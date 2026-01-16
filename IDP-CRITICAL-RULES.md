# 🚨 CRITICAL IDP RULES - DO NOT BREAK AUTHENTICATION

**Last Updated:** January 15, 2026  
**Severity:** BREAKING CHANGES - Will disable all app logins

---

## ⚠️ NEVER CHANGE THESE WITHOUT UNDERSTANDING CONSEQUENCES

### 🔴 **1. Identity Provider Proxy Setting**

**File:** `Identityprovider/src/index.js`

❌ **NEVER DO THIS:**
```javascript
// DON'T make proxy conditional on environment!
if (isProduction) {
  provider.proxy = true  // ❌ BREAKS DEV
}
```

✅ **ALWAYS KEEP:**
```javascript
// Proxy MUST be true for both dev and production (behind Traefik/Azure)
provider.proxy = true
console.log('🔧 Provider proxy set to:', provider.proxy)
```

**Why:** Without `provider.proxy = true`, the IDP returns HTTP URLs instead of HTTPS, causing:
- `OPError: expected 200 OK, got: 308 Permanent Redirect`
- All OIDC logins fail across ALL apps
- Infinite redirect loops

---

### 🔴 **2. OIDC Client Configuration**

**File:** `Identityprovider/clients.json`

❌ **NEVER REMOVE OR MODIFY:**
- Client IDs (e.g., `smarthr-backend`, `leave-management`, `performance-management`)
- Client secrets (must match backend env vars)
- Existing redirect URIs
- Existing allowed origins

✅ **SAFE TO ADD:**
- New redirect URIs (additive)
- New allowed origins (additive)
- New clients (additive)

**Critical Client IDs:**
```json
{
  "client_id": "smarthr-backend",        // ← Recruiter backend
  "client_id": "leave-management",       // ← Leave backend
  "client_id": "performance-management", // ← Performance backend
  "client_id": "payroll-management",     // ← Payroll backend
  "client_id": "openwebui",              // ← AI Assistant
  "client_id": "outline"                 // ← Docs
}
```

**If you change a client_id, you MUST update:**
1. Backend `OIDC_CLIENT_ID` env var in Dokploy
2. All redirect URIs
3. All frontend IDP configurations

---

### 🔴 **3. Redirect URI Patterns**

**File:** `Identityprovider/clients.json`

❌ **NEVER REMOVE THESE PATTERNS:**
```json
"redirect_uri_patterns": [
  "https://api.seemplifyai.com/api/auth/oidc/callback",      // Production
  "https://api-dev.seemplifyai.com/api/auth/oidc/callback",  // Dev
  "http://localhost:5001/api/auth/oidc/callback"             // Local
]
```

✅ **MUST INCLUDE BOTH:**
- Production URLs (no `-dev`)
- Dev URLs (with `-dev`)
- Localhost for local development

