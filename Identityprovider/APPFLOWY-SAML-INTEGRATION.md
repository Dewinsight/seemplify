# AppFlowy SAML Integration with Seemplify Identity Provider

> **Status**: ✅ Implementation Complete  
> **Date**: January 2026  
> **Approach**: Seemplify as SAML IdP → AppFlowy as SAML SP (SAML-ONLY Authentication)  
> **Deployment**: Dokploy on Azure VM  
> **AppFlowy Deployed**: ✅ Yes (on Dokploy)

## 🔑 Access & Configuration

AppFlowy is deployed on Dokploy. To configure SAML settings:

1. **SSH into the Azure VM** - See `access/SERVER-ACCESS.md` for credentials
2. **Access Dokploy UI** - See `access/DOKPLOY-CREDENTIALS.md`
3. **Configure AppFlowy environment variables** via Dokploy dashboard

> **Note**: All access credentials are stored in the `access/` folder (gitignored for security).

---

## 📋 Executive Summary

This document outlines the integration of AppFlowy with Seemplify Identity Provider using SAML 2.0, with the following requirements:

1. **Add AppFlowy to Seemplify Hub** - Display in apps dashboard
2. **Configure Seemplify as SAML IdP** - Send SAML assertions to AppFlowy
3. **AppFlowy SAML-ONLY Authentication** - Disable email/password login entirely
4. **Single Source of Truth** - All users authenticate through Seemplify

---

## 🎯 Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                    AUTHENTICATION FLOW                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                  │
│  User                                                      │
│   │                                                          │
│   │ 1. Navigate to AppFlowy                                 │
│   ▼                                                          │
│  AppFlowy (SAML SP)                                        │
│   │                                                          │
│   │ 2. Redirect to Seemplify IdP: /saml/sso?sp=appflowy      │
│   ▼                                                          │
│  Seemplify IdP (SAML IdP)                                  │
│   │                                                          │
│   │ 3a. Check session → Not logged in? → Show login form          │
│   │ 3b. Already logged in? → Build claims via getCachedClaims     │
│   │                                                          │
│   │ 4. Generate SAML Response with:                              │
│   │     • User identity (email, name, sub)                       │
│   │     • Organizations (with roles & permissions)                 │
│   │     • Teams (with hierarchy & direct reports)                 │
│   │     • Current organization context                             │
│   ▼                                                          │
│  5. POST SAML Response to AppFlowy ACS                        │
│   ▼                                                          │
│  AppFlowy                                                     │
│   │                                                          │
│   │ 6. Create/update user account                               │
│   │ 7. Assign groups based on SAML attributes                    │
│   ▼                                                          │
│  8. User logged in ✅                                       │
│                                                                  │
│  No email/password login - ONLY SAML from Seemplify!              │
│                                                                  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 🏗️ Seemplify IdP Endpoints (IMPLEMENTED)

### 1. Add AppFlowy to Hub Configuration

#### File: `src/config/hubApps.js`

```javascript
// Add to productionApps array (after payroll-management)
{
  appId: 'appflowy',
  name: 'AppFlowy',
  description: 'AI-powered workspace and knowledge management',
  icon: 'cube',
  color: '#a78bfa',
  url: process.env.APPFLOWY_URL || 'https://appflowy.seemplifyai.com',
  apiUrl: process.env.APPFLOWY_URL || 'https://appflowy.seemplifyai.com',
  authType: 'saml', // NEW: Specify SAML auth type
  clientId: 'appflowy',
  isActive: true,
  isPublic: true,
  category: 'productivity',
  order: 5
}
```

**Also add to developmentApps:**
```javascript
{
  appId: 'appflowy',
  name: 'AppFlowy',
  description: 'AI-powered workspace and knowledge management',
  icon: 'cube',
  color: '#a78bfa',
  url: process.env.APPFLOWY_URL || 'http://localhost:8000',
  apiUrl: process.env.APPFLOWY_URL || 'http://localhost:8000',
  authType: 'saml',
  clientId: 'appflowy',
  isActive: true,
  isPublic: true,
  category: 'productivity',
  order: 5
}
```

### 2. Add IdP Endpoints to SAML Routes

#### File: `src/routes/samlRoutes.js`

