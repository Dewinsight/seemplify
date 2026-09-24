"""Seemplify Identity login for the restored, production Frappe LMS."""
import hmac
import hashlib
from urllib.parse import parse_qs, urlparse

import frappe
from frappe.utils.oauth import get_info_via_oauth, get_oauth2_authorize_url, login_oauth_user, update_oauth_user
from frappe.integrations.oauth2_logins import decoder_compat
from lms.lms.seemplify_oauth import extract_idp_lms_permissions, get_frappe_role_for_permissions


def permitted_role(claims):
    authoritative, permissions = extract_idp_lms_permissions(claims)
    if not authoritative:
        return None
    return get_frappe_role_for_permissions(permissions)


@frappe.whitelist(allow_guest=True)
def start():
    url = get_oauth2_authorize_url("seemplify", "/lms/programs")
    state = parse_qs(urlparse(url).query)["state"][0]
    frappe.cache.set_value(state_key(state), True, expires_in_sec=600)
    frappe.local.cookie_manager.set_cookie(
        "lms_oidc_state", state, secure=True, httponly=True, samesite="Lax", max_age=600
    )
    frappe.local.response.update(type="redirect", location=url)


@frappe.whitelist(allow_guest=True)
def callback(code=None, state=None):
    cookie = frappe.request.cookies.get("lms_oidc_state", "")
    if not code or not state or not cookie or not hmac.compare_digest(cookie, state):
        frappe.throw("Your sign-in expired. Please sign in again.", frappe.AuthenticationError)
    # Reject expired/replayed flows before contacting the provider.
    if not frappe.cache.get_value(state_key(state)):
        frappe.throw("Your sign-in expired. Please sign in again.", frappe.AuthenticationError)
    frappe.cache.delete_value(state_key(state))
    frappe.local.cookie_manager.delete_cookie("lms_oidc_state")
    claims = get_info_via_oauth("seemplify", code, decoder_compat)
    if not claims.get("email") or claims.get("email_verified") is not True or not permitted_role(claims):
        frappe.throw("Your Seemplify account needs LMS access. Contact your organisation administrator.", frappe.PermissionError)
    frappe.local.oauth_userinfo = claims
    email = claims["email"].lower()
    if update_oauth_user(email, claims, "seemplify") is False:
        return
    # Historical database roles must not independently grant production access.
    user = frappe.get_doc("User", email)
    role = permitted_role(claims)
    user.set("roles", [{"role": role}])
    user.user_type = "Website User" if role == "LMS Student" else "System User"
    user.save(ignore_permissions=True)
    login_oauth_user(claims, provider="seemplify", state=state)


def state_key(state):
    return "lms_oidc_state:" + hashlib.sha256(state.encode()).hexdigest()


def block_local_auth():
    if not frappe.conf.get("seemplify_oidc_only"):
        return
    cmd = frappe.form_dict.get("cmd") or frappe.request.path.removeprefix("/api/method/")
    if cmd.startswith("frappe.integrations.oauth2_logins.") or cmd in {
        "login", "frappe.core.doctype.user.user.sign_up", "lms.lms.user.sign_up",
        "lms.lms.user.reset_password", "frappe.core.doctype.user.user.reset_password",
        "frappe.www.login.send_login_link", "frappe.www.login.login_via_key",
    }:
        frappe.throw("Please sign in with Seemplify Identity.", frappe.AuthenticationError)
