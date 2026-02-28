import { getApiBaseUrl, getWsBaseUrl, getInactivityTimeout, getInactivityWarningTime } from '../utils/env';
import { sanitizeObject, preventClickjacking, defaultRateLimiter } from '../utils/security';
import { tokenManager } from '../utils/tokenManager';

const isBrowser = typeof window !== 'undefined';

// Use runtime configuration
let FALLBACK_API = 'https://api.seemplifyai.com';
let FALLBACK_WS = 'wss://api.seemplifyai.com';

// Attempt to load fallback-config.json at startup (best-effort, browser only)
if (isBrowser) {
  fetch('/fallback-config.json')
    .then((r) => r.ok ? r.json() : null)
    .then((cfg) => {
      if (cfg && typeof cfg === 'object') {
        if (cfg.NEXT_PUBLIC_API_BASE_URL) FALLBACK_API = String(cfg.NEXT_PUBLIC_API_BASE_URL);
        if (cfg.NEXT_PUBLIC_WS_BASE_URL) FALLBACK_WS = String(cfg.NEXT_PUBLIC_WS_BASE_URL);
        console.log('🛟 Loaded fallback config from JSON:', { FALLBACK_API, FALLBACK_WS });
      }
    })
    .catch(() => {});
}

// Always return the configured/default URLs (no session overrides)
export const getCurrentApiBaseUrl = (): string => {
  return getApiBaseUrl();
};

export const getCurrentWsBaseUrl = (): string => {
  return getWsBaseUrl();
};

export const API_BASE_URL = getApiBaseUrl();
export const WS_BASE_URL = getWsBaseUrl();

// Debug logging
if (isBrowser) {
  console.log('🌐 API Configuration:', {
    API_BASE_URL,
    WS_BASE_URL
  });
}

// Global logout handler
let globalLogoutHandler: (() => void) | null = null;

export const setGlobalLogoutHandler = (handler: () => void) => {
  globalLogoutHandler = handler;
};

// Inactivity timer configuration - from runtime config
const INACTIVITY_TIMEOUT = getInactivityTimeout();
const WARNING_TIME = getInactivityWarningTime();
let inactivityTimer: NodeJS.Timeout | null = null;
let warningTimer: NodeJS.Timeout | null = null;
let lastActivityTime = Date.now();

// Activity events to track - removed mousemove as it causes too frequent triggers
const ACTIVITY_EVENTS = ['mousedown', 'keypress', 'scroll', 'touchstart', 'click'];

// Warning callback for UI
let inactivityWarningHandler: ((timeLeft: number) => void) | null = null;

export const setInactivityWarningHandler = (handler: (timeLeft: number) => void) => {
  inactivityWarningHandler = handler;
};

// Reset inactivity timer
const resetInactivityTimer = () => {
  lastActivityTime = Date.now();
  
  // Clear existing timers
  if (inactivityTimer) {
    clearTimeout(inactivityTimer);
    inactivityTimer = null;
  }
  if (warningTimer) {
    clearTimeout(warningTimer);
    warningTimer = null;
  }

  // Only set timers if user is authenticated
  if (isBrowser && tokenManager.getAccessToken()) {
    // Set warning timer
    warningTimer = setTimeout(() => {
      if (inactivityWarningHandler) {
        inactivityWarningHandler(WARNING_TIME / 1000); // Convert to seconds
        console.warn('⚠️ User will be logged out in 5 minutes due to inactivity');
      }
    }, INACTIVITY_TIMEOUT - WARNING_TIME);

    // Set logout timer
    inactivityTimer = setTimeout(() => {
      console.warn('🚨 Logging out user due to inactivity');
      if (globalLogoutHandler) {
        globalLogoutHandler();
      }
    }, INACTIVITY_TIMEOUT);
  }
};

// Track user activity
const trackActivity = () => {
  resetInactivityTimer();
};

// Initialize inactivity tracking
export const initializeInactivityTracking = () => {
  if (!isBrowser) return;

  // Add event listeners for activity tracking
  ACTIVITY_EVENTS.forEach(event => {
    document.addEventListener(event, trackActivity, true);
  });

  // Start the timer
  resetInactivityTimer();
  
  console.log('🕐 Inactivity tracking initialized - 30 minute timeout');
};

