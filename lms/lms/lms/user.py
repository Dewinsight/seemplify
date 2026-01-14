import frappe
from frappe import _
from frappe.model.naming import append_number_if_name_exists
from frappe.utils import escape_html, random_string
from frappe.website.utils import cleanup_page_name, is_signup_disabled
import requests

from lms.lms.utils import get_country_code

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


def validate_username_duplicates(doc, method):
	while not doc.username or doc.username_exists():
		doc.username = append_number_if_name_exists(
			doc.doctype, cleanup_page_name(doc.full_name), fieldname="username"
		)
	if " " in doc.username:
		doc.username = doc.username.replace(" ", "")

	if len(doc.username) < 4:
		doc.username = doc.email.replace("@", "").replace(".", "")


def after_insert(doc, method):
	doc.add_roles("LMS Student")


@frappe.whitelist(allow_guest=True)
def sign_up(email, full_name, verify_terms, user_category):
	if is_signup_disabled():
		frappe.throw(_("Sign Up is disabled"), _("Not Allowed"))

	user = frappe.db.get("User", {"email": email})
	if user:
		if user.enabled:
			return 0, _("Already Registered")
		else:
			return 0, _("Registered but disabled")
	else:
		if frappe.db.get_creation_count("User", 60) > 300:
			frappe.respond_as_web_page(
				_("Temporarily Disabled"),
				_(
					"Too many users signed up recently, so the registration is disabled. Please try back in an hour"
				),
				http_status_code=429,
			)

	user = frappe.get_doc(
		{
			"doctype": "User",
			"email": email,
			"first_name": escape_html(full_name),
			"verify_terms": verify_terms,
			"user_category": user_category,
			"country": "",
			"enabled": 1,
			"new_password": random_string(10),
			"user_type": "Website User",
		}
	)
	user.flags.ignore_permissions = True
	user.flags.ignore_password_policy = True
	user.insert()

	# set default signup role as per Portal Settings
	default_role = frappe.db.get_single_value("Portal Settings", "default_role")
	if default_role:
		user.add_roles(default_role)

	user.add_roles("LMS Student")
	set_country_from_ip(None, user.name)

	if user.flags.email_sent:
		return 1, _("Please check your email for verification")
	else:
		return 2, _("Please ask your administrator to verify your sign-up")


def set_country_from_ip(login_manager=None, user=None):
	if not user and login_manager:
		user = login_manager.user
	user_country = frappe.db.get_value("User", user, "country")
	if user_country:
		return
	frappe.db.set_value("User", user, "country", get_country_code())
	return


def on_login(login_manager):
	"""
	Hook called after successful login.
	Handles:
	1. Setting home page for LMS app
	2. Processing OAuth/SSO logins to assign LMS roles from IDP claims
	"""
	default_app = frappe.db.get_single_value("System Settings", "default_app")
	if default_app == "lms":
		frappe.local.response["home_page"] = "/lms"
	
	# Check if this was an OAuth login and process LMS role
	process_oauth_lms_role(login_manager)


def process_oauth_lms_role(login_manager):
	"""
	Process LMS role from OAuth/SSO login.
	Fetches user claims from IDP and assigns appropriate Frappe roles.
	"""
	try:
		user = login_manager.user
		if not user or user == "Guest":
			return
		
		# Check if there's OAuth data in the session or flags
		oauth_info = getattr(frappe.local, 'oauth_userinfo', None)
		
		# If no cached OAuth info, try to fetch from IDP
		if not oauth_info:
			oauth_info = get_oauth_userinfo_from_idp(user)
		
		if not oauth_info:
			frappe.logger().debug(f"No OAuth info found for {user}")
			return
		
		# Extract LMS role claim
		lms_role_claim = oauth_info.get('lms_role')
		
		if not lms_role_claim:
			frappe.logger().debug(f"No lms_role claim found for {user}")
			return
		
		# Get the role name (could be in 'role' or 'frappe_role' field)
		idp_role = lms_role_claim.get('role')
		frappe_role = lms_role_claim.get('frappe_role') or LMS_ROLE_MAPPING.get(idp_role, 'LMS Student')
		
		frappe.logger().info(f"Processing LMS role for {user}: {idp_role} -> {frappe_role}")
		
		# Assign the role to the user
		assign_lms_role_to_user(user, frappe_role)
		
	except Exception as e:
		frappe.logger().error(f"Error processing OAuth LMS role: {e}")


def get_oauth_userinfo_from_idp(user_email):
	"""
	Fetch user info from IDP's /me endpoint.
	Uses the Social Login Key configuration for Seemplify.
	"""
	try:
		# Get the Social Login Key for Seemplify
		social_login_key = frappe.get_doc("Social Login Key", "Seemplify")
		
		if not social_login_key or not social_login_key.enabled:
			return None
		
		# Get the base URL from the social login key
		base_url = social_login_key.base_url
		if not base_url:
			return None
		
		# Try to get access token from session
		# This might not be available depending on how Frappe stores OAuth tokens
		access_token = frappe.session.data.get('oauth_access_token')
		
		if not access_token:
			frappe.logger().debug("No OAuth access token in session")
			return None
		
		# Fetch userinfo from IDP
		userinfo_url = f"{base_url}/me"
		response = requests.get(
			userinfo_url,
			headers={'Authorization': f'Bearer {access_token}'},
			timeout=10
		)
		
		if response.status_code == 200:
			return response.json()
		else:
			frappe.logger().warning(f"Failed to fetch userinfo from IDP: {response.status_code}")
			return None
			
	except Exception as e:
		frappe.logger().error(f"Error fetching OAuth userinfo: {e}")
		return None


def assign_lms_role_to_user(user_email, frappe_role):
	"""
	Assign a Frappe role to a user.
	Also updates user_type based on desk access requirements.
	"""
	if not frappe.db.exists('User', user_email):
		frappe.logger().warning(f"User {user_email} does not exist")
		return
	
	if not frappe.db.exists('Role', frappe_role):
		frappe.logger().warning(f"Role {frappe_role} does not exist")
		return
	
	user_doc = frappe.get_doc('User', user_email)
	
	# Remove existing LMS roles first (to ensure clean role assignment)
	existing_lms_roles = [r.role for r in user_doc.roles if r.role in LMS_ROLE_MAPPING.values()]
	for old_role in existing_lms_roles:
		if old_role != frappe_role:
			user_doc.remove_roles(old_role)
	
	# Add the new role
	if frappe_role not in [r.role for r in user_doc.roles]:
		user_doc.add_roles(frappe_role)
		frappe.logger().info(f"Assigned role {frappe_role} to user {user_email}")
	
	# Update user_type if role grants desk access
	if frappe_role in DESK_ACCESS_ROLES:
		if user_doc.user_type != 'System User':
			user_doc.user_type = 'System User'
			user_doc.save(ignore_permissions=True)
			frappe.logger().info(f"Updated {user_email} to System User for desk access")
	
	frappe.db.commit()