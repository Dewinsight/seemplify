# SAML 2.0 Addition Plan for Seemplify Identity Provider

> **Status**: ✅ IMPLEMENTED (IdP Mode)  
> **Date**: January 2026  
> **Library**: `samlify` (for IdP mode)  
> **Approach**: Seemplify as SAML Identity Provider (issues assertions to apps)

---

## ⚠️ IMPORTANT: Implementation Changed

**Original Plan**: SAML Service Provider (SP) mode - receive assertions from external IdPs (Okta, Azure)

**Actual Implementation**: SAML Identity Provider (IdP) mode - Seemplify **issues** SAML assertions to applications, using our own user database (same as OIDC).

| Aspect | Original Plan (SP) | Actual Implementation (IdP) |
|--------|-------------------|---------------------------|
| **Role** | Receive from Okta/Azure | Issue to our apps |
| **Users** | External IdP users | Our MongoDB users |
| **Claims** | Mapped from external | Built via `getCachedClaims()` |
| **Login** | External IdP login | Seemplify login page |

---

## ✅ What Was Implemented

### Files Created/Modified

| File | Purpose |
|------|---------|
| `src/services/samlService.js` | SAML IdP service using `samlify` |
| `src/routes/samlRoutes.js` | SSO, metadata, logout endpoints |
| `saml-sps.json` | Registered Service Providers (apps) |
| `src/models/Account.js` | Added SAML fields |
| `src/index.js` | Mount routes at `/saml` |

### Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /saml/metadata` | IdP metadata XML |
| `GET /saml/sps` | List registered apps |
| `GET /saml/sso?sp=<id>` | Start SSO |
| `GET /saml/sso/complete` | Complete after login |
| `ALL /saml/logout` | Single logout |

### Key Features

1. **Uses same users as OIDC** - MongoDB Account collection
2. **Uses same claims** - `getCachedClaims()` for orgs/teams/permissions
3. **Shares login session** - If logged in via OIDC, SAML works too
4. **Multi-app support** - Register apps in `saml-sps.json`

---

## 📚 Original Plan (Below)

The following sections contain the **original SP-mode plan** which was **not implemented**. Kept for reference only.

## 🏗️ Current Architecture Analysis

### Existing Components (Keep As-Is)

```
Identityprovider/
├── src/
│   ├── index.js              ← Main Express app + OIDC provider
│   ├── models/
│   │   ├── Account.js        ← User accounts (add SAML fields)
│   │   ├── Organization.js   ← Org memberships ✅ REUSE
│   │   └── Team.js           ← Team hierarchy ✅ REUSE
│   ├── utils/
│   │   ├── permissions.js    ← Permission system ✅ REUSE
│   │   └── teams.js          ← Team claims ✅ REUSE
│   ├── middleware/
│   │   ├── apiAuth.js        ← Token validation ✅ REUSE
│   │   └── permissions.js    ← Auth middleware ✅ REUSE
│   └── services/
│       ├── emailService.js   ← Email sending ✅ REUSE
│       └── otpService.js     ← OTP handling ✅ REUSE
├── clients.json              ← OIDC clients ✅ KEEP
└── package.json              ← Add @node-saml/passport-saml
```

### Key Integration Points

1. **Claims Building** (`getCachedClaims` in index.js) - **CRITICAL TO REUSE**
   - Already builds organization claims
   - Already builds team claims  
   - Already builds team permissions
   - SAML tokens will use this same function

2. **Organization/Team Structure** - **FULLY COMPATIBLE**
   - SAML users will be linked to organizations
   - Team roles (line_manager, team_lead) work with SAML
   - Permission system doesn't care about auth method

---

## 📦 Recommended Library: `@node-saml/passport-saml`

### Why This Library?

| Criterion | @node-saml/passport-saml | samlify | saml2-js |
|-----------|-------------------------|---------|----------|
| **Maturity** | ⭐⭐⭐⭐⭐ (10+ years) | ⭐⭐⭐⭐ | ⭐⭐⭐ |
| **Maintenance** | ⭐⭐⭐⭐⭐ Active | ⭐⭐⭐⭐ Active | ⭐⭐ Slow |
| **Express.js** | ⭐⭐⭐⭐⭐ Native | ⭐⭐⭐⭐ Good | ⭐⭐⭐ Basic |
| **Standalone** | ⭐⭐⭐⭐ Yes | ⭐⭐⭐⭐⭐ Yes | ⭐⭐⭐⭐⭐ Yes |
| **Documentation** | ⭐⭐⭐⭐ Good | ⭐⭐⭐ OK | ⭐⭐ Limited |
| **Security** | ⭐⭐⭐⭐⭐ Regular CVE fixes | ⭐⭐⭐⭐ Good | ⭐⭐⭐ Adequate |

