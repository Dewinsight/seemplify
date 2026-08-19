import axios from 'axios';
import { redirectToLogin, isPublicRoute } from '@/services/authGuard';
import { getApiUrl } from '@/lib/env';
import { API_ERROR_EVENT, getApiErrorMessage, isApiErrorHandled } from '@/lib/apiError';

// Use centralized environment detection to prevent localhost in production
const API_URL = getApiUrl();

// Create axios instance
export const api = axios.create({
    baseURL: API_URL,
    headers: {
        'Content-Type': 'application/json',
    },
    withCredentials: true,
});

// Add auth token to requests
api.interceptors.request.use((config) => {
    if (typeof window !== 'undefined') {
        const token = localStorage.getItem('access_token');
        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }
    }
    return config;
});

// Handle response errors - auto redirect on 401/403
api.interceptors.response.use(
    (response) => response,
    async (error) => {
        if (typeof Blob !== 'undefined' && error.response?.data instanceof Blob) {
            try {
                const text = await error.response.data.text();
                error.response.data = JSON.parse(text);
            } catch {
                // Keep the original blob when the provider did not return JSON.
            }
        }
        // Only handle auth errors if we're not already on a public route
        if (typeof window !== 'undefined') {
            const currentPath = window.location.pathname;
            
            // Check for authentication errors
            if (error.response?.status === 401 || error.response?.status === 403) {
                // Don't redirect if we're already on login page or OIDC callback
                if (!isPublicRoute(currentPath)) {
                    console.warn('Authentication error - redirecting to login');
                    redirectToLogin();
                }
            }

            window.setTimeout(() => {
                if (isApiErrorHandled(error)) return;
                window.dispatchEvent(new CustomEvent(API_ERROR_EVENT, {
                    detail: { message: getApiErrorMessage(error, 'The request could not be completed.', { markHandled: false }) },
                }));
            }, 0);
        }
        
        return Promise.reject(error);
    }
);

// Auth API helpers
export const authApi = {
    getMe: async () => {
        const response = await api.get('/auth/me');
        return response.data;
    },
    logout: async () => {
        return api.post('/auth/logout');
    },
    switchOrganization: async (organizationId: string) => {
        const response = await api.post('/auth/switch-organization', { organizationId });
        return response.data;
    },
};

// Clock API helpers
export const clockApi = {
    getStatus: async () => {
        const response = await api.get('/clock/status');
        return response.data;
    },
    clockIn: async (note?: string, location?: any) => {
        const response = await api.post('/clock/in', { note, location });
        return response.data;
    },
    clockOut: async (note?: string, location?: any) => {
        const response = await api.post('/clock/out', { note, location });
        return response.data;
    },
    startBreak: async (note?: string) => {
        const response = await api.post('/clock/break/start', { note });
        return response.data;
    },
    endBreak: async (note?: string) => {
        const response = await api.post('/clock/break/end', { note });
        return response.data;
    },
    getEntries: async (startDate?: string, endDate?: string) => {
        const response = await api.get('/clock/entries', { params: { startDate, endDate } });
        return response.data;
    },
    createManualEntry: async (data: { entryType: string; timestamp: string; note: string; timezone?: string; targetUserId?: string }) => {
        const response = await api.post('/clock/manual', data);
        return response.data;
    },
    subscribe: (onAttendance: () => void) => {
        const controller = new AbortController();
        const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
        (async () => {
            try {
                const response = await fetch(`${API_URL}/clock/events`, {
                    headers: token ? { Authorization: `Bearer ${token}` } : {},
                    credentials: 'include',
                    signal: controller.signal,
                });
                if (!response.ok || !response.body) return;
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';
                while (true) {
                    const result = await reader.read();
                    if (result.done) break;
                    buffer += decoder.decode(result.value, { stream: true });
                    const messages = buffer.split('\n\n');
                    buffer = messages.pop() || '';
                    messages.forEach(message => { if (message.includes('event: attendance')) onAttendance(); });
                }
            } catch (error: any) {
                if (error?.name !== 'AbortError') console.warn('Attendance live updates disconnected');
            }
        })();
        return () => controller.abort();
    },
};

