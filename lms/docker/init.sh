#!/bin/bash
# LMS Auto-deployment v1.1 - Last updated: 2026-01-14
# Fixed: Use correct Frappe module path (lms.lms.api) by appending to existing api.py

if [ -d "/home/frappe/frappe-bench/apps/frappe" ]; then
    echo "Bench already exists, skipping init"
    cd /home/frappe/frappe-bench
    bench start
    exit 0
fi

echo "Creating new bench..."

export PATH="${NVM_DIR}/versions/node/v${NODE_VERSION_DEVELOP}/bin/:${PATH}"

bench init --skip-redis-config-generation frappe-bench

cd frappe-bench

# Use containers instead of localhost
bench set-mariadb-host mariadb
bench set-redis-cache-host redis://redis:6379
bench set-redis-queue-host redis://redis:6379
bench set-redis-socketio-host redis://redis:6379

# Remove redis, watch from Procfile
sed -i '/redis/d' ./Procfile
sed -i '/watch/d' ./Procfile

bench get-app lms

bench new-site lms.seemplifyai.com \
--force \
--mariadb-root-password ${MYSQL_ROOT_PASSWORD:-123} \
--admin-password admin123 \
--no-mariadb-socket

bench --site lms.seemplifyai.com install-app lms
bench --site lms.seemplifyai.com set-config developer_mode 1

# Append LMS role sync function to existing api.py (correct path: lms.lms.api)
echo "Adding LMS role sync function to api.py..."

# Check if the function already exists
if ! grep -q "def set_user_lms_role" /home/frappe/frappe-bench/apps/lms/lms/lms/api.py; then
    cat >> /home/frappe/frappe-bench/apps/lms/lms/lms/api.py << 'APIEOF'


# === LMS Role Sync from Seemplify IDP ===
import hmac
import hashlib

# LMS Role mapping from Seemplify IDP to Frappe roles
LMS_ROLE_MAPPING = {
    "student": "LMS Student",
    "course_creator": "Course Creator",
    "moderator": "Moderator",
    "batch_evaluator": "Batch Evaluator",
    "course_evaluator": "Course Evaluator",
    "administrator": "System Manager"
}

DEFAULT_LMS_ROLE = "LMS Student"
DESK_ACCESS_ROLES = ["Course Creator", "Moderator", "Batch Evaluator", "Course Evaluator", "System Manager"]


@frappe.whitelist(allow_guest=True, methods=["POST"])
def set_user_lms_role(email=None, role=None, timestamp=None, signature=None):
    """
    API endpoint to receive and set LMS roles from the Seemplify IDP.
    Called by IDP after successful OIDC login to sync user's LMS role.
    Endpoint: /api/method/lms.lms.api.set_user_lms_role
    """
    if frappe.request.method != "POST":
        frappe.throw(_("Only POST requests are allowed"), frappe.PermissionError)

    # Verify signature from IDP
    idp_frappe_secret = os.environ.get("IDP_FRAPPE_SECRET", "seemplify-lms-secret-2026")
    expected_signature = hmac.new(
        idp_frappe_secret.encode("utf-8"),
        f"{email}:{role}:{timestamp}".encode("utf-8"),
        hashlib.sha256
    ).hexdigest()

    if not hmac.compare_digest(expected_signature, signature or ""):
        frappe.throw(_("Invalid signature"), frappe.PermissionError)

    if role not in LMS_ROLE_MAPPING:
        frappe.throw(_(f"Invalid LMS role: {role}"), frappe.ValidationError)

    frappe_role = LMS_ROLE_MAPPING.get(role, DEFAULT_LMS_ROLE)

    if not frappe.db.exists("User", email):
        frappe.throw(_(f"User {email} does not exist"), frappe.ValidationError)

    # Run with elevated permissions since we've verified the signature from IDP
    original_user = frappe.session.user
    try:
        frappe.set_user("Administrator")
        
        user_doc = frappe.get_doc("User", email)

        # Remove existing LMS roles (user should have only one)
        for old_role in list(LMS_ROLE_MAPPING.values()):
            if old_role != frappe_role and old_role in [r.role for r in user_doc.roles]:
                user_doc.remove_roles(old_role)

        # Add new role if not already present
        if frappe_role not in [r.role for r in user_doc.roles]:
            user_doc.add_roles(frappe_role)

        # Upgrade to System User if role requires desk access
        if frappe_role in DESK_ACCESS_ROLES and user_doc.user_type == "Website User":
            user_doc.user_type = "System User"
            user_doc.save(ignore_permissions=True)

        frappe.db.commit()
    finally:
        frappe.set_user(original_user)
    
    return {"success": True, "message": f"LMS role '{frappe_role}' assigned to {email}"}


@frappe.whitelist()
def get_user_lms_roles(email=None):
    """Get user's current LMS roles."""
    if not email:
        email = frappe.session.user
    roles = frappe.get_roles(email)
    lms_roles = [r for r in roles if r in LMS_ROLE_MAPPING.values()]
    return {"email": email, "lms_roles": lms_roles}
APIEOF
    echo "LMS role sync function added to api.py"
else
    echo "LMS role sync function already exists in api.py"
fi

# Set branding to "Seemplify LMS"
bench --site lms.seemplifyai.com execute "frappe.db.set_single_value('Website Settings', 'app_name', 'Seemplify LMS')"
bench --site lms.seemplifyai.com execute "frappe.db.set_single_value('System Settings', 'app_name', 'Seemplify LMS')"
bench --site lms.seemplifyai.com execute "frappe.db.commit()"

# Update site_config.json with app_name
python3 -c "import json; f='/home/frappe/frappe-bench/sites/lms.seemplifyai.com/site_config.json'; d=json.load(open(f)); d['app_name']='Seemplify LMS'; json.dump(d, open(f, 'w'), indent=1)"

bench --site lms.seemplifyai.com clear-cache
bench use lms.seemplifyai.com

bench start
