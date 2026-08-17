const AUTH_COOKIE_NAME = 'mosaic_auth';
const AUTH_COOKIE_TTL_MS = 24 * 60 * 60 * 1000;

const parseCookieHeader = (cookieHeader = '') => {
    return String(cookieHeader || '')
        .split(';')
        .map(part => part.trim())
        .filter(Boolean)
        .reduce((acc, part) => {
            const separatorIndex = part.indexOf('=');
            if (separatorIndex === -1) return acc;

            const key = part.slice(0, separatorIndex).trim();
            const value = part.slice(separatorIndex + 1).trim();
            if (!key) return acc;

            try {
                acc[key] = decodeURIComponent(value);
            } catch (error) {
                acc[key] = value;
            }
            return acc;
        }, {});
};

const getAuthCookieOptions = () => {
    const options = {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: AUTH_COOKIE_TTL_MS
    };

    if (process.env.AUTH_COOKIE_DOMAIN) {
        options.domain = process.env.AUTH_COOKIE_DOMAIN;
    }

    return options;
};

const clearLegacyDomainCookie = (res) => {
    if (process.env.NODE_ENV !== 'production') return;
    res.clearCookie(AUTH_COOKIE_NAME, {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/',
        domain: process.env.LEGACY_AUTH_COOKIE_DOMAIN || '.seemplifyai.com'
    });
};

const setAuthCookie = (res, token) => {
    // Migrate away from the former parent-domain cookie before issuing the
    // host-only cookie. A sibling Seemplify subdomain must not control this app's session.
    clearLegacyDomainCookie(res);
    res.cookie(AUTH_COOKIE_NAME, token, getAuthCookieOptions());
};

const clearAuthCookie = (res) => {
    res.clearCookie(AUTH_COOKIE_NAME, {
        ...getAuthCookieOptions(),
        maxAge: undefined
    });
    clearLegacyDomainCookie(res);
};

const extractTokenFromRequest = (req) => {
    const authorization = req.headers['authorization'];
    if (typeof authorization === 'string' && authorization.startsWith('Bearer ')) {
        return authorization.slice('Bearer '.length).trim();
    }

    const cookies = parseCookieHeader(req.headers.cookie);
    return cookies[AUTH_COOKIE_NAME] || null;
};

module.exports = {
    AUTH_COOKIE_NAME,
    AUTH_COOKIE_TTL_MS,
    clearAuthCookie,
    extractTokenFromRequest,
    getAuthCookieOptions,
    parseCookieHeader,
    setAuthCookie
};