// Cleanup inactivity tracking
export const cleanupInactivityTracking = () => {
  if (!isBrowser) return;

  // Remove event listeners
  ACTIVITY_EVENTS.forEach(event => {
    document.removeEventListener(event, trackActivity, true);
  });

  // Clear timers
  if (inactivityTimer) {
    clearTimeout(inactivityTimer);
    inactivityTimer = null;
  }
  if (warningTimer) {
    clearTimeout(warningTimer);
    warningTimer = null;
  }
  
  console.log('🕐 Inactivity tracking cleaned up');
};

// Get time until logout (for UI display)
export const getTimeUntilLogout = (): number => {
  if (!lastActivityTime) return 0;
  const timeElapsed = Date.now() - lastActivityTime;
  const timeRemaining = INACTIVITY_TIMEOUT - timeElapsed;
  return Math.max(0, Math.floor(timeRemaining / 1000)); // Return seconds
};

// Helper function to get auth headers
export const getAuthHeaders = () => {
  const token = isBrowser ? tokenManager.getAccessToken() : null;
  return {
    'Content-Type': 'application/json',
    ...(token && { 'Authorization': `Bearer ${token}` }),
  };
};

// Removed throttling for organization API calls as it was causing issues

// Internal fetch with token refresh
async function fetchWithTokenRefresh(url: string, options: RequestInit): Promise<Response> {
  // Check if token needs refresh before making request
  if (isBrowser && tokenManager.needsRefresh()) {
    console.log('🔄 Token needs refresh before request');
    await tokenManager.refreshTokens();
  }

  // Make the request
  const response = await fetch(url, options);

  // If 401 and not already refreshing, try to refresh and retry once
  const headers = options.headers as Record<string, string> | undefined;
  if (response.status === 401 && !headers?.['X-Retry-After-Refresh']) {
    console.log('🔄 Got 401, attempting token refresh and retry');
    
    const refreshResult = await tokenManager.refreshTokens();
    if (refreshResult) {
      // Update headers with new token
      const newHeaders = {
        ...options.headers,
        'Authorization': `Bearer ${refreshResult.accessToken}`,
        'X-Retry-After-Refresh': 'true' // Prevent infinite retry
      };

      // Retry the request with new token
      return fetch(url, { ...options, headers: newHeaders });
    }
  }

  return response;
}

