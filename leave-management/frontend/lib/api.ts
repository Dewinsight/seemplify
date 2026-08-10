import axios, { AxiosError, AxiosInstance } from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5002/api';

// Create axios instance
const api: AxiosInstance = axios.create({
  baseURL: API_URL,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor to add auth token
api.interceptors.request.use(
  (config) => {
    // Get token from localStorage if available
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
      // Clear token and redirect to login (but not if we're already on login page)
      if (typeof window !== 'undefined') {
        const isLoginPage = window.location.pathname === '/login';
        if (!isLoginPage) {
          localStorage.removeItem('accessToken');
          window.location.href = '/login';
        }
      }
    }
    return Promise.reject(error);
  }
);

// Auth API
export const authApi = {
  login: () => {
    // Use /oidc/start instead of /login to force IdP login page (no auto-login)
    // This matches SmartHR behavior - always shows IdP login page when clicking "Login with AIIN"
    const returnTo = encodeURIComponent(window.location.href);
    window.location.href = `${API_URL}/auth/oidc/start?returnTo=${returnTo}`;
  },

  logout: async () => {
    try {
      const response = await api.post('/auth/logout');
      return response.data;
    } catch (error) {
      // Don't throw - logout should always succeed even if API fails
      console.warn('Logout API call failed (non-critical):', error);
      return { success: true, message: 'Logged out locally' };
    }
  },

  getMe: async () => {
    const response = await api.get('/auth/me');
    return response.data;
  },

  refresh: async () => {
    const response = await api.post('/auth/refresh');
    return response.data;
  },

  switchOrganization: async (organizationId: string) => {
    const response = await api.post('/auth/switch-organization', { organizationId });
    return response.data;
  },
};

// Leave Requests API
export const leaveRequestsApi = {
  getAll: async (params?: Record<string, string | number>) => {
    const response = await api.get('/leave-requests', { params });
    return response.data;
  },

  getApprovals: async (params?: Record<string, string | number>) => {
    const response = await api.get('/leave-requests/approvals', { params });
    return response.data;
  },

  getTeamRequests: async (params?: Record<string, string | number>) => {
    const response = await api.get('/leave-requests/team', { params });
    return response.data;
  },

  getAllAdmin: async (params?: Record<string, string | number>) => {
    const response = await api.get('/leave-requests/all', { params });
    return response.data;
  },

  getCalendar: async (startDate: string, endDate: string, teamId?: string) => {
    const response = await api.get('/leave-requests/calendar', {
      params: { startDate, endDate, teamId },
    });
    return response.data;
  },

  getById: async (id: string) => {
    const response = await api.get(`/leave-requests/${id}`);
    return response.data;
  },

  create: async (data: {
    leaveType: string;
    startDate: string;
    endDate: string;
    reason?: string;
    teamId?: string;
  }) => {
    const response = await api.post('/leave-requests', data);
    return response.data;
  },

  approve: async (id: string, comment?: string, idempotencyKey?: string) => {
    const response = await api.post(`/leave-requests/${id}/approve`, {
      comment,
      idempotencyKey,
    });
    return response.data;
  },

  reject: async (id: string, reason: string) => {
    const response = await api.post(`/leave-requests/${id}/reject`, { reason });
    return response.data;
  },

  cancel: async (id: string, reason?: string) => {
    const response = await api.delete(`/leave-requests/${id}`, {
      data: { reason },
    });
    return response.data;
  },
};

// Leave Balances API
export const leaveBalancesApi = {
  getMyBalance: async (year?: number) => {
    const response = await api.get('/leave-balances/me', { params: { year } });
    return response.data;
  },

  getSummary: async (year?: number) => {
    const response = await api.get('/leave-balances/summary', { params: { year } });
    return response.data;
  },

  getAll: async (params?: Record<string, string | number>) => {
    const response = await api.get('/leave-balances', { params });
    return response.data;
  },

  getMembers: async (params?: Record<string, string | number>) => {
    const response = await api.get('/leave-balances/members', { params });
    return response.data;
  },

  getUserBalance: async (userId: string, year?: number) => {
    const response = await api.get(`/leave-balances/user/${userId}`, { params: { year } });
    return response.data;
  },

  updateUserBalance: async (
    userId: string,
    updates: Record<string, { total?: number; used?: number }>,
    year?: number,
    reason?: string
  ) => {
    const response = await api.put(`/leave-balances/user/${userId}`, {
      year,
      updates,
      reason,
    });
    return response.data;
  },

  adjustEntitlement: async (userId: string, leaveTypeKey: string, data: {
    year: number;
    total?: number;
    delta?: number;
    operation?: 'add' | 'deduct' | 'set' | 'reset';
    reason: string;
    resetToPolicy?: boolean;
    expectedVersion?: number;
  }) => {
    const response = await api.patch(
      `/leave-balances/user/${encodeURIComponent(userId)}/entitlements/${encodeURIComponent(leaveTypeKey)}`,
      data
    );
    return response.data;
  },

  getUserHistory: async (userId: string, year?: number) => {
    const response = await api.get(`/leave-balances/user/${encodeURIComponent(userId)}/history`, { params: { year } });
    return response.data;
  },

  getMyHistory: async (year?: number) => {
    const response = await api.get('/leave-balances/me/history', { params: { year } });
    return response.data;
  },

  initializeOrganization: async (year?: number) => {
    const response = await api.post('/leave-balances/initialize', { year });
    return response.data;
  },
};

export const leaveTypesApi = {
  getAll: async (includeInactive = false) => {
    const response = await api.get('/leave-types', { params: { includeInactive } });
    return response.data;
  },
  create: async (data: Record<string, unknown>) => {
    const response = await api.post('/leave-types', data);
    return response.data;
  },
  update: async (key: string, data: Record<string, unknown>) => {
    const response = await api.patch(`/leave-types/${encodeURIComponent(key)}`, data);
    return response.data;
  },
  archive: async (key: string) => {
    const response = await api.delete(`/leave-types/${encodeURIComponent(key)}`);
    return response.data;
  },
};

export const auditLogsApi = {
  getAll: async (params?: Record<string, string | number>) => {
    const response = await api.get('/audit-logs', { params });
    return response.data;
  },
};

// Leave Policies API
export const leavePoliciesApi = {
  get: async () => {
    const response = await api.get('/leave-policies');
    return response.data;
  },

  update: async (updates: Record<string, unknown>) => {
    const response = await api.put('/leave-policies', updates);
    return response.data;
  },

  getDefaults: async () => {
    const response = await api.get('/leave-policies/defaults');
    return response.data;
  },

  getHolidays: async (year?: number) => {
    const response = await api.get('/leave-policies/holidays', { params: { year } });
    return response.data;
  },

  addHoliday: async (date: string, name: string, isRecurring?: boolean) => {
    const response = await api.post('/leave-policies/holidays', {
      date,
      name,
      isRecurring,
    });
    return response.data;
  },

  removeHoliday: async (date: string) => {
    const response = await api.delete('/leave-policies/holidays', {
      data: { date },
    });
    return response.data;
  },

  getEntitlements: async () => {
    const response = await api.get('/leave-policies/entitlements');
    return response.data;
  },
};

export default api;
