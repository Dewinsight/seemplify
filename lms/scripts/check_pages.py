#!/usr/bin/env python3
import frappe
frappe.init(site="localhost")
frappe.connect()
from frappe.website.router import get_pages
frappe.cache.delete_value("website_pages")
try:
    pages = get_pages()
    print("Pages with login:", [k for k in pages if "login" in k])
    if "lms-login" in pages:
        print("lms-login found:", pages["lms-login"])
    else:
        print("lms-login NOT in pages")
except Exception as e:
    import traceback
    print("Error:", type(e).__name__, str(e))
    traceback.print_exc()
