'use strict';

const jwt = require('jsonwebtoken');
const { generators, getOidcClient, oidcConfig } = require('../services/oidcClientService');
const { provisionIdentity } = require('../services/idpProvisioningService');
const { buildAuthPayload } = require('./authController');
const { clearAuthCookie, parseCookieHeader, setAuthCookie } = require('../utils/authSession');

const TRANSACTION_COOKIE = 'mosaic_oidc_tx';
const TRANSACTION_TTL_MS = 10 * 60 * 1000;

function frontendOrigin() {
    return String(process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
}

function safeReturnPath(value) {
    const fallback = '/';
    const candidate = String(value || '').trim();
    if (!candidate) return fallback;
    if (candidate.startsWith('/') && !candidate.startsWith('//')) return candidate;
    try {
        const url = new URL(candidate);
        if (url.origin === new URL(frontendOrigin()).origin) return `${url.pathname}${url.search}${url.hash}`;
    } catch {
        // Invalid external return targets intentionally fall back to the app root.
    }
    return fallback;
}

function transactionSecret() {
    const secret = String(process.env.OIDC_STATE_SECRET || process.env.JWT_SECRET || '').trim();
    if (process.env.NODE_ENV === 'production' && Buffer.byteLength(secret) < 32) {
        throw new Error('OIDC_STATE_SECRET must contain at least 32 bytes in production.');
    }
    return secret || 'approver-development-only-state-secret';
}

function transactionCookieOptions() {
    return {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/api/auth/oidc',
        maxAge: TRANSACTION_TTL_MS
    };
}

function clearTransactionCookie(res) {
    res.clearCookie(TRANSACTION_COOKIE, { ...transactionCookieOptions(), maxAge: undefined });
}

function redirectToLogin(res, error) {
    const message = encodeURIComponent(String(error || 'Single sign-on failed'));
    return res.redirect(`${frontendOrigin()}/login?error=${message}`);
}

exports.start = async (req, res) => {
    try {
        const client = await getOidcClient();
        const state = generators.state();
        const nonce = generators.nonce();
        const codeVerifier = generators.codeVerifier();
        const transaction = jwt.sign({
            state,
            nonce,
            codeVerifier,
            returnTo: safeReturnPath(req.query.returnTo)
        }, transactionSecret(), { expiresIn: '10m', audience: 'approver-oidc', issuer: 'approver' });
        res.cookie(TRANSACTION_COOKIE, transaction, transactionCookieOptions());

        const parameters = {
            scope: 'openid email profile',
            state,
            nonce,
            code_challenge: generators.codeChallenge(codeVerifier),
            code_challenge_method: 'S256'
        };
        if (req.query.force_login === 'true') parameters.prompt = 'login';
        if (typeof req.query.hub_token === 'string' && req.query.hub_token) {
            parameters.hub_token = req.query.hub_token;
        }
        return res.redirect(client.authorizationUrl(parameters));
    } catch (error) {
        console.error('Approver OIDC start failed:', error.message);
        return redirectToLogin(res, 'The identity service is temporarily unavailable.');
    }
};

exports.callback = async (req, res) => {
    if (req.query.error) {
        clearTransactionCookie(res);
        return redirectToLogin(res, req.query.error_description || req.query.error);
    }
    try {
        const cookies = parseCookieHeader(req.headers.cookie);
        const rawTransaction = cookies[TRANSACTION_COOKIE];
        if (!rawTransaction) throw new Error('The sign-in transaction cookie is missing or expired.');
        const transaction = jwt.verify(rawTransaction, transactionSecret(), {
            audience: 'approver-oidc',
            issuer: 'approver'
        });
        const client = await getOidcClient();
        const config = oidcConfig();
        const tokenSet = await client.callback(config.redirectUri, client.callbackParams(req), {
            state: transaction.state,
            nonce: transaction.nonce,
            code_verifier: transaction.codeVerifier
        });
        const idTokenClaims = tokenSet.claims();
        const userInfo = tokenSet.access_token ? await client.userinfo(tokenSet.access_token) : {};
        const user = await provisionIdentity({ ...idTokenClaims, ...userInfo });
        const payload = {
            ...buildAuthPayload(user),
            sub: user.idpSubject,
            authProvider: 'seemplify-idp',
            sv: Number(user.sessionVersion || 0)
        };
        const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '24h' });
        setAuthCookie(res, token);
        clearTransactionCookie(res);
        return res.redirect(`${frontendOrigin()}${safeReturnPath(transaction.returnTo)}`);
    } catch (error) {
        clearAuthCookie(res);
        clearTransactionCookie(res);
        console.error('Approver OIDC callback failed:', error.message);
        return redirectToLogin(res, error.code === 'APPROVER_ACCESS_DENIED' ? error.message : 'Single sign-on could not be completed.');
    }
};

exports.logout = (req, res) => {
    clearAuthCookie(res);
    clearTransactionCookie(res);
    const issuer = String(process.env.IDP_ISSUER_URL || process.env.OIDC_ISSUER || '').replace(/\/$/, '');
    return res.redirect(issuer ? `${issuer}/logout` : `${frontendOrigin()}/login`);
};

exports.status = (req, res) => {
    let configured = true;
    try { oidcConfig(); } catch { configured = false; }
    res.json({ configured, localAuthEnabled: String(process.env.LOCAL_AUTH_ENABLED || '').toLowerCase() === 'true' });
};

module.exports.safeReturnPath = safeReturnPath;
