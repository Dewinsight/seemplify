"""Exercise the API-only scanner without checking out or executing PR content."""
import base64
import hashlib
import json
import os
from pathlib import Path
import tempfile
import textwrap
import unittest
from unittest.mock import patch

WORKFLOW = Path(__file__).resolve().parents[3] / '.github/workflows/polinrider-scan.yml'
source = WORKFLOW.read_text(encoding='utf-8')
embedded = source.split("<<'PYEOF'\n", 1)[1].split('          PYEOF', 1)[0]
scanner = {'__name__': 'scanner_contract'}
exec(compile(textwrap.dedent(embedded), 'polinrider_scan.py', 'exec'), scanner)


class ScannerContract(unittest.TestCase):
    def test_no_pr_checkout_or_execution(self):
        self.assertNotIn('actions/checkout', source)
        self.assertIn('runs-on: [self-hosted, dewinsight-kvm8-control]', source)
        self.assertIn('python3 -I', source)

    def test_detects_indicator(self):
        self.assertTrue(scanner['scan_text']('src/example.js', 'NONCE_' + 'FANOUT'))

    def test_rejects_external_api_destination(self):
        with self.assertRaises(ValueError):
            scanner['api']('https://example.test/repos/owner/repo', 'test-token')

    def test_blob_integrity(self):
        data = b'../../opt/seemplify/secrets/example'
        sha = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
        blob = {'sha': sha, 'encoding': 'base64', 'size': len(data), 'content': base64.b64encode(data).decode()}
        with patch.dict(scanner, api=lambda *_: blob):
            self.assertEqual(scanner['read_blob']('Dewinsight/seemplify', sha, 'test-token'), data.decode())
            blob['content'] = base64.b64encode(b'tampered').decode()
            with self.assertRaises(ValueError):
                scanner['read_blob']('Dewinsight/seemplify', sha, 'test-token')

    def test_invalid_blob_sha(self):
        with self.assertRaises(ValueError):
            scanner['read_blob']('Dewinsight/seemplify', '../../secrets', 'test-token')

    def test_rejects_redirect(self):
        with self.assertRaises(ValueError):
            scanner['NoRedirect']().redirect_request(None, None, 302, '', {}, 'https://example.test')

    def test_manual_scan_requires_exact_pr_head(self):
        with tempfile.TemporaryDirectory() as directory:
            event = Path(directory) / 'event.json'
            event.write_text('{}')
            env = {'GITHUB_EVENT_PATH': str(event), 'GITHUB_TOKEN': 'test-token',
                   'GITHUB_REPOSITORY': 'Dewinsight/seemplify', 'GITHUB_EVENT_NAME': 'workflow_dispatch',
                   'REQUESTED_PR': '73', 'GITHUB_SHA': 'e' * 40}
            with patch.dict(os.environ, env), patch.dict(scanner, api=lambda *_: {'head': {'sha': 'f' * 40}}):
                with self.assertRaisesRegex(ValueError, 'exact current PR head'):
                    scanner['main'](['--pr'])

    def test_api_pagination_fails_closed(self):
        with patch.dict(scanner, api=lambda *_: [{}] * 100):
            with self.assertRaises(ValueError):
                scanner['paged']('https://api.github.com/repos/Dewinsight/seemplify/pulls/73/files', 'test-token', 100)


if __name__ == '__main__':
    unittest.main()