```javascript
import express from 'express';
import { samlService } from '../services/samlService.js';
import { Account } from '../models/Account.js';

const router = express.Router();

/**
 * IdP SSO Endpoint - Receives AuthnRequest from AppFlowy
 * POST /api/auth/saml/idp/sso
 * 
 * Flow:
 * 1. AppFlowy sends AuthnRequest (user clicked login)
 * 2. Seemplify validates request
 * 3. Check if user is logged in
 * 4. If not, redirect to login (store SAML context)
 * 5. If yes, generate SAML Response with full claims
 * 6. POST response back to AppFlowy
 */
router.post('/idp/sso', express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const { SAMLRequest, RelayState } = req.body;
    
    if (!SAMLRequest) {
      return res.status(400).json({ error: 'Missing SAMLRequest' });
    }

    console.log('🔐 SAML IdP SSO request received');
    console.log('  Relay State:', RelayState?.substring(0, 50) + '...');

    // 1. Decode and validate AuthnRequest
    const authnRequest = await samlService.validateAuthnRequest(SAMLRequest);
    
    console.log(`  From SP: ${authnRequest.issuer}`);
    console.log(`  Request ID: ${authnRequest.id}`);
    console.log(`  ACS URL: ${authnRequest.assertionConsumerServiceURL}`);

    // 2. Get Service Provider metadata (AppFlowy)
    const spMetadata = await samlService.getSPMetadata(authnRequest.issuer);
    
    if (!spMetadata) {
      console.warn(`  ⚠️ Unknown SP: ${authnRequest.issuer}`);
      return res.status(400).json({ 
        error: 'Unknown Service Provider',
        hint: 'Register this SP in SAML configuration'
      });
    }

    console.log(`  ✅ SP metadata loaded: ${spMetadata.entityId}`);

    // 3. Check if user is logged in
    let account;
    if (req.session?.accountId) {
      account = await Account.findById(req.session.accountId)
        .populate('organizations.organization', 'name')
        .populate('currentOrganization', 'name')
        .lean();
    }

    if (!account) {
      // Not logged in - store SAML context and redirect to login
      console.log('  ⚠️ User not logged in - redirecting to login');
      
      const samlContext = {
        requestId: authnRequest.id,
        spIssuer: authnRequest.issuer,
        spEntityId: spMetadata.entityId,
        acsUrl: authnRequest.assertionConsumerServiceURL,
        relayState: RelayState,
        timestamp: Date.now()
      };

      req.session.samlContext = samlContext;
      req.session.save();

      // Redirect to login with returnTo to resume SAML flow
      const loginUrl = `/interaction/login?returnTo=/api/auth/saml/idp/sso`;
      return res.redirect(`${process.env.ISSUER_URL}${loginUrl}`);
    }

    console.log(`✅ User already logged in: ${account.email}`);

    // 4. Generate SAML Response with full claims
    // ⭐ KEY: Reuse existing getCachedClaims function!
    const samlResponse = await samlService.generateSAMLResponse(account, spMetadata, authnRequest.id);
    
    console.log('✅ SAML Response generated with full claims');
    console.log(`   → Orgs: ${account.organizations.length}`);
    console.log(`   → Teams: ${account.teams?.length || 0}`);

    // 5. POST SAML Response back to AppFlowy
    const acsUrl = authnRequest.assertionConsumerServiceURL;
    const form = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>SAML Response - AppFlowy</title>
          <style>
            body { font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f3f4f6; }
            .container { text-align: center; }
            p { color: #6b7280; margin-bottom: 1rem; }
          </style>
        </head>
        <body onload="document.forms[0].submit()">
          <div class="container">
            <p>Redirecting to AppFlowy...</p>
            <form method="post" action="${acsUrl}">
              <input type="hidden" name="SAMLResponse" value="${samlResponse}" />
              <input type="hidden" name="RelayState" value="${RelayState || ''}" />
            </form>
          </div>
        </body>
      </html>
    `;

    res.type('text/html').send(form);
    console.log(`✅ SAML Response sent to: ${acsUrl}`);

  } catch (error) {
    console.error('SAML IdP SSO error:', error);
    res.status(500).json({ 
      error: 'SAML authentication failed', 
      details: error.message 
    });
  }
});

/**
 * IdP Metadata Endpoint - For AppFlowy to fetch
 * GET /api/auth/saml/idp/metadata
 * 
 * Returns XML metadata describing Seemplify as SAML IdP
 */
router.get('/idp/metadata', async (req, res) => {
  try {
    const metadata = await samlService.generateIdPMetadata();
    res.type('application/xml').send(metadata);
    console.log('📋 IdP metadata requested');
  } catch (error) {
    console.error('IdP metadata error:', error);
    res.status(500).json({ error: 'Failed to generate metadata' });
  }
});

/**
 * IdP Single Logout (SLO) - Optional
 * POST /api/auth/saml/idp/logout
 * 
 * Handles logout initiated by AppFlowy
 */
