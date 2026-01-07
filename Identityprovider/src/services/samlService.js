import * as samlify from 'samlify';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * SAML Identity Provider Service
 * 
 * Seemplify IdP issues SAML assertions to Service Provider applications.
 * Users authenticate with Seemplify credentials (email/password in MongoDB).
 * 
 * Flow:
 * 1. App sends AuthnRequest to /saml/sso
 * 2. User logs in (reuses OIDC login session)  
 * 3. IdP generates SAML Assertion with claims
 * 4. IdP POSTs assertion to App's ACS endpoint
 */
class SAMLIdPService {
    constructor() {
        this.idp = null;
        this.serviceProviders = new Map();
        this.initialized = false;
    }

    /**
     * Initialize the SAML Identity Provider
     */
    initialize() {
        if (this.initialized) return;

        try {
            const privateKey = this.loadPrivateKey();
            const certificate = this.loadCertificate();

            if (!privateKey || !certificate) {
                console.warn('⚠️ SAML IdP: Missing certificates - SAML disabled');
                return;
            }

            // Create Identity Provider
            this.idp = samlify.IdentityProvider({
                entityID: process.env.SAML_IDP_ENTITY_ID || `${process.env.ISSUER_URL}/saml`,
                privateKey: privateKey,
                privateKeyPass: process.env.SAML_KEY_PASSWORD || '',
                signingCert: certificate,
                singleSignOnService: [{
                    Binding: samlify.Constants.namespace.binding.redirect,
                    Location: `${process.env.ISSUER_URL}/saml/sso`
                }, {
                    Binding: samlify.Constants.namespace.binding.post,
                    Location: `${process.env.ISSUER_URL}/saml/sso`
                }],
                singleLogoutService: [{
                    Binding: samlify.Constants.namespace.binding.redirect,
                    Location: `${process.env.ISSUER_URL}/saml/logout`
                }],
                nameIDFormat: [
                    samlify.Constants.namespace.format.emailAddress,
                    samlify.Constants.namespace.format.persistent
                ],
                // Assertion settings
                wantAuthnRequestsSigned: false, // Allow unsigned AuthnRequests for simplicity
                signatureConfig: {
                    prefix: 'ds',
                    location: {
                        reference: "/samlp:Response/saml:Assertion",
                        action: 'after'
                    }
                }
            });

            this.initialized = true;
            console.log('✅ SAML Identity Provider initialized');
        } catch (error) {
            console.error('❌ SAML IdP initialization failed:', error.message);
        }
    }

    /**
     * Load IdP private key
     */
    loadPrivateKey() {
        try {
            const keyPath = path.join(__dirname, '../../certs/idp-private.pem');
            if (fs.existsSync(keyPath)) {
                return fs.readFileSync(keyPath, 'utf-8');
            }
            if (process.env.SAML_IDP_PRIVATE_KEY) {
                return process.env.SAML_IDP_PRIVATE_KEY.replace(/\\n/g, '\n');
            }
            return null;
        } catch (error) {
            console.warn('⚠️ Could not load SAML IdP private key:', error.message);
            return null;
        }
    }

    /**
     * Load IdP certificate
     */
    loadCertificate() {
        try {
            const certPath = path.join(__dirname, '../../certs/idp-cert.pem');
            if (fs.existsSync(certPath)) {
                return fs.readFileSync(certPath, 'utf-8');
            }
            if (process.env.SAML_IDP_CERTIFICATE) {
                return process.env.SAML_IDP_CERTIFICATE.replace(/\\n/g, '\n');
            }
            return null;
        } catch (error) {
            console.warn('⚠️ Could not load SAML IdP certificate:', error.message);
            return null;
        }
    }

    /**
     * Register a Service Provider (application)
     */
    registerServiceProvider(spId, config) {
        const sp = samlify.ServiceProvider({
            entityID: config.entityId,
            assertionConsumerService: [{
                Binding: samlify.Constants.namespace.binding.post,
                Location: config.acsUrl
            }],
            singleLogoutService: config.sloUrl ? [{
                Binding: samlify.Constants.namespace.binding.redirect,
                Location: config.sloUrl
            }] : [],
            // Optional: SP's signing certificate for signed AuthnRequests
            signingCert: config.certificate || null
        });

        this.serviceProviders.set(spId, {
            ...config,
            sp: sp
        });

        console.log(`✅ Registered SAML SP: ${spId} (${config.name})`);
    }