**If you add a new app, ADD its redirect URIs (don't replace)!**

---

### 🔴 **4. IDP Environment Variables**

**In Dokploy (both dev and production):**

❌ **NEVER DELETE OR CHANGE:**
```env
ISSUER_URL=https://auth.seemplifyai.com           # Or auth-dev for dev
OIDC_COOKIE_SECRET=<secret>                       # Must be strong
API_AUDIENCE=https://auth.seemplifyai.com         # Must match ISSUER_URL
TRUST_PROXY=true                                   # Required for HTTPS
```

❌ **NEVER SET TO FALSE:**
```env
TRUST_PROXY=false  # ❌ BREAKS HTTPS URLs
```

✅ **SAFE TO CHANGE:**
- `BREVO_API_KEY` (email service)
- `SMARTHR_URL`, `LEAVE_URL`, etc. (app URLs)
- `*_WEBHOOK_URL` (webhook endpoints)

---

### 🔴 **5. Backend OIDC Configuration**

**Files:** `*/backend/routes/auth.js`, `*/backend/app.js`

❌ **NEVER HARDCODE THESE:**
```javascript
const issuerUrl = 'https://auth.seemplifyai.com'  // ❌ BREAKS DEV
const redirectUri = 'https://api.seemplifyai.com/...'  // ❌ BREAKS DEV
```

✅ **ALWAYS USE ENV VARS:**
```javascript
const issuerUrl = process.env.IDP_ISSUER_URL;  // ✅ Environment-aware
const redirectUri = process.env.OIDC_REDIRECT_URI;  // ✅ Environment-aware
```

**Required Backend Env Vars (all backends):**
```env
IDP_ISSUER_URL=https://auth[-dev].seemplifyai.com
OIDC_REDIRECT_URI=https://api[-dev].seemplifyai.com/api/auth/oidc/callback
OIDC_CLIENT_ID=<app-client-id>
OIDC_CLIENT_SECRET=<app-client-secret>
FRONTEND_URL=https://app[-dev].seemplifyai.com
```

---

### 🔴 **6. Frontend IDP URLs**

**All frontends must have:**

❌ **NEVER HARDCODE:**
```typescript
const idpUrl = 'https://auth.seemplifyai.com'  // ❌ BREAKS DEV
```

✅ **USE ENV VAR:**
```typescript
const idpUrl = process.env.NEXT_PUBLIC_IDP_URL  // ✅ From build args
```

**Required in Dockerfile.dev:**
```dockerfile
ARG NEXT_PUBLIC_IDP_URL=https://auth-dev.seemplifyai.com
```

**Required in Dockerfile (production):**
```dockerfile
ARG NEXT_PUBLIC_IDP_URL=https://auth.seemplifyai.com
```

---

### 🔴 **7. Content Security Policy (CSP)**

**File:** `recruiter/frontend/next.config.mjs` (if CSP exists)

❌ **NEVER REMOVE FROM CSP:**
```javascript
connect-src: 
  'self'
  https://auth.seemplifyai.com       // ❌ Remove = blocks IDP
  https://auth-dev.seemplifyai.com   // ❌ Remove = blocks dev IDP
  
frame-src:
  https://auth.seemplifyai.com       // ❌ Remove = breaks IDP iframe
  https://auth-dev.seemplifyai.com
  
form-action:
  https://auth.seemplifyai.com       // ❌ Remove = blocks IDP forms
  https://auth-dev.seemplifyai.com
```

**Symptom if broken:**
- Console error: `Refused to connect... violates CSP`
- All API calls fail
- Infinite logout loop

---

### 🔴 **8. OIDC Cookie Names & Settings**

**Backend auth routes:**

❌ **NEVER CHANGE THESE NAMES:**
```javascript
res.cookie('oidc_verifier', ...)  // Used by OIDC PKCE flow
res.cookie('oidc_state', ...)     // Used by OIDC state validation
```

❌ **NEVER DISABLE SECURE/SAMESITE:**
```javascript
// In production, these MUST be secure
{ 
  secure: true,              // ❌ Don't set to false in production
  sameSite: 'lax',          // ❌ Don't change to 'none' unnecessarily
  httpOnly: true            // ❌ Don't disable (security risk)
}
```

---

### 🔴 **9. OIDC Discovery Endpoints**

**Never mock or disable:**

❌ **DON'T DO THIS:**
```javascript
// Skip OIDC discovery
const issuer = { issuer: 'manual' }  // ❌ BREAKS AUTO-DISCOVERY
```

✅ **ALWAYS USE:**
```javascript
const issuer = await Issuer.discover(process.env.IDP_ISSUER_URL);
```

**Why:** OIDC requires auto-discovery of:
- Authorization endpoint
- Token endpoint  
- JWKS endpoint
- UserInfo endpoint

---

### 🔴 **10. Database Naming Convention**

**MUST FOLLOW PATTERN:**

**Production:**
- `identity`
- `smart_hr_db`
- `leave-management`
- `performance_db`
- `payroll_db`

**Dev (with `_dev` suffix):**
- `identity_dev`
- `smart_hr_db_dev`
- `leave-management_dev`
- `performance_db_dev`
- `payroll_db_dev`

❌ **Don't use:**
- `-dev` suffix (use `_dev`)
- Inconsistent naming
- Shared databases between dev/prod

---

## ✅ SAFE CHANGES

### **You CAN safely change:**

1. ✅ Add new apps to `clients.json` (additive)
2. ✅ Add new redirect URIs (additive)
3. ✅ Add new allowed origins (additive)
4. ✅ Update app URLs (`SMARTHR_URL`, `LEAVE_URL`, etc.)
5. ✅ Change email settings (Brevo API keys, templates)
6. ✅ Update webhook URLs
7. ✅ Add new CSP domains (additive)
8. ✅ Change non-OIDC middleware
9. ✅ Update UI/styling in IDP views
10. ✅ Add new features that don't touch OIDC flow

---

## 🔧 DEBUGGING CHECKLIST

**If IDP login breaks, check:**

1. ✅ `provider.proxy = true` (not conditional)
2. ✅ `TRUST_PROXY=true` in env vars
3. ✅ `IDP_ISSUER_URL` uses HTTPS (not HTTP)
4. ✅ Client ID exists in `clients.json`
5. ✅ Client secret matches backend env var
6. ✅ Redirect URI is whitelisted in `clients.json`
7. ✅ CSP allows IDP URLs (`connect-src`, `frame-src`, `form-action`)
8. ✅ `OIDC_COOKIE_SECRET` is set
9. ✅ Backend has correct `OIDC_REDIRECT_URI`
10. ✅ Frontend has correct `NEXT_PUBLIC_IDP_URL`

---

## 🚨 EMERGENCY ROLLBACK

**If you break IDP and all logins fail:**

```bash
# 1. Find last working commit
git log --oneline Identityprovider/

# 2. Revert the breaking change
git revert <commit-hash>

# 3. Push to restore
git push origin dev  # or main

# 4. Wait for auto-deploy (30-40 seconds)

# 5. Test login
curl https://auth[-dev].seemplifyai.com/.well-known/openid-configuration
```

**Quick IDP restart:**
```bash
ssh seemplify@4.180.153.209
docker service update --force identity-provider[-dev]-a1b2c3
```

---

## 📝 REMEMBER

**The IDP is the SINGLE POINT OF AUTHENTICATION for:**
- ✅ Recruiter (SmartHR)
- ✅ Leave Management
- ✅ Performance Management  
- ✅ Payroll Management
- ✅ Outline Docs
- ✅ AI Assistant (OpenWebUI)

**If IDP breaks, ALL apps break. Treat IDP changes with extreme care!** 🛡️

---

**Questions? Check:**
- `OIDC-DEV-COMPLETE.md` - OIDC investigation & verification
- `OIDC-FINAL-FIX.md` - provider.proxy bug fix
- `DEV-ENVIRONMENT-COMPLETE-SUCCESS.md` - Full setup verification