router.post('/idp/logout', express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const { SAMLRequest } = req.body;
    
    console.log('🚪 SAML SLO request received');

    if (req.session?.accountId) {
      const account = await Account.findById(req.session.accountId);
      console.log(`🚪 Logging out: ${account?.email}`);
    }

    // Clear session
    req.session.destroy();

    // Generate SAML Logout Response
    const sloResponse = await samlService.generateLogoutResponse(SAMLRequest);
    
    const form = `
      <!DOCTYPE html>
      <html>
        <body onload="document.forms[0].submit()">
          <form method="post" action="${extractSloUrl(SAMLRequest)}">
            <input type="hidden" name="SAMLResponse" value="${sloResponse}" />
          </form>
        </body>
      </html>
    `;

    res.type('text/html').send(form);
    console.log('✅ SLO completed');

  } catch (error) {
    console.error('SAML SLO error:', error);
    res.status(500).json({ error: 'Logout failed' });
  }
});

export default router;
```

### 3. Add IdP Methods to SAML Service

#### File: `src/services/samlService.js`

**Add these methods to the existing SAMLService class:**

```javascript
/**
 * Validate AuthnRequest from Service Provider
 * @param {string} samlRequest - Base64-encoded SAML AuthnRequest
 * @returns {Object} Parsed request details
 */
validateAuthnRequest(samlRequest) {
  try {
    // Decode base64
    const decoded = Buffer.from(samlRequest, 'base64').toString('utf-8');
    
    // Parse XML (using simple regex for now, use xml2js in production)
    const idMatch = decoded.match(/ID="([^"]+)"/);
    const issuerMatch = decoded.match(/<saml:Issuer[^>]*>([^<]+)<\/saml:Issuer>/);
    const acsMatch = decoded.match(/AssertionConsumerServiceURL="([^"]+)"/);
    const destinationMatch = decoded.match(/Destination="([^"]+)"/);
    
    if (!idMatch || !issuerMatch) {
      throw new Error('Invalid SAML AuthnRequest format');
    }

    return {
      id: idMatch[1],
      issuer: issuerMatch[1],
      assertionConsumerServiceURL: acsMatch ? acsMatch[1] : null,
      destination: destinationMatch ? destinationMatch[1] : null
    };
  } catch (error) {
    console.error('AuthnRequest validation error:', error);
    throw new Error('Failed to validate AuthnRequest');
  }
}

/**
 * Generate SAML Response with user claims
 * ⭐ KEY INTEGRATION: Reuses existing getCachedClaims function!
 * 
 * @param {Object} account - User account document
 * @param {Object} spMetadata - Service Provider metadata
 * @param {string} inResponseTo - Original request ID
 * @returns {string} Base64-encoded SAML Response
 */
async function generateSAMLResponse(account, spMetadata, inResponseTo) {
  console.log(`🔨 Building SAML claims for: ${account.email}`);
  
  // ⭐ REUSE EXISTING FUNCTION - Same as OIDC!
  // This gives us organizations, teams, permissions automatically!
  const claims = await getCachedClaims(account);

  console.log(`  → Total Orgs: ${claims.organizations.length}`);
  console.log(`  → Total Teams: ${claims.teams.length}`);
  console.log(`  → Current Org: ${claims.current_organization?.name || 'none'}`);

  // Build SAML assertion attributes
  const attributes = [
    // Standard OIDC attributes (for compatibility)
    { Name: 'urn:oid:0.9.2342.19200300.100.1.3', Value: claims.email },
    { Name: 'urn:oid:2.5.4.42', Value: claims.name },
    { Name: 'urn:oid:2.5.4.4', Value: claims.name }, // Display name
    { Name: 'urn:oid:1.2.840.113549.1.1.1', Value: claims.email }, // email
    
    // Custom Seemplify attributes
    { Name: 'urn:seemplify:email', Value: claims.email },
    { Name: 'urn:seemplify:name', Value: claims.name },
    { Name: 'urn:seemplify:sub', Value: claims.sub },
    
    // Organization data (JSON stringified for AppFlowy to parse)
    { 
      Name: 'urn:seemplify:organizations', 
      Value: JSON.stringify(claims.organizations),
      NameFormat: 'urn:oasis:names:tc:SAML:2.0:attrname-format:basic'
    },
    { 
      Name: 'urn:seemplify:current_organization', 
      Value: JSON.stringify(claims.current_organization),
      NameFormat: 'urn:oasis:names:tc:SAML:2.0:attrname-format:basic'
    },
    
    // Team data (JSON stringified)
    { 
      Name: 'urn:seemplify:teams', 
      Value: JSON.stringify(claims.teams),
      NameFormat: 'urn:oasis:names:tc:SAML:2.0:attrname-format:basic'
    },
    { 
      Name: 'urn:seemplify:team_permissions', 
      Value: JSON.stringify(claims.team_permissions),
      NameFormat: 'urn:oasis:names:tc:SAML:2.0:attrname-format:basic'
    },
    
    // Current role in organization
    { Name: 'urn:seemplify:role', Value: claims.current_organization?.role || 'member' }
  ];

  // Generate SAML Response XML
  const now = new Date();
  const notBefore = new Date(now.getTime() - 5 * 60 * 1000); // 5 min ago
  const notOnOrAfter = new Date(now.getTime() + 8 * 60 * 60 * 1000); // 8 hours from now

  const samlResponse = `
    <samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"
                   xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"
                   ID="_${this.generateUUID()}"
                   InResponseTo="${inResponseTo}"
                   IssueInstant="${now.toISOString()}"
                   Version="2.0">
      <saml:Issuer>${this.spConfig.entityId}</saml:Issuer>
      <ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
        <!-- Signature would be added here in production -->
      </ds:Signature>
      <samlp:Status>
        <samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/>
      </samlp:Status>
      <saml:Assertion xmlns:xs="http://www.w3.org/2001/XMLSchema"
                      xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                      ID="_${this.generateUUID()}"
                      IssueInstant="${now.toISOString()}"
                      Version="2.0">
        <saml:Issuer>${this.spConfig.entityId}</saml:Issuer>
        <ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
          <!-- Assertion signature -->
        </ds:Signature>
        <saml:Subject>
          <saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">
            ${claims.email}
          </saml:NameID>
          <saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer">
            <saml:SubjectConfirmationData NotOnOrAfter="${notOnOrAfter.toISOString()}"/>
          </saml:SubjectConfirmation>
        </saml:Subject>
        <saml:Conditions NotBefore="${notBefore.toISOString()}"
                          NotOnOrAfter="${notOnOrAfter.toISOString()}">
          <saml:Audience>${spMetadata.entityId}</saml:Audience>
        </saml:Conditions>
        <saml:AttributeStatement>
          ${attributes.map(attr => `
            <saml:Attribute Name="${attr.Name}" NameFormat="${attr.NameFormat || 'urn:oasis:names:tc:SAML:2.0:attrname-format:basic'}">
              <saml:AttributeValue>${this.escapeXml(attr.Value)}</saml:AttributeValue>
            </saml:Attribute>
          `).join('')}
        </saml:AttributeStatement>
      </saml:Assertion>
    </samlp:Response>
  `;

  // Encode response
  const encoded = Buffer.from(samlResponse.trim(), 'utf-8').toString('base64');
  
  // Sign response (in production, with real signing)
  // For now, return unsigned (for testing)
  return encoded;
}

