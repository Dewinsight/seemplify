"""
Create default outgoing Email Account for Brevo SMTP.
Run: bench --site localhost execute lms.docker.setup_email_account.setup_brevo_email_account
Or from shell with env: SMTP_PASS=xxx FROM_EMAIL=yyy bench execute ...
"""
import os

import frappe


def setup_brevo_email_account():
    """Create or update default outgoing Email Account from env (Brevo SMTP)."""
    smtp_pass = os.environ.get("SMTP_PASS") or frappe.conf.get("mail_password")
    smtp_login = os.environ.get("SMTP_LOGIN") or frappe.conf.get("mail_login")
    sender_name = (
        (os.environ.get("SENDER_NAME") or "").strip()
        or (frappe.conf.get("app_name") or "").strip()
        or "Simplify LMS"
    )
    from_email = (
        os.environ.get("FROM_EMAIL")
        or frappe.conf.get("mail_email_id")
        or smtp_login
    )

    if not smtp_pass or not smtp_login or not from_email:
        print("Skipping Email Account: need SMTP_PASS, SMTP_LOGIN and FROM_EMAIL")
        return

    account_name = sender_name
    login_is_different = int(bool(smtp_login and smtp_login != from_email))
    existing = frappe.db.exists("Email Account", account_name)

    # Reuse/rename an existing outgoing account for this sender email to avoid
    # duplicate key conflicts on (email_id, enable_incoming, enable_outgoing).
    if not existing:
        existing_outgoing = frappe.db.get_value(
            "Email Account",
            {"email_id": from_email, "enable_incoming": 0, "enable_outgoing": 1},
            "name",
        )
        if existing_outgoing:
            if existing_outgoing != account_name and not frappe.db.exists("Email Account", account_name):
                frappe.rename_doc(
                    "Email Account",
                    existing_outgoing,
                    account_name,
                    force=True,
                )
            elif existing_outgoing != account_name:
                # Keep using existing sender-email account if target name already exists.
                account_name = existing_outgoing
            existing = frappe.db.exists("Email Account", account_name)

    if existing:
        doc = frappe.get_doc("Email Account", account_name)
        doc.email_account_name = account_name
        doc.smtp_server = frappe.conf.get("mail_server") or "smtp-relay.brevo.com"
        doc.smtp_port = str(frappe.conf.get("mail_port") or 587)
        doc.use_tls = frappe.conf.get("use_tls") or 1
        doc.email_id = from_email
        doc.login_id_is_different = login_is_different
        doc.login_id = smtp_login if login_is_different else None
        doc.password = smtp_pass
        doc.enable_outgoing = 1
        doc.default_outgoing = 1
        doc.always_use_account_name_as_sender_name = 1
        doc.always_use_account_email_id_as_sender = 1
        doc.save(ignore_permissions=True)
        frappe.db.commit()
        print(f"Updated Email Account: {account_name}")
    else:
        doc = frappe.get_doc({
            "doctype": "Email Account",
            "email_account_name": account_name,
            "email_id": from_email,
            "login_id_is_different": login_is_different,
            "login_id": smtp_login if login_is_different else None,
            "enable_incoming": 0,
            "enable_outgoing": 1,
            "default_outgoing": 1,
            "smtp_server": frappe.conf.get("mail_server") or "smtp-relay.brevo.com",
            "smtp_port": str(frappe.conf.get("mail_port") or 587),
            "use_tls": frappe.conf.get("use_tls") or 1,
            "always_use_account_name_as_sender_name": 1,
            "always_use_account_email_id_as_sender": 1,
            "auth_method": "Basic",
        })
        doc.password = smtp_pass
        doc.insert(ignore_permissions=True)
        frappe.db.commit()
        print(f"Created Email Account: {account_name}")

    # Ensure only one default outgoing
    frappe.db.sql(
        "UPDATE `tabEmail Account` SET default_outgoing = 0 WHERE name != %s",
        (account_name,),
    )
    frappe.db.set_value("Email Account", account_name, "default_outgoing", 1)
    frappe.db.commit()
    frappe.clear_cache()
