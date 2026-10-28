#!/usr/bin/env python3
"""Package source, never local signing keys, downloaded tools or generated assets."""
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "dist/a-dark-room-offline-source.zip"
EXCLUDED_DIRS = {".git", ".local", ".tools", "dist", "node_modules", "__pycache__"}
GENERATED = Path("android/app/src/main/assets")


def package():
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    count = 0
    with ZipFile(OUTPUT, "w", ZIP_DEFLATED, compresslevel=9) as archive:
        for path in sorted(ROOT.rglob("*")):
            relative = path.relative_to(ROOT)
            if any(part in EXCLUDED_DIRS for part in relative.parts):
                continue
            if relative == GENERATED or GENERATED in relative.parents:
                continue
            if not path.is_file():
                continue
            if path.suffix.lower() in {".jks", ".keystore", ".p12", ".pfx"}:
                raise RuntimeError(f"Private signing material must not be packaged: {relative}")
            archive.write(path, relative.as_posix())
            count += 1
    print(f"Packaged {count} source files: {OUTPUT} ({OUTPUT.stat().st_size:,} bytes)")


if __name__ == "__main__":
    package()
