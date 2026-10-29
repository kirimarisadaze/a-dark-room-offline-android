# SPDX-License-Identifier: MPL-2.0
"""Adapt the existing offline Android build to trusted GitHub Actions runs."""

import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import sys
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[1]
REPOSITORY = "kirimarisadaze/a-dark-room-offline-android"
PACKAGE = "org.adarkroom.offline"
ANDROID = "{http://schemas.android.com/apk/res/android}"
SIGNING_FILES = ("a-dark-room-offline.jks", "keystore-password.txt", "ci-certificate.der")
SIGNING_MARKER = ".ci-owned"


def git(root, *arguments):
    """Read Git data without exposing credentials or changing the checkout."""
    return subprocess.check_output(["git", "-C", str(root), *arguments])


def metadata(root):
    """Read the actual application version and historical signing certificate."""
    manifest = ET.parse(root / "android/app/src/main/AndroidManifest.xml").getroot()
    version = manifest.get(ANDROID + "versionName", "")
    code = manifest.get(ANDROID + "versionCode", "")
    if manifest.get("package") != PACKAGE or not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise ValueError("Unexpected Android package or version")
    if not re.fullmatch(r"[1-9]\d*", code):
        raise ValueError("Invalid Android versionCode")
    releases = json.loads((root / "docs/releases.json").read_text(encoding="utf-8"))
    current = next(item for item in releases["releases"] if item["version"] == releases["latest"])
    certificate = current["certificateSha256"].lower()
    if not re.fullmatch(r"[a-f0-9]{64}", certificate):
        raise ValueError("Missing historical signing certificate SHA-256")
    commit = git(root, "rev-parse", "HEAD").decode().strip()
    tree = git(root, "rev-parse", "HEAD^{tree}").decode().strip()
    return {"version": version, "versionCode": int(code), "packageName": PACKAGE,
            "certificateSha256": certificate, "commit": commit, "tree": tree,
            "artifact_name": "android-" + version + "-" + commit[:12]}


def trusted_signing_environment():
    """Reject signing outside a main-branch push or manual Actions run."""
    if (os.environ.get("GITHUB_ACTIONS") != "true" or
            os.environ.get("GITHUB_REPOSITORY") != REPOSITORY or
            os.environ.get("GITHUB_REF") != "refs/heads/main" or
            os.environ.get("GITHUB_EVENT_NAME") not in ("push", "workflow_dispatch")):
        raise ValueError("Original signing is restricted to trusted main-branch builds")


def signing_root(root):
    """Resolve the single private signing directory without following redirects."""
    target = root / ".local/signing"
    if target.resolve() != root.resolve() / ".local/signing":
        raise ValueError("Signing directory must not be redirected")
    return target


def clean_signing(root):
    """Remove only the three temporary signing files in an Actions build."""
    trusted_signing_environment()
    directory = signing_root(root)
    marker = directory / SIGNING_MARKER
    ownership = os.environ.get("ADR_CI_SIGNING_TOKEN", "")
    if (not ownership or not marker.is_file() or marker.is_symlink() or
            marker.read_text(encoding="ascii") != ownership):
        return
    for name in SIGNING_FILES:
        path = directory / name
        if path.is_file() or path.is_symlink():
            path.unlink()
    marker.unlink()


def restore_signing(root):
    """Restore private Actions secrets and check the original certificate first."""
    trusted_signing_environment()
    info = metadata(root)
    encoded = os.environ.get("ANDROID_KEYSTORE_BASE64", "")
    password = os.environ.get("ANDROID_KEYSTORE_PASSWORD", "").rstrip("\r\n")
    if not encoded or not password or "\n" in password or "\r" in password:
        raise ValueError("Original signing Secrets are missing or invalid")
    try:
        key = base64.b64decode(encoded, validate=True)
        password_bytes = (password + "\n").encode("ascii")
    except (ValueError, UnicodeError):
        raise ValueError("Original signing Secrets have an invalid format") from None
    if not key:
        raise ValueError("Original signing keystore is empty")
    directory = signing_root(root)
    if any((directory / name).exists() or (directory / name).is_symlink() for name in (*SIGNING_FILES, SIGNING_MARKER)):
        raise ValueError("Refusing to replace existing signing files")
    environment_file = os.environ.get("GITHUB_ENV")
    if not environment_file:
        raise ValueError("Missing Actions environment state file")
    directory.mkdir(parents=True, exist_ok=True)
    try:
        ownership = secrets.token_hex(32)
        with open(environment_file, "a", encoding="utf-8") as output:
            output.write("ADR_CI_SIGNING_TOKEN=" + ownership + "\n")
        os.environ["ADR_CI_SIGNING_TOKEN"] = ownership
        (directory / SIGNING_MARKER).write_text(ownership, encoding="ascii")
        (directory / SIGNING_FILES[0]).write_bytes(key)
        (directory / SIGNING_FILES[1]).write_bytes(password_bytes)
        for name in SIGNING_FILES[:2]:
            (directory / name).chmod(0o600)
        keytool = Path(os.environ["JAVA_HOME"]) / "bin/keytool.exe"
        result = subprocess.run([str(keytool), "-exportcert", "-keystore", str(directory / SIGNING_FILES[0]),
                                 "-alias", "adarkroom-offline", "-storepass:file", str(directory / SIGNING_FILES[1]),
                                 "-file", str(directory / SIGNING_FILES[2])], capture_output=True)
        if result.returncode:
            raise ValueError("Cannot validate the original signing keystore")
        actual = hashlib.sha256((directory / SIGNING_FILES[2]).read_bytes()).hexdigest()
        if actual != info["certificateSha256"]:
            raise ValueError("Signing certificate does not match the historical Release")
    except BaseException:
        clean_signing(root)
        raise
    print("Original signing certificate verified: " + actual)