### Installation

```bash
npm install @node-saml/passport-saml
```

### Works Without Passport.js

```javascript
import { SAML } from '@node-saml/passport-saml';

// Standalone SAML instance - no Passport required
const saml = new SAML({
  callbackUrl: 'https://auth.seemplifyai.com/api/auth/saml/callback',
  entryPoint: 'https://idp.example.com/sso',
  issuer: 'seemplify',
  cert: 'IdP-certificate'
});

// Validate SAML response directly
const { profile } = await saml.validatePostResponseAsync(samlResponse);
```

---

## 📁 Files to Create/Modify

### New Files

| File | Purpose |
|------|---------|
| `src/services/samlService.js` | SAML configuration & validation |
| `src/routes/samlRoutes.js` | SAML endpoints (metadata, login, callback) |
| `src/config/samlConfig.js` | SAML IdP configurations |
| `saml-idps.json` | External IdP registry (like clients.json) |
| `certs/` | SP signing certificate & key |

### Files to Modify

| File | Change |
|------|--------|
| `src/models/Account.js` | Add SAML-specific fields |
| `src/index.js` | Mount SAML routes |
| `package.json` | Add @node-saml/passport-saml |

---

## 🔧 Implementation Details

### Phase 1: Model Updates

#### Account.js - Add SAML Fields

```javascript
// Add to existing schema (after line 86)
saml: {
  // SAML NameID (unique identifier from IdP)
  nameId: { type: String, sparse: true, index: true },
  nameIdFormat: { type: String },
  
  // IdP that authenticated this user
  identityProvider: { type: String },
  
  // Session tracking
  sessionIndex: { type: String },
  
  // Last SAML authentication
  lastSamlAuth: { type: Date },
  
  // SAML attributes passed from IdP
  attributes: { type: Map, of: String }
},

// Update authProvider enum to include SAML
authProvider: {
  type: String,
  enum: ['local', 'oauth', 'oidc', 'saml', 'oidc-saml'],
  default: 'local'
}
```

### Phase 2: SAML Service

#### src/services/samlService.js

