"""Contract checks that do not require a running Frappe site."""
import ast
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]


class ProductionAuthContract(unittest.TestCase):
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
        self.assertLess(callback.index("compare_digest"), callback.index("get_info_via_oauth"))
        self.assertLess(callback.index("permitted_role(claims)"), callback.index("login_oauth_user"))
        self.assertIn('claims.get("email_verified") is not True', callback)
        self.assertIn('frappe.cache.delete_value(state_key(state))', callback)

    def test_login_page_uses_identity_in_production(self):
        for path in ("www/lms-login.html", "lms/www/lms-login.html"):
            source = (ROOT / path).read_text()
            self.assertIn("{% if has_oauth %}", source)
            self.assertIn("/api/method/lms.lms.production_auth.start", source)


if __name__ == "__main__":
    unittest.main()