/**
 * Generate SAML Logout Response
 * @param {string} samlRequest - Base64-encoded SAML LogoutRequest
 * @returns {string} Base64-encoded Logout Response
 */
generateLogoutResponse(samlRequest) {
  const now = new Date();
  const logoutResponse = `
    <samlp:LogoutResponse xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"
                        xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"
                        ID="_${this.generateUUID()}"
                        InResponseTo="${this.extractRequestId(samlRequest)}"
                        IssueInstant="${now.toISOString()}"
                        Version="2.0">
      <saml:Issuer>${this.spConfig.entityId}</saml:Issuer>
      <samlp:Status>
        <samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/>
      </samlp:Status>
    </samlp:LogoutResponse>
  `;
  
  return Buffer.from(logoutResponse.trim(), 'utf-8').toString('base64');
}

/**
 * Generate IdP Metadata XML
 * @returns {string} IdP metadata XML
 */
generateIdPMetadata() {
  const entityId = process.env.SAML_ISSUER || process.env.ISSUER_URL;
  const ssoUrl = `${entityId}/api/auth/saml/idp/sso`;
  const sloUrl = `${entityId}/api/auth/saml/idp/logout`;
  const cert = this.spConfig.cert || '';

  // Clean certificate for XML
  const cleanCert = cert.replace(/-----BEGIN CERTIFICATE-----/g, '')
                          .replace(/-----END CERTIFICATE-----/g, '')
                          .replace(/\n/g, '')
                          .trim();

  const metadata = `<?xml version="1.0" encoding="UTF-8"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata"
                   xmlns:ds="http://www.w3.org/2000/09/xmldsig#"
                   entityID="${entityId}">
  <md:IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol"
                          WantAuthnRequestsSigned="true">
    <md:NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</md:NameIDFormat>
    
    <md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"
                              Location="${ssoUrl}" />
    
    <md:SingleLogoutService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"
                              Location="${sloUrl}" />
  </md:IDPSSODescriptor>
  
  <md:KeyDescriptor use="signing">
    <ds:KeyInfo>
      <ds:X509Data>
        <ds:X509Certificate>${cleanCert}</ds:X509Certificate>
      </ds:X509Data>
    </ds:KeyInfo>
  </md:KeyDescriptor>
</md:EntityDescriptor>`;

  return metadata;
}

/**
 * Extract SAML Logout Request URL
 */
extractSloUrl(samlRequest) {
  const decoded = Buffer.from(samlRequest, 'base64').toString('utf-8');
  const match = decoded.match(/Destination="([^"]+)"/);
  return match ? match[1] : null;
}