```javascript
import { SAML } from '@node-saml/passport-saml';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * SAML Service - Manages SAML configurations for multiple IdPs
 * 
 * Supports:
 * - Multiple IdP configurations (Okta, Azure AD SAML, OneLogin, etc.)
 * - SP metadata generation
 * - SAML response validation
 * - User profile extraction
 */
class SAMLService {
  constructor() {
    this.idpConfigs = new Map();
    this.spConfig = {
      entityId: process.env.SAML_SP_ENTITY_ID || 'seemplify',
      callbackUrl: `${process.env.ISSUER_URL}/api/auth/saml/callback`,
      logoutUrl: `${process.env.ISSUER_URL}/api/auth/saml/logout`,
      
      // SP signing certificate (optional but recommended)
      privateKey: this.loadPrivateKey(),
      cert: this.loadCertificate(),
      
      // Security settings
      wantAssertionsSigned: true,
      wantAuthnResponseSigned: true,
      signatureAlgorithm: 'sha256',
      digestAlgorithm: 'sha256'
    };
  }

  /**
   * Load SP private key from file
   */
  loadPrivateKey() {
    try {
      const keyPath = path.join(__dirname, '../../certs/sp-private.pem');
      if (fs.existsSync(keyPath)) {
        return fs.readFileSync(keyPath, 'utf-8');
      }
      console.warn('⚠️ SAML SP private key not found - signing disabled');
      return null;
    } catch (error) {
      console.warn('⚠️ Could not load SAML SP private key:', error.message);
      return null;
    }
  }

  /**
   * Load SP certificate from file
   */
  loadCertificate() {
    try {
      const certPath = path.join(__dirname, '../../certs/sp-cert.pem');
      if (fs.existsSync(certPath)) {
        return fs.readFileSync(certPath, 'utf-8');
      }
      console.warn('⚠️ SAML SP certificate not found - signing disabled');
      return null;
    } catch (error) {
      console.warn('⚠️ Could not load SAML SP certificate:', error.message);
      return null;
    }
  }

  /**
   * Register an IdP configuration
   * @param {string} idpId - Unique identifier for this IdP
   * @param {Object} config - IdP configuration
   */
  registerIdP(idpId, config) {
    const samlInstance = new SAML({
      ...this.spConfig,
      callbackUrl: `${process.env.ISSUER_URL}/api/auth/saml/callback/${idpId}`,
      entryPoint: config.ssoUrl,
      issuer: this.spConfig.entityId,
      cert: config.certificate,
      identifierFormat: config.nameIdFormat || 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
      
      // Optional: audience restriction
      audience: this.spConfig.entityId,
      
      // IdP-specific settings
      disableRequestedAuthnContext: config.disableRequestedAuthnContext || false,
      forceAuthn: config.forceAuthn || false,
      
      // Logout
      logoutUrl: config.sloUrl || null
    });

    this.idpConfigs.set(idpId, {
      ...config,
      saml: samlInstance
    });

    console.log(`✅ Registered SAML IdP: ${idpId} (${config.name})`);
  }

  /**
   * Get IdP configuration
   */
  getIdP(idpId) {
    return this.idpConfigs.get(idpId);
  }

  /**
   * List all registered IdPs
   */
  listIdPs() {
    return Array.from(this.idpConfigs.entries()).map(([id, config]) => ({
      id,
      name: config.name,
      enabled: config.enabled !== false
    }));
  }

  /**
   * Generate SAML login URL for IdP
   */
  async getLoginUrl(idpId, relayState = null) {
    const idp = this.idpConfigs.get(idpId);
    if (!idp) {
      throw new Error(`Unknown SAML IdP: ${idpId}`);
    }

    // Generate AuthnRequest URL
    const url = await idp.saml.getAuthorizeUrlAsync(
      relayState || '/',
      {}, // Additional parameters
      {} // AuthnRequest options
    );

    return url;
  }

  /**
   * Validate SAML response from IdP
   */
  async validateResponse(idpId, samlResponse) {
    const idp = this.idpConfigs.get(idpId);
    if (!idp) {
      throw new Error(`Unknown SAML IdP: ${idpId}`);
    }

    // Validate the SAML response
    const result = await idp.saml.validatePostResponseAsync(samlResponse);
    
    return result;
  }

  /**
   * Extract user data from SAML profile
   * Maps SAML attributes to our user model
   */
  extractUserFromProfile(profile, idpId) {
    // Standard SAML attributes
    const user = {
      // NameID - primary identifier
      nameId: profile.nameID,
      nameIdFormat: profile.nameIDFormat,
      
      // Email - try multiple attribute names
      email: profile.email ||
             profile['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress'] ||
             profile['urn:oid:0.9.2342.19200300.100.1.3'] ||
             profile.mail ||
             profile.nameID, // Fallback if NameID is email
      
      // Name - try multiple attribute names
      name: profile.displayName ||
            profile['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name'] ||
            profile['urn:oid:2.16.840.1.113730.3.1.241'] ||
            profile.cn ||
            `${profile.firstName || ''} ${profile.lastName || ''}`.trim() ||
            null,
      
      // First/Last name
      firstName: profile.firstName ||
                 profile['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname'] ||
                 profile['urn:oid:2.5.4.42'] ||
                 null,
      lastName: profile.lastName ||
                profile['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname'] ||
                profile['urn:oid:2.5.4.4'] ||
                null,
      
      // Groups/Roles from IdP
      groups: profile.groups ||
              profile['http://schemas.xmlsoap.org/claims/Group'] ||
              profile['memberOf'] ||
              [],
      
      // Session info
      sessionIndex: profile.sessionIndex,
      
      // IdP identifier
      identityProvider: idpId,
      
      // Raw attributes for debugging/extension
      rawAttributes: profile
    };

    // Ensure email is lowercase
    if (user.email) {
      user.email = user.email.toLowerCase().trim();
    }

    return user;
  }

  /**
   * Generate SP metadata XML
   */
  async getMetadata(idpId = null) {
    // Use first registered IdP or create a generic one
    let saml;
    if (idpId && this.idpConfigs.has(idpId)) {
      saml = this.idpConfigs.get(idpId).saml;
    } else {
      // Create a temporary SAML instance for metadata
      saml = new SAML({
        ...this.spConfig,
        callbackUrl: `${process.env.ISSUER_URL}/api/auth/saml/callback`,
        issuer: this.spConfig.entityId,
        entryPoint: 'https://placeholder.example.com/sso', // Required but not used
        cert: 'placeholder'
      });
    }

    return saml.generateServiceProviderMetadata(
      null, // Decryption cert (optional)
      this.spConfig.cert // Signing cert
    );
  }
}

// Export singleton
export const samlService = new SAMLService();
export default samlService;
```

