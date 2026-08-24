# Copyright (c) 2026, Seemplify
# License: AGPL

"""
Seemplify OAuth Handler for Frappe LMS

Handles OIDC login from Seemplify Identity Provider and maps
LMS roles from claims to Frappe roles.
"""

import frappe
from frappe import _


# LMS Role mapping from Seemplify IDP claims to Frappe roles
# Based on Frappe LMS DocType permissions research:
# - LMS Student: Basic learner (no desk access)
# - Course Creator: Create/edit courses (desk access)
# - Moderator: Full LMS admin (desk access)
# - Batch Evaluator: Manage batches, grade assignments (desk access)
# - Course Evaluator: Certification evaluations (desk access)
LMS_ROLE_MAPPING = {
    'student': 'LMS Student',
    'course_creator': 'Course Creator',
    'moderator': 'Moderator',
    'batch_evaluator': 'Batch Evaluator',
    'course_evaluator': 'Course Evaluator',
    'administrator': 'System Manager'
}

# Default role if no LMS role claim is present
DEFAULT_LMS_ROLE = 'LMS Student'

# Roles that grant Frappe desk access
DESK_ACCESS_ROLES = ['Course Creator', 'Moderator', 'Batch Evaluator', 'Course Evaluator', 'System Manager']

LMS_ROLE_PERMISSION_MARKERS = (
    ('Moderator', {
        'manage_lms_settings', 'manage_user_roles', 'edit_any_course',
        'delete_any_course', 'publish_courses', 'import_data'
    }),
    ('Batch Evaluator', {
        'manage_batches', 'create_batches', 'edit_batches', 'delete_batches',
        'manage_batch_enrollments', 'grade_assignments', 'evaluate_quizzes'
    }),
    ('Course Evaluator', {
        'evaluate_certifications', 'issue_certificates', 'revoke_certificates',
        'grade_final_evaluations', 'manage_evaluator_schedule'
    }),
    ('Course Creator', {
        'create_courses', 'create_chapters', 'create_lessons', 'create_quizzes',
        'create_assignments', 'edit_own_courses', 'manage_course_content'
    }),
    ('LMS Student', {
        'view_courses', 'enroll_courses', 'view_lessons', 'submit_assignments',
        'take_quizzes', 'view_certificates', 'view_own_progress'
    })
)


def extract_idp_lms_permissions(claims):
    """Return (is_authoritative, permissions) from the canonical IdP claims."""
    if not isinstance(claims, dict):
        return False, set()

    permission_maps = []
    if isinstance(claims.get('product_permissions'), dict):
        permission_maps.append(claims['product_permissions'])

    current_organization = claims.get('current_organization')
    if isinstance(current_organization, dict):
        if isinstance(current_organization.get('appPermissions'), dict):
            permission_maps.append(current_organization['appPermissions'])
        authorization = current_organization.get('authorization')
        if isinstance(authorization, dict) and isinstance(authorization.get('permissionsByApp'), dict):
            permission_maps.append(authorization['permissionsByApp'])

    authorization = claims.get('authorization')
    if isinstance(authorization, dict) and isinstance(authorization.get('permissionsByApp'), dict):
        permission_maps.append(authorization['permissionsByApp'])

    for permission_map in permission_maps:
        if 'lms' in permission_map:
            permissions = permission_map.get('lms')
            return True, {
                str(permission).strip()
                for permission in (permissions if isinstance(permissions, list) else [])
                if str(permission).strip()
            }

    return False, set()


def get_frappe_role_for_permissions(permissions):
    """Project fine-grained IdP permissions onto the closest Frappe LMS role."""
    normalized = {str(permission).strip() for permission in (permissions or []) if str(permission).strip()}
    for frappe_role, markers in LMS_ROLE_PERMISSION_MARKERS:
        if normalized.intersection(markers):
            return frappe_role
    return None


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
    
    has_idp_matrix, lms_permissions = extract_idp_lms_permissions(login_info)
    lms_role_claim = login_info.get('lms_role')
    
    if has_idp_matrix:
        frappe_role = get_frappe_role_for_permissions(lms_permissions)
        frappe.logger().info(f"IdP LMS permission matrix resolved for {email}: {frappe_role or 'no access'}")
        login_info['_lms_frappe_role'] = frappe_role
        login_info['_lms_permissions'] = sorted(lms_permissions)
    elif lms_role_claim and isinstance(lms_role_claim, dict):
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