// Centralized API request wrapper with 401 handling and security
export const apiRequest = async (url: string, options: RequestInit = {}): Promise<Response> => {
  // Prevent clickjacking on first request
  if (isBrowser && !window.__clickjackingChecked) {
    preventClickjacking();
    window.__clickjackingChecked = true;
  }
  
  // Apply rate limiting for sensitive endpoints (not login, as server handles that)
  const sensitiveEndpoints = ['/api/auth/verify-otp', '/api/auth/resend-otp'];
  if (sensitiveEndpoints.some(endpoint => url.includes(endpoint))) {
    if (!defaultRateLimiter.check(url)) {
      throw new Error('Too many requests. Please wait before trying again.');
    }
  }
  
  // Sanitize request body to prevent injection attacks
  if (options.body && typeof options.body === 'string') {
    try {
      const parsed = JSON.parse(options.body);
      const sanitized = sanitizeObject(parsed);
      options.body = JSON.stringify(sanitized);
    } catch {
      // Body is not JSON, leave as is
    }
  }

  // Log organization API calls for debugging (but don't throttle them)
  if (url.includes('/api/organizations/user')) {
    const headers = options.headers as any;
    const hasTraceId = headers && headers['X-Trace-ID'];
    if (!hasTraceId) {
      console.warn(`⚠️ UNTRACED API CALL to ${url}`, new Error().stack);
      console.warn('Headers passed:', headers);
    } else {
      console.log(`✅ TRACED API CALL to ${url} | Caller: ${headers['X-Caller-ID']} | Trace: ${headers['X-Trace-ID']}`);
    }
  }
  
  // Reset inactivity timer on API activity (user is actively using the app)
  // But don't reset for organization API calls to avoid feedback loops
  if (isBrowser && tokenManager.getAccessToken() && !url.includes('/api/organizations/user')) {
    resetInactivityTimer();
  }

  // Check if this is an admin API call
  const isAdminCall = url.includes('/api/admin');
  const headers = options.headers as any || {};
  
  // Check if this is a file upload (FormData in body)
  const isFileUpload = options.body instanceof FormData;
  
  // For file uploads, DON'T add Content-Type (browser will set multipart/form-data automatically)
  // For admin calls, don't auto-add regular auth headers if admin token is present
  let finalHeaders;
  if (isFileUpload) {
    // For file uploads, only add auth token, NOT Content-Type
    const token = isBrowser ? tokenManager.getAccessToken() : null;
    finalHeaders = {
      ...(token && { 'Authorization': `Bearer ${token}` }),
      ...headers
    };
    console.log('📎 File upload detected - letting browser set Content-Type automatically');
  } else if (isAdminCall && headers['x-admin-auth-token']) {
    finalHeaders = { ...headers };
  } else {
    finalHeaders = { ...getAuthHeaders(), ...headers };
  }

  // Helper to build URL from base
  const buildUrl = (base: string) => (url.startsWith('http') ? url : `${base}${url}`);

  // Check if we should always use fallback (Sterling deployment)
  const shouldUseFallback = isBrowser && window.location.href.includes('sterling');

  // Always try default first, then fallback if it fails (unless Sterling deployment)
  let response: Response;
  
  if (shouldUseFallback) {
    console.log('🌐 Sterling deployment detected, using fallback API directly');
    response = await fetchWithTokenRefresh(buildUrl(FALLBACK_API), { ...options, headers: finalHeaders });
  } else {
    try {
      // First attempt: use the configured/default API base URL
      response = await fetchWithTokenRefresh(buildUrl(API_BASE_URL), { ...options, headers: finalHeaders });
    
      // Check if response is HTML or 404 (indicating misconfiguration)
      if (!response.ok) {
        const ct = response.headers.get('content-type') || '';
        const isHtmlResponse = ct.includes('text/html') || ct.includes('text/plain');
        const is404 = response.status === 404;
        
        if (is404 || isHtmlResponse) {
          // Try to read response to see if it's HTML
          const responseText = await response.clone().text().catch(() => '');
          if (isHtmlResponse && responseText.trim().startsWith('<')) {
            console.warn('🔁 Default API returned HTML, trying fallback...');
            response = await fetchWithTokenRefresh(buildUrl(FALLBACK_API), { ...options, headers: finalHeaders });
          } else if (is404) {
            console.warn('🔁 Default API returned 404, trying fallback...');
            response = await fetchWithTokenRefresh(buildUrl(FALLBACK_API), { ...options, headers: finalHeaders });
          }
        }
      }
    } catch (err) {
      // Network error (connection refused, DNS failure, etc.)
      console.warn('🌐 Network error with default API, trying fallback...', err);
      try {
        response = await fetchWithTokenRefresh(buildUrl(FALLBACK_API), { ...options, headers: finalHeaders });
      } catch (fallbackErr) {
        console.error('❌ Both default and fallback APIs failed:', fallbackErr);
        throw err; // Throw the original error
      }
    }
  }

  // Handle 401 Unauthorized responses
  if (response.status === 401 && isBrowser) {
    let errorData: any = {};
    try {
      errorData = await response.clone().json();
    } catch (parseErr) {
      console.warn('⚠️ Unable to parse 401 response JSON', parseErr);
    }
    console.warn('🚨 401 Unauthorized response:', errorData);
    
    const code = errorData.code || errorData.error || '';
    const message = errorData.msg || errorData.message || '';
    const shouldAutoLogout = [
      'token_expired',
      'token_invalid',
      'session_not_found',
      'session_revoked',
      'session_version_mismatch'
    ].includes(code) || ['Token has expired','Invalid token','Token verification failed','No token, authorization denied'].some(err => message.includes(err));
    
    if (shouldAutoLogout) {
      console.warn('🚨 Auto-logging out user due to auth error:', errorData.msg || errorData.message);
      
      // Check if this is an admin API call
      const isAdminCall = url.includes('/api/admin');
      
      if (isAdminCall) {
        // For admin calls, redirect to admin login
        localStorage.removeItem('adminToken');
        localStorage.removeItem('adminData');
        window.location.href = '/admin/login';
      } else {
        // Clear regular user session
        tokenManager.clearTokens();
        
        // Trigger global logout if handler is set
        if (globalLogoutHandler) {
          globalLogoutHandler();
        }
        
        // Redirect to login
        window.location.href = '/login';
      }
    } else {
      console.warn('⚠️ 401 error but not auto-logging out:', errorData.msg || errorData.message);
    }
  }

  return response;
};

