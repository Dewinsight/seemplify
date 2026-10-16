import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock

spec = importlib.util.spec_from_file_location('release', Path(__file__).parents[1] / 'github-orchestrator.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.release = module.Release.__new__(module.Release)
        self.release.revision = 'a' * 40
        self.release.root = Path(self.temporary.name)
        self.release.runs = []
        self.release.eligible_since = '2026-10-16T00:00:00Z'

    def test_superseded_main_cannot_dispatch_a_component(self):
        self.release.api = Mock(return_value={'object': {'sha': 'b' * 40}})
        with self.assertRaisesRegex(ValueError, 'superseded'):
            self.release.run_workflow('deploy-core-hostinger.yml')
        self.assertEqual(self.release.api.call_count, 1)

    def test_success_requires_exact_dispatched_revision(self):
        self.release.api = Mock(side_effect=[{'object': {'sha': 'a' * 40}},
            {'workflow_runs': []},
            {'workflow_run_id': 123}, {'head_sha': 'b' * 40}])
        with self.assertRaisesRegex(ValueError, 'revision mismatch'):
            self.release.run_workflow('deploy-core-hostinger.yml')

    def test_failed_child_stops_the_release_and_records_evidence(self):
        self.release.api = Mock(side_effect=[{'object': {'sha': 'a' * 40}},
            {'workflow_runs': []},
            {'workflow_run_id': 123}, {'head_sha': 'a' * 40, 'status': 'completed',
            'conclusion': 'failure', 'html_url': 'https://github.com/example/run/123'}])
        with self.assertRaisesRegex(RuntimeError, 'did not succeed'):
            self.release.run_workflow('deploy-core-hostinger.yml')
        self.assertEqual(self.release.runs[0]['conclusion'], 'failure')
        self.assertTrue((self.release.root / 'runs.json').is_file())

    def test_reuses_recent_exact_main_push_without_dispatching_twice(self):
        existing = {'id': 123, 'head_sha': 'a' * 40, 'head_branch': 'main',
            'event': 'push', 'created_at': '2026-10-16T00:01:00Z', 'status': 'completed',
            'conclusion': 'success', 'html_url': 'https://github.com/example/run/123'}
        self.release.api = Mock(side_effect=[{'object': {'sha': 'a' * 40}},
            {'workflow_runs': [existing]}, existing])
        self.release.run_workflow('deploy-core-hostinger.yml')
        self.assertEqual(self.release.runs[0]['id'], 123)
        self.assertTrue(all(len(call.args) == 1 for call in self.release.api.call_args_list))

    def test_pr_and_stale_runs_cannot_replace_a_trusted_release(self):
        base = {'id': 123, 'head_sha': 'a' * 40, 'head_branch': 'main',
            'event': 'push', 'created_at': '2026-10-16T00:01:00Z', 'status': 'completed',
            'conclusion': 'success', 'html_url': 'https://github.com/example/run/123'}
        self.release.api = Mock(side_effect=[{'object': {'sha': 'a' * 40}},
            {'workflow_runs': [dict(base,event='pull_request'),
                dict(base,created_at='2026-10-15T23:59:00Z'),dict(base,head_sha='b'*40)]},
            {'workflow_run_id': 456}, dict(base,id=456)])
        self.release.run_workflow('deploy-core-hostinger.yml')
        self.assertEqual(self.release.runs[0]['id'], 456)

    def test_complete_release_includes_stanbic_lms(self):
        self.assertEqual(len(module.WORKFLOWS), 9)
        self.assertIn('deploy-lms-hostinger.yml', module.WORKFLOWS)


if __name__ == '__main__':
    unittest.main()
