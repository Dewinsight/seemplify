slk = frappe.get_all("Social Login Key", fields=["name", "provider_name", "enable_social_login", "base_url", "client_id", "client_secret"])
for s in slk:
    print(s)
