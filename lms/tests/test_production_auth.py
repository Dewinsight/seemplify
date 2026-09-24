"""Contract checks that do not require a running Frappe site."""
import ast
import pathlib
import unittest
import hashlib
import hmac
import json
from types import SimpleNamespace
from unittest.mock import Mock

ROOT = pathlib.Path(__file__).resolve().parents[1]


class ProductionAuthContract(unittest.TestCase):
    def callback_fixture(self, claims=None, cached=True):
        tree = ast.parse((ROOT / "lms/lms/production_auth.py").read_text())
        nodes = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in {"callback", "state_key"}]
        for node in nodes:
            node.decorator_list = []
        def reject(message, kind):
            raise kind(message)
        framework = SimpleNamespace(
            request=SimpleNamespace(cookies={"lms_oidc_state": hashlib.sha256(b"state").hexdigest()}),
            cache=SimpleNamespace(getdel=Mock(return_value=json.dumps({"verifier": "test-verifier"}) if cached else None), make_key=lambda value: value),
            local=SimpleNamespace(cookie_manager=SimpleNamespace(delete_cookie=Mock())),
            throw=reject, AuthenticationError=ValueError, PermissionError=PermissionError,
            get_doc=Mock(return_value=Mock()),
        )
        scope = {"frappe": framework, "hmac": hmac, "hashlib": hashlib, "json": json,
                 "exchange_claims": Mock(return_value=claims or {}),
                 "permitted_role": lambda data: "LMS Student" if data.get("product_permissions", {}).get("lms") == ["view_courses"] else None,
                 "update_oauth_user": Mock(return_value=True), "login_oauth_user": Mock()}
        exec(compile(ast.Module(body=nodes, type_ignores=[]), "callback", "exec"), scope)
        return framework, scope

    def test_mismatched_browser_state_never_exchanges_code(self):
        framework, scope = self.callback_fixture()
        framework.request.cookies["lms_oidc_state"] = "wrong-browser"
        with self.assertRaises(ValueError):
            scope["callback"]("code", "state")
        scope["exchange_claims"].assert_not_called()

    def test_expired_or_replayed_state_never_exchanges_code(self):
        _, scope = self.callback_fixture(cached=False)
        with self.assertRaises(ValueError):
            scope["callback"]("code", "state")
        scope["exchange_claims"].assert_not_called()

    def test_missing_lms_access_never_creates_session(self):
        _, scope = self.callback_fixture({"email": "student@example.test", "email_verified": True})
        with self.assertRaises(PermissionError):
            scope["callback"]("code", "state")
        scope["login_oauth_user"].assert_not_called()

    def test_verified_student_replaces_historical_roles_before_login(self):
        framework, scope = self.callback_fixture({"email": "student@example.test", "email_verified": True, "product_permissions": {"lms": ["view_courses"]}})
        scope["callback"]("code", "state")
        framework.get_doc.return_value.set.assert_called_once_with("roles", [{"role": "LMS Student"}])
        self.assertEqual(framework.get_doc.return_value.user_type, "Website User")
        scope["login_oauth_user"].assert_called_once()

    def test_permission_matrix_denies_missing_or_empty_access(self):
        tree = ast.parse((ROOT / "lms/lms/seemplify_oauth.py").read_text())
        wanted = {"LMS_ROLE_PERMISSION_MARKERS", "extract_idp_lms_permissions", "get_frappe_role_for_permissions"}
        nodes = [node for node in tree.body if (isinstance(node, ast.FunctionDef) and node.name in wanted) or (isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id in wanted for t in node.targets))]
        scope = {}
        exec(compile(ast.Module(body=nodes, type_ignores=[]), "claims", "exec"), scope)
        extract = scope["extract_idp_lms_permissions"]
        resolve = scope["get_frappe_role_for_permissions"]
        self.assertEqual(extract({}), (False, set()))
        self.assertEqual(extract({"product_permissions": {"lms": []}}), (True, set()))
        self.assertIsNone(resolve([]))
        self.assertEqual(resolve(["view_courses"]), "LMS Student")
        self.assertEqual(resolve(["manage_lms_settings"]), "Moderator")

    def test_callback_checks_browser_state_and_permissions_before_login(self):
        source = (ROOT / "lms/lms/production_auth.py").read_text()
        callback = source[source.index("def callback"):source.index("def block_local_auth")]
        self.assertLess(callback.index("compare_digest"), callback.index("exchange_claims"))
        self.assertLess(callback.index("permitted_role(claims)"), callback.index("login_oauth_user"))
        self.assertIn('claims.get("email_verified") is not True', callback)
        self.assertIn('frappe.cache.getdel(frappe.cache.make_key(state_key(state)))', callback)

    def test_login_page_uses_identity_in_production(self):
        for path in ("www/lms-login.html", "lms/www/lms-login.html"):
            source = (ROOT / path).read_text()
            self.assertIn("{% if has_oauth %}", source)
            self.assertIn("/api/method/lms.lms.production_auth.start", source)


if __name__ == "__main__":
    unittest.main()
