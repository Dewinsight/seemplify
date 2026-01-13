# Copyright (c) 2026, Seemplify
# License: AGPL

import frappe

no_cache = 1

def get_context(context):
    """
    Context for custom LMS login page.
    Redirects to /lms if already logged in.
    """
    if frappe.session.user != "Guest":
        frappe.local.flags.redirect_location = "/lms"
        raise frappe.Redirect
    
    context.no_cache = 1
    context.show_sidebar = False
    context.no_breadcrumbs = True
    
    # Get IDP URL from config or use default
    context.idp_url = frappe.conf.get("seemplify_idp_url", "https://auth.seemplifyai.com")
    context.lms_client_id = frappe.conf.get("seemplify_client_id", "lms")
    
    return context
