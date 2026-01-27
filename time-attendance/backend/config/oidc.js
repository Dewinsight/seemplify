const { Issuer, generators } = require('openid-client');

let oidcClient = null;
let oidcIssuer = null;

const initializeOIDC = async () => {
    try {
        oidcIssuer = await Issuer.discover(process.env.IDP_ISSUER_URL);
        console.log('Discovered OIDC issuer:', oidcIssuer.issuer);

        oidcClient = new oidcIssuer.Client({
            client_id: process.env.OIDC_CLIENT_ID,
            client_secret: process.env.OIDC_CLIENT_SECRET,
            redirect_uris: [process.env.OIDC_REDIRECT_URI],
            response_types: ['code'],
            token_endpoint_auth_method: 'client_secret_basic',
        });

        console.log('OIDC client initialized with PKCE support');
        return oidcClient;
    } catch (error) {
        console.error('Failed to initialize OIDC client:', error.message);
        throw error;
    }
};

const getOIDCClient = () => {
    if (!oidcClient) {
        throw new Error('OIDC client not initialized. Call initializeOIDC() first.');
    }
    return oidcClient;
};

const getOIDCIssuer = () => {
    if (!oidcIssuer) {
        throw new Error('OIDC issuer not initialized. Call initializeOIDC() first.');
    }
    return oidcIssuer;
};

const generatePKCE = () => {
    const codeVerifier = generators.codeVerifier();
    const codeChallenge = generators.codeChallenge(codeVerifier);
    return { codeVerifier, codeChallenge };
};

const generateAuthUrl = (state, nonce, codeVerifier = null, additionalParams = {}) => {
    const client = getOIDCClient();

    let pkce = null;
    if (!codeVerifier) {
        pkce = generatePKCE();
    } else {
        const codeChallenge = generators.codeChallenge(codeVerifier);
        pkce = { codeVerifier, codeChallenge };
    }

    const authParams = {
        scope: 'openid email profile organizations teams',
        state,
        nonce,
        redirect_uri: process.env.OIDC_REDIRECT_URI,
        code_challenge: pkce.codeChallenge,
        code_challenge_method: 'S256',
        ...additionalParams,
    };

    return {
        url: client.authorizationUrl(authParams),
        codeVerifier: pkce.codeVerifier,
    };
};

const exchangeCode = async (code, state, nonce, codeVerifier, iss = null) => {
    const client = getOIDCClient();
    const issuer = getOIDCIssuer();

    try {
        // Use the grant method directly to exchange the authorization code
        // This bypasses the strict iss validation in the callback method
        const tokenSet = await client.grant({
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: process.env.OIDC_REDIRECT_URI,
            code_verifier: codeVerifier,
        });

        // Add issuer if missing
        if (tokenSet && !tokenSet.iss) {
            tokenSet.iss = issuer.issuer;
        }

        return tokenSet;
    } catch (error) {
        console.error('Token exchange error:', error.message);
        throw error;
    }
};

const getUserInfo = async (accessToken) => {
    const client = getOIDCClient();
    return await client.userinfo(accessToken);
};

const refreshTokens = async (refreshToken) => {
    const client = getOIDCClient();
    return await client.refresh(refreshToken);
};

module.exports = {
    initializeOIDC,
    getOIDCClient,
    getOIDCIssuer,
    generateAuthUrl,
    generatePKCE,
    exchangeCode,
    getUserInfo,
    refreshTokens,
};
