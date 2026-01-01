const { Issuer, generators } = require('openid-client');

let oidcClient = null;
let oidcIssuer = null;

const initializeOIDC = async () => {
  try {
    const issuerUrl = process.env.IDP_ISSUER_URL || process.env.OIDC_ISSUER;
    if (!issuerUrl) {
      console.warn('IDP_ISSUER_URL/OIDC_ISSUER not set, OIDC authentication disabled');
      return null;
    }

    // Discover OIDC issuer configuration
    oidcIssuer = await Issuer.discover(issuerUrl);
    console.log('Discovered OIDC issuer:', oidcIssuer.issuer);

    // Initialize OIDC client with PKCE support
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

// Generate PKCE code verifier and challenge
const generatePKCE = () => {
  const codeVerifier = generators.codeVerifier();
  const codeChallenge = generators.codeChallenge(codeVerifier);
  return { codeVerifier, codeChallenge };
};

// Generate authorization URL for login with PKCE
const generateAuthUrl = (state, nonce, codeVerifier = null, additionalParams = {}) => {
  const client = getOIDCClient();

  // Generate PKCE if not provided
  let pkce = null;
  if (!codeVerifier) {
    pkce = generatePKCE();
  } else {
    // If codeVerifier is provided, we need to generate the challenge
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

  // Return both the URL and the code verifier (needed for token exchange)
  return {
    url: client.authorizationUrl(authParams),
    codeVerifier: pkce.codeVerifier,
  };
};

// Exchange authorization code for tokens with PKCE
const exchangeCode = async (code, state, nonce, codeVerifier, iss = null) => {
  const client = getOIDCClient();
  const issuer = getOIDCIssuer();

  const params = { code, state };
  const checks = {
    state,
    nonce,
  };

  // Add PKCE verifier if provided
  if (codeVerifier) {
    checks.code_verifier = codeVerifier;
  }

  try {
    const tokenSet = await client.callback(
      process.env.OIDC_REDIRECT_URI,
      params,
      checks
    );

    // If tokenSet doesn't have iss, add it from the issuer
    if (tokenSet && !tokenSet.iss) {
      tokenSet.iss = issuer.issuer;
    }

    return tokenSet;
  } catch (error) {
    // If the error is about missing iss, try to work around it
    if (error.message && error.message.includes('iss missing')) {
      console.warn('Token response missing iss, using discovered issuer');
      // Retry with explicit issuer in checks
      const tokenSet = await client.callback(
        process.env.OIDC_REDIRECT_URI,
        params,
        { ...checks, issuer: issuer.issuer }
      );
      if (tokenSet && !tokenSet.iss) {
        tokenSet.iss = issuer.issuer;
      }
      return tokenSet;
    }
    throw error;
  }
};

// Get user info from access token
const getUserInfo = async (accessToken) => {
  const client = getOIDCClient();
  return await client.userinfo(accessToken);
};

// Refresh tokens
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
