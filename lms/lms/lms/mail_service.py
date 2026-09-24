"""Password reset delivery through the documented Seemplify mail API."""
import hashlib
import html
import os
from urllib.parse import urlparse

import frappe
import requests

API_URL = "https://mail-control.seemplifyai.com/v1/messages"


def configured():
    return bool(os.environ.get("LMS_MAIL_API_TOKEN"))


def send_password_reset(recipient, link):
    parsed = urlparse(link)
    if parsed.scheme != "https" or parsed.netloc != "lms.seemplifyai.com" or parsed.path != "/update-password":
        raise ValueError("Unexpected LMS password reset URL")
    token = os.environ.get("LMS_MAIL_API_TOKEN")
    if not token:
        frappe.throw("Password-reset email is not configured. Please contact your LMS administrator.")
    subject = "Reset your Stanbic IBTC STEM Series password"
    text = f"Use this link to reset your STEM Series LMS password:\n{link}\n\nIf you did not request this, you can ignore this email. Your password has not changed."
    body = f'<h2>Stanbic IBTC STEM Series</h2><p>Use the button below to reset your LMS password.</p><p><a href="{html.escape(link, quote=True)}">Reset password</a></p><p>If you did not request this, you can ignore this email. Your password has not changed.</p>'
    try:
        response = requests.post(
            API_URL,
            headers={"Authorization": f"Bearer {token}", "Idempotency-Key": "lms-reset-" + hashlib.sha256(link.encode()).hexdigest()},
            json={"from": "security@seemplifyai.com", "fromName": "Stanbic IBTC STEM Series", "to": [recipient],
                  "subject": subject, "text": text, "html": body, "tag": "lms-password-reset"},
            timeout=20, allow_redirects=False,
        )
    except requests.RequestException:
        frappe.throw("Password-reset email could not be sent. Please try again shortly.")
    if response.status_code != 202:
        # Do not log provider bodies, recipient addresses or reset tokens.
        frappe.throw("Password-reset email could not be sent. Please try again shortly.")
