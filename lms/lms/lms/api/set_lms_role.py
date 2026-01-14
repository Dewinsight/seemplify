# Copyright (c) 2026, Seemplify
# License: AGPL

"""
API endpoint for setting LMS roles via IDP server-to-server call.
This bypasses the limitation of Frappe's OAuth handler not processing custom claims.
"""

import frappe
from frappe import _
import hmac
import hashlib
import time

# Shared secret for IDP-to-Frappe communication (should match IDP config)
IDP_SHARED_SECRET = frappe.conf.get('idp_shared_secret', 'seemplify-lms-secret-2026')

# LMS Role mapping from IDP to Frappe
LMS_ROLE_MAPPING = {
    'student': 'LMS Student',
    'course_creator': 'Course Creator',
    'moderator': 'Moderator',
    'batch_evaluator': 'Batch Evaluator',
    'course_evaluator': 'Course Evaluator',
    'administrator': 'System Manager'
}

# Roles that grant Frappe desk access
DESK_ACCESS_ROLES = ['Course Creator', 'Moderator', 'Batch Evaluator', 'Course Evaluator', 'System Manager']


def verify_signature(email, role, timestamp, signature):
    """
    Verify the HMAC signature from the IDP.
    """
    # Signature format: HMAC-SHA256(email:role:timestamp, secret)
    message = f"{email}:{role}:{timestamp}"
    expected_sig = hmac.new(
        IDP_SHARED_SECRET.encode('utf-8'),
        message.encode('utf-8'),
        hashlib.sha256
    ).hexdigest()
    
    return hmac.compare_digest(signature, expected_sig)


@frappe.whitelist(allow_guest=True)
def set_user_lms_role(email, role, timestamp, signature):
    """
    Set a user's LMS role in Frappe.
    
    This endpoint is called by the IDP after successful OAuth authentication
    to ensure the user's LMS role is correctly assigned in Frappe.
    
    Args:
        email (str): User's email address
        role (str): IDP role name (e.g., 'course_creator', 'student')
        timestamp (str): Unix timestamp when the request was signed
        signature (str): HMAC-SHA256 signature for verification
    
    Returns:
        dict: Success status and assigned role
    """
    frappe.logger().info(f"[LMS API] set_user_lms_role called for {email} with role {role}")
    
    # Verify timestamp is within 5 minutes
    try:
        ts = int(timestamp)
        current_time = int(time.time())
        if abs(current_time - ts) > 300:  # 5 minutes
            frappe.logger().warning(f"[LMS API] Timestamp expired for {email}")
            frappe.throw(_("Request timestamp expired"), frappe.AuthenticationError)
    except ValueError:
        frappe.throw(_("Invalid timestamp"), frappe.ValidationError)
    
    # Verify signature
    if not verify_signature(email, role, timestamp, signature):
        frappe.logger().warning(f"[LMS API] Invalid signature for {email}")
        frappe.throw(_("Invalid signature"), frappe.AuthenticationError)
    
    # Validate role
    if role not in LMS_ROLE_MAPPING:
        frappe.throw(_("Invalid role: {0}").format(role), frappe.ValidationError)
    
    frappe_role = LMS_ROLE_MAPPING[role]
    
    # Check if user exists
    if not frappe.db.exists('User', email):
        frappe.logger().warning(f"[LMS API] User {email} does not exist")
        frappe.throw(_("User not found"), frappe.DoesNotExistError)
    
    # Get user document
    user_doc = frappe.get_doc('User', email)
    
    # Remove any existing LMS roles first (user should have only one LMS role)
    existing_lms_roles = [r.role for r in user_doc.roles if r.role in LMS_ROLE_MAPPING.values()]
    for old_role in existing_lms_roles:
        if old_role != frappe_role:
            user_doc.remove_roles(old_role)
            frappe.logger().info(f"[LMS API] Removed old LMS role {old_role} from {email}")
    
    # Add the new role
    current_roles = [r.role for r in user_doc.roles]
    if frappe_role not in current_roles:
        user_doc.add_roles(frappe_role)
        frappe.logger().info(f"[LMS API] Added LMS role {frappe_role} to {email}")
    
    # If role requires desk access, upgrade user type
    if frappe_role in DESK_ACCESS_ROLES:
        if user_doc.user_type == 'Website User':
            user_doc.user_type = 'System User'
            user_doc.save(ignore_permissions=True)
            frappe.logger().info(f"[LMS API] Upgraded {email} to System User for desk access")
    
    frappe.db.commit()
    
    return {
        'success': True,
        'email': email,
        'frappe_role': frappe_role,
        'desk_access': frappe_role in DESK_ACCESS_ROLES
    }


@frappe.whitelist(allow_guest=True)
def get_user_lms_roles(email, timestamp, signature):
    """
    Get a user's current LMS roles in Frappe.
    
    Args:
        email (str): User's email address
        timestamp (str): Unix timestamp when the request was signed
        signature (str): HMAC-SHA256 signature for verification
    
    Returns:
        dict: User's LMS roles
    """
    # Verify timestamp is within 5 minutes
    try:
        ts = int(timestamp)
        current_time = int(time.time())
        if abs(current_time - ts) > 300:
            frappe.throw(_("Request timestamp expired"), frappe.AuthenticationError)
    except ValueError:
        frappe.throw(_("Invalid timestamp"), frappe.ValidationError)
    
    # Verify signature (reusing the same format as set_user_lms_role)
    if not verify_signature(email, "get", timestamp, signature):
        frappe.throw(_("Invalid signature"), frappe.AuthenticationError)
    
    # Check if user exists
    if not frappe.db.exists('User', email):
        return {
            'success': False,
            'email': email,
            'error': 'User not found',
            'roles': []
        }
    
    # Get user document
    user_doc = frappe.get_doc('User', email)
    
    # Get LMS roles
    lms_roles = [r.role for r in user_doc.roles if r.role in LMS_ROLE_MAPPING.values()]
    
    return {
        'success': True,
        'email': email,
        'roles': lms_roles,
        'user_type': user_doc.user_type
    }
