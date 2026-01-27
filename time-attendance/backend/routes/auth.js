const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const {
    generateAuthUrl,
    exchangeCode,
    getUserInfo,
    generatePKCE,
} = require('../config/oidc');
const { verifySubscriptionAccess, getSubscriptionRequiredUrl } = require('../services/idpSubscriptionService');

// Store PKCE verifiers temporarily (in production, use Redis or similar)
const pkceStore = new Map();

// Initiate login - redirect to Identity Provider
router.get('/login', (req, res) => {
    try {
        const state = uuidv4();
        const nonce = uuidv4();
        const pkce = generatePKCE();

        // Store state, nonce, and PKCE verifier in session
        req.session.authState = state;
        req.session.authNonce = nonce;
        req.session.codeVerifier = pkce.codeVerifier;

        // Also store in memory for callback
        pkceStore.set(state, {
            nonce,
            codeVerifier: pkce.codeVerifier,
            createdAt: Date.now(),
        });

        const { url } = generateAuthUrl(state, nonce, pkce.codeVerifier);

        res.redirect(url);
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Failed to initiate login' });
    }
});

// Auth callback from Identity Provider
router.get('/oidc/callback', async (req, res) => {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5011';

    try {
        const { code, state, error, error_description } = req.query;

        if (error) {
            console.error('OIDC error:', error, error_description);
            return res.redirect(`${frontendUrl}/login?error=${encodeURIComponent(error_description || error)}`);
        }

        if (!code || !state) {
            return res.redirect(`${frontendUrl}/login?error=Missing+authorization+code`);
        }

        // Get stored PKCE data
        const storedData = pkceStore.get(state) || {
            nonce: req.session?.authNonce,
            codeVerifier: req.session?.codeVerifier,
        };

        if (!storedData.codeVerifier) {
            console.error('No code verifier found for state:', state);
            return res.redirect(`${frontendUrl}/login?error=Invalid+session`);
        }

        // Exchange code for tokens
        const tokenSet = await exchangeCode(
            code,
            state,
            storedData.nonce,
            storedData.codeVerifier
        );

        // Clean up stored data
        pkceStore.delete(state);
        if (req.session) {
            delete req.session.authState;
            delete req.session.authNonce;
            delete req.session.codeVerifier;
        }

        // Get user info
        const userinfo = await getUserInfo(tokenSet.access_token);

        // Build user object
        const user = {
            id: userinfo.sub,
            email: userinfo.email,
            name: userinfo.name,
            organizations: userinfo.organizations || [],
            teams: userinfo.teams || [],
            currentOrganization: userinfo.currentOrganization,
            accessToken: tokenSet.access_token,
            refreshToken: tokenSet.refresh_token,
            expiresAt: tokenSet.expires_at,
        };

        // Determine current organization ID
        const currentOrgId = userinfo.currentOrganization?.id ||
            userinfo.current_organization?.id ||
            userinfo.organizations?.[0]?.id;

        // Verify subscription access for the current organization
        if (currentOrgId) {
            console.log('🔒 Verifying subscription access for org:', currentOrgId);
            const subscriptionCheck = await verifySubscriptionAccess(
                currentOrgId,
                tokenSet.access_token
            );

            if (!subscriptionCheck.allowed) {
                console.log('❌ Subscription access denied for time-attendance:', subscriptionCheck.reason);
                // Redirect to IDP subscription required page
                const subscriptionUrl = getSubscriptionRequiredUrl(
                    'time-attendance',
                    currentOrgId,
                    subscriptionCheck.reason
                );
                return res.redirect(subscriptionUrl);
            }
            console.log('✅ Subscription access verified for time-attendance');
        }

        // Store in session
        if (req.session) {
            req.session.user = user;
        }

        // Redirect to frontend with token in URL hash
        const redirectUrl = `${frontendUrl}/dashboard#access_token=${tokenSet.access_token}`;
        res.redirect(redirectUrl);

    } catch (error) {
        console.error('Callback error:', error);
        res.redirect(`${frontendUrl}/login?error=${encodeURIComponent('Authentication failed')}`);
    }
});

// Get current user
router.get('/me', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        const accessToken = authHeader.substring(7);
        const userinfo = await getUserInfo(accessToken);

        console.log('📋 Userinfo claims:', JSON.stringify({
            sub: userinfo.sub,
            email: userinfo.email,
            organizations: userinfo.organizations?.map(o => ({ id: o.id, name: o.name })),
            currentOrganization: userinfo.currentOrganization,
            current_organization: userinfo.current_organization,
        }, null, 2));

        // Find current organization - check both field names
        let currentOrganization = userinfo.currentOrganization || userinfo.current_organization;
        if (!currentOrganization && userinfo.organizations?.length > 0) {
            currentOrganization = userinfo.organizations[0];
        }

        res.json({
            user: {
                id: userinfo.sub,
                email: userinfo.email,
                name: userinfo.name,
                organizations: userinfo.organizations || [],
                teams: userinfo.teams || [],
            },
            currentOrganization,
            currentOrganizationId: currentOrganization?.id,
        });
    } catch (error) {
        console.error('Get user error:', error);
        res.status(401).json({ error: 'Invalid token' });
    }
});

// Logout
router.post('/logout', (req, res) => {
    if (req.session) {
        req.session.destroy((err) => {
            if (err) {
                console.error('Session destroy error:', err);
            }
        });
    }
    res.json({ success: true });
});

// Switch organization
router.post('/switch-organization', async (req, res) => {
    try {
        const { organizationId } = req.body;
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        const accessToken = authHeader.substring(7);
        const userinfo = await getUserInfo(accessToken);

        const organization = userinfo.organizations?.find(org => org.id === organizationId);

        if (!organization) {
            return res.status(403).json({ error: 'Organization not found or access denied' });
        }

        // Verify subscription access for the target organization
        console.log('🔒 Verifying subscription access for org:', organizationId);
        const subscriptionCheck = await verifySubscriptionAccess(
            organizationId,
            accessToken
        );

        if (!subscriptionCheck.allowed) {
            console.log('❌ Organization switch denied - no subscription:', subscriptionCheck.reason);
            return res.status(403).json({
                error: 'This organization does not have access to Time & Attendance',
                code: 'SUBSCRIPTION_REQUIRED',
                reason: subscriptionCheck.reason,
                subscribeUrl: subscriptionCheck.subscribeUrl || `${process.env.IDP_URL || 'http://localhost:4000'}/plans`
            });
        }
        console.log('✅ Subscription access verified for time-attendance');

        // Update session if exists
        if (req.session && req.session.user) {
            req.session.user.currentOrganization = organization;
        }

        res.json({
            success: true,
            organization,
        });
    } catch (error) {
        console.error('Switch organization error:', error);
        res.status(500).json({ error: 'Failed to switch organization' });
    }
});

// Clean up old PKCE entries periodically (every 5 minutes)
setInterval(() => {
    const now = Date.now();
    const maxAge = 10 * 60 * 1000; // 10 minutes

    for (const [state, data] of pkceStore.entries()) {
        if (now - data.createdAt > maxAge) {
            pkceStore.delete(state);
        }
    }
}, 5 * 60 * 1000);

module.exports = router;