### Phase 3: SAML Routes

#### src/routes/samlRoutes.js

```javascript
import express from 'express';
import { samlService } from '../services/samlService.js';
import { Account } from '../models/Account.js';
import { SignJWT } from 'jose';

const router = express.Router();

// Import getCachedClaims - THIS IS THE KEY INTEGRATION POINT
// It reuses ALL existing organization, team, and permission logic
let getCachedClaims;
export const setClaimsFunction = (fn) => { getCachedClaims = fn; };

/**
 * SP Metadata endpoint
 * GET /api/auth/saml/metadata
 * 
 * IdPs use this to configure the SP
 */
router.get('/metadata', async (req, res) => {
  try {
    const metadata = await samlService.getMetadata();
    res.type('application/xml').send(metadata);
  } catch (error) {
    console.error('SAML metadata error:', error);
    res.status(500).json({ error: 'Failed to generate metadata' });
  }
});

/**
 * List available SAML IdPs
 * GET /api/auth/saml/idps
 */
router.get('/idps', (req, res) => {
  const idps = samlService.listIdPs();
  res.json(idps);
});

/**
 * Initiate SAML login
 * GET /api/auth/saml/login/:idpId
 * 
 * Redirects user to IdP for authentication
 */
router.get('/login/:idpId', async (req, res) => {
  try {
    const { idpId } = req.params;
    const { redirect_uri, state } = req.query;

    // Store relay state (where to redirect after auth)
    const relayState = JSON.stringify({
      redirect_uri: redirect_uri || process.env.DEFAULT_REDIRECT_URI,
      state: state || ''
    });

    const loginUrl = await samlService.getLoginUrl(idpId, relayState);
    
    console.log(`🔐 SAML login initiated for IdP: ${idpId}`);
    res.redirect(loginUrl);
  } catch (error) {
    console.error('SAML login error:', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * SAML Assertion Consumer Service (ACS)
 * POST /api/auth/saml/callback/:idpId
 * 
 * Receives SAML response from IdP
 */
router.post('/callback/:idpId', express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const { idpId } = req.params;
    const { SAMLResponse, RelayState } = req.body;

    if (!SAMLResponse) {
      return res.status(400).json({ error: 'Missing SAMLResponse' });
    }

    console.log(`📨 SAML callback received from IdP: ${idpId}`);

    // Validate SAML response
    const { profile } = await samlService.validateResponse(idpId, { SAMLResponse });
    
    console.log(`✅ SAML response validated for: ${profile.nameID}`);

    // Extract user data from SAML profile
    const samlUser = samlService.extractUserFromProfile(profile, idpId);

    if (!samlUser.email) {
      return res.status(400).json({ 
        error: 'Email not provided in SAML assertion',
        hint: 'Configure IdP to include email attribute'
      });
    }

    // Find or create account
    let account = await Account.findOne({ email: samlUser.email });
    
    if (!account) {
      // Create new account from SAML
      console.log(`📝 Creating new account from SAML: ${samlUser.email}`);
      
      account = new Account({
        sub: `saml:${samlUser.nameId}`,
        email: samlUser.email,
        emailVerified: true, // SAML IdP verified the email
        profile: {
          name: samlUser.name || samlUser.email.split('@')[0],
          preferred_username: samlUser.email
        },
        authProvider: 'saml',
        saml: {
          nameId: samlUser.nameId,
          nameIdFormat: samlUser.nameIdFormat,
          identityProvider: idpId,
          sessionIndex: samlUser.sessionIndex,
          lastSamlAuth: new Date(),
          attributes: samlUser.rawAttributes
        }
      });
      await account.save();
    } else {
      // Update existing account with SAML info
      console.log(`🔄 Updating existing account with SAML: ${samlUser.email}`);
      
      account.saml = {
        nameId: samlUser.nameId,
        nameIdFormat: samlUser.nameIdFormat,
        identityProvider: idpId,
        sessionIndex: samlUser.sessionIndex,
        lastSamlAuth: new Date(),
        attributes: samlUser.rawAttributes
      };
      
      // Update auth provider if not already SAML
      if (account.authProvider !== 'saml' && account.authProvider !== 'oidc-saml') {
        account.authProvider = account.authProvider === 'oidc' ? 'oidc-saml' : 'saml';
      }
      
      await account.save();
    }

    // Populate account for claims building
    const populatedAccount = await Account.findById(account._id)
      .populate('organizations.organization', 'name')
      .populate('currentOrganization', 'name')
      .lean();

    // ⭐ CRITICAL: Use EXISTING claims builder
    // This gives us full organization, team, and permission support!
    const claims = await getCachedClaims(populatedAccount);

    // Generate JWT token
    const secret = new TextEncoder().encode(process.env.JWT_SECRET || process.env.OIDC_COOKIE_SECRET);
    const token = await new SignJWT({
      ...claims,
      auth_method: 'saml',
      idp: idpId
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('24h')
      .setIssuer(process.env.ISSUER_URL)
      .setSubject(account.sub)
      .sign(secret);

    // Parse relay state for redirect
    let redirectUri = process.env.DEFAULT_REDIRECT_URI || 'https://app.seemplifyai.com';
    let state = '';
    
    try {
      if (RelayState) {
        const parsed = JSON.parse(RelayState);
        redirectUri = parsed.redirect_uri || redirectUri;
        state = parsed.state || '';
      }
    } catch (e) {
      // RelayState might be a plain URL
      if (RelayState && RelayState.startsWith('http')) {
        redirectUri = RelayState;
      }
    }

    // Redirect with token
    const separator = redirectUri.includes('?') ? '&' : '?';
    const finalUrl = `${redirectUri}${separator}token=${token}${state ? `&state=${state}` : ''}`;

    console.log(`✅ SAML auth complete for: ${account.email}, redirecting...`);
    res.redirect(finalUrl);

  } catch (error) {
    console.error('SAML callback error:', error);
    res.status(400).json({
      error: 'SAML authentication failed',
      details: error.message
    });
  }
});

/**
 * SAML Single Logout (SLO)
 * GET/POST /api/auth/saml/logout
 */
router.all('/logout', async (req, res) => {
  try {
    // Get user from session or token
    const accountId = req.session?.accountId || req.user?.sub;
    
    if (accountId) {
      const account = await Account.findOne({ sub: accountId });
      if (account?.saml?.sessionIndex) {
        // TODO: Initiate SLO with IdP if configured
        console.log(`🚪 SAML logout for: ${account.email}`);
      }
    }

    // Clear session
    req.session?.destroy();
    
    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    console.error('SAML logout error:', error);
    res.status(500).json({ error: 'Logout failed' });
  }
});

export default router;
```

