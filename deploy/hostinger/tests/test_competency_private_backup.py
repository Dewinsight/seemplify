"""Execute the production heredocs against synthetic, isolated private files."""
import hashlib
import io
import json
import os
import pathlib
import re
import stat
import subprocess
import sys
import tarfile
import tempfile
import unittest

HOSTINGER = pathlib.Path(__file__).resolve().parents[1]
KEY = "12345678-1234-4234-8234-123456789abc"


def block(filename, marker):
    source = (HOSTINGER / filename).read_text(encoding="utf-8")
    return source.split("<<'" + marker + "'\n", 1)[1].split("\n" + marker, 1)[0]


@unittest.skipUnless(os.name == "posix", "Private backup permissions and symlinks require actual POSIX semantics")
class PrivateBackupTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="seemplify-backup-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        self.source = self.root / "private"
        self.source.mkdir(mode=0o700)
        self.destination = self.root / "backup"
        self.destination.mkdir(mode=0o700)
        self.payload = b"Synthetic private competency source\x00\n"
        (self.source / KEY).write_bytes(self.payload)
        (self.source / KEY).chmod(0o600)

    def archive(self):
        return subprocess.run([sys.executable, "-c", block("backup-hostinger.sh", "COMPETENCY_ARCHIVE_PY"),
            str(self.destination), str(self.source)], capture_output=True, text=True)

    def restore(self):
        return subprocess.run([sys.executable, "-c", block("restore-smoke-hostinger.sh", "COMPETENCY_RESTORE_PY"),
            str(self.destination)], capture_output=True, text=True)

    def good_archive(self):
        result = self.archive()
        self.assertEqual(result.returncode, 0, result.stderr)

    def rewrite(self, *, name=KEY, payload=None, mode=0o600, kind=tarfile.REGTYPE, duplicate=False, empty=False):
        archive = self.destination / "competency-private.tar.gz"
        with tarfile.open(archive, "w:gz") as stream:
            if not empty:
                info = tarfile.TarInfo(name)
                info.type = kind
                info.mode = mode
                info.linkname = "../../outside"
                data = self.payload if payload is None else payload
                info.size = len(data) if kind == tarfile.REGTYPE else 0
                stream.addfile(info, io.BytesIO(data) if kind == tarfile.REGTYPE else None)
                if duplicate:
                    stream.addfile(info, io.BytesIO(data))
        archive.chmod(0o600)

    def test_real_roundtrip_hash_permissions_and_source_unchanged(self):
        self.good_archive()
        result = self.restore()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("isolated restore ok files=1", result.stdout)
        self.assertNotIn(KEY, result.stdout)
        manifest = json.loads((self.destination / "competency-private.manifest.json").read_text())
        self.assertEqual(manifest["files"][0]["sha256"], hashlib.sha256(self.payload).hexdigest())
        for name in ("competency-private.tar.gz", "competency-private.manifest.json"):
            self.assertEqual(stat.S_IMODE((self.destination / name).stat().st_mode), 0o600)
        self.assertEqual((self.source / KEY).read_bytes(), self.payload)

    def test_empty_configured_private_folder_restores(self):
        (self.source / KEY).unlink()
        self.good_archive()
        self.assertEqual(self.restore().returncode, 0)

    def test_unconfigured_legacy_backup_has_no_private_archive(self):
        self.assertEqual(self.restore().returncode, 0)

    def test_hash_mismatch_rejected(self):
        self.good_archive()
        self.rewrite(payload=b"X" * len(self.payload))
        self.assertNotEqual(self.restore().returncode, 0)

    def test_unsafe_members_rejected(self):
        self.good_archive()
        cases = [dict(name="../outside"), dict(name="/tmp/outside"), dict(name="unknown"),
                 dict(kind=tarfile.SYMTYPE), dict(kind=tarfile.LNKTYPE), dict(mode=0o644),
                 dict(duplicate=True), dict(empty=True)]
        for case in cases:
            with self.subTest(case=case):
                self.rewrite(**case)
                self.assertNotEqual(self.restore().returncode, 0)

    def test_archive_missing_manifest_rejected(self):
        self.good_archive()
        (self.destination / "competency-private.manifest.json").unlink()
        self.assertNotEqual(self.restore().returncode, 0)

    def test_manifest_unknown_and_duplicate_keys_rejected(self):
        self.good_archive()
        path = self.destination / "competency-private.manifest.json"
        original = json.loads(path.read_text())
        for key in ("../outside", "another", KEY):
            with self.subTest(key=key):
                manifest = json.loads(json.dumps(original))
                manifest["files"].append({**manifest["files"][0], "key": key})
                path.write_text(json.dumps(manifest))
                self.assertNotEqual(self.restore().returncode, 0)

    def test_backup_permissions_rejected(self):
        self.good_archive()
        for name in ("competency-private.tar.gz", "competency-private.manifest.json"):
            with self.subTest(name=name):
                path = self.destination / name
                path.chmod(0o644)
                self.assertNotEqual(self.restore().returncode, 0)
                path.chmod(0o600)

    def test_source_symlink_and_unknown_name_rejected(self):
        for name in ("unknown", "abcdefab-cdef-4abc-8abc-abcdefabcdef"):
            with self.subTest(name=name):
                item = self.source / name
                item.symlink_to(self.source / KEY)
                self.assertNotEqual(self.archive().returncode, 0)
                item.unlink()

    def test_source_modes_rejected(self):
        self.source.chmod(0o755)
        self.assertNotEqual(self.archive().returncode, 0)
        self.source.chmod(0o700)
        (self.source / KEY).chmod(0o644)
        self.assertNotEqual(self.archive().returncode, 0)

    def test_shell_pair_resumes_only_paused_writer_on_success_and_dump_failure(self):
        binary = self.root / "bin"
        binary.mkdir()
        docker = binary / "docker"
        docker.write_text("""#!/usr/bin/env python3
import os, sys
args = sys.argv[1:]
if args[0] == 'ps':
    print('private-writer')
elif args[0] == 'inspect' and '--format' in args:
    print('writer' if '.Mounts' in args[args.index('--format') + 1] else 'running')
elif args[0] in ['pause', 'unpause']:
    with open(os.environ['TEST_DOCKER_LOG'], 'a') as stream:
        stream.write(args[0] + ':' + args[1] + '\\n')
elif args[0] == 'exec':
    if os.environ.get('TEST_FAIL_DUMP') == 'yes':
        sys.exit(2)
    print('synthetic database dump')
""", encoding="utf-8")
        docker.chmod(0o700)
        template = (HOSTINGER / "backup-hostinger.sh").read_text(encoding="utf-8")
        template = template.split("docker exec seemplify-shared-experience-postgres-1", 1)[0]
        for failure in ("none", "dump", "archive"):
            with self.subTest(failure=failure):
                fails = failure != "none"
                (self.source / KEY).chmod(0o644 if failure == "archive" else 0o600)
                backup = self.root / (failure + "-backup")
                script = template.replace("/var/backups/seemplify", str(backup))
                script = script.replace("/opt/seemplify/data/competency", str(self.source))
                script = script.replace("/run/lock/seemplify-backup.lock", str(self.root / "backup.lock"))
                log = self.root / "docker-actions"
                log.write_text("")
                env = {**os.environ, "PATH": str(binary) + ":" + os.environ["PATH"],
                    "TEST_DOCKER_LOG": str(log), "TEST_FAIL_DUMP": "yes" if failure == "dump" else "no"}
                result = subprocess.run(["bash", "-c", script], capture_output=True, text=True, env=env)
                self.assertEqual(result.returncode == 0, not fails, result.stderr)
                self.assertEqual(log.read_text().splitlines(), ["pause:private-writer", "unpause:private-writer"])
                self.assertEqual(len(list(backup.glob("*/FAILED"))), int(fails))


if __name__ == "__main__":
    unittest.main()
