import axios from 'axios';

const ACTIVE_ORG_ID_KEY = 'activeOrganizationId';
const LEGACY_ACTIVE_ORG_KEY = 'activeOrganization';

// Use VITE_API_BASE_URL from build-time env var, or fallback
const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ||
  (import.meta.env.PROD
    ? 'https://api.approver.seemplifyai.com/api'
    : 'http://localhost:5000/api');

let activeOrganizationId: string | null = null;

const readLegacyActiveOrganizationId = (): string | null => {
    const raw = localStorage.getItem(LEGACY_ACTIVE_ORG_KEY);
    if (!raw) return null;

    try {
        const parsed = JSON.parse(raw);
        return typeof parsed?._id === 'string' ? parsed._id : null;
    } catch (error) {
        return null;
    }
};

export const getPersistedActiveOrganizationId = (): string | null => {
    return activeOrganizationId
        || localStorage.getItem(ACTIVE_ORG_ID_KEY)
        || readLegacyActiveOrganizationId();
};

export const setPersistedActiveOrganizationId = (orgId: string | null) => {
    activeOrganizationId = orgId;
    if (orgId) {
        localStorage.setItem(ACTIVE_ORG_ID_KEY, orgId);
    } else {
        localStorage.removeItem(ACTIVE_ORG_ID_KEY);
    }
};

export const clearLegacySessionStorage = () => {
    ['token', 'user', 'organizations', LEGACY_ACTIVE_ORG_KEY].forEach((key) => {
        localStorage.removeItem(key);
    });
};

const api = axios.create({
    baseURL: apiBaseUrl,
    withCredentials: true
});

api.interceptors.request.use((config) => {
    const orgId = getPersistedActiveOrganizationId();
    if (orgId) {
        config.headers['X-Organization-Id'] = orgId;
    } else if (config.headers && 'X-Organization-Id' in config.headers) {
        delete config.headers['X-Organization-Id'];
    }
    return config;
});

/** Build full URL for organization logo from stored path */
export const getLogoUrl = (logoPath: string | undefined): string | null => {
    if (!logoPath) return null;
    const filename = logoPath.split('/').pop();
    if (!filename) return null;
    const base = api.defaults.baseURL || '';
    const origin = base.replace(/\/api\/?$/, '');
    return `${origin}/api/uploads/logos/${filename}`;
};

export default api;
