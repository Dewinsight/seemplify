import frappe

no_cache = 1
base_template_path = None


def get_context(context):
    context.no_cache = 1
    context.has_reset_key = bool(frappe.form_dict.get("key"))
    context.csrf_token = frappe.sessions.get_csrf_token()
    return context
