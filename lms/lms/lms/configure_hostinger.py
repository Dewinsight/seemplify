"""Idempotent setup after restoring the historical LMS database."""
import frappe


def configure():
    frappe.conf.seemplify_oidc_only = 0
    frappe.conf.lms_standalone_auth = 1
    settings = frappe.get_single("System Settings")
    settings.disable_user_pass_login = 0
    settings.login_with_email_link = 0
    settings.enable_onboarding = 0
    settings.save(ignore_permissions=True)
    website = frappe.get_single("Website Settings")
    website.disable_signup = 1
    website.app_name = "Stanbic IBTC STEM Series"
    website.save(ignore_permissions=True)
    # Imported SMTP credentials cannot be decrypted without the old site's key.
    # Do not send historical queued messages while SMTP is unconfigured.
    frappe.db.sql("UPDATE `tabEmail Account` SET enable_outgoing=0, enable_incoming=0")
    frappe.db.sql("UPDATE `tabEmail Queue` SET status='Not Sent' WHERE status='Sending'")
    frappe.db.set_single_value("System Settings", "mute_emails", 1)
    # This LMS uses its own users/passwords, independently of Seemplify Identity.
    if frappe.db.exists("Social Login Key", "Seemplify"):
        frappe.db.set_value("Social Login Key", "Seemplify", "enable_social_login", 0)
    # Replace missing cover uploads with the versioned Stanbic artwork.
    for doctype in ("LMS Course", "LMS Program"):
        for item in frappe.get_all(doctype, fields=["name", "title", "image"]):
            if not item.image or item.image.startswith("/files/"):
                title = (item.title or item.name).lower()
                track = "primary" if "primary" in title else ("jss" if "junior" in title or "jss" in title else "sss")
                frappe.db.set_value(doctype, item.name, "image", f"/assets/lms/images/stanbic/stanbic-stem-{track}.png")
    frappe.db.commit()
    frappe.clear_cache()
    return {"courses": frappe.db.count("LMS Course"), "lessons": frappe.db.count("Course Lesson"), "programs": frappe.db.count("LMS Program"), "oidc": False, "standalone_auth": True}