### Phase 4: IdP Configuration File

#### saml-idps.json

```json
{
  "idps": [
    {
      "id": "okta",
      "name": "Okta",
      "enabled": true,
      "ssoUrl": "https://your-org.okta.com/app/your-app-id/sso/saml",
      "certificate": "-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----",
      "nameIdFormat": "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
      "attributeMapping": {
        "email": "email",
        "name": "displayName",
        "groups": "groups"
      }
    },
    {
      "id": "azure-saml",
      "name": "Microsoft Azure AD (SAML)",
      "enabled": true,
      "ssoUrl": "https://login.microsoftonline.com/{tenant-id}/saml2",
      "certificate": "-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----",
      "nameIdFormat": "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
      "attributeMapping": {
        "email": "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress",
        "name": "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name",
        "groups": "http://schemas.microsoft.com/ws/2008/06/identity/claims/groups"
      }
    },
    {
      "id": "onelogin",
      "name": "OneLogin",
      "enabled": false,
      "ssoUrl": "https://your-org.onelogin.com/trust/saml2/http-post/sso/xxx",
      "certificate": "-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----",
      "nameIdFormat": "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress"
    }
  ]
}
```

### Phase 5: Integration in index.js

#### Add to src/index.js

```javascript
// Add near the top with other imports
import samlRoutes, { setClaimsFunction } from './routes/samlRoutes.js'
import { samlService } from './services/samlService.js'
import { readFileSync } from 'fs'

// After getCachedClaims is defined, share it with SAML routes
setClaimsFunction(getCachedClaims)

// Load SAML IdP configurations
const loadSamlIdPs = () => {
  try {
    const idpsConfigPath = process.env.SAML_IDPS_CONFIG || join(__dirname, '../saml-idps.json')
    const idpsData = JSON.parse(readFileSync(idpsConfigPath, 'utf-8'))
    
    for (const idp of idpsData.idps) {
      if (idp.enabled !== false) {
        samlService.registerIdP(idp.id, idp)
      }
    }
    
    console.log(`✅ Loaded ${samlService.listIdPs().length} SAML IdPs`)
  } catch (error) {
    console.warn('⚠️ No SAML IdPs configured:', error.message)
  }
}

loadSamlIdPs()

// Mount SAML routes (add before provider.callback())
app.use('/api/auth/saml', samlRoutes)
```

