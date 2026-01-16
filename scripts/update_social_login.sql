-- Update Social Login Key for Seemplify with correct endpoints
UPDATE `tabSocial Login Key` 
SET 
  authorize_url = '/auth',
  access_token_url = '/token',
  redirect_url = '/api/method/frappe.integrations.oauth2_logins.custom/Seemplify',
  api_endpoint = '/me',
  client_secret = 'lms-secret',
  auth_url_data = '{"response_type": "code", "scope": "openid email profile"}',
  modified = NOW()
WHERE name = 'seemplify' OR name = 'Seemplify';
