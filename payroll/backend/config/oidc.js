const { Issuer, generators } = require('openid-client');
const { getPayrollOidcClientConfig } = require('./identityProvider');

let client;
let issuerInstance = null;

async function getOidcClient() {
  if (client) return client;

  const oidcConfig = getPayrollOidcClientConfig({
    issuerUrlFallback: 'http://localhost:4000',
  });
  const issuerUrl = oidcConfig.issuerUrl;
  const issuer = await Issuer.discover(issuerUrl);
  issuerInstance = issuer;
  
  client = new issuer.Client({
    client_id: oidcConfig.clientId,
    client_secret: oidcConfig.clientSecret,
    redirect_uris: [oidcConfig.redirectUri],
    response_types: ['code']
  });

  return client;
}

// Generate PKCE code verifier and challenge
const generatePKCE = () => {
  const codeVerifier = generators.codeVerifier();
  const codeChallenge = generators.codeChallenge(codeVerifier);
  return { codeVerifier, codeChallenge };
};

// Get OIDC issuer instance (for external validation)
const getOidcIssuer = () => {
  if (!issuerInstance) {
    throw new Error('OIDC issuer not initialized. Call getOidcClient() first.');
  }
  return issuerInstance;
};

// Get user info from access token (validates token with IdP)
async function getUserInfo(accessToken) {
  const oidcClient = await getOidcClient();
  const userinfo = await oidcClient.userinfo(accessToken);
  return userinfo;
}

module.exports = {
  getOidcClient,
  getOidcIssuer,
  generatePKCE,
  getUserInfo,
};