---

## 🔌 API Endpoints Summary

### New SAML Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/auth/saml/metadata` | GET | SP metadata XML for IdP configuration |
| `/api/auth/saml/idps` | GET | List available SAML IdPs |
| `/api/auth/saml/login/:idpId` | GET | Initiate SAML login (redirects to IdP) |
| `/api/auth/saml/callback/:idpId` | POST | Receive SAML assertion from IdP |
| `/api/auth/saml/logout` | GET/POST | Single Logout |

### Existing Endpoints (Unchanged)

| Endpoint | Status |
|----------|--------|
| `/.well-known/openid-configuration` | ✅ Unchanged |
| `/oauth/authorize` | ✅ Unchanged |
| `/oauth/token` | ✅ Unchanged |
| `/oauth/userinfo` | ✅ Unchanged |
| `/api/organizations/*` | ✅ Unchanged |
| `/api/teams/*` | ✅ Unchanged |

---

## 🔐 Security Considerations

### SAML-Specific Security

1. **Certificate Validation**
   - Verify IdP certificate on every response
   - Pin certificates in production
   - Monitor for certificate rotation

2. **Assertion Security**
   ```javascript
   wantAssertionsSigned: true,      // Require signed assertions
   wantAuthnResponseSigned: true,   // Require signed responses
   signatureAlgorithm: 'sha256',    // Modern algorithm
   digestAlgorithm: 'sha256'
   ```

3. **Replay Protection**
   - Check assertion `NotOnOrAfter`
   - Validate `InResponseTo` matches request ID
   - Store used assertion IDs (optional)

4. **Clock Skew**
   ```javascript
   acceptedClockSkewMs: 180000  // 3 minutes tolerance
   ```

### SP Certificate Generation

```bash
# Generate SP signing key and certificate
mkdir -p certs
openssl req -x509 -newkey rsa:2048 \
  -keyout certs/sp-private.pem \
  -out certs/sp-cert.pem \
  -days 365 \
  -nodes \
  -subj "/CN=seemplify/O=Seemplify/C=US"
```

---

