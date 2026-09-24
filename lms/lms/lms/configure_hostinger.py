"""Idempotent setup after restoring the historical LMS database."""
import json
import os

import frappe


def configure():
    secret = os.environ["OIDC_LMS_SECRET"]
    frappe.conf.seemplify_oidc_only = 1
    settings = frappe.get_single("System Settings")
    settings.disable_user_pass_login = 1
    settings.login_with_email_link = 0
    settings.enable_onboarding = 0
    settings.save(ignore_permissions=True)
    website = frappe.get_single("Website Settings")
    website.disable_signup = 1
    website.app_name = "Stanbic IBTC STEM Series"
    website.save(ignore_permissions=True)
    # Imported SMTP credentials cannot be decrypted without the old site's key.
    # Identity owns account mail; do not send historical queued messages.
    frappe.db.sql("UPDATE `tabEmail Account` SET enable_outgoing=0, enable_incoming=0")
    frappe.db.sql("UPDATE `tabEmail Queue` SET status='Not Sent' WHERE status='Sending'")
    frappe.db.set_single_value("System Settings", "mute_emails", 1)
    doc = frappe.get_doc("Social Login Key", "seemplify") if frappe.db.exists("Social Login Key", "seemplify") else frappe.new_doc("Social Login Key")
    doc.update({
        "provider_name": "Seemplify", "social_login_provider": "Custom",
        "enable_social_login": 1, "client_id": "lms", "client_secret": secret,
        "base_url": "https://auth.seemplifyai.com", "custom_base_url": 1,
        "authorize_url": "/oidc/auth", "access_token_url": "/oidc/token",
        "redirect_url": "/api/method/lms.lms.production_auth.callback",
        "api_endpoint": "https://auth.seemplifyai.com/oidc/me",
        "auth_url_data": json.dumps({"response_type": "code", "scope": "openid email profile organization"}),
        "user_id_property": "sub", "sign_ups": "Allow",
    })
    doc.save(ignore_permissions=True)
    # Replace missing cover uploads with the versioned Stanbic artwork.
    for doctype in ("LMS Course", "LMS Program"):
        for item in frappe.get_all(doctype, fields=["name", "title", "image"]):
            if not item.image or item.image.startswith("/files/"):
                title = (item.title or item.name).lower()
                track = "primary" if "primary" in title else ("jss" if "junior" in title or "jss" in title else "sss")
                frappe.db.set_value(doctype, item.name, "image", f"/assets/lms/images/stanbic/stanbic-stem-{track}.png")
    frappe.db.commit()
    frappe.clear_cache()
    return {"courses": frappe.db.count("LMS Course"), "lessons": frappe.db.count("Course Lesson"), "programs": frappe.db.count("LMS Program"), "oidc": True}