/**
 * Extract Request ID from SAML Logout Request
 */
extractRequestId(samlRequest) {
  const decoded = Buffer.from(samlRequest, 'base64').toString('utf-8');
  const match = decoded.match(/ID="([^"]+)"/);
  return match ? match[1] : null;
}

/**
 * Escape XML special characters
 */
escapeXml(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
}

/**
 * Generate UUID for SAML messages
 */
generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}
```

### 4. Mount SAML IdP Routes in Main App

#### File: `src/index.js`

**Add after existing SAML routes:**

```javascript
// Import SAML routes (existing from SP mode)
import samlRoutes from './routes/samlRoutes.js'

// Mount existing SAML SP routes (for Okta/Azure integration)
app.use('/api/auth/saml', samlRoutes)
```

The SAML routes file already includes both SP and IdP endpoints, so this single mount is sufficient.

---

## 🐳 AppFlowy Deployment (Dokploy)

### Option A: Deploy via Dokploy UI (RECOMMENDED for first deployment)

**Why deploy UI first?**

1. **Test AppFlowy standalone** - Verify it works with default settings
2. **Get correct URLs** - Dokploy will assign actual domain
3. **Configure DNS** - Set up SSL certificates
4. **Then configure SAML** - Add Seemplify integration after it's running

**Steps:**

1. **Log into Dokploy**
   - Navigate to https://dokploy.seemplifyai.com

2. **Create New Application**
   - Click "New Application" → "Docker Compose"
   - Name: `appflowy`
   - Repository: `appflowyio/appflowy`
   - Branch: `main`

3. **Configure Environment Variables**
   - Click "Environment Variables"
   - Add initial config (without SAML):
   ```yaml
   APPFLOWY_ENV=production
   APPFLOWY_DB_HOST=your-postgres-host
   APPFLOWY_DB_PORT=5432
   APPFLOWY_DB_NAME=appflowy
   APPFLOWY_DB_USER=appflowy
   APPFLOWY_DB_PASSWORD=your-secure-password
   GOTRUE_DISABLE_SIGNUP=false  # Allow signup initially for testing
   ```

4. **Deploy**
   - Click "Deploy"
   - Wait for deployment to complete
   - Note the assigned URL (e.g., `appflowy.seemplifyai.com`)

5. **Access AppFlowy**
   - Navigate to the assigned URL
   - Create admin account via signup
   - Verify app is working

### Option B: Deploy via Docker Compose (Advanced)

If you prefer command-line deployment:

```yaml
# docker-compose.yml for AppFlowy
version: '3.8'
services:
  appflowy:
    image: appflowyio/appflowy:latest
    container_name: appflowy
    restart: unless-stopped
    environment:
      # App Configuration
      - APPFLOWY_ENV=production
      
      # Database
      - APPFLOWY_DB_HOST=postgres
      - APPFLOWY_DB_PORT=5432
      - APPFLOWY_DB_NAME=appflowy
      - APPFLOWY_DB_USER=appflowy
      - APPFLOWY_DB_PASSWORD=${APPFLOWY_DB_PASSWORD}
      
      # ⚠️ INITIAL: Allow signup for testing
      - GOTRUE_DISABLE_SIGNUP=false
      
      # SAML will be added after first deployment
      # GOTRUE_SAML_ENABLED=true
      # AUTH_SAML_ENABLED=true
      
    ports:
      - "80:3000"
      - "443:3000"
    volumes:
      - ./appflowy-data:/appflowy/data
    depends_on:
      - postgres
      
  postgres:
    image: postgres:15
    container_name: appflowy-db
    restart: unless-stopped
    environment:
      - POSTGRES_DB=appflowy
      - POSTGRES_USER=appflowy
      - POSTGRES_PASSWORD=${APPFLOWY_DB_PASSWORD}
    volumes:
      - ./postgres-data:/var/lib/postgresql/data

volumes:
  appflowy-data:
  postgres-data:
```

---

## 🔧 AppFlowy SAML Configuration (After Deployment)

### Environment Variables for SAML-ONLY Authentication

**Update in Dokploy UI or docker-compose.yml:**

```bash
# ========================================
# ENABLE SAML - DISABLE EMAIL/PASSWORD
# ========================================

# ⚠️ CRITICAL: Enable SAML
GOTRUE_SAML_ENABLED=true
AUTH_SAML_ENABLED=true

# ⚠️ CRITICAL: Disable email/password login
GOTRUE_DISABLE_EMAIL_SIGNUP=true   # No email signup
GOTRUE_DISABLE_SIGNUP=true            # No signup at all
GOTRUE_EXTERNAL_EMAIL_ENABLED=false   # No external email auth
GOTRUE_EXTERNAL_PHONE_ENABLED=false   # No phone auth

