import importlib.util
import os
import sys
from pathlib import Path
import tempfile
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

    def test_failed_status_remains_durable_for_delivery_retry(self):
        job = self.queue.enqueue('frontend', 'a' * 40)
        self.queue.claim()
        self.queue.finish(job, True)
        row = self.queue.rows()[0]
        self.assertEqual(row['state'], 'success')
        self.assertEqual(row['status_sent'], 0)

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


if __name__ == '__main__':
    unittest.main()
