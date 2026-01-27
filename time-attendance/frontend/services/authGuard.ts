/**
 * Auth Guard Service
 * 
 * Handles automatic redirect to login page when:
 * - Token is expired
 * - User is not authenticated
 * - API returns 401/403 errors
 */

let isRedirecting = false;

/**
 * Redirect to login page
 */
export function redirectToLogin() {
    if (isRedirecting) return; // Prevent multiple redirects
    isRedirecting = true;

    // Clear auth data
    if (typeof window !== 'undefined') {
        localStorage.removeItem('access_token');
    }

    // Redirect to login
    const currentPath = window.location.pathname;
    const loginUrl = `/login${currentPath !== '/login' ? `?redirect=${encodeURIComponent(currentPath)}` : ''}`;
    
    window.location.href = loginUrl;
}

/**
 * Check if current path is a public route (doesn't require auth)
 */
export function isPublicRoute(path: string): boolean {
    const publicRoutes = ['/login', '/oidc/callback'];
    return publicRoutes.some(route => path.startsWith(route));
}

/**
 * Reset redirect flag (call after successful login)
 */
export function resetRedirectFlag() {
    isRedirecting = false;
}
