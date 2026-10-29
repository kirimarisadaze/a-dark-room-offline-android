# SPDX-License-Identifier: MPL-2.0
"""Exercise CI signing boundaries and exact-source packaging without real secrets."""

import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import zipfile

SPEC = importlib.util.spec_from_file_location("ci_android", Path(__file__).with_name("ci-android.py"))
CI = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CI)
CERTIFICATE = "a" * 64
INFO = {"packageName": CI.PACKAGE, "version": "1.3.2", "versionCode": 21, "certificateSha256": CERTIFICATE}
SIGNATURE = ("Verified using v1 scheme (JAR signing): true\n"
             "Verified using v2 scheme (APK Signature Scheme v2): true\n"
             "Signer #1 certificate SHA-256 digest: " + CERTIFICATE + "\n")
BADGING = "package: name='org.adarkroom.offline' versionCode='21' versionName='1.3.2' platformBuildVersionName='15'\n"


class AndroidCiTests(unittest.TestCase):
    """Check failure boundaries which could otherwise ship the wrong application."""

    def test_signing_requires_trusted_event_and_ref(self):
        """Keep PRs, forks, local runs and non-main refs away from release signing."""
        valid = {"GITHUB_ACTIONS": "true", "GITHUB_REPOSITORY": CI.REPOSITORY,
                 "GITHUB_REF": "refs/heads/main", "GITHUB_EVENT_NAME": "workflow_dispatch"}
        with patch.dict(os.environ, valid, clear=True):
            CI.trusted_signing_environment()
        for name, value in [("GITHUB_ACTIONS", "false"), ("GITHUB_REPOSITORY", "someone/fork"),
                            ("GITHUB_REF", "refs/heads/test"), ("GITHUB_REF", "refs/pull/2/merge"),
                            ("GITHUB_EVENT_NAME", "pull_request"), ("GITHUB_EVENT_NAME", "pull_request_target")]:
            with self.subTest(name=name, value=value), patch.dict(os.environ, {**valid, name: value}, clear=True):
                with self.assertRaises(ValueError):
                    CI.trusted_signing_environment()

    def test_only_original_single_signer_and_both_schemes_are_accepted(self):
        """Reject replacement identities and binaries missing an Android 6-compatible signature."""
        CI.inspect_verified_apk(SIGNATURE, BADGING, INFO)
        for signature in [SIGNATURE.replace(CERTIFICATE, "b" * 64), SIGNATURE.replace("v1 scheme (JAR signing): true", "v1 scheme (JAR signing): false"),
                          SIGNATURE.replace("v2 scheme (APK Signature Scheme v2): true", "v2 scheme (APK Signature Scheme v2): false"),
                          SIGNATURE + "Signer #2 certificate SHA-256 digest: " + CERTIFICATE + "\n"]:
            with self.subTest(signature=signature), self.assertRaises(ValueError):
                CI.inspect_verified_apk(signature, BADGING, INFO)

    def test_apk_must_match_committed_package_and_both_version_fields(self):
        """Reject an unrelated APK or a stale binary even when its signature is valid."""
        for badging in [BADGING.replace(CI.PACKAGE, "org.example.other"), BADGING.replace("versionCode='21'", "versionCode='20'"),
                        BADGING.replace("versionName='1.3.2'", "versionName='1.3.1'"), ""]:
            with self.subTest(badging=badging), self.assertRaises(ValueError):
                CI.inspect_verified_apk(SIGNATURE, badging, INFO)

    def test_source_archive_matches_git_and_ignores_private_worktree_files(self):
        """Preserve committed bytes across checkout newlines while excluding local signing files."""
        with tempfile.TemporaryDirectory(prefix="adr-ci-test-") as directory:
            root = Path(directory)
            subprocess.run(["git", "init", "--quiet", str(root)], check=True)
            (root / ".gitignore").write_text(".local/\n", encoding="ascii")
            (root / ".gitattributes").write_text("*.txt text eol=lf\n", encoding="ascii")
            (root / "source.txt").write_bytes(b"original\n")
            subprocess.run(["git", "-C", str(root), "add", "."], check=True)
            subprocess.run(["git", "-C", str(root), "-c", "user.name=CI Test", "-c", "user.email=ci@example.invalid",
                            "commit", "--quiet", "-m", "Fixture"], check=True)
            (root / "source.txt").write_bytes(b"original\r\n")
            private = root / ".local/signing"
            private.mkdir(parents=True)
            (private / "keystore-password.txt").write_text("fixture-private", encoding="ascii")
            archive = root / ".local/source.zip"
            subprocess.run(["git", "-c", "core.autocrlf=false", "-c", "core.eol=lf", "-C", str(root),
                            "archive", "--format=zip", "--output=" + str(archive), "HEAD"], check=True)
            CI.validate_source(root, archive, "HEAD")
            with zipfile.ZipFile(archive) as zipped:
                self.assertEqual(zipped.read("source.txt"), b"original\n")
                self.assertNotIn(".local/signing/keystore-password.txt", zipped.namelist())
            with zipfile.ZipFile(archive, "a") as zipped:
                zipped.writestr(".local/signing/keystore-password.txt", "fixture-private")
            with self.assertRaises(ValueError):
                CI.validate_source(root, archive, "HEAD")

    def test_existing_signing_files_are_never_overwritten(self):
        """Refuse a nonempty signing directory before writing decoded secrets."""
        valid = {"GITHUB_ACTIONS": "true", "GITHUB_REPOSITORY": CI.REPOSITORY,
                 "GITHUB_REF": "refs/heads/main", "GITHUB_EVENT_NAME": "push",
                 "ANDROID_KEYSTORE_BASE64": "Zml4dHVyZQ==", "ANDROID_KEYSTORE_PASSWORD": "fixture-password"}
        with tempfile.TemporaryDirectory(prefix="adr-ci-key-") as directory:
            root = Path(directory)
            private = root / ".local/signing"
            private.mkdir(parents=True)
            key = private / "a-dark-room-offline.jks"
            key.write_bytes(b"existing")
            (private / CI.SIGNING_MARKER).write_text("previous-run-token", encoding="ascii")
            with patch.dict(os.environ, valid, clear=True), patch.object(CI, "metadata", return_value=INFO):
                with self.assertRaises(ValueError):
                    CI.restore_signing(root)
                CI.clean_signing(root)
            self.assertEqual(key.read_bytes(), b"existing")
            self.assertEqual((private / CI.SIGNING_MARKER).read_text(encoding="ascii"), "previous-run-token")

    def test_failed_signing_restoration_removes_its_own_files(self):
        """Clean up a rejected or unusable key without retaining signing material."""
        valid = {"GITHUB_ACTIONS": "true", "GITHUB_REPOSITORY": CI.REPOSITORY,
                 "GITHUB_REF": "refs/heads/main", "GITHUB_EVENT_NAME": "push", "JAVA_HOME": "fixture-jdk",
                 "ANDROID_KEYSTORE_BASE64": "Zml4dHVyZQ==", "ANDROID_KEYSTORE_PASSWORD": "fixture-password"}
        with tempfile.TemporaryDirectory(prefix="adr-ci-clean-") as directory:
            root = Path(directory)
            valid["GITHUB_ENV"] = str(root / "github-env")
            with patch.dict(os.environ, valid, clear=True), patch.object(CI, "metadata", return_value=INFO), \
                    patch.object(CI.subprocess, "run", return_value=subprocess.CompletedProcess([], 1)):
                with self.assertRaises(ValueError):
                    CI.restore_signing(root)
            private = root / ".local/signing"
            self.assertTrue(private.is_dir())
            self.assertEqual(list(private.iterdir()), [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