    /**
     * Get registered Service Provider
     */
    getServiceProvider(spId) {
        return this.serviceProviders.get(spId);
    }

    /**
     * List all registered SPs
     */
    listServiceProviders() {
        return Array.from(this.serviceProviders.entries()).map(([id, config]) => ({
            id,
            name: config.name,
            entityId: config.entityId,
            enabled: config.enabled !== false
        }));
    }

    /**
     * Parse incoming AuthnRequest
     */
    async parseAuthnRequest(request, binding = 'redirect') {
        if (!this.idp) throw new Error('SAML IdP not initialized');

        // For now, just extract the SP identifier and RelayState
        // In production, you'd validate the request signature
        return {
            spEntityId: request.issuer || null,
            relayState: request.RelayState || null,
            requestId: request.ID || `_${Date.now()}`
        };
    }

    /**
     * Create SAML Assertion for a user
     * @param {string} spId - Service Provider identifier
     * @param {Object} user - User data (from Account + getCachedClaims)
     * @param {string} requestId - Original AuthnRequest ID
     */
    async createLoginResponse(spId, user, requestId = null) {
        if (!this.idp) throw new Error('SAML IdP not initialized');

        const spConfig = this.serviceProviders.get(spId);
        if (!spConfig) throw new Error(`Unknown Service Provider: ${spId}`);

        const { sp } = spConfig;

        // Build SAML attributes from user claims
        const attributes = this.buildAttributes(user);

        // Create the login response
        const response = await this.idp.createLoginResponse(
            sp,
            null, // requestInfo (parsed AuthnRequest)
            'post', // binding
            {
                // User info
                email: user.email,

                // Attributes to include in assertion
                attributes: attributes
            },
            // Additional options
            (samlContent) => {
                // Custom template modifications if needed
                return samlContent;
            },
            false, // isEncrypt
            requestId // inResponseTo
        );

        return {
            context: response.context, // The SAML Response XML
            entityEndpoint: spConfig.acsUrl // Where to POST
        };
    }

    /**
     * Build SAML attributes from user claims
     * Maps our claims to standard SAML attribute names
     */
    buildAttributes(user) {
        const attributes = [];

        // Standard attributes
        if (user.email) {
            attributes.push({
                name: 'email',
                friendlyName: 'Email',
                value: user.email
            });
            attributes.push({
                name: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
                value: user.email
            });
        }

        if (user.name) {
            attributes.push({
                name: 'displayName',
                friendlyName: 'Display Name',
                value: user.name
            });
            attributes.push({
                name: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name',
                value: user.name
            });
        }

        // Organization claims
        if (user.current_organization) {
            attributes.push({
                name: 'currentOrganization',
                value: JSON.stringify(user.current_organization)
            });
        }

        if (user.organizations && user.organizations.length > 0) {
            attributes.push({
                name: 'organizations',
                value: JSON.stringify(user.organizations)
            });
        }

        // Team claims  
        if (user.teams && user.teams.length > 0) {
            attributes.push({
                name: 'teams',
                value: JSON.stringify(user.teams)
            });
        }

        // Permissions
        if (user.team_permissions && user.team_permissions.length > 0) {
            attributes.push({
                name: 'permissions',
                value: JSON.stringify(user.team_permissions)
            });
        }

        return attributes;
    }

    /**
     * Get IdP metadata XML
     */
    getMetadata() {
        if (!this.idp) throw new Error('SAML IdP not initialized');
        return this.idp.getMetadata();
    }

    /**
     * Check if IdP is ready
     */
    isReady() {
        return this.initialized && this.idp !== null;
    }
}

// Export singleton
export const samlIdPService = new SAMLIdPService();
export default samlIdPService;