// Timesheet API helpers
export const timesheetApi = {
    getCurrent: async () => {
        const response = await api.get('/timesheets/current');
        return response.data;
    },
    getList: async (params?: any) => {
        const response = await api.get('/timesheets', { params });
        return response.data;
    },
    list: async (params?: any) => {
        const response = await api.get('/timesheets', { params });
        return response.data;
    },
    getById: async (id: string) => {
        const response = await api.get(`/timesheets/${id}`);
        return response.data;
    },
    submit: async (id: string, note?: string) => {
        const response = await api.post(`/timesheets/${id}/submit`, { note });
        return response.data;
    },
    recall: async (id: string) => {
        const response = await api.post(`/timesheets/${id}/recall`);
        return response.data;
    },
    exportExcel: async (id: string) => {
        const response = await api.get(`/timesheets/${id}/export`, {
            responseType: 'blob',
        });

        const disposition = response.headers['content-disposition'] || '';
        const match = disposition.match(/filename=\"?([^\";]+)\"?/i);
        const filename = match ? match[1] : `timesheet-${id}.xlsx`;

        return {
            blob: response.data,
            filename,
        };
    },
};

// Attendance API helpers
export const attendanceApi = {
    getDashboard: async () => {
        const response = await api.get('/attendance/dashboard');
        return response.data;
    },
    getTeamStatus: async (teamId?: string) => {
        const response = await api.get('/attendance/team', { params: { teamId } });
        return response.data;
    },
    getTeamMemberDetail: async (userId: string) => {
        const response = await api.get(`/attendance/team/${userId}`);
        return response.data;
    },
    sendClockOutReminder: async (userId: string) => {
        const response = await api.post(`/attendance/team/${userId}/notify-clock-out`);
        return response.data;
    },
    exportTeamExcel: async (params?: { teamId?: string; status?: string; q?: string }) => {
        const response = await api.get('/attendance/team/export', {
            params,
            responseType: 'blob',
        });

        const disposition = response.headers['content-disposition'] || '';
        const match = disposition.match(/filename=\"?([^\";]+)\"?/i);
        const filename = match ? match[1] : 'team-attendance-export.xlsx';

        return {
            blob: response.data,
            filename,
        };
    },
    getSummary: async (params?: any) => {
        const response = await api.get('/attendance/summary', { params });
        return response.data;
    },
};

// Report API helpers
export const reportsApi = {
    getExceptions: async (startDate: string, endDate: string) => {
        const response = await api.get('/reports/exceptions', { params: { startDate, endDate } });
        return response.data;
    },
    exportExceptions: async (startDate: string, endDate: string) => {
        const response = await api.get('/reports/exceptions', { params: { startDate, endDate, format: 'xlsx' }, responseType: 'blob' });
        const disposition = response.headers['content-disposition'] || '';
        const match = disposition.match(/filename="?([^";]+)"?/i);
        return { blob: response.data, filename: match?.[1] || 'attendance-exceptions.xlsx' };
    },
    getMonthlyAttendance: async (start: string, end: string) => {
        const response = await api.get('/reports/attendance', { params: { start, end } });
        return response.data;
    },
    exportAttendance: async (start: string, end: string) => {
        const response = await api.get('/reports/attendance/export', { params: { start, end }, responseType: 'blob' });
        return { blob: response.data, filename: `attendance-${start.slice(0, 10)}-${end.slice(0, 10)}.xlsx` };
    },
    getAnalytics: async (start?: string, end?: string) => (await api.get('/reports/analytics', { params: { start, end } })).data,
    getCapacityForecast: async (start?: string, end?: string) => (await api.get('/reports/capacity-forecast', { params: { start, end } })).data,
    getOvertime: async (start: string, end: string) => {
        const response = await api.get('/reports/overtime', { params: { start, end } });
        return response.data;
    },
    getLateness: async (start: string, end: string) => {
        const response = await api.get('/reports/lateness', { params: { start, end } });
        return response.data;
    },
    getGeofenceViolations: async (startDate?: string, endDate?: string, userId?: string) => {
        const response = await api.get('/reports/geofence-violations', { 
            params: { startDate, endDate, userId } 
        });
        return response.data;
    },
    getLocationAccuracy: async (startDate?: string, endDate?: string) => {
        const response = await api.get('/reports/location-accuracy', { 
            params: { startDate, endDate } 
        });
        return response.data;
    },
    getLocationHistory: async (userId: string, startDate?: string, endDate?: string, limit?: number) => {
        const response = await api.get('/reports/location-history', { 
            params: { userId, startDate, endDate, limit } 
        });
        return response.data;
    },
};

// Admin API helpers
export const adminApi = {
    getPolicy: async () => {
        const response = await api.get('/admin/attendance-policy');
        return response.data;
    },
    updatePolicy: async (policy: any) => {
        const response = await api.put('/admin/attendance-policy', policy);
        return response.data;
    },
    addGeofenceLocation: async (location: any) => {
        const response = await api.post('/admin/geofence-locations', location);
        return response.data;
    },
    updateGeofenceLocation: async (index: number, location: any) => {
        const response = await api.put(`/admin/geofence-locations/${index}`, location);
        return response.data;
    },
    deleteGeofenceLocation: async (index: number) => {
        const response = await api.delete(`/admin/geofence-locations/${index}`);
        return response.data;
    },
};

export const attendanceAccessApi = {
    getPolicy: async () => (await api.get('/admin/access-policy')).data,
    updatePolicy: async (roles: Array<{ key: string; permissions: string[] }>) => (await api.put('/admin/access-policy', { roles })).data,
    searchPeople: async (q = '') => (await api.get('/admin/access-policy/people', { params: { q } })).data,
    assignPerson: async (userId: string, roleKeys: string[]) => (await api.put(`/admin/access-policy/people/${encodeURIComponent(userId)}`, { roleKeys })).data,
};

// Approvals API helpers
export const approvalsApi = {
    getPending: async () => {
        const response = await api.get('/approvals');
        return response.data.timesheets || response.data;
    },
    getHistory: async () => {
        const response = await api.get('/approvals/history');
        return response.data.timesheets || response.data;
    },
    approve: async (id: string, note?: string) => {
        const response = await api.post(`/approvals/${id}/approve`, { comment: note });
        return response.data;
    },
    reject: async (id: string, reason: string) => {
        const response = await api.post(`/approvals/${id}/reject`, { reason });
        return response.data;
    },
    requestRevision: async (id: string, reason: string) => {
        const response = await api.post(`/approvals/${id}/request-revision`, { reason });
        return response.data;
    },
    revert: async (id: string, reason: string) => {
        const response = await api.post(`/approvals/${id}/revert`, { reason });
        return response.data;
    },
    delete: async (id: string, reason: string) => {
        const response = await api.delete(`/approvals/${id}`, { data: { reason } });
        return response.data;
    },
};

export const schedulingApi = {
    getRoster: async () => (await api.get('/v1/scheduling/roster')).data,
    reconcileRoster: async () => (await api.post('/v1/scheduling/roster/reconcile')).data,
    getTemplates: async () => (await api.get('/v1/scheduling/templates')).data,
    createTemplate: async (data: any) => (await api.post('/v1/scheduling/templates', data)).data,
    getShifts: async (params?: any) => (await api.get('/v1/scheduling/shifts', { params })).data,
    createShift: async (data: any) => (await api.post('/v1/scheduling/shifts', data)).data,
    acknowledge: async (id: string, accepted = true, note = '') => (await api.post(`/v1/scheduling/shifts/${id}/acknowledge`, { accepted, note })).data,
    publish: async (data: any) => (await api.post('/v1/scheduling/publish', data)).data,
    getRequests: async () => (await api.get('/v1/scheduling/requests')).data,
    createRequest: async (data: any) => (await api.post('/v1/scheduling/requests', data)).data,
    reviewRequest: async (id: string, approved: boolean, note = '') => (await api.post(`/v1/scheduling/requests/${id}/review`, { approved, note })).data,
    getAvailability: async () => (await api.get('/v1/scheduling/availability')).data,
    setAvailability: async (date: string, data: any) => (await api.put(`/v1/scheduling/availability/${date}`, data)).data,
};

export const exceptionsApi = {
    list: async (params?: any) => (await api.get('/v1/exceptions', { params })).data,
    requestCorrection: async (id: string, data: any) => (await api.post(`/v1/exceptions/${id}/correction-requests`, data)).data,
    requestTimesheetCorrection: async (timesheetId: string, data: any) => (await api.post(`/v1/exceptions/timesheets/${timesheetId}/correction-requests`, data)).data,
    flagTimesheetDay: async (timesheetId: string, data: any) => (await api.post(`/v1/exceptions/timesheets/${timesheetId}/flags`, data)).data,
    review: async (id: string, accepted: boolean, note = '') => (await api.post(`/v1/exceptions/${id}/review`, { accepted, note })).data,
    resolve: async (id: string, note = '') => (await api.post(`/v1/exceptions/${id}/resolve`, { note })).data,
    getCorrectionRoute: async (timesheetId: string) => (await api.get(`/v1/exceptions/timesheets/${timesheetId}/correction-route`)).data,
};

export const presenceApi = {
    notice: async () => (await api.get('/v1/presence/notice')).data,
    me: async (params?: any) => (await api.get('/v1/presence/me', { params })).data,
    exportMine: async () => (await api.get('/v1/presence/me/export')).data,
    requestPrivacyAction: async (type: string, reason: string) => (await api.post('/v1/presence/privacy-requests', { type, reason })).data,
    privacyRequests: async () => (await api.get('/v1/presence/privacy-requests')).data,
    team: async (params?: any) => (await api.get('/v1/presence/team', { params })).data,
    assignments: async () => (await api.get('/v1/presence/assignments')).data,
    saveAssignment: async (data: any) => (await api.put('/v1/presence/assignments', data)).data,
};

export const notificationsApi = {
    list: async (unread = false) => (await api.get('/v1/notifications', { params: { unread } })).data,
    read: async (id: string) => (await api.post(`/v1/notifications/${id}/read`)).data,
    readAll: async () => (await api.post('/v1/notifications/read-all')).data,
    getPreferences: async () => (await api.get('/v1/notifications/preferences/me')).data,
    savePreferences: async (data: any) => (await api.put('/v1/notifications/preferences/me', data)).data,
    savePushSubscription: async (subscription: PushSubscriptionJSON) => (await api.post('/v1/notifications/push-subscriptions', { subscription })).data,
};

export const rulePacksApi = {
    list: async (params?: any) => (await api.get('/v1/rule-packs', { params })).data,
    assignmentOptions: async () => (await api.get('/v1/rule-packs/assignment-options')).data,
    coverage: async () => (await api.get('/v1/rule-packs/coverage')).data,
    seedDefaults: async () => (await api.post('/v1/rule-packs/seed-defaults')).data,
    get: async (id: string) => (await api.get(`/v1/rule-packs/${id}`)).data,
    create: async (data: any) => (await api.post('/v1/rule-packs', data)).data,
    clone: async (id: string, data?: any) => (await api.post(`/v1/rule-packs/${id}/clone`, data || {})).data,
    update: async (id: string, data: any) => (await api.patch(`/v1/rule-packs/${id}`, data)).data,
    validate: async (id: string) => (await api.post(`/v1/rule-packs/${id}/validate`)).data,
    publish: async (id: string, data: any) => (await api.post(`/v1/rule-packs/${id}/publish`, data)).data,
    retire: async (id: string, data?: any) => (await api.post(`/v1/rule-packs/${id}/retire`, data || {})).data,
    simulate: async (id: string, data: any) => (await api.post(`/v1/rule-packs/${id}/simulate`, data)).data,
};

export const correctionRunsApi = {
    list: async () => (await api.get('/admin/correction-runs')).data,
    create: async (data: any) => (await api.post('/admin/correction-runs', data)).data,
};

export default api;

