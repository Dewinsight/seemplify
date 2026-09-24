"""Seemplify Identity login for the restored, production Frappe LMS."""
import hmac
import hashlib
import base64
import json
import secrets
from urllib.parse import parse_qs, urlparse, urlencode

import requests

import frappe
from frappe.utils.oauth import get_oauth_keys, get_oauth2_authorize_url, login_oauth_user, update_oauth_user
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
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    frappe.cache.set(frappe.cache.make_key(state_key(state)), json.dumps({"verifier": verifier}), ex=600)
    url += "&" + urlencode({"code_challenge": challenge, "code_challenge_method": "S256"})
    frappe.local.cookie_manager.set_cookie(
        "lms_oidc_state", hashlib.sha256(state.encode()).hexdigest(), secure=True, httponly=True, samesite="Lax", max_age=600
    )
    frappe.local.response.update(type="redirect", location=url)


@frappe.whitelist(allow_guest=True)
def callback(code=None, state=None):
    cookie = frappe.request.cookies.get("lms_oidc_state", "")
    if not code or not state or not cookie or not hmac.compare_digest(cookie, hashlib.sha256(state.encode()).hexdigest()):
        frappe.throw("Your sign-in expired. Please sign in again.", frappe.AuthenticationError)
    # Reject expired/replayed flows before contacting the provider.
    transaction = frappe.cache.getdel(frappe.cache.make_key(state_key(state)))
    if not transaction:
        frappe.throw("Your sign-in expired. Please sign in again.", frappe.AuthenticationError)
    frappe.local.cookie_manager.delete_cookie("lms_oidc_state")
    claims = exchange_claims(code, json.loads(transaction)["verifier"])
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


def exchange_claims(code, verifier):
    credentials = get_oauth_keys("seemplify")
    token = requests.post("https://auth.seemplifyai.com/token", data={
        **credentials, "code": code, "code_verifier": verifier,
        "grant_type": "authorization_code",
        "redirect_uri": "https://lms.seemplifyai.com/api/method/lms.lms.production_auth.callback",
    }, timeout=20)
    token.raise_for_status()
    info = requests.get("https://auth.seemplifyai.com/me", headers={
        "Authorization": "Bearer " + token.json()["access_token"],
    }, timeout=20)
    info.raise_for_status()
    return info.json()


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
