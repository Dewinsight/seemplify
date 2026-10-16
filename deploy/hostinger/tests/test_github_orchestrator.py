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

    def test_superseded_main_cannot_dispatch_a_component(self):
        self.release.api = Mock(return_value={'object': {'sha': 'b' * 40}})
        with self.assertRaisesRegex(ValueError, 'superseded'):
            self.release.run_workflow('deploy-core-hostinger.yml')
        self.assertEqual(self.release.api.call_count, 1)

    def test_success_requires_exact_dispatched_revision(self):
        self.release.api = Mock(side_effect=[{'object': {'sha': 'a' * 40}},
            {'workflow_run_id': 123}, {'head_sha': 'b' * 40}])
        with self.assertRaisesRegex(ValueError, 'revision mismatch'):
            self.release.run_workflow('deploy-core-hostinger.yml')

    def test_failed_child_stops_the_release_and_records_evidence(self):
        self.release.api = Mock(side_effect=[{'object': {'sha': 'a' * 40}},
            {'workflow_run_id': 123}, {'head_sha': 'a' * 40, 'status': 'completed',
            'conclusion': 'failure', 'html_url': 'https://github.com/example/run/123'}])
        with self.assertRaisesRegex(RuntimeError, 'did not succeed'):
            self.release.run_workflow('deploy-core-hostinger.yml')
        self.assertEqual(self.release.runs[0]['conclusion'], 'failure')
        self.assertTrue((self.release.root / 'runs.json').is_file())

    def test_complete_release_includes_stanbic_lms(self):
        self.assertEqual(len(module.WORKFLOWS), 9)
        self.assertIn('deploy-lms-hostinger.yml', module.WORKFLOWS)


if __name__ == '__main__':
    unittest.main()
