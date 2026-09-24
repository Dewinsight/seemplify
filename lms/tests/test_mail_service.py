import importlib.util
import pathlib
import sys
import types
import unittest
from unittest.mock import Mock, patch


class MailServiceTest(unittest.TestCase):
    def setUp(self):
        self.frappe = types.SimpleNamespace(throw=Mock(side_effect=ValueError("Delivery failed")))
        self.requests = types.SimpleNamespace(post=Mock(return_value=types.SimpleNamespace(status_code=202)), RequestException=ConnectionError)
        spec = importlib.util.spec_from_file_location("mail_service", pathlib.Path(__file__).resolve().parents[1] / "lms/lms/mail_service.py")
        self.module = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, frappe=self.frappe, requests=self.requests):
            spec.loader.exec_module(self.module)
        self.env = patch.dict("os.environ", {"LMS_MAIL_API_TOKEN": "test-only"})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.link = "https://lms.seemplifyai.com/update-password?key=test-only"

    def test_documented_contract_and_stable_idempotency(self):
        self.module.send_password_reset("student@example.test", self.link)
        first = self.requests.post.call_args
        self.module.send_password_reset("student@example.test", self.link)
        self.assertEqual(first, self.requests.post.call_args)
        args, kwargs = first
        self.assertEqual(args[0], "https://mail-control.seemplifyai.com/v1/messages")
        self.assertFalse(kwargs["allow_redirects"])
        self.assertEqual(kwargs["json"]["to"], ["student@example.test"])
        self.assertIn(self.link, kwargs["json"]["text"])
        self.assertNotIn("test-only", kwargs["headers"]["Idempotency-Key"])

    def test_rejects_foreign_or_insecure_reset_links(self):
        for url in ["https://evil.test/update-password?key=x", "http://lms.seemplifyai.com/update-password?key=x"]:
            with self.assertRaises(ValueError):
                self.module.send_password_reset("student@example.test", url)
        self.requests.post.assert_not_called()

    def test_nonaccepted_responses_never_report_success(self):
        for status in [401, 403, 429, 500, 503, 302]:
            self.requests.post.return_value.status_code = status
            with self.assertRaises(ValueError):
                self.module.send_password_reset("student@example.test", self.link)

    def test_transport_failure_is_safe(self):
        self.requests.post.side_effect = ConnectionError("sensitive provider details")
        with self.assertRaisesRegex(ValueError, "Delivery failed"):
            self.module.send_password_reset("student@example.test", self.link)

    def test_missing_secret_never_sends(self):
        with patch.dict("os.environ", {}, clear=True):
            self.assertFalse(self.module.configured())
            with self.assertRaises(ValueError):
                self.module.send_password_reset("student@example.test", self.link)
        self.requests.post.assert_not_called()