def assign_lms_role_from_claim(email, lms_role_claim):
    """
    Assign the appropriate Frappe LMS role based on IDP claim.
    Also handles user type upgrade if role requires desk access.
    
    Args:
        email (str): User's email
        lms_role_claim (dict): LMS role claim from Seemplify IDP containing:
            - role: 'student', 'course_creator', 'moderator', 'batch_evaluator', 'course_evaluator'
            - permissions: List of permissions
            - organization_id: Organization context
    
    Returns:
        str: The Frappe role that was assigned
    """
    if not email:
        frappe.logger().warning("No email provided for role assignment")
        return None
    
    if not frappe.db.exists('User', email):
        frappe.logger().warning(f"User {email} does not exist")
        return None
    
    has_idp_matrix, lms_permissions = extract_idp_lms_permissions(lms_role_claim)

    # Canonical permission claims take precedence over the transitional role claim.
    if has_idp_matrix:
        frappe_role = get_frappe_role_for_permissions(lms_permissions)
    elif lms_role_claim and isinstance(lms_role_claim, dict):
        idp_role = lms_role_claim.get('role')
        frappe_role = LMS_ROLE_MAPPING.get(idp_role, DEFAULT_LMS_ROLE)
    else:
        frappe_role = DEFAULT_LMS_ROLE
    
    frappe.logger().info(f"Assigning LMS role to {email}: {frappe_role or 'no access'}")
    
    # Get user document
    user_doc = frappe.get_doc('User', email)
    
    # Remove any existing LMS roles first (user should have only one LMS role)
    existing_lms_roles = [r.role for r in user_doc.roles if r.role in LMS_ROLE_MAPPING.values()]
    for old_role in existing_lms_roles:
        if old_role != frappe_role:
            user_doc.remove_roles(old_role)
            frappe.logger().info(f"Removed old LMS role {old_role} from {email}")
    
    # Add the new role when the IdP grants LMS access. An authoritative empty
    # list removes every prior LMS role instead of falling back to Student.
    if frappe_role and frappe_role not in [r.role for r in user_doc.roles]:
        user_doc.add_roles(frappe_role)
        frappe.logger().info(f"Added LMS role {frappe_role} to {email}")
    
    # If role requires desk access, upgrade user type
    if frappe_role in DESK_ACCESS_ROLES:
        if user_doc.user_type == 'Website User':
            user_doc.user_type = 'System User'
            user_doc.save(ignore_permissions=True)
            frappe.logger().info(f"Upgraded {email} to System User for desk access")
    
    return frappe_role


def get_frappe_role_for_idp_role(idp_role):
    """
    Get the Frappe role name for an IDP role.
    
    Args:
        idp_role (str): IDP role name (e.g., 'student', 'course_creator')
    
    Returns:
        str: Frappe role name (e.g., 'LMS Student', 'Course Creator')
    """
    return LMS_ROLE_MAPPING.get(idp_role, DEFAULT_LMS_ROLE)


def get_all_lms_roles():
    """
    Get all available LMS roles with their descriptions.
    
    Returns:
        list: List of role dictionaries
    """
    return [
        {
            'idp_role': 'student',
            'frappe_role': 'LMS Student',
            'desk_access': False,
            'description': 'Basic learner - enroll in courses, submit assignments, take quizzes'
        },
        {
            'idp_role': 'course_creator',
            'frappe_role': 'Course Creator',
            'desk_access': True,
            'description': 'Create and manage courses, chapters, lessons, quizzes'
        },
        {
            'idp_role': 'moderator',
            'frappe_role': 'Moderator',
            'desk_access': True,
            'description': 'Full LMS admin - publish courses, manage all content and settings'
        },
        {
            'idp_role': 'batch_evaluator',
            'frappe_role': 'Batch Evaluator',
            'desk_access': True,
            'description': 'Manage batches, grade assignments, evaluate student progress'
        },
        {
            'idp_role': 'course_evaluator',
            'frappe_role': 'Course Evaluator',
            'desk_access': True,
            'description': 'Evaluate certifications, issue and manage certificates'
        }
    ]


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
    Create/verify all LMS-specific roles in Frappe.
    Called during app installation or via bench command.
    
    Frappe LMS uses these roles (from DocType permissions):
    - LMS Student: Basic learner, no desk access
    - Course Creator: Create/edit courses, desk access
    - Moderator: Full LMS admin, desk access
    - Batch Evaluator: Manage batches, grade assignments, desk access
    - Course Evaluator: Certification evaluations, desk access (via Course Evaluator doctype)
    """
    roles = [
        {
            'role_name': 'LMS Student',
            'desk_access': 0,
            'home_page': '/lms',
            'description': 'Basic learner role - can enroll in courses, submit assignments, take quizzes'
        },
        {
            'role_name': 'Course Creator',
            'desk_access': 1,
            'home_page': '/lms',
            'description': 'Can create and manage courses, chapters, lessons, quizzes'
        },
        {
            'role_name': 'Moderator',
            'desk_access': 1,
            'home_page': '/lms',
            'description': 'Full LMS admin - can publish courses, manage all content and settings'
        },
        {
            'role_name': 'Batch Evaluator',
            'desk_access': 1,
            'home_page': '/lms',
            'description': 'Can manage batches, grade assignments, evaluate student progress'
        },
        {
            'role_name': 'Course Evaluator',
            'desk_access': 1,
            'home_page': '/lms',
            'description': 'Can evaluate certifications, issue and manage certificates'
        }
    ]
    
    created_roles = []
    for role_data in roles:
        if not frappe.db.exists('Role', role_data['role_name']):
            role = frappe.get_doc({
                'doctype': 'Role',
                **role_data
            })
            role.insert(ignore_permissions=True)
            created_roles.append(role_data['role_name'])
            frappe.logger().info(f"Created role: {role_data['role_name']}")
        else:
            frappe.logger().info(f"Role already exists: {role_data['role_name']}")
    
    if created_roles:
        frappe.db.commit()
        frappe.logger().info(f"Created {len(created_roles)} LMS roles: {', '.join(created_roles)}")
    
    return created_roles


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
    client_secret = frappe.conf.get('seemplify_client_secret')
    if not client_secret:
        frappe.throw(_('Seemplify OAuth client secret is not configured'))
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
