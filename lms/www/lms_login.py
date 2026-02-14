# Copyright (c) 2026, Seemplify
# License: AGPL

import frappe
from frappe.website.utils import is_signup_disabled

no_cache = 1
base_template_path = None  # Don't use base template - standalone page

def get_context(context):
    """
    Context for custom LMS login page.
    Redirects to /lms if already logged in.
    Uses email/password login only - no Social Login Key.
    """
    if frappe.session.user != "Guest":
        frappe.local.flags.redirect_location = "/lms"
        raise frappe.Redirect
    
    context.no_cache = 1
    context.show_sidebar = False
    context.no_breadcrumbs = True
    context.has_oauth = False
    context.signup_enabled = not is_signup_disabled()
    context.login_with_email_link = frappe.db.get_single_value(
        "System Settings", "login_with_email_link", cache=True
    ) or False
    
    return context
