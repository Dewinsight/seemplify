doc = frappe.get_doc("Social Login Key", "seemplify")
doc.client_secret = "lms-secret"
doc.save(ignore_permissions=True)
frappe.db.commit()
print("Updated client_secret successfully")
