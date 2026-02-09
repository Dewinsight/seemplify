import axios from 'axios';

// Use VITE_API_BASE_URL from build-time env var, or fallback
const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ||
  (import.meta.env.PROD
    ? 'https://api.approver.seemplifyai.com/api'
    : 'http://localhost:5000/api');

const api = axios.create({
    baseURL: apiBaseUrl,
});

// Inject X-Organization-Id header from active org in localStorage
api.interceptors.request.use((config) => {
    const activeOrg = localStorage.getItem('activeOrganization');
    if (activeOrg) {
        try {
            const org = JSON.parse(activeOrg);
            if (org && org._id) {
                config.headers['X-Organization-Id'] = org._id;
            }
        } catch (e) {
            // Invalid JSON in localStorage — ignore
        }
    }
    return config;
});

export default api;
