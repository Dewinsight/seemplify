// Keep the production session cookie app-specific. The former `mosaic_auth`
// name was once issued for the parent Seemplify domain, which means a stale
// sibling-domain cookie can shadow a fresh host-only cookie in browser request
// headers after OIDC completes.
const AUTH_COOKIE_NAME = 'seemplify_approver_session';
const LEGACY_AUTH_COOKIE_NAMES = ['mosaic_auth'];
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

const clearLegacyCookies = (res) => {
    LEGACY_AUTH_COOKIE_NAMES.forEach((name) => {
        res.clearCookie(name, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            path: '/'
        });

        if (process.env.NODE_ENV === 'production') {
            res.clearCookie(name, {
                httpOnly: true,
                secure: true,
                sameSite: 'lax',
                path: '/',
                domain: process.env.LEGACY_AUTH_COOKIE_DOMAIN || '.seemplifyai.com'
            });
        }
    });
};

const setAuthCookie = (res, token) => {
    // Remove old host and parent-domain cookies before issuing a distinct,
    // host-only session. A sibling Seemplify subdomain must not control this app.
    clearLegacyCookies(res);
    res.cookie(AUTH_COOKIE_NAME, token, getAuthCookieOptions());
};

const clearAuthCookie = (res) => {
    res.clearCookie(AUTH_COOKIE_NAME, {
        ...getAuthCookieOptions(),
        maxAge: undefined
    });
    clearLegacyCookies(res);
};

const extractTokenFromRequest = (req) => {
    const authorization = req.headers['authorization'];
    if (typeof authorization === 'string' && authorization.startsWith('Bearer ')) {
        return authorization.slice('Bearer '.length).trim();
    }

    const cookies = parseCookieHeader(req.headers.cookie);
    return cookies[AUTH_COOKIE_NAME]
        || LEGACY_AUTH_COOKIE_NAMES.map(name => cookies[name]).find(Boolean)
        || null;
};

module.exports = {
    AUTH_COOKIE_NAME,
    LEGACY_AUTH_COOKIE_NAMES,
    AUTH_COOKIE_TTL_MS,
    clearAuthCookie,
    extractTokenFromRequest,
    getAuthCookieOptions,
    parseCookieHeader,
    setAuthCookie
};