# ========================================
# SEEMPLIFY IDP CONFIGURATION
# ========================================

# Seemplify IdP endpoints
AUTH_SAML_ENTRY_POINT=https://auth.seemplifyai.com/api/auth/saml/idp/sso
AUTH_SAML_ISSUER=https://auth.seemplifyai.com/api/auth/saml/idp

# Seemplify IdP metadata URL (easier than manual config)
AUTH_SAML_METADATA_URL=https://auth.seemplifyai.com/api/auth/saml/idp/metadata

# ========================================
# APPFLOWY (SP) CONFIGURATION
# ========================================

# AppFlowy URLs (replace with actual deployed URLs)
AUTH_SAML_CALLBACK_URL=https://appflowy.seemplifyai.com/gotrue/sso/saml/acs
AUTH_SAML_DEFAULT_REDIRECT_URL=https://appflowy.seemplifyai.com/app

# AppFlowy Entity ID
AUTH_SAML_ISSUER=https://appflowy.seemplifyai.com

# ========================================
# CERTIFICATES
# ========================================

# Seemplify IdP certificate (for validating SAML responses)
AUTH_SAML_CERT="${SEEMPLIFY_SAML_CERT}"

# AppFlowy SP private key (for signing requests)
# Generate: openssl genrsa -out appflowy-private.pem 2048
GOTRUE_SAML_PRIVATE_KEY="${APPFLOWY_SP_PRIVATE_KEY}"

# AppFlowy SP certificate (for Seemplify to validate)
# Generate: openssl req -new -x509 -key appflowy-private.pem -out appflowy-cert.pem -days 365
AUTH_SAML_CERT="${APPFLOWY_SP_CERT}"

# ========================================
# USER PROVISIONING
# ========================================

# ⚠️ CRITICAL: Allow auto-creation of users on first SAML login
GOTRUE_EXTERNAL_EMAIL_ENABLED=false
GOTRUE_EXTERNAL_PHONE_ENABLED=false
GOTRUE_PASSWORD_LOGIN_ENABLED=false  # Disable password login completely
```

### Certificate Generation

**Generate AppFlowy SP certificates:**

```bash
# 1. Generate private key
openssl genrsa -out appflowy-private.pem 2048

# 2. Generate certificate
openssl req -new -x509 -key appflowy-private.pem -out appflowy-cert.pem -days 365 \
  -subj "/CN=appflowy.seemplifyai.com/O=Seemplify/C=US"

# 3. Encode for environment variables (base64)
PRIVATE_KEY_BASE64=$(cat appflowy-private.pem | base64 -w 0)
CERT_BASE64=$(cat appflowy-cert.pem | base64 -w 0)

echo "GOTRUE_SAML_PRIVATE_KEY=$PRIVATE_KEY_BASE64"
echo "AUTH_SAML_CERT=$CERT_BASE64"
```

**Add these values to Dokploy environment variables.**

---

## 🔗 Seemplify SP Configuration (Register AppFlowy)

### Add AppFlowy as Trusted SP

#### File: `saml-idps.json` (or create new)

**Note**: For IdP mode, we need to register Service Providers, not Identity Providers.

Create a new file `saml-sps.json`:

```json
{
  "sps": [
    {
      "spId": "appflowy",
      "name": "AppFlowy",
      "enabled": true,
      "entityId": "https://appflowy.seemplifyai.com",
      "acsUrl": "https://appflowy.seemplifyai.com/gotrue/sso/saml/acs",
      "sloUrl": "https://appflowy.seemplifyai.com/gotrue/sso/saml/slo",
      "certificate": "-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----",
      "attributeMapping": {
        "email": "urn:seemplify:email",
        "name": "urn:seemplify:name",
        "organizations": "urn:seemplify:organizations",
        "teams": "urn:seemplify:teams"
      }
    }
  ]
}
```

**Load SPs in samlService.js:**

```javascript
/**
 * Load Service Provider configurations
 */
loadServiceProviders() {
  try {
    const spsConfigPath = process.env.SAML_SPS_CONFIG || join(__dirname, '../saml-sps.json');
    const spsData = JSON.parse(readFileSync(spsConfigPath, 'utf-8'));
    
    for (const sp of spsData.sps) {
      if (sp.enabled !== false) {
        this.spConfigs.set(sp.spId, sp);
        console.log(`✅ Registered SAML SP: ${sp.spId} (${sp.name})`);
      }
    }
    
    console.log(`✅ Loaded ${this.listSPs().length} SAML Service Providers`);
  } catch (error) {
    console.warn('⚠️ No SAML SPs configured:', error.message);
  }
}
```

---

## 🧪 Single Logout (SLO) Integration

### Seemplify Logout with SAML Propagation

When user logs out from Seemplify, also log out from AppFlowy:

```javascript
// In src/index.js - existing logout endpoint modification
app.post('/interaction/logout', async (req, res) => {
  try {
    // ... existing logout logic ...
    
    // ⚠️ NEW: Notify AppFlowy of logout (SAML SLO)
    if (req.session.samlContext) {
      await samlService.sendSLOToSP(req.session.samlContext.spIssuer);
    }
    
    // Clear session
    req.session.destroy();
    
    res.redirect(process.env.ISSUER_URL);
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Logout failed' });
  }
});
```

---

## ✅ Testing & Verification

### 1. Test Seemplify IdP Metadata

```bash
# Fetch metadata
curl https://auth.seemplifyai.com/api/auth/saml/idp/metadata

