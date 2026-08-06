import axios, { AxiosError } from 'axios';
import { resolvePayrollApiUrl } from '@/lib/runtimeConfig';

const API_URL = resolvePayrollApiUrl();

// Create axios instance with credentials
const api = axios.create({
  baseURL: API_URL,
  withCredentials: true, // Important for cookies/sessions
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor to add auth token
api.interceptors.request.use(
  (config) => {
    // Get token from localStorage (set after OIDC callback)
    if (typeof window !== 'undefined') {
      const token = localStorage.getItem('accessToken');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor for error handling
api.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    if (error.response?.status === 401) {
      // Only redirect if not already on login page
      if (typeof window !== 'undefined') {
        const isLoginPage = window.location.pathname === '/login';
        if (!isLoginPage) {
          console.warn('401 Unauthorized - session may have expired');
          // Clear stored token
          localStorage.removeItem('accessToken');
          // Redirect to login
          window.location.href = '/login';
        }
      }
    }
    return Promise.reject(error);
  }
);

// Auth API helpers
export const authApi = {
  // Initiate OIDC login - redirects to backend which handles OIDC flow
  login: () => {
    const returnTo = encodeURIComponent(window.location.origin);
    window.location.href = `${API_URL}/auth/oidc/start?returnTo=${returnTo}`;
  },

  // Logout - clears session on backend and frontend
  logout: async () => {
    try {
      const response = await api.post('/auth/logout');
      localStorage.removeItem('accessToken');
      return response.data;
    } catch (error) {
      // Don't throw - logout should always succeed even if API fails
      console.warn('Logout API call failed (non-critical):', error);
      localStorage.removeItem('accessToken');
      return { success: true, message: 'Logged out locally' };
    }
  },

  // Get current user info from backend
  getMe: async () => {
    const response = await api.get('/auth/me');
    return response.data;
  },

  // Refresh token
  refresh: async () => {
    const response = await api.post('/auth/refresh');
    return response.data;
  },

  // Switch organization
  switchOrganization: async (organizationId: string) => {
    const response = await api.post('/auth/switch-organization', { organizationId });
    return response.data;
  },
};

// Helper to extract and store access token from URL hash after OIDC callback
export const handleAuthCallback = (): boolean => {
  if (typeof window === 'undefined') return false;

  const hash = window.location.hash;
  if (hash && hash.includes('access_token=')) {
    const params = new URLSearchParams(hash.substring(1));
    const accessToken = params.get('access_token');

    if (accessToken) {
      // Store token in localStorage
      localStorage.setItem('accessToken', accessToken);

      // Clear hash from URL without reloading
      window.history.replaceState(null, '', window.location.pathname + window.location.search);

      return true;
    }
  }

  return false;
};

// Check if user is authenticated (has valid token)
export const isAuthenticated = (): boolean => {
  if (typeof window === 'undefined') return false;
  return !!localStorage.getItem('accessToken');
};

// Get stored access token
export const getAccessToken = (): string | null => {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('accessToken');
};

export default api;