## 📊 Claims Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                          USER AUTHENTICATION                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────┐      ┌──────────────┐      ┌──────────────┐       │
│  │   Browser    │─────▶│  SAML IdP    │─────▶│   IdP Auth   │       │
│  │   Login      │      │  (Okta/AD)   │      │   Success    │       │
│  └──────────────┘      └──────────────┘      └──────────────┘       │
│                                                      │               │
│                                                      ▼               │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                    SAML CALLBACK                              │   │
│  │  POST /api/auth/saml/callback/:idpId                         │   │
│  │                                                               │   │
│  │  1. Validate SAML Response (signature, timestamps)           │   │
│  │  2. Extract user profile from assertion                      │   │
│  │  3. Find or create Account in MongoDB                        │   │
│  │  4. ──────────────────────────────────────────────────────── │   │
│  │     │                                                         │   │
│  │     ▼                                                         │   │
│  │  ╔══════════════════════════════════════════════════════════╗│   │
│  │  ║           getCachedClaims(account)                       ║│   │
│  │  ║                                                          ║│   │
│  │  ║  REUSED FROM OIDC - Same function, same logic!          ║│   │
│  │  ║                                                          ║│   │
│  │  ║  ┌─────────────────────────────────────────────────────┐║│   │
│  │  ║  │  buildOrganizationClaims(account)                   │║│   │
│  │  ║  │  - Organization memberships                         │║│   │
│  │  ║  │  - Organization roles (owner, admin, staff...)      │║│   │
│  │  ║  │  - Base permissions                                 │║│   │
│  │  ║  │  - App-specific permissions (smarthr, leave-mgmt)   │║│   │
│  │  ║  └─────────────────────────────────────────────────────┘║│   │
│  │  ║                                                          ║│   │
│  │  ║  ┌─────────────────────────────────────────────────────┐║│   │
│  │  ║  │  getTeamClaims(account)                             │║│   │
│  │  ║  │  - Team memberships                                 │║│   │
│  │  ║  │  - Team hierarchy path                              │║│   │
│  │  ║  │  - Team roles (member, line_manager, team_lead)     │║│   │
│  │  ║  │  - Direct reports                                   │║│   │
│  │  ║  │  - Manager info                                     │║│   │
│  │  ║  └─────────────────────────────────────────────────────┘║│   │
│  │  ║                                                          ║│   │
│  │  ║  ┌─────────────────────────────────────────────────────┐║│   │
│  │  ║  │  team_permissions                                   │║│   │
│  │  ║  │  - approve_leaves                                   │║│   │
│  │  ║  │  - view_team_leaves                                 │║│   │
│  │  ║  │  - view_direct_reports_leaves                       │║│   │
│  │  ║  └─────────────────────────────────────────────────────┘║│   │
│  │  ╚══════════════════════════════════════════════════════════╝│   │
│  │                                                               │   │
│  │  5. Sign claims as JWT                                        │   │
│  │  6. Redirect to app with token                                │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                      │               │
│                                                      ▼               │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                     APPLICATION                               │   │
│  │  SmartHR / Leave Management / Performance / Payroll          │   │
│  │                                                               │   │
│  │  Token contains IDENTICAL claims structure:                   │   │
│  │  - sub, email, name                                          │   │
│  │  - organizations[]                                           │   │
│  │  - teams[]                                                   │   │
│  │  - team_permissions[]                                        │   │
│  │  - current_organization                                      │   │
│  │                                                               │   │
│  │  ✅ Apps don't need to change!                               │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 📅 Implementation Timeline

### Phase 1: Foundation (Day 1)
- [ ] Install `@node-saml/passport-saml`
- [ ] Update Account schema with SAML fields
- [ ] Generate SP certificates
- [ ] Create `samlService.js`

### Phase 2: Routes (Day 2)
- [ ] Create `samlRoutes.js`
- [ ] Mount routes in `index.js`
- [ ] Integrate with `getCachedClaims`
- [ ] Test metadata endpoint

### Phase 3: IdP Configuration (Day 3)
- [ ] Create `saml-idps.json`
- [ ] Configure first IdP (Okta or Azure AD SAML)
- [ ] Test end-to-end login flow
- [ ] Verify claims contain org/team data

### Phase 4: Testing & Polish (Day 4-5)
- [ ] Test with multiple IdPs
- [ ] Test new user creation via SAML
- [ ] Test existing user linking
- [ ] Add error handling
- [ ] Add logging
- [ ] Documentation

---

## ✅ Checklist Before Go-Live

### Security
- [ ] SP certificate generated and secured
- [ ] IdP certificates validated
- [ ] Assertion signatures enforced
- [ ] Clock skew configured
- [ ] HTTPS enforced

### Functionality
- [ ] New users created correctly
- [ ] Existing users linked correctly
- [ ] Organization claims populated
- [ ] Team claims populated
- [ ] Permissions working

### Operations
- [ ] Logging configured
- [ ] Error handling complete
- [ ] IdP configuration documented
- [ ] Runbook for certificate rotation

---

## 🔗 Related Documentation

- [OIDC Configuration](./SSO_CONFIGURATION_GUIDE.md)
- [Azure Nylas Setup](../access/AZURE-NYLAS-SETUP.md)
- [Google OAuth Setup](../access/GOOGLE-NYLAS-SETUP.md)
- [@node-saml/passport-saml](https://github.com/node-saml/passport-saml)

---

## 📝 Notes

1. **Why not passport-saml with Passport.js?**
   - We already have a working auth system
   - Passport.js adds unnecessary middleware
   - `@node-saml/passport-saml` exports `SAML` class for standalone use

2. **Why not samlify?**
   - More complex than needed
   - Designed for building IdPs (we're only building SP)
   - Less community adoption

3. **Organization/Team Integration**
   - SAML users start with no organizations (like email signup)
   - They get invited to organizations via existing flow
   - Team assignments work identically to OIDC users
   - No special handling needed!
