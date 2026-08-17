'use strict';

const { Issuer, generators } = require('openid-client');

let cachedClient;
let cachedConfigKey;

function oidcConfig(source = process.env) {
    const issuerUrl = String(source.IDP_ISSUER_URL || source.OIDC_ISSUER || '').trim();
    const clientId = String(source.OIDC_CLIENT_ID || '').trim();
    const clientSecret = String(source.OIDC_CLIENT_SECRET || '').trim();
    const redirectUri = String(source.OIDC_REDIRECT_URI || '').trim();
    const missing = Object.entries({ issuerUrl, clientId, clientSecret, redirectUri })
        .filter(([, value]) => !value)
        .map(([key]) => key);
    if (missing.length > 0) throw new Error(`OIDC configuration missing: ${missing.join(', ')}`);
    return { issuerUrl, clientId, clientSecret, redirectUri };
}

async function getOidcClient() {
    const config = oidcConfig();
    const key = JSON.stringify(config);
    if (cachedClient && cachedConfigKey === key) return cachedClient;
    const issuer = await Issuer.discover(config.issuerUrl);
    cachedClient = new issuer.Client({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uris: [config.redirectUri],
        response_types: ['code'],
        token_endpoint_auth_method: 'client_secret_basic'
    });
    cachedConfigKey = key;
    return cachedClient;
}

module.exports = { generators, getOidcClient, oidcConfig };
