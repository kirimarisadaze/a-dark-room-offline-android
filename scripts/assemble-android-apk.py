#!/usr/bin/env python3
"""Assemble an unsigned APK with explicit POSIX asset paths on every host OS.

Windows aapt2 -A may emit backslashes inside ZIP entry names. Python's ZipInfo
normalizes its `filename` on Windows, so inspect `orig_filename` when validating.
The caller must zipalign and sign the returned unsigned APK.
"""

import argparse
import json
from pathlib import Path, PurePosixPath
import zipfile


def validate_apk(path: Path, expected_assets: dict[str, bytes]) -> dict:
    with zipfile.ZipFile(path) as archive:
        entries = archive.infolist()
        original_names = [entry.orig_filename for entry in entries]
        invalid = [name for name in original_names if "\\" in name or "\x00" in name]
        if invalid:
            raise RuntimeError(f"Non-POSIX raw ZIP entry names: {invalid[:5]}")
        if len(original_names) != len(set(original_names)):
            raise RuntimeError("Duplicate raw ZIP entry names")
        for name in original_names:
            if name.startswith("/") or any(part in (".", "..") for part in name.split("/")):
                raise RuntimeError(f"Invalid ZIP entry path: {name!r}")
        for name, content in expected_assets.items():
            if name not in original_names or archive.read(name) != content:
                raise RuntimeError(f"Missing or modified APK asset: {name}")
        for required in ("AndroidManifest.xml", "resources.arsc", "classes.dex", "assets/game/index.html"):
            if required not in original_names:
                raise RuntimeError(f"Missing required APK entry: {required}")
        index = archive.read("assets/game/index.html").decode("utf-8")
        if "<!doctype html" not in index.lower() or "<head>" not in index.lower() or "</html>" not in index.lower():
            raise RuntimeError("Bundled index.html is incomplete or not HTML")
        for required in ("assets/game/lib/jquery.min.js", "assets/game/script/engine.js",
                         "assets/game/script/room.js", "assets/game/offline.js",
                         "assets/game/mobile.css", "assets/game/lang/zh_cn/strings.js",
                         "assets/game/home.html", "assets/game/home.js", "assets/game/home.css",
                         "assets/game/save-slots.js",
                         "assets/game/zh-cn-extra.js", "assets/game/audio/light-fire.flac"):
            if required not in original_names or not archive.read(required):
                raise RuntimeError(f"Missing or empty core game asset: {required}")
        corrupt = archive.testzip()
        if corrupt:
            raise RuntimeError(f"ZIP integrity check failed: {corrupt}")
        return {"entries": len(entries), "assets": len(expected_assets),
                "rawBackslashEntries": 0, "indexEntry": "assets/game/index.html"}


def assemble(resource_apk: Path, assets_root: Path, dex_file: Path, output: Path) -> dict:
    resource_apk, assets_root, dex_file, output = (
        path.resolve() for path in (resource_apk, assets_root, dex_file, output)
    )
    if not resource_apk.is_file() or not dex_file.is_file() or not assets_root.is_dir():
        raise ValueError("Resource APK, assets directory and classes.dex must exist")
    if output in (resource_apk, dex_file) or output.is_relative_to(assets_root):
        raise ValueError("Output must not overwrite an input or be inside the assets directory")
    assets = {}
    for asset in sorted(assets_root.rglob("*")):
        if asset.is_file():
            relative = asset.relative_to(assets_root)
            name = "assets/" + PurePosixPath(*relative.parts).as_posix()
            if "\\" in name or "\x00" in name:
                raise ValueError(f"Unsupported source asset path: {asset}")
            assets[name] = asset.read_bytes()
    if "assets/game/index.html" not in assets:
        raise ValueError("Assets directory must contain game/index.html")

    output.parent.mkdir(parents=True, exist_ok=True)
    written = set()
    with zipfile.ZipFile(resource_apk) as source, zipfile.ZipFile(output, "w") as destination:
        for original in source.infolist():
            name = original.orig_filename.replace("\\", "/")
            # Replace any prior bundled assets or bytecode and discard stale signatures.
            if name.startswith(("assets/", "META-INF/")) or name == "classes.dex":
                continue
            if name in written:
                raise ValueError(f"Duplicate resource entry: {name}")
            entry = zipfile.ZipInfo(name, original.date_time)
            entry.compress_type = original.compress_type
            entry.external_attr = original.external_attr
            destination.writestr(entry, source.read(original))
            written.add(name)
        for name, content in assets.items():
            if name in written:
                raise ValueError(f"Duplicate asset entry: {name}")
            entry = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
            entry.compress_type = zipfile.ZIP_DEFLATED
            destination.writestr(entry, content)
            written.add(name)
        destination.writestr("classes.dex", dex_file.read_bytes(), compress_type=zipfile.ZIP_DEFLATED)
    return validate_apk(output, assets)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    pack = commands.add_parser("pack", help="Build an unsigned APK from resources, assets and bytecode")
    pack.add_argument("--resources", required=True, type=Path)
    pack.add_argument("--assets", required=True, type=Path)
    pack.add_argument("--dex", required=True, type=Path)
    pack.add_argument("--output", required=True, type=Path)
    verify = commands.add_parser("verify", help="Inspect raw ZIP paths and bundled source asset integrity")
    verify.add_argument("apk", type=Path)
    verify.add_argument("--assets", type=Path, default=Path(__file__).resolve().parents[1] / "android/app/src/main/assets")
    args = parser.parse_args()
    if args.command == "pack":
        result = assemble(args.resources, args.assets, args.dex, args.output)
    else:
        assets = {"assets/" + PurePosixPath(*asset.relative_to(args.assets).parts).as_posix(): asset.read_bytes()
                  for asset in args.assets.rglob("*") if asset.is_file()}
        if not assets or "assets/game/index.html" not in assets:
            raise RuntimeError("Generated source assets are absent; prepare assets before verification")
        result = validate_apk(args.apk, assets)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
