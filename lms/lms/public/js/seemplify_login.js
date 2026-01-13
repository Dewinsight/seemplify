/**
 * Seemplify Login for Frappe LMS
 * 
 * Redirects to branded login page and handles OAuth2 flow.
 */

frappe.ready(function() {
  // Redirect default /login to branded login page
  if (window.location.pathname === '/login') {
    // Check for return URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    const returnTo = urlParams.get('redirect-to') || urlParams.get('redirect_to');
    
    // Build redirect URL
    let brandedLoginUrl = '/lms-login';
    if (returnTo) {
      brandedLoginUrl += '?redirect_to=' + encodeURIComponent(returnTo);
    }
    
    // Redirect to branded login
    window.location.href = brandedLoginUrl;
    return;
  }

  // Handle provider parameter for direct OAuth start
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('provider') === 'seemplify') {
    window.loginWithSeemplify();
  }
});

/**
 * Initiate OAuth2 login with Seemplify
 */
window.loginWithSeemplify = function() {
  // Build OAuth URL for Seemplify IDP
  const idpUrl = 'https://auth.seemplifyai.com';
  const clientId = 'lms';
  const redirectUri = window.location.origin + '/api/method/frappe.integrations.oauth2_logins.login_via_oauth2';
  
  const authUrl = idpUrl + '/oidc/auth?' + new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state: btoa(JSON.stringify({ redirect_to: '/lms' }))
  }).toString();
  
  window.location.href = authUrl;
};
