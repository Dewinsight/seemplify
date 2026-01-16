import frappe
frappe.init(site="lms.seemplifyai.com")
frappe.connect()

# Get the Social Login Key document
doc = frappe.get_doc("Social Login Key", "seemplify")

# Set the client_secret - this will properly encrypt it
doc.client_secret = "lms-secret"
doc.save(ignore_permissions=True)

frappe.db.commit()
print("Successfully updated client_secret for Social Login Key 'seemplify'")

frappe.destroy()
