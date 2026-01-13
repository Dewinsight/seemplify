# Copyright (c) 2026, Seemplify
# License: AGPL

import frappe
from frappe.utils.oauth import get_oauth2_authorize_url, get_oauth_keys

no_cache = 1
base_template_path = None  # Don't use base template - standalone page

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
    
    # Generate OAuth authorization URL for Seemplify provider
    try:
        # Check if Social Login Key exists and has valid credentials
        if frappe.db.exists("Social Login Key", "Seemplify"):
            keys = get_oauth_keys("Seemplify")
            if keys and keys.get("client_id") and keys.get("client_secret"):
                redirect_to = frappe.local.request.args.get("redirect-to", "/lms")
                context.oauth_url = get_oauth2_authorize_url("Seemplify", redirect_to)
                context.has_oauth = True
            else:
                context.has_oauth = False
                context.oauth_error = "Social Login Key not configured properly"
        else:
            context.has_oauth = False
            context.oauth_error = "Seemplify Social Login Key not found"
    except Exception as e:
        context.has_oauth = False
        context.oauth_error = str(e)
        frappe.log_error(f"OAuth URL generation failed: {e}", "LMS Login")
    
    return context
