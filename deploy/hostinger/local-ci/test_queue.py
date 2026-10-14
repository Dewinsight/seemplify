import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
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


if __name__ == '__main__':
    unittest.main()
