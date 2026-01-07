import express from 'express';
import { samlIdPService } from '../services/samlService.js';
import { Account } from '../models/Account.js';

const router = express.Router();

// Import getCachedClaims - THIS IS THE KEY INTEGRATION POINT
// It reuses ALL existing organization, team, and permission logic
let getCachedClaims;
export const setClaimsFunction = (fn) => { getCachedClaims = fn; };

/**
 * IdP Metadata endpoint
 * GET /saml/metadata
 * 
 * Applications (SPs) use this to configure SAML SSO
 */
router.get('/metadata', (req, res) => {
    try {
        if (!samlIdPService.isReady()) {
            return res.status(503).json({ error: 'SAML IdP not configured' });
        }
        const metadata = samlIdPService.getMetadata();
        res.type('application/xml').send(metadata);
    } catch (error) {
        console.error('SAML metadata error:', error);
        res.status(500).json({ error: 'Failed to generate metadata' });
    }
});

/**
 * List registered Service Providers
 * GET /saml/sps
 */
router.get('/sps', (req, res) => {
    const sps = samlIdPService.listServiceProviders();
    res.json(sps);
});

/**
 * Single Sign-On endpoint
 * GET /saml/sso
 * 
 * Receives AuthnRequest from Service Provider
 * If user is logged in → generate assertion
 * If not → redirect to login page
 */
router.get('/sso', async (req, res) => {
    try {
        const { sp, RelayState } = req.query;

        if (!sp) {
            return res.status(400).json({
                error: 'Missing sp parameter',
                hint: 'Use /saml/sso?sp=<service_provider_id>'
            });
        }

        if (!samlIdPService.isReady()) {
            return res.status(503).json({ error: 'SAML IdP not configured' });
        }

        const spConfig = samlIdPService.getServiceProvider(sp);
        if (!spConfig) {
            return res.status(400).json({ error: `Unknown Service Provider: ${sp}` });
        }

        // Check if user is already logged in (via OIDC session)
        const sessionAccountId = req.session?.accountId;

        if (!sessionAccountId) {
            // Store SAML context and redirect to login
            req.session.samlRequest = {
                sp: sp,
                relayState: RelayState || spConfig.defaultRelayState || '/',
                timestamp: Date.now()
            };

            console.log(`🔐 SAML SSO: No session, redirecting to login for SP: ${sp}`);
            return res.redirect(`/login?return_to=${encodeURIComponent('/saml/sso/complete')}`);
        }

        // User is logged in - generate assertion
        await handleSamlAssertion(req, res, sp, RelayState);

    } catch (error) {
        console.error('SAML SSO error:', error);
        res.status(500).json({ error: 'SSO failed', details: error.message });
    }
});

/**
 * Complete SSO after login
 * GET /saml/sso/complete
 * 
 * Called after user logs in to complete the SAML flow
 */
router.get('/sso/complete', async (req, res) => {
    try {
        const samlRequest = req.session?.samlRequest;

        if (!samlRequest) {
            return res.status(400).json({
                error: 'No pending SAML request',
                hint: 'Start SSO flow with /saml/sso?sp=<id>'
            });
        }

        // Check session timeout (10 minutes)
        if (Date.now() - samlRequest.timestamp > 10 * 60 * 1000) {
            delete req.session.samlRequest;
            return res.status(400).json({ error: 'SAML request expired' });
        }

        const sessionAccountId = req.session?.accountId;
        if (!sessionAccountId) {
            return res.redirect(`/login?return_to=${encodeURIComponent('/saml/sso/complete')}`);
        }

        await handleSamlAssertion(req, res, samlRequest.sp, samlRequest.relayState);

        // Clean up
        delete req.session.samlRequest;

    } catch (error) {
        console.error('SAML SSO complete error:', error);
        res.status(500).json({ error: 'SSO completion failed', details: error.message });
    }
});

/**
 * Handle SAML assertion generation and POST to SP
 */
async function handleSamlAssertion(req, res, spId, relayState) {
    const sessionAccountId = req.session?.accountId;

    // Get account with populated orgs/teams
    const account = await Account.findOne({ sub: sessionAccountId })
        .populate('organizations.organization', 'name')
        .populate('currentOrganization', 'name')
        .lean();

    if (!account) {
        return res.status(401).json({ error: 'Account not found' });
    }

    // Build claims (reusing OIDC claims logic!)
    let claims = { sub: account.sub, email: account.email, name: account.profile?.name };
    if (getCachedClaims) {
        claims = await getCachedClaims(account);
    }

    console.log(`📝 SAML: Generating assertion for ${account.email} → SP: ${spId}`);

    // Generate SAML Response
    const { context, entityEndpoint } = await samlIdPService.createLoginResponse(
        spId,
        claims,
        `_${Date.now()}`
    );

    // Return HTML form that auto-submits to SP
    const html = `
<!DOCTYPE html>
<html>
<head>
  <title>Redirecting to Application...</title>
  <style>
    body { font-family: system-ui, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #0a0a0a; color: #fff; }
    .loader { text-align: center; }
    .spinner { width: 40px; height: 40px; border: 3px solid #333; border-top-color: #3b82f6; border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto 20px; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="loader">
    <div class="spinner"></div>
    <p>Signing you in...</p>
  </div>
  <form id="saml-form" method="POST" action="${entityEndpoint}">
    <input type="hidden" name="SAMLResponse" value="${Buffer.from(context).toString('base64')}" />
    ${relayState ? `<input type="hidden" name="RelayState" value="${relayState}" />` : ''}
  </form>
  <script>document.getElementById('saml-form').submit();</script>
</body>
</html>`;

    res.type('html').send(html);
}

/**
 * Single Logout endpoint
 * GET/POST /saml/logout
 */
router.all('/logout', async (req, res) => {
    try {
        // Clear session
        req.session?.destroy?.();

        const returnUrl = req.query.return_to || process.env.DEFAULT_LOGOUT_URL || '/';
        res.redirect(returnUrl);
    } catch (error) {
        console.error('SAML logout error:', error);
        res.status(500).json({ error: 'Logout failed' });
    }
});

export default router;
