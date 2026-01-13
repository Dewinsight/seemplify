# Copyright (c) 2026, Seemplify
# License: AGPL

"""
Seemplify OAuth Handler for Frappe LMS

Handles OIDC login from Seemplify Identity Provider and maps
LMS roles from claims to Frappe roles.
"""

import frappe
from frappe import _


# LMS Role mapping from Seemplify claims to Frappe roles
LMS_ROLE_MAPPING = {
    'instructor': 'Course Creator',
    'student': 'LMS Student',
    'course_creator': 'Course Creator',
    'moderator': 'Moderator'
}

# Default role if no LMS role claim is present
DEFAULT_LMS_ROLE = 'LMS Student'


def process_seemplify_login(login_info):
    """
    Process login info from Seemplify OAuth provider.
    Maps LMS role claims to Frappe roles.
    
    Args:
        login_info (dict): OAuth user info containing:
            - email: User's email
            - name: User's display name
            - lms_role: LMS role claim from Seemplify
                - role: 'instructor', 'student', etc.
                - permissions: List of permissions
                - organization_id: Org context
    
    Returns:
        dict: Updated login info
    """
    if not login_info:
        return login_info
    
    email = login_info.get('email')
    if not email:
        return login_info
    
    frappe.logger().info(f"Processing Seemplify login for: {email}")
    
    # Extract LMS role from claims
    lms_role_claim = login_info.get('lms_role')
    
    if lms_role_claim and isinstance(lms_role_claim, dict):
        role_name = lms_role_claim.get('role')
        frappe_role = LMS_ROLE_MAPPING.get(role_name, DEFAULT_LMS_ROLE)
        
        frappe.logger().info(f"LMS role claim: {role_name} -> Frappe role: {frappe_role}")
        
        # Store role for post-login assignment
        login_info['_lms_frappe_role'] = frappe_role
        login_info['_lms_role_claim'] = lms_role_claim
    else:
        frappe.logger().info(f"No LMS role claim found for {email}")
        login_info['_lms_frappe_role'] = DEFAULT_LMS_ROLE
    
    return login_info


def assign_lms_roles_after_login(login_manager):
    """
    Hook to assign LMS roles after successful OAuth login.
    Called from hooks.py on_session_creation or on_login.
    
    Args:
        login_manager: Frappe login manager instance
    """
    if not login_manager or not login_manager.user:
        return
    
    user = login_manager.user
    
    # Check if this is a Seemplify OAuth login
    # The role info would be stored in session or flags
    lms_role = getattr(frappe.local, '_seemplify_lms_role', None)
    
    if not lms_role:
        return
    
    try:
        assign_role_to_user(user, lms_role)
    except Exception as e:
        frappe.logger().error(f"Error assigning LMS role to {user}: {e}")


def assign_role_to_user(email, role_name):
    """
    Assign a Frappe role to a user.
    
    Args:
        email (str): User's email
        role_name (str): Frappe role name to assign
    """
    if not frappe.db.exists('User', email):
        frappe.logger().warning(f"User {email} does not exist")
        return
    
    if not frappe.db.exists('Role', role_name):
        frappe.logger().warning(f"Role {role_name} does not exist")
        return
    
    # Check if user already has this role
    existing = frappe.db.exists('Has Role', {
        'parent': email,
        'role': role_name,
        'parenttype': 'User'
    })
    
    if existing:
        frappe.logger().info(f"User {email} already has role {role_name}")
        return
    
    # Add the role
    user_doc = frappe.get_doc('User', email)
    user_doc.add_roles(role_name)
    
    frappe.logger().info(f"Assigned role {role_name} to user {email}")


@frappe.whitelist(allow_guest=True)
def get_seemplify_login_url(redirect_to=None):
    """
    API endpoint to get the Seemplify OAuth login URL.
    
    Args:
        redirect_to (str): URL to redirect after login
    
    Returns:
        dict: Contains the OAuth URL
    """
    if not redirect_to:
        redirect_to = '/lms'
    
    # Build OAuth URL
    oauth_url = '/api/method/frappe.integrations.oauth2_logins.login_via_oauth2?' + \
        frappe.utils.urllib.parse.urlencode({
            'provider': 'seemplify',
            'redirect_to': redirect_to
        })
    
    return {'url': oauth_url}


def create_lms_roles():
    """
    Create LMS-specific roles in Frappe if they don't exist.
    Called during app installation.
    """
    roles = [
        {
            'role_name': 'LMS Student',
            'desk_access': 0,
            'home_page': '/lms'
        },
        {
            'role_name': 'LMS Instructor',
            'desk_access': 1,
            'home_page': '/lms'
        },
        {
            'role_name': 'LMS Moderator',
            'desk_access': 1,
            'home_page': '/lms'
        }
    ]
    
    for role_data in roles:
        if not frappe.db.exists('Role', role_data['role_name']):
            role = frappe.get_doc({
                'doctype': 'Role',
                **role_data
            })
            role.insert(ignore_permissions=True)
            frappe.logger().info(f"Created role: {role_data['role_name']}")


def setup_seemplify_social_login():
    """
    Set up Seemplify as a Social Login provider.
    Called during app installation or via bench command.
    """
    provider_name = 'Seemplify'
    
    if frappe.db.exists('Social Login Key', provider_name):
        frappe.logger().info("Seemplify Social Login Key already exists")
        return
    
    # Get configuration from site config or environment
    client_id = frappe.conf.get('seemplify_client_id', 'lms')
    client_secret = frappe.conf.get('seemplify_client_secret', 'lms-seemplify-secret-2026')
    base_url = frappe.conf.get('seemplify_base_url', 'https://auth.seemplifyai.com')
    
    social_login = frappe.get_doc({
        'doctype': 'Social Login Key',
        'enable_social_login': 1,
        'provider_name': provider_name,
        'social_login_provider': 'Custom',
        'client_id': client_id,
        'client_secret': client_secret,
        'icon': 'fa fa-sign-in',
        'base_url': base_url,
        'authorize_url': '/oidc/auth',
        'access_token_url': '/oidc/token',
        'redirect_url': '/api/method/frappe.integrations.oauth2_logins.login_via_oauth2',
        'api_endpoint': '/oidc/me',
        'auth_url_data': '{"response_type": "code", "scope": "openid email profile"}',
        'user_id_property': 'email',
        'sign_ups': 1,
        'custom_base_url': 1
    })
    
    social_login.insert(ignore_permissions=True)
    frappe.db.commit()
    
    frappe.logger().info("Created Seemplify Social Login Key")