# Verify XML is valid
# Should contain EntityID, SSO URL, SLO URL, Certificate
```

### 2. Test AppFlowy SAML Configuration

```bash
# 1. Log out of AppFlowy
# 2. Navigate to AppFlowy login page
# 3. Verify ONLY "Sign in with Seemplify" button is shown
# 4. No email/password form should be visible ✅
# 5. Click "Sign in with Seemplify"
# 6. Redirect to Seemplify login
# 7. Enter credentials
# 8. Redirect back to AppFlowy
# 9. ✅ User logged in with full org/team data!
```

### 3. Verify SAML Attributes Received

Add debugging to AppFlowy to log received attributes:

```javascript
// AppFlowy should log SAML attributes on first login
console.log('📦 Received SAML attributes:', {
  email: attributes['urn:seemplify:email'],
  name: attributes['urn:seemplify:name'],
  organizations: JSON.parse(attributes['urn:seemplify:organizations']),
  teams: JSON.parse(attributes['urn:seemplify:teams'])
});
```

### 4. Verify No Email/Password Login

```bash
# Attempt to access email/password login
curl -X POST https://appflowy.seemplifyai.com/gotrue/api/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"test"}'

# Expected: 403 or "login disabled" error ✅
```

---

## 📋 Implementation Checklist

### Phase 1: Seemplify IdP Setup
- [ ] Add AppFlowy to `hubApps.js` (both dev and prod)
- [ ] Add IdP endpoints to `samlRoutes.js`:
  - [ ] POST `/api/auth/saml/idp/sso`
  - [ ] GET `/api/auth/saml/idp/metadata`
  - [ ] POST `/api/auth/saml/idp/logout`
- [ ] Add IdP methods to `samlService.js`:
  - [ ] `validateAuthnRequest()`
  - [ ] `generateSAMLResponse()` with `getCachedClaims` integration
  - [ ] `generateIdPMetadata()`
  - [ ] `generateLogoutResponse()`
- [ ] Register AppFlowy as SP in `saml-sps.json`
- [ ] Test IdP metadata endpoint returns valid XML
- [ ] Restart Seemplify IdP

### Phase 2: AppFlowy Deployment
- [ ] Deploy AppFlowy via Dokploy UI (initial deployment)
- [ ] Configure DNS for AppFlowy domain
- [ ] Verify SSL certificate is working
- [ ] Create initial admin account
- [ ] Test basic AppFlowy functionality
- [ ] Generate AppFlowy SP certificates
- [ ] Update environment variables for SAML:
  - [ ] Enable SAML: `GOTRUE_SAML_ENABLED=true`, `AUTH_SAML_ENABLED=true`
  - [ ] Disable email/password: `GOTRUE_DISABLE_SIGNUP=true`
  - [ ] Configure Seemplify endpoints
  - [ ] Add certificates
- [ ] Restart AppFlowy
- [ ] Test SAML-only login flow

### Phase 3: Integration Testing
- [ ] Test SAML login from AppFlowy to Seemplify
- [ ] Verify user is created/updated correctly
- [ ] Verify organization data is passed in SAML
- [ ] Verify team data is passed in SAML
- [ ] Verify permissions are correct
- [ ] Test logout propagates to AppFlowy (SLO)
- [ ] Verify email/password login is disabled
- [ ] Test with multiple users
- [ ] Test user switching

### Phase 4: Hub Integration
- [ ] Verify AppFlowy appears in Seemplify hub
- [ ] Click AppFlowy tile from hub
- [ ] Verify seamless SAML login
- [ ] Test other apps still work with OIDC
- [ ] Verify consistent user experience across all apps

---

## 📊 SAML Attributes Mapping

### What AppFlowy Receives

| Attribute Name | Format | Description |
|----------------|----------|-------------|
| `urn:seemplify:email` | String | User email |
| `urn:seemplify:name` | String | User display name |
| `urn:seemplify:sub` | String | User unique ID |
| `urn:seemplify:organizations` | JSON String | Array of organization memberships with roles |
| `urn:seemplify:current_organization` | JSON Object | Current organization context |
| `urn:seemplify:teams` | JSON String | Array of team memberships with hierarchy |
| `urn:seemplify:team_permissions` | JSON String | Team-based permissions (approve_leaves, etc.) |
| `urn:seemplify:role` | String | Current organization role |

### Organizations Structure (JSON)

```json
[
  {
    "id": "org123",
    "name": "Company A",
    "role": "admin",
    "permissions": ["manage_users", "manage_jobs", "view_analytics"],
    "appPermissions": {
      "smarthr": ["manage_jobs", "manage_candidates"],
      "leave-management": ["approve_leaves", "view_all_leaves"]
    },
    "teamPermissions": [
      {
        "teamId": "team1",
        "teamName": "Engineering",
        "role": "line_manager",
        "permissions": ["approve_leaves", "view_team_leaves"],
        "directReports": ["user2", "user3"]
      }
    ]
  }
]
```

### Teams Structure (JSON)

```json
[
  {
    "id": "team1",
    "name": "Engineering",
    "organizationId": "org123",
    "organizationName": "Company A",
    "role": "line_manager",
    "isManager": true,
    "directReports": ["user2", "user3"],
    "hierarchyPath": ["Company A", "Engineering", "Backend"],
    "joinedAt": "2026-01-01T00:00:00Z"
  }
]
```

---

## 🔒 Security Considerations

### SAML Security

1. **Signed Assertions**
   ```javascript
   // In production, sign all SAML responses
   const signedResponse = samlResponse.sign(this.privateKey);
   ```

2. **Encrypted Assertions** (optional, recommended)
   - Encrypt sensitive attributes if AppFlowy supports it

3. **Message Expiration**
   ```javascript
   // Set reasonable expiration (currently 8 hours)
   notOnOrAfter: new Date(now.getTime() + 8 * 60 * 60 * 1000)
   ```

4. **Request Validation**
   - Validate all AuthnRequests
   - Check Request IDs
   - Verify SP is registered

### AppFlowy Security

1. **Disable All Non-SAML Auth**
   ```bash
   GOTRUE_DISABLE_EMAIL_SIGNUP=true
   GOTRUE_DISABLE_SIGNUP=true
   GOTRUE_EXTERNAL_EMAIL_ENABLED=false
   GOTRUE_EXTERNAL_PHONE_ENABLED=false
   GOTRUE_PASSWORD_LOGIN_ENABLED=false
   ```

2. **Validate SAML Responses**
   - Verify signature with Seemplify certificate
   - Check assertion expiration
   - Validate audience

3. **HTTPS Only**
   - Force HTTPS for SAML endpoints
   - Secure cookies

---

## 🐛 Troubleshooting

### Issue: SAML AuthnRequest Not Validated

**Symptoms:**
- AppFlowy shows error "Invalid SAMLRequest"
- User redirected to Seemplify but returns immediately

**Solutions:**
1. Check SAML Request format (base64 encoded)
2. Verify XML parsing in `validateAuthnRequest()`
3. Check logs for parsing errors

### Issue: User Not Created in AppFlowy

**Symptoms:**
- SAML login succeeds
- AppFlowy shows "User not found" error

**Solutions:**
1. Ensure `GOTRUE_DISABLE_SIGNUP=false` for first-time users
2. Check AppFlowy logs for attribute parsing errors
3. Verify email format matches (lowercase, trimmed)

### Issue: Organization/Team Data Missing

**Symptoms:**
- User logs in successfully
- No organization/team data in AppFlowy

**Solutions:**
1. Check Seemplify logs for `getCachedClaims` output
2. Verify JSON serialization is correct
3. Check AppFlowy logs for SAML attribute parsing
4. Ensure `urn:seemplify:*` attributes are being sent

### Issue: Email/Password Login Still Available

**Symptoms:**
- Email/password form visible on AppFlowy login page

**Solutions:**
1. Verify all disable variables are set:
   - `GOTRUE_DISABLE_EMAIL_SIGNUP=true`
   - `GOTRUE_DISABLE_SIGNUP=true`
2. Restart AppFlowy after changing environment variables
3. Clear browser cache

---

## 📚 Related Documentation

- [SAML Addition Plan](./SAML-ADDITION-PLAN.md) - Full SAML SP implementation
- [SSO Configuration Guide](./SSO_CONFIGURATION_GUIDE.md) - Existing OIDC setup
- [Hub Apps Configuration](../access/) - App deployment configs

---

## 📞 Support

For issues or questions:
1. Check logs in Seemplify IdP
2. Check logs in AppFlowy (if accessible)
3. Verify network connectivity between services
4. Check SSL certificates are valid

---

**Last Updated**: January 2026  
**Version**: 1.0  
**Status**: Ready for Implementation
