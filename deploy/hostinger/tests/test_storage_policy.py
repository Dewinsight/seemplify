import gzip
import hashlib
import importlib.util
import io
import json
import os
import sqlite3
import subprocess
import sys
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

HOST = Path(__file__).resolve().parents[1]


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, HOST / filename)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


cache = module('cache', 'runner-cache-maintenance.py')
storage = module('storage', 'storage-maintenance.py')
source = (HOST / 'backup-hostinger.sh').read_text()
block = source.split("<<'BACKUP_RETENTION_PY'\n", 1)[1].split('\nBACKUP_RETENTION_PY', 1)[0]
retention = {'__name__': 'retention_test'}
exec(compile(block, 'backup-retention', 'exec'), retention)


@unittest.skipUnless(os.name == 'posix', 'Production Linux symlink and gzip contracts')
class BackupRetention(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.old = self.root / '20261021T011735Z'
        self.old.mkdir()
        self.old.joinpath('precious').write_bytes(b'only good copy')
        self.root.joinpath('latest').symlink_to(self.old.name)
        self.new = self.root / '20261022T011735Z'
        self.new.mkdir()
        self.files = ['mongodb.archive.gz', 'production-configuration.tar.gz', 'metadata.txt',
                      'experience-postgres.sql.gz', 'dokploy-postgres.sql.gz', 'mail-mariadb.sql.gz',
                      'shared-redis.rdb', 'chatgpt-gateway-data.tar.gz', 'workspace-uploads.tar.gz', 'managed-cv-backup.json']
        for name in self.files:
            data = gzip.compress(b'backup') if name.endswith('.gz') else b'backup'
            self.new.joinpath(name).write_bytes(data)
        self.manifest()

    def manifest(self):
        self.new.joinpath('SHA256SUMS').write_text(''.join(
            hashlib.sha256(self.new.joinpath(n).read_bytes()).hexdigest() + '  ./' + n + '\n' for n in self.files))

    def finalize(self):
        retention['finalize'](self.root, self.new.name)

    def test_verified_replacement_retires_old_but_keeps_hardlinked_models_and_newer_work(self):
        self.old.joinpath('milo-models.tar.gz').write_bytes(gzip.compress(b'model'))
        os.link(self.old / 'milo-models.tar.gz', self.new / 'milo-models.tar.gz')
        self.files.append('milo-models.tar.gz'); self.manifest()
        pending = self.root / '20261023T000000Z'; pending.mkdir()
        unknown = self.root / 'custom-archive'; unknown.mkdir()
        self.finalize()
        self.assertFalse(self.old.exists())
        self.assertEqual((self.root / 'latest').resolve(), self.new)
        self.assertEqual(gzip.decompress((self.new / 'milo-models.tar.gz').read_bytes()), b'model')
        self.assertTrue(pending.exists()); self.assertTrue(unknown.exists())

    def test_checksum_failure_preserves_previous_good_backup_and_pointer(self):
        self.new.joinpath('mongodb.archive.gz').write_bytes(b'truncated')
        with self.assertRaises(ValueError): self.finalize()
        self.assertTrue(self.old.exists()); self.assertEqual((self.root / 'latest').resolve(), self.old)

    def test_failed_or_unmanifested_replacement_cannot_retire_previous(self):
        self.new.joinpath('FAILED').touch()
        with self.assertRaises(ValueError): self.finalize()
        self.new.joinpath('FAILED').unlink(); self.new.joinpath('uncovered').touch()
        with self.assertRaises(ValueError): self.finalize()
        self.assertTrue(self.old.exists())

    def test_symlink_payload_cannot_escape_backup_root(self):
        file = self.new / 'metadata.txt'; file.unlink(); file.symlink_to(self.old / 'precious')
        with self.assertRaises(ValueError): self.finalize()
        self.assertTrue(self.old.exists())

    def test_corrupt_compressed_stream_with_valid_checksum_cannot_replace_backup(self):
        self.new.joinpath('mongodb.archive.gz').write_bytes(b'corrupt gzip')
        self.manifest()
        with self.assertRaises(Exception): self.finalize()
        self.assertTrue(self.old.exists()); self.assertEqual((self.root / 'latest').resolve(), self.old)


class ArchiveRetention(unittest.TestCase):
    @unittest.skipUnless(os.name == 'posix', 'Production Linux symlink and tar contracts')
    def test_keeps_one_readable_archive_ignores_partial_and_symlinks(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            for i in range(3):
                p = root / (str(i)*40 + '.tar.gz')
                with tarfile.open(p, 'w:gz') as stream:
                    item = tarfile.TarInfo('data'); item.size = 4
                    stream.addfile(item, io.BytesIO(b'data'))
                os.utime(p, (i+1, i+1))
            (root / 'upload.partial.tar.gz').write_bytes(b'partial')
            (root / ('a'*40 + '.tar.gz')).symlink_to(root / ('2'*40 + '.tar.gz'))
            removed = storage.prune_archives(root, r'[a-f0-9]{40}\.tar\.gz', True)
            self.assertEqual(len(removed), 2)
            self.assertTrue((root / ('2'*40 + '.tar.gz')).exists())
            self.assertTrue((root / 'upload.partial.tar.gz').exists())

    def test_corrupt_newest_archive_preserves_all_previous_copies(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            for i in range(2):
                p = root / (str(i)*40 + '.tar.gz'); p.write_bytes(b'broken'); os.utime(p, (i+1, i+1))
            with self.assertRaises(Exception): storage.prune_archives(root, r'[a-f0-9]{40}\.tar\.gz', True)
            self.assertEqual(len(list(root.iterdir())), 2)


class QueueSnapshotVerification(unittest.TestCase):
    def test_restore_check_does_not_add_sidecars_to_checksum_covered_snapshot(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d); path=root/'hostinger-ci-queue.sqlite3'
            with sqlite3.connect(path) as db:
                db.execute('pragma journal_mode=wal')
                db.execute('create table jobs(id integer)')
            db.close()
            original=hashlib.sha256(path.read_bytes()).hexdigest()
            text=(HOST/'restore-smoke-hostinger.sh').read_text()
            code=text.split("<<'QUEUE_RESTORE_PY'\n",1)[1].split('\nQUEUE_RESTORE_PY',1)[0]
            subprocess.run([sys.executable,'-c',code,str(root)],check=True,capture_output=True)
            self.assertEqual(sorted(p.name for p in root.iterdir()), ['hostinger-ci-queue.sqlite3'])
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), original)


class RunnerCache(unittest.TestCase):
    def row(self):
        return [{'State': {'Running': True}, 'Config': {'User': 'runner', 'Env': [
            'ACTIONS_RUNNER_HOOK_JOB_STARTED=/runner/hooks/ci-slot-started.sh']},
            'Mounts': [{'Destination': '/runner', 'Source': str(cache.STATE)}]}]

    def test_existing_worker_cannot_trigger_cache_deletion(self):
        with patch.object(cache, 'command', side_effect=[json.dumps(self.row()), 'comm\nRunner.Worker']) as call:
            self.assertIn('skipped', cache.maintain(True))
            self.assertEqual(call.call_count, 2)

    def test_changed_hook_contract_fails_before_cache_access(self):
        row = self.row(); row[0]['Config']['Env'] = []
        with patch.object(cache, 'command', return_value=json.dumps(row)) as call:
            with self.assertRaises(RuntimeError): cache.maintain(True)
            self.assertEqual(call.call_count, 1)

    def test_below_threshold_cache_is_preserved(self):
        with patch.object(cache, 'command', side_effect=[json.dumps(self.row()), 'comm\nRunner.Listener', '/home/runner/.npm', '500 .npm', '500 .npm']), patch.object(cache.subprocess, 'run') as mutation:
            self.assertFalse(cache.maintain(True)['cleaned']); mutation.assert_not_called()

    def test_large_cache_clean_uses_only_verified_npm_path_as_runner_user(self):
        tool='/runner/_work/_tool/node/22.23.2/x64'
        with patch.object(cache, 'command', side_effect=[json.dumps(self.row()), 'Runner.Listener', '/home/runner/.npm', '2000000000 .npm', tool, '/home/runner/.npm', '3000000 .npm']), patch.object(cache.subprocess, 'run') as mutation:
            self.assertTrue(cache.maintain(True)['cleaned'])
            self.assertEqual(mutation.call_args.args[0], ['docker','exec',cache.RUNNER,tool+'/bin/node',tool+'/lib/node_modules/npm/bin/npm-cli.js','--cache','/home/runner/.npm','cache','clean','--force'])

    @unittest.skipUnless(os.name == 'posix', 'Production Linux flock')
    def test_busy_compute_slot_prevents_any_cleaning(self):
        import fcntl
        with tempfile.TemporaryDirectory() as d:
            state = Path(d); lock = state / '.seemplify-build.lock'; lock.touch()
            with lock.open('a') as held:
                fcntl.flock(held, fcntl.LOCK_EX)
                with self.assertRaises(BlockingIOError):
                    with cache.idle_slot(state, state / 'deploy.lock'): self.fail('Busy job must retain its cache')


if __name__ == '__main__':
    unittest.main()