def inspect_verified_apk(signature, badging, info):
    """Check real APK signature output, package name and both version fields."""
    fingerprints = re.findall(r"^Signer #\d+ certificate SHA-256 digest: ([a-fA-F0-9]{64})\s*$", signature, re.M)
    if len(fingerprints) != 1 or fingerprints[0].lower() != info["certificateSha256"]:
        raise ValueError("APK signing identity differs from the original Release")
    for scheme in ("v1", "v2"):
        if not re.search(r"Verified using " + scheme + r" scheme[^\r\n]*: true", signature):
            raise ValueError("APK is missing a verified " + scheme + " signature")
    package = re.search(r"^package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'", badging, re.M)
    if not package or package.groups() != (info["packageName"], str(info["versionCode"]), info["version"]):
        raise ValueError("APK package or version differs from the committed manifest")


def verify_apk(root, apk, info):
    """Verify the built binary using SDK tools before exporting any artifact."""
    sdk = Path(os.environ["ANDROID_HOME"]) / "build-tools/35.0.0"
    java = Path(os.environ["JAVA_HOME"]) / "bin/java.exe"
    signature = subprocess.check_output([str(java), "-jar", str(sdk / "lib/apksigner.jar"),
                                         "verify", "--verbose", "--print-certs", str(apk)]).decode()
    badging = subprocess.check_output([str(sdk / "aapt2.exe"), "dump", "badging", str(apk)]).decode()
    inspect_verified_apk(signature, badging, info)
    subprocess.run([str(sdk / "zipalign.exe"), "-c", "4", str(apk)], check=True)
    permissions = subprocess.check_output([str(sdk / "aapt2.exe"), "dump", "permissions", str(apk)]).decode()
    if "android.permission.INTERNET" in permissions:
        raise ValueError("Offline APK unexpectedly requests Internet permission")
    subprocess.run([sys.executable, str(root / "scripts/assemble-android-apk.py"), "verify", str(apk)], check=True)


def validate_source(root, archive, commit):
    """Require every source ZIP member to match the exact committed Git blob."""
    paths = git(root, "ls-tree", "-r", "--name-only", commit).decode().splitlines()
    with zipfile.ZipFile(archive) as zipped:
        members = [item.filename for item in zipped.infolist() if not item.is_dir()]
        if len(set(members)) != len(members) or set(members) != set(paths):
            raise ValueError("Source archive does not match the committed file list")
        for name in members:
            parts = Path(name).parts
            if (any(part in (".local", ".tools", ".git", "node_modules", "dist") for part in parts) or
                    name.startswith("android/app/src/main/assets/") or
                    Path(name).suffix.lower() in (".jks", ".keystore", ".p12", ".pfx") or
                    Path(name).name == "keystore-password.txt" or
                    (Path(name).name.startswith(".env") and Path(name).name != ".env.example")):
                raise ValueError("Private or generated material must not enter source artifacts")
            if zipped.read(name) != git(root, "show", commit + ":" + name):
                raise ValueError("Source archive differs from Git: " + name)


def package(root):
    """Export verified APK, committed source and public build provenance only."""
    info = metadata(root)
    if subprocess.run(["git", "-C", str(root), "diff", "--quiet", "HEAD", "--"]).returncode:
        raise ValueError("Tracked source changed after checkout")
    apk = root / "dist/a-dark-room-offline.apk"
    verify_apk(root, apk, info)
    output = root / "dist/ci-artifacts"
    output.mkdir(parents=True, exist_ok=True)
    if any(output.iterdir()):
        raise ValueError("Artifact output directory must start empty")
    stem = "a-dark-room-offline-" + info["version"]
    destination = output / (stem + ".apk")
    source = output / (stem + "-source.zip")
    shutil.copyfile(apk, destination)
    subprocess.run(["git", "-c", "core.autocrlf=false", "-c", "core.eol=lf", "-C", str(root),
                    "archive", "--format=zip", "--output=" + str(source), info["commit"]], check=True)
    validate_source(root, source, info["commit"])
    info["files"] = {}
    for path in (destination, source):
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        info["files"][path.name] = {"sha256": digest, "bytes": path.stat().st_size}
        (output / (path.name + ".sha256")).write_text(digest + "  " + path.name + "\n", encoding="ascii")
    (output / "build-info.json").write_text(json.dumps(info, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(info, ensure_ascii=False))


def main():
    """Run a narrowly scoped CI command without printing any signing secret."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("metadata", "restore-signing", "clean-signing", "package"))
    args = parser.parse_args()
    if args.command == "metadata":
        info = metadata(ROOT)
        if os.environ.get("GITHUB_OUTPUT"):
            with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
                for name in ("version", "artifact_name"):
                    output.write(name + "=" + info[name] + "\n")
        print(json.dumps(info))
    elif args.command == "restore-signing":
        restore_signing(ROOT)
    elif args.command == "clean-signing":
        clean_signing(ROOT)
    else:
        package(ROOT)


if __name__ == "__main__":
    main()
