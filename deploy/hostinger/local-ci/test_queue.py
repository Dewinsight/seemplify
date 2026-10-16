import importlib.util
import contextlib
import io
import os
import sys
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import Mock, patch
import urllib.error
from concurrent.futures import ThreadPoolExecutor

spec = importlib.util.spec_from_file_location('hostinger_queue', Path(__file__).with_name('runner_queue.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class QueueTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.queue = module.Queue(self.directory.name)

    def test_push_deduplication_preserves_distinct_revisions(self):
        first = self.queue.enqueue('frontend', 'a' * 40)
        self.assertEqual(first, self.queue.enqueue('frontend', 'a' * 40))
        self.assertNotEqual(first, self.queue.enqueue('frontend', 'b' * 40))
        self.assertEqual(len(self.queue.rows()), 2)

    def test_claim_is_atomic_across_workers(self):
        for number in range(20):
            self.queue.enqueue('frontend', 'a' * 40, 'probe', str(number))
        with ThreadPoolExecutor(max_workers=8) as pool:
            claimed = list(pool.map(lambda _: self.queue.claim()['id'], range(20)))
        self.assertEqual(len(set(claimed)), 20)

    def test_same_route_serializes_without_blocking_other_route(self):
        first = self.queue.enqueue('frontend', 'a' * 40)
        second = self.queue.enqueue('frontend', 'b' * 40)
        third = self.queue.enqueue('backend', 'c' * 40)
        self.assertEqual(self.queue.claim()['id'], first)
        self.assertEqual(self.queue.claim()['id'], third)
        self.assertIsNone(self.queue.claim())
        self.queue.finish(first, True)
        self.assertEqual(self.queue.claim()['id'], second)

    def test_queue_survives_process_recreation(self):
        job = self.queue.enqueue('frontend', 'a' * 40)
        recreated = module.Queue(self.directory.name)
        self.assertEqual(recreated.claim()['id'], job)
        recreated.finish(job, False)
        self.assertEqual(self.queue.rows()[0]['state'], 'failure')

    def test_rejects_invalid_identity(self):
        with self.assertRaises(ValueError):
            self.queue.enqueue('frontend', '../not-a-sha')
        with self.assertRaises(ValueError):
            self.queue.enqueue('frontend', 'a' * 40, 'arbitrary-command')

    def test_redirects_cannot_receive_api_credential(self):
        with self.assertRaises(ValueError):
            module.NoRedirect().redirect_request(None, None, 302, '', {}, 'https://example.test')

    def test_poller_retains_every_canonical_first_parent_revision(self):
        token = Path(self.directory.name) / 'token'
        token.write_text('test-only-token')
        driver = module.Driver({'state_dir': self.directory.name, 'token_file': str(token),
            'routes': [{'name': 'frontend', 'repo': 'Dewinsight/Xplorer-crm', 'ref': 'development'}]})
        head = 'a' * 40
        def api(path, payload=None):
            if path.endswith('/variables'):
                return {'variables': [{'name': 'HOSTINGER_CI_DRIVER', 'value': 'local'}]}
            if '/git/ref/' in path:
                return {'object': {'sha': head}}
            return {'parents': [{'sha': {'c' * 40: 'b' * 40, 'b' * 40: 'a' * 40}[path.split('/')[-1]]}]}
        driver.api = api
        driver.poll()  # Establish baseline; never replay historical production.
        self.assertEqual(driver.queue.rows(), [])
        head = 'c' * 40
        driver.poll()
        driver.poll()
        self.assertEqual([row['sha'] for row in driver.queue.rows()], ['b' * 40, 'c' * 40])

    def test_one_failed_lane_does_not_starve_other_routes_or_move_its_cursor(self):
        token = Path(self.directory.name) / 'token'
        token.write_text('test-only-token')
        routes = [{'name': name, 'repo': 'Dewinsight/' + name, 'ref': 'main'}
                  for name in ['broken', 'healthy']]
        driver = module.Driver({'state_dir': self.directory.name, 'token_file': str(token), 'routes': routes})
        with driver.queue.connect() as db:
            db.executemany('INSERT INTO cursors VALUES(?,?)', [(r['name'], 'a' * 40) for r in routes])
        def api(path):
            if '/broken/' in path:
                raise urllib.error.URLError('private-api-error-must-not-be-logged')
            if path.endswith('/variables'):
                return {'variables': [{'name': 'HOSTINGER_CI_DRIVER', 'value': 'local'}]}
            if '/git/ref/' in path:
                return {'object': {'sha': 'b' * 40}}
            return {'parents': [{'sha': 'a' * 40}]}
        driver.api = api
        output = io.StringIO()
        with contextlib.redirect_stdout(output), self.assertRaises(urllib.error.URLError):
            driver.poll()
        self.assertEqual([(r['route'], r['sha']) for r in driver.queue.rows()], [('healthy', 'b' * 40)])
        with driver.queue.connect() as db:
            self.assertEqual(db.execute('SELECT sha FROM cursors WHERE route="broken"').fetchone()[0], 'a' * 40)
        self.assertIn('poll_route_failed=broken:URLError', output.getvalue())
        self.assertNotIn('private-api-error', output.getvalue())

    def test_queued_status_delivery_survives_restart_without_claiming_execution(self):
        job = self.queue.enqueue('frontend', 'a' * 40)
        recreated = module.Queue(self.directory.name)
        self.assertEqual([row['id'] for row in recreated.undelivered()], [job])
        driver = module.Driver.__new__(module.Driver)
        driver.routes = {'frontend': {'name': 'frontend', 'repo': 'Dewinsight/Xplorer-crm'}}
        driver.api = Mock()
        driver.status(recreated.undelivered()[0], 'pending')
        payload = driver.api.call_args.args[1]
        self.assertEqual(payload['state'], 'pending')
        self.assertIn('queued; waiting for capacity', payload['description'])
        recreated.claim()
        self.assertEqual(recreated.undelivered(), [])
        recreated.finish(job, True)
        self.assertEqual(recreated.undelivered()[0]['state'], 'success')

    def test_failed_status_remains_durable_for_delivery_retry(self):
        job = self.queue.enqueue('frontend', 'a' * 40)
        self.queue.claim()
        self.queue.finish(job, True)
        row = self.queue.rows()[0]
        self.assertEqual(row['state'], 'success')
        self.assertEqual(row['status_sent'], 0)

    @patch.object(module.subprocess, 'run')
    def test_image_guard_failure_blocks_execution_and_records_failure(self, run):
        run.return_value.stdout = ''
        driver = module.Driver.__new__(module.Driver)
        driver.queue = self.queue
        driver.command = Mock(side_effect=RuntimeError('image unavailable'))
        driver.routes = {'frontend': {'repo': 'Dewinsight/Xplorer-crm'}}
        driver.status = Mock()
        driver.deploy = Mock()
        self.queue.enqueue('frontend', 'a' * 40)
        driver.work(self.queue.claim())
        driver.deploy.assert_not_called()
        self.assertEqual(driver.command.call_args.args[0],
                         [str(Path(module.__file__).with_name('ensure-image.sh'))])
        self.assertEqual(self.queue.rows()[0]['state'], 'failure')
        self.assertEqual(driver.status.call_args.args[1], 'failure')

    @patch.object(module.time, 'sleep')
    def test_transient_read_retries_without_losing_result(self, sleep):
        read = Mock(side_effect=[ConnectionResetError(), TimeoutError(), {'sha': 'a' * 40}])
        self.assertEqual(module.read_with_retry(read), {'sha': 'a' * 40})
        self.assertEqual(read.call_count, 3)
        self.assertEqual([call.args[0] for call in sleep.call_args_list], [1, 2])

    @patch.object(module.time, 'sleep')
    def test_read_retry_is_bounded(self, sleep):
        read = Mock(side_effect=ConnectionResetError())
        with self.assertRaises(ConnectionResetError):
            module.read_with_retry(read)
        self.assertEqual(read.call_count, 3)

    @patch.object(module.time, 'sleep')
    def test_authorization_failure_is_not_retried(self, sleep):
        read = Mock(side_effect=urllib.error.HTTPError('https://api.github.com', 403, 'Forbidden', {}, None))
        with self.assertRaises(urllib.error.HTTPError):
            module.read_with_retry(read)
        self.assertEqual(read.call_count, 1)
        sleep.assert_not_called()

    @unittest.skipIf(os.name == 'nt', 'POSIX file permissions are enforced on the Linux host')
    def test_source_modes_do_not_weaken_private_job_artifacts(self):
        driver = module.Driver.__new__(module.Driver)
        driver.config = {'timeout_seconds': 5}
        root = Path(self.directory.name)
        root.chmod(0o700)
        previous = os.umask(0o077)
        try:
            with (root / 'log').open('w') as log:
                command = [sys.executable, '-c', 'from pathlib import Path; import sys; Path(sys.argv[1]).write_text("test")']
                driver.command(command + [str(root / 'secret')], log)
                driver.command(command + [str(root / 'source')], log, umask=0o022)
        finally:
            os.umask(previous)
        self.assertEqual((root / 'secret').stat().st_mode & 0o777, 0o600)
        self.assertEqual((root / 'source').stat().st_mode & 0o777, 0o644)
        self.assertEqual(root.stat().st_mode & 0o777, 0o700)

    def test_lane_settings_copy_only_existing_media_credentials(self):
        path = Path(self.directory.name) / 'lane.env'
        path.write_text('CLOUDINARY_CLOUD_NAME="example"\nCLOUDINARY_API_KEY=test-key\n'
                        'CLOUDINARY_API_SECRET=test-secret\nDATABASE_PASSWORD=must-not-copy\n')
        path.chmod(0o600)
        self.assertEqual(module.lane_cloud_settings(path), {'CLOUDINARY_CLOUD_NAME': 'example',
                         'CLOUDINARY_API_KEY': 'test-key', 'CLOUDINARY_API_SECRET': 'test-secret'})

    def test_incomplete_media_credentials_block_execution(self):
        path = Path(self.directory.name) / 'lane.env'
        path.write_text('CLOUDINARY_CLOUD_NAME=example\n')
        path.chmod(0o600)
        with self.assertRaises(ValueError):
            module.lane_cloud_settings(path)

    def test_changed_blob_is_scanned_before_any_checkout(self):
        driver = module.Driver.__new__(module.Driver)
        driver.token = 'test-only-token'
        driver.routes = {'frontend': {'repo': 'Dewinsight/Xplorer-crm', 'ref': 'development'}}
        driver.api = Mock(side_effect=[{'files': [{'filename': 'source.js', 'sha': 'b' * 40}]}, {}])
        driver.command = Mock(side_effect=RuntimeError('stop before checkout'))
        scanner = types.SimpleNamespace(check_commits=Mock(return_value=[]),
            read_blob=Mock(return_value='verified source'), scan_text=Mock(return_value=[]))
        job = {'id': 1, 'route': 'frontend', 'sha': 'a' * 40}
        with patch.dict(sys.modules, polinrider_scanner=scanner):
            with (Path(self.directory.name) / 'scan.log').open('w') as log:
                with self.assertRaisesRegex(RuntimeError, 'stop before checkout'):
                    driver.deploy(job, Path(self.directory.name), log)
        scanner.read_blob.assert_called_once_with('Dewinsight/Xplorer-crm', 'b' * 40, 'test-only-token')
        scanner.scan_text.assert_called_once_with('source.js', 'verified source')
        self.assertEqual(driver.api.call_args_list[-1].args[1]['state'], 'success')

    def test_rejected_scan_never_reaches_checkout(self):
        driver = module.Driver.__new__(module.Driver)
        driver.token = 'test-only-token'
        driver.routes = {'frontend': {'repo': 'Dewinsight/Xplorer-crm', 'ref': 'development'}}
        driver.api = Mock(side_effect=[{'files': [{'filename': 'source.js', 'sha': 'b' * 40}]}, {}])
        driver.command = Mock()
        scanner = types.SimpleNamespace(check_commits=Mock(return_value=[]),
            read_blob=Mock(return_value='rejected source'), scan_text=Mock(return_value=[('error', 'rejected')]))
        with patch.dict(sys.modules, polinrider_scanner=scanner):
            with (Path(self.directory.name) / 'scan.log').open('w') as log:
                with self.assertRaisesRegex(ValueError, 'scan rejected'):
                    driver.deploy({'id': 1, 'route': 'frontend', 'sha': 'a' * 40}, Path(self.directory.name), log)
        driver.command.assert_not_called()


class WorkspaceTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.driver = object.__new__(module.Driver)
        self.driver.queue = module.Queue(self.directory.name)

    def test_reuses_stable_path_with_fresh_source_and_separate_routes(self):
        source = Path(self.directory.name) / 'source'
        source.mkdir()
        (source / 'file.ts').write_text('first revision')
        first = self.driver.prepare_workspace('backend-dev', source)
        (first / 'generated.js').write_text('discard stale output')
        other = self.driver.prepare_workspace('backend-staging', source)
        (source / 'file.ts').write_text('second revision')
        second = self.driver.prepare_workspace('backend-dev', source)
        self.assertEqual(first, second)
        self.assertEqual((second / 'file.ts').read_text(), 'second revision')
        self.assertFalse((second / 'generated.js').exists())
        self.assertEqual((other / 'file.ts').read_text(), 'first revision')
        self.assertEqual((source / 'file.ts').read_text(), 'second revision')

    def test_invalid_route_cannot_delete_outside_the_workspace_base(self):
        outside = Path(self.directory.name) / 'unrelated'
        outside.mkdir()
        for name in ['../unrelated', '/unrelated', 'backend/../../unrelated']:
            with self.subTest(name=name), self.assertRaises(ValueError):
                self.driver.workspace_path(name)
        self.assertTrue(outside.exists())

    @unittest.skipIf(os.name == 'nt', 'Linux host enforces symlink behavior')
    def test_preserves_source_symlink_and_rejects_workspace_symlink(self):
        source = Path(self.directory.name) / 'source'
        source.mkdir()
        outside = Path(self.directory.name) / 'outside'
        outside.mkdir()
        (source / 'link').symlink_to(outside, target_is_directory=True)
        workspace = self.driver.prepare_workspace('backend-dev', source)
        self.assertTrue((workspace / 'link').is_symlink())
        (workspace.parent / 'backend-staging').symlink_to(outside, target_is_directory=True)
        with self.assertRaises(ValueError):
            self.driver.prepare_workspace('backend-staging', source)
        self.assertTrue(outside.exists())


class CapacityTests(unittest.TestCase):
    def test_memory_limits_accept_configured_units_and_reject_invalid_values(self):
        self.assertEqual(module.memory_limit_bytes('3500m'), 3500 * 1024 ** 2)
        self.assertEqual(module.memory_limit_bytes('4g'), 4 * 1024 ** 3)
        self.assertEqual(module.memory_limit_bytes('512MB'), 512 * 1024 ** 2)
        for value in ['0', '-1g', 'not-memory', '1g extra']:
            with self.subTest(value=value), self.assertRaises(ValueError):
                module.memory_limit_bytes(value)

    def test_application_pressure_leaves_memory_for_queued_jobs(self):
        driver = object.__new__(module.Driver)
        driver.config = {'job_memory': '3500m', 'minimum_free_memory_after_job_mb': 512}
        driver.queue = Mock(root=Path('.'))
        for available_mib, expected in [(5012, True), (4012, True), (4011, False), (3000, False)]:
            meminfo = f'MemTotal: 8388608 kB\nMemAvailable: {available_mib * 1024} kB\n'
            with self.subTest(available_mib=available_mib), patch.object(module.Path, 'read_text', return_value=meminfo), patch.object(module.shutil, 'disk_usage', return_value=Mock(free=16 * 1024 ** 3)):
                self.assertEqual(driver.capacity_available(), expected)

    def test_reserves_admitted_memory_before_docker_has_allocated_it(self):
        driver = object.__new__(module.Driver)
        driver.config = {'job_memory': '3500m', 'minimum_free_memory_after_job_mb': 512}
        driver.queue = Mock(root=Path('.'))
        with patch.object(module.Path, 'read_text', return_value='MemAvailable: 8192000 kB'), patch.object(module.shutil, 'disk_usage', return_value=Mock(free=16 * 1024 ** 3)):
            self.assertTrue(driver.capacity_available(active_jobs=1))
            self.assertFalse(driver.capacity_available(active_jobs=2))

    def test_low_disk_space_retains_jobs_without_starting_them(self):
        driver = object.__new__(module.Driver)
        driver.config = {'job_memory': '3500m', 'minimum_free_disk_mb': 8192}
        driver.queue = Mock(root=Path('.'))
        with patch.object(module.Path, 'read_text', return_value='MemAvailable: 8192000 kB'):
            for free_mb, expected in [(8191, False), (8192, True)]:
                with self.subTest(free_mb=free_mb), patch.object(module.shutil, 'disk_usage', return_value=Mock(free=free_mb * 1024 ** 2)):
                    self.assertEqual(driver.capacity_available(), expected)


class CleanupTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.queue = module.Queue(self.directory.name)

    def job(self, state='success', finished='2020-01-01T00:00:00+00:00', sent=1):
        job_id = self.queue.enqueue('frontend', 'a' * 40, nonce=str(len(self.queue.rows())))
        with self.queue.connect() as db:
            db.execute('UPDATE jobs SET state=?,finished=?,status_sent=? WHERE id=?', (state, finished, sent, job_id))
        root = self.queue.job_directory(job_id)
        root.mkdir(parents=True)
        (root / 'source').mkdir()
        (root / 'source' / 'build-output').write_text('disposable')
        for name in ('job.log', 'secrets.env', 'event.json', 'workflow.yml', 'variables.env', 'verification.json'):
            (root / name).write_text('test-only')
        return root

    def test_dry_run_preserves_files_and_proofs(self):
        root = self.job()
        report = self.queue.cleanup()
        self.assertEqual(report['payloads'], 5)
        self.assertFalse(report['errors'])
        self.assertTrue((root / 'source' / 'build-output').exists())
        self.assertTrue((root / 'secrets.env').exists())
        self.assertFalse((self.queue.root / 'cleanup-report.json').exists())

    def test_reclaims_terminal_payloads_but_preserves_queued_and_running(self):
        terminal = [self.job(state) for state in ('success', 'failure', 'skipped')]
        active = [self.job(state) for state in ('queued', 'running')]
        report = self.queue.cleanup(apply=True)
        self.assertEqual(report['payloads'], 15)
        self.assertFalse(report['errors'])
        for root in terminal:
            self.assertFalse((root / 'source').exists())
            self.assertFalse((root / 'secrets.env').exists())
            self.assertTrue((root / 'job.log').exists())
            self.assertTrue((root / 'verification.json').exists())
        for root in active:
            self.assertTrue((root / 'source').exists())
            self.assertTrue((root / 'secrets.env').exists())
        self.assertEqual(len(self.queue.rows()), 5)

    def test_log_retention_keeps_latest_twenty_recent_and_undelivered(self):
        old = self.job()
        undelivered = self.job(sent=0)
        recent = self.job(finished=module.now())
        latest = [self.job() for _ in range(20)]
        report = self.queue.cleanup(apply=True)
        self.assertEqual(report['logs'], 1)
        self.assertFalse((old / 'job.log').exists())
        self.assertTrue((old / 'verification.json').exists())
        for root in [undelivered, recent] + latest:
            self.assertTrue((root / 'job.log').exists())
        self.assertEqual(self.queue.cleanup(apply=True)['logs'], 0)

    @unittest.skipIf(os.name == 'nt', 'Linux symlink contract')
    def test_job_symlink_cannot_delete_outside_files(self):
        root = self.job()
        outside = Path(self.directory.name) / 'outside'
        root.rename(outside)
        root.symlink_to(outside, target_is_directory=True)
        report = self.queue.cleanup(apply=True)
        self.assertEqual(report['errors'], [{'job': 1, 'type': 'ValueError'}])
        self.assertTrue((outside / 'secrets.env').exists())
        self.assertTrue((outside / 'source' / 'build-output').exists())

    @unittest.skipIf(os.name == 'nt', 'Linux symlink contract')
    def test_payload_symlink_is_unlinked_without_following_target(self):
        root = self.job()
        module.shutil.rmtree(root / 'source')
        outside = Path(self.directory.name) / 'outside'
        outside.mkdir()
        (outside / 'keep').write_text('protected')
        (root / 'source').symlink_to(outside, target_is_directory=True)
        self.assertFalse(self.queue.cleanup(apply=True)['errors'])
        self.assertFalse((root / 'source').is_symlink())
        self.assertTrue((outside / 'keep').exists())

    def test_failure_is_reported_without_stopping_other_job_cleanup(self):
        first = self.job()
        second = self.job()
        remove = self.queue.remove_payload
        def fail_one(job_id, apply=False):
            if job_id == 2:
                raise PermissionError('credential-bearing message must never be logged')
            return remove(job_id, apply=apply)
        with patch.object(self.queue, 'remove_payload', side_effect=fail_one):
            report = self.queue.cleanup(apply=True)
        self.assertEqual(report['errors'], [{'job': 2, 'type': 'PermissionError'}])
        self.assertFalse((first / 'source').exists())
        self.assertTrue((second / 'source').exists())

    def test_recovery_payload_removal_preserves_job_log_and_proof(self):
        root = self.job('running')
        self.assertEqual(self.queue.remove_payload(1, apply=True), 5)
        self.assertTrue((root / 'job.log').exists())
        self.assertTrue((root / 'verification.json').exists())
        for invalid in (0, -1, '../escape'):
            with self.assertRaises(ValueError):
                self.queue.remove_payload(invalid, apply=True)


if __name__ == '__main__':
    unittest.main()
