/**
 * Seemplify Login for Frappe LMS
 *
 * Redirects legacy auth pages to the branded login page.
 * Email/password login only - no Social Login Key.
 */

// Redirect immediately if on a browser-facing auth page.
var legacyAuthPaths = ['/login', '/login/', '/sign-up', '/signup', '/new-sign-up', '/forgot-password', '/forgot'];
if (legacyAuthPaths.indexOf(window.location.pathname) !== -1) {
	var urlParams = new URLSearchParams(window.location.search);
	var returnTo = urlParams.get('redirect-to') || urlParams.get('redirect_to');
	var brandedLoginUrl = '/lms-login';
	if (returnTo) {
		brandedLoginUrl += '?redirect_to=' + encodeURIComponent(returnTo);
	}
	window.location.replace(brandedLoginUrl);
}
