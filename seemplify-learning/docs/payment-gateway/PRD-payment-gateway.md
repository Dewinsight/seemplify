# PRD: Dual Payment Gateway — Paystack + Flutterwave

**Document:** `PRD-payment-gateway.md`  
**Status:** Draft  
**Created:** 2026-03-10  
**Domain:** learning.aiinigeria.com (primary) + secondary domain  

---

## 1. Overview

### 1.1 Problem Statement

The AI in Nigeria Learning Platform currently supports **only Flutterwave** for course purchases. This creates a single point of failure — if Flutterwave experiences downtime or the admin wants to switch providers, there is no fallback. Additionally, some Nigerian learners prefer Paystack-specific payment channels.

### 1.2 Goal

Add **Paystack** as a second payment gateway alongside Flutterwave, giving learners a choice at checkout and giving admins the ability to enable/disable either provider from the admin dashboard.

### 1.3 Scope

- **In scope:** Paystack integration for course collections, admin provider toggle, checkout provider selection, webhook/callback handling for two domains, `paystackService.js` implementation
- **Out of scope:** Paystack payouts (withdrawals remain manual), subscription/recurring billing, Paystack Transfers API for automated payouts

---

## 2. Current State Analysis

### 2.1 Existing Flutterwave Implementation

| Component | File | Details |
|-----------|------|---------|
| Service | `src/services/flutterwaveService.js` (97 lines) | `createFlutterwavePaymentLink()`, `verifyFlutterwaveTransaction()`, `isFlutterwaveConfigured()` |
| Payment Model | `src/models/SimpleLmsPayment.js` (118 lines) | `provider` enum: `['flutterwave']`, `flutterwaveTxId`, `flutterwaveStatus` |
| Checkout Route | `src/routes/simpleLms.js` line 1573 | `initiateCoursePaymentCheckout()` — hardcoded to Flutterwave |
| Callback Route | `src/routes/simpleLms.js` line 2076 | `GET /simple-lms/payments/flutterwave/callback` |
| Webhook Route | `src/routes/simpleLms.js` line 5597 | `POST /api/simple-lms/payments/flutterwave/webhook` — hash-based verification |
| URL Builder | `src/routes/simpleLms.js` line 408 | `buildAppBaseUrl(req)` — dynamic from `req.protocol + req.get('host')` |
| Env Vars | `.env` | `FLUTTERWAVE_SECRET_KEY`, `FLUTTERWAVE_PUBLIC_KEY`, `FLUTTERWAVE_BASE_URL`, `FLUTTERWAVE_WEBHOOK_HASH` |

### 2.2 How the Two-Domain Problem is Already Solved

> [!NOTE]
> **Good news:** The existing `buildAppBaseUrl(req)` function already dynamically generates callback URLs from the incoming HTTP request's host header. This means whichever domain the learner is on (`learning.aiinigeria.com` or the secondary domain), the callback URL will automatically point back to the correct domain. This works for **both** Flutterwave and Paystack.

```javascript
// Existing code — already handles multiple domains
const buildAppBaseUrl = (req) => {
  const requestBaseUrl = `${req.protocol}://${req.get('host')}`.replace(/\/+$/, '')
  const forceConfiguredBase = String(process.env.APP_BASE_URL_FORCE || '').trim().toLowerCase() === 'true'
  const configured = String(process.env.APP_BASE_URL || '').trim()
  if (forceConfiguredBase && configured) return configured.replace(/\/+$/, '')
  return requestBaseUrl
}
```

**For Paystack callbacks:** The `callback_url` is sent **per transaction** via the Initialize Transaction API — so no dashboard-level callback URL configuration is needed on Paystack's end.

**For Paystack webhooks:** Unlike callbacks, webhooks are configured **once on the Paystack dashboard** and point to a single URL. Since both domains hit the same server, configure the webhook URL as: `https://learning.aiinigeria.com/api/simple-lms/payments/paystack/webhook`

---

## 3. Functional Requirements

### 3.1 Admin Provider Management

| ID | Requirement | Priority |
|----|-------------|----------|
| FPG-01 | Admin dashboard shows a "Payment Gateways" section under platform settings — visible **only to `super_admin`** | Critical |
| FPG-02 | Super admin can toggle Flutterwave ON/OFF via a switch control | Critical |
| FPG-03 | Super admin can toggle Paystack ON/OFF via a switch control | Critical |
| FPG-04 | At least one provider must remain enabled — system prevents disabling both | Critical |
| FPG-05 | Toggle state stored in a platform settings document/model (not env vars alone) | High |
| FPG-06 | Each provider shows its configuration status: ✅ Configured / ⚠️ Missing keys | High |
| FPG-07 | **Only `super_admin` role** can view, toggle, or change payment gateway settings and API keys. Regular `admin` roles cannot access this section. | Critical |
| FPG-07a | Changing API keys requires re-authentication (password confirmation) for extra security | High |

**Admin UI wireframe:**
```
┌──────────────────────────────────────────────────────────────┐
│  Platform Settings → Payment Gateways                        │
│  🔒 Super Admin Only                                         │
│                                                              │
│  ┌───────────────────────────────────────────────────┐       │
│  │ Flutterwave                      [🟢 Enabled ▼]  │       │
│  │ Status: ✅ Configured (keys present)              │       │
│  │ Secret Key: ****...7f2b  [🔒 Change]             │       │
│  │ Public Key: FLWP...x8kq  [🔒 Change]             │       │
│  │ Webhook Hash: ****...ab1c [🔒 Change]             │       │
│  │ Last Changed: Mar 8, 2026 by admin@...            │       │
│  └───────────────────────────────────────────────────┘       │
│                                                              │
│  ┌───────────────────────────────────────────────────┐       │
│  │ Paystack                         [🟢 Enabled ▼]  │       │
│  │ Status: ✅ Configured (keys present)              │       │
│  │ Secret Key: sk_live_****...c92b  [🔒 Change]     │       │
│  │ Public Key: pk_live_****...9ea8  [🔒 Change]     │       │
│  │ Webhook URL: https://learning.aiinigeria.com      │       │
│  │   /api/simple-lms/payments/paystack/webhook       │       │
│  │ Last Changed: Mar 5, 2026 by admin@...            │       │
│  └───────────────────────────────────────────────────┘       │
│                                                              │
│  ⚠ At least one provider must remain enabled.               │
│  Default provider for checkout: [Paystack ▼]                 │
│                                                              │
│  [Save Changes]                                              │
└──────────────────────────────────────────────────────────────┘
```

**🔒 Change Key Modal (requires re-authentication):**
```
┌──────────────────────────────────────┐
│  Update Paystack Secret Key          │
│                                      │
│  ⚠ Confirm your password to proceed │
│  Password: [__________________]     │
│                                      │
│  New Secret Key:                     │
│  [________________________________] │
│                                      │
│  ⓘ This action will be logged in    │
│    the audit trail with your         │
│    account, IP address, and          │
│    timestamp.                        │
│                                      │
│  [Cancel]       [Update Key]         │
└──────────────────────────────────────┘
```

### 3.2 Checkout Provider Selection

| ID | Requirement | Priority |
|----|-------------|----------|
| FPG-08 | If both providers are enabled, the checkout page shows provider options | High |
| FPG-09 | If only one provider is enabled, checkout uses that provider silently (no selection) | High |
| FPG-10 | Admin can set a "default provider" shown as pre-selected at checkout | Medium |
| FPG-11 | Learner's choice persisted in session for subsequent cart item checkouts | Medium |
| FPG-12 | Selected provider stored in `SimpleLmsPayment.provider` for each transaction | Critical |

**Checkout provider selection UI:**
```
┌──────────────────────────────────────────────────────────────┐
│  Complete Purchase — "AI Fundamentals"                       │
│                                                              │
│  Amount: ₦5,000                                              │
│                                                              │
│  Pay with:                                                   │
│  ┌──────────────────────┐  ┌──────────────────────┐         │
│  │  ◉ Paystack          │  │  ○ Flutterwave       │         │
│  │  Card, Bank, USSD    │  │  Card, Bank, USSD    │         │
│  └──────────────────────┘  └──────────────────────┘         │
│                                                              │
│  [Pay ₦5,000 →]                                              │
└──────────────────────────────────────────────────────────────┘
```

### 3.3 Paystack Service Implementation

| ID | Requirement | Priority |
|----|-------------|----------|
| FPG-13 | Create `src/services/paystackService.js` mirroring `flutterwaveService.js` structure | Critical |
| FPG-14 | `initializePaystackTransaction()` — POST to `https://api.paystack.co/transaction/initialize` | Critical |
| FPG-15 | `verifyPaystackTransaction()` — GET to `https://api.paystack.co/transaction/verify/:reference` | Critical |
| FPG-16 | `isPaystackConfigured()` — checks presence of `PAYSTACK_SECRET_KEY` and `PAYSTACK_PUBLIC_KEY` | Critical |
| FPG-17 | `getPaystackPublicKey()` — returns public key for frontend (if inline checkout used) | High |

**Technical specification — `paystackService.js`:**

```javascript
// Paystack API — mirrors flutterwaveService.js structure
const PAYSTACK_BASE_URL = 'https://api.paystack.co'

// POST /transaction/initialize
// Required body: { email, amount, callback_url, reference, metadata }
// - amount is in KOBO (minor units) — same as our amountMinor ✅
// - callback_url is set dynamically per transaction ✅
// - reference is our txRef ✅
// Returns: { data: { authorization_url, access_code, reference } }

// GET /transaction/verify/:reference
// - Uses txRef as reference
// Returns: { data: { status: 'success'|'failed'|'abandoned', amount, reference, ... } }
```

> [!NOTE]
> **Key difference from Flutterwave:** Paystack's `amount` parameter is already in **kobo (minor units)**, which matches our `amountMinor` field directly — no division by 100 needed (unlike Flutterwave which expects major units and requires `amountMinor / 100`).

### 3.4 Paystack Callback & Webhook

| ID | Requirement | Priority |
|----|-------------|----------|
| FPG-18 | Callback route: `GET /simple-lms/payments/paystack/callback?reference=xxx` | Critical |
| FPG-19 | Callback extracts `reference` (our `txRef`), verifies via Paystack Verify API | Critical |
| FPG-20 | Webhook route: `POST /api/simple-lms/payments/paystack/webhook` | Critical |
| FPG-21 | Webhook verifies signature using HMAC SHA-512 of request body with secret key | Critical |
| FPG-22 | Webhook handles `charge.success` event — verifies and finalizes payment | Critical |
| FPG-23 | Both callback and webhook share the same verification + enrollment logic | High |

**Paystack webhook verification:**
```javascript
// Paystack sends x-paystack-signature header
// Verify: HMAC('sha512', requestBody, secretKey) === signature
const crypto = require('crypto')
const hash = crypto.createHmac('sha512', PAYSTACK_SECRET_KEY)
                   .update(JSON.stringify(req.body))
                   .digest('hex')
if (hash !== req.headers['x-paystack-signature']) {
  return res.sendStatus(401) // Invalid signature
}
```

> [!IMPORTANT]
> **Webhook URL for Paystack dashboard:** Since both domains hit the same server, set the Paystack dashboard webhook URL to: `https://learning.aiinigeria.com/api/simple-lms/payments/paystack/webhook`. Webhooks don't need to match the domain the learner used — they're server-to-server. The **callback URL** (which redirects the learner's browser) is set dynamically per transaction using `buildAppBaseUrl(req)`, so it automatically matches whichever domain the learner is on.

### 3.5 Payment Model Updates

| ID | Requirement | Priority |
|----|-------------|----------|
| FPG-24 | Extend `SimpleLmsPayment.provider` enum: `['flutterwave', 'paystack']` | Critical |
| FPG-25 | Add `paystackReference` field (String) — maps to Paystack's `reference` | Critical |
| FPG-26 | Add `paystackStatus` field (String) — mirrors `flutterwaveStatus` | High |
| FPG-27 | Add `providerTxId` field (String) — generic provider transaction ID | Medium |
| FPG-28 | `verificationPayload` continues to store the raw verification response from either provider | High |

**Schema changes:**
```diff
  provider: {
    type: String,
-   enum: ['flutterwave'],
-   default: 'flutterwave'
+   enum: ['flutterwave', 'paystack'],
+   required: true
  },
+ paystackReference: {
+   type: String,
+   trim: true,
+   maxlength: 120
+ },
+ paystackStatus: {
+   type: String,
+   trim: true,
+   maxlength: 60
+ },
```

### 3.6 Platform Settings Model

| ID | Requirement | Priority |
|----|-------------|----------|
| FPG-29 | Create `SimpleLmsPlatformSettings` model (singleton document) or extend existing settings | High |
| FPG-30 | Store: `paymentGateways.flutterwave.enabled` (Boolean, default true) | Critical |
| FPG-31 | Store: `paymentGateways.paystack.enabled` (Boolean, default false) | Critical |
| FPG-32 | Store: `paymentGateways.defaultProvider` (String, enum: `['flutterwave', 'paystack']`) | High |
| FPG-33 | API keys stored **encrypted (AES-256-GCM)** in the database, configurable via admin UI | Critical |
| FPG-33a | Encryption master key stored in environment variable `CREDENTIALS_ENCRYPTION_KEY` (the only secret in env) | Critical |
| FPG-33b | Keys decrypted in-memory only when needed for API calls — never logged, never returned in full to frontend | Critical |
| FPG-33c | Every credential change logged to `AuditLog` with: who, when, IP address, what changed (old key last-4 → new key last-4) | Critical |
| FPG-33d | Re-authentication (password confirmation) required before any credential change | Critical |

**Schema:**
```javascript
const EncryptedCredentialSchema = new mongoose.Schema({
  ciphertext: { type: String, required: true },  // AES-256-GCM encrypted value
  iv: { type: String, required: true },           // Initialization vector (hex)
  authTag: { type: String, required: true },      // Authentication tag (hex)
  lastFour: { type: String, maxlength: 4 },       // Last 4 chars for display masking
  updatedAt: Date,
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'AiinAccount' }
}, { _id: false })

const SimpleLmsPlatformSettingsSchema = new mongoose.Schema({
  paymentGateways: {
    flutterwave: {
      enabled: { type: Boolean, default: true },
      secretKey: EncryptedCredentialSchema,       // Encrypted
      publicKey: EncryptedCredentialSchema,       // Encrypted
      webhookHash: EncryptedCredentialSchema      // Encrypted
    },
    paystack: {
      enabled: { type: Boolean, default: false },
      secretKey: EncryptedCredentialSchema,       // Encrypted
      publicKey: EncryptedCredentialSchema        // Encrypted
    },
    defaultProvider: {
      type: String,
      enum: ['flutterwave', 'paystack'],
      default: 'flutterwave'
    }
  },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'AiinAccount' },
  updatedAt: { type: Date, default: Date.now }
}, { timestamps: true })
```

---

## 4. Environment Variables

### 4.1 Existing (Flutterwave)

| Variable | Purpose |
|----------|---------|
| `FLUTTERWAVE_SECRET_KEY` | API authentication (server-side) |
| `FLUTTERWAVE_PUBLIC_KEY` | Frontend integration (if inline used) |
| `FLUTTERWAVE_BASE_URL` | API base (default: `https://api.flutterwave.com/v3`) |
| `FLUTTERWAVE_WEBHOOK_HASH` | Webhook verification hash |

### 4.2 New (Paystack)

> [!NOTE]
> Paystack and Flutterwave API keys are now stored **encrypted in the database** and configured via the admin UI. The only remaining env var for keys is the **encryption master key**.

| Variable | Purpose |
|----------|---------|
| `CREDENTIALS_ENCRYPTION_KEY` | **Master key** for AES-256-GCM encryption of all stored API keys. Generate with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |

Paystack and Flutterwave keys are no longer stored in `.env` — they are entered via the admin UI and stored encrypted in `SimpleLmsPlatformSettings`.

> [!CAUTION]
> **The `CREDENTIALS_ENCRYPTION_KEY` is the single most critical secret.** If lost, all stored API keys become unrecoverable. If compromised, all stored API keys are exposed. Back it up securely. Rotate it only with a planned migration.

---

## 5. Paystack vs Flutterwave — Technical Comparison

| Aspect | Flutterwave | Paystack |
|--------|-------------|----------|
| **API Base** | `https://api.flutterwave.com/v3` | `https://api.paystack.co` |
| **Initialize** | `POST /payments` | `POST /transaction/initialize` |
| **Verify** | `GET /transactions/{id}/verify` | `GET /transaction/verify/{reference}` |
| **Amount format** | **Major units** (₦50.00 → `50.00`) | **Minor units / kobo** (₦50.00 → `5000`) |
| **Auth header** | `Bearer SECRET_KEY` | `Bearer SECRET_KEY` |
| **Callback URL** | Set per transaction (`redirect_url`) | Set per transaction (`callback_url`) |
| **Webhook verification** | Custom hash comparison | HMAC SHA-512 with secret key |
| **Callback query params** | `?tx_ref=X&status=Y&transaction_id=Z` | `?reference=X&trxref=X` |
| **Success status** | `"successful"` | `"success"` |
| **Payment methods** | Card, bank transfer, USSD, mobile money | Card, bank transfer, USSD, QR |

---

## 6. Implementation Approach

### 6.1 Refactor: Provider-Agnostic Checkout

The key change is making `initiateCoursePaymentCheckout()` provider-agnostic:

```
Current flow:
  initiateCoursePaymentCheckout() → createFlutterwavePaymentLink() → redirect

New flow:
  initiateCoursePaymentCheckout(provider) 
    → if (provider === 'paystack')  → initializePaystackTransaction()  → redirect to authorization_url
    → if (provider === 'flutterwave') → createFlutterwavePaymentLink() → redirect to checkout link
```

### 6.2 Refactor: Provider-Agnostic Verification

```
Current flow:
  /payments/flutterwave/callback → verifyFlutterwaveTransaction() → finalize

New flow:
  /payments/paystack/callback  → verifyPaystackTransaction()  → shared finalizePayment()
  /payments/flutterwave/callback → verifyFlutterwaveTransaction() → shared finalizePayment()
```

### 6.3 Shared Payment Finalization

Extract the commission calculation, enrollment, and cart-continue logic into a shared `finalizeSuccessfulPayment()` function usable by both providers.

---

## 7. Routes Summary

| Route | Method | Purpose |
|-------|--------|---------|
| `/simple-lms/payments/flutterwave/callback` | GET | Existing — Flutterwave redirect callback |
| `/simple-lms/payments/paystack/callback` | GET | **New** — Paystack redirect callback |
| `/api/simple-lms/payments/flutterwave/webhook` | POST | Existing — Flutterwave webhook |
| `/api/simple-lms/payments/paystack/webhook` | POST | **New** — Paystack webhook |
| `/api/simple-lms/admin/payment-settings` | GET/PUT | **New** — Super admin provider toggle (requires `super_admin` role) |

---

## 8. File Inventory

| Action | File | Changes |
|--------|------|---------|
| **[NEW]** | `src/services/paystackService.js` | `initializePaystackTransaction()`, `verifyPaystackTransaction()`, `isPaystackConfigured()`, `getPaystackPublicKey()` |
| **[NEW]** | `src/services/credentialEncryptionService.js` | `encrypt()`, `decrypt()`, `maskKey()` — AES-256-GCM helpers |
| **[NEW]** | `src/models/SimpleLmsPlatformSettings.js` | Singleton settings doc with gateway toggles + encrypted credentials |
| **[MODIFY]** | `src/models/SimpleLmsPayment.js` | Add `'paystack'` to provider enum, add `paystackReference`, `paystackStatus` fields |
| **[MODIFY]** | `src/routes/simpleLms.js` | Add Paystack callback + webhook routes, refactor `initiateCoursePaymentCheckout()` to accept provider, extract shared `finalizeSuccessfulPayment()`, add admin settings API with re-auth + audit logging |
| **[MODIFY]** | `src/services/flutterwaveService.js` | Update to read keys from encrypted DB settings (fallback to env vars for migration) |
| **[MODIFY]** | `src/views/*.ejs` | Checkout view: add provider selection UI. Admin: add gateway settings panel with change modals |
| **[MODIFY]** | `.env` / `.env.example` | Add `CREDENTIALS_ENCRYPTION_KEY`; existing Flutterwave env vars become optional fallbacks |

---

## 9. Non-Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| NFR-PG-01 | Payment verification is idempotent — re-verifying same transaction does not create duplicate enrollments | Critical |
| NFR-PG-02 | API keys encrypted at rest using AES-256-GCM; decrypted in-memory only when making provider API calls | Critical |
| NFR-PG-03 | Webhook endpoints return 200 OK within 5 seconds to avoid retries | High |
| NFR-PG-04 | Admin settings changes take effect immediately (no server restart needed) | High |
| NFR-PG-05 | If a provider goes down mid-transaction, payment record shows `failed` — learner can retry with the other provider | High |
| NFR-PG-06 | API key masking in admin UI (show last 4 chars only); never return full key to frontend | Critical |
| NFR-PG-07 | All credential changes require re-authentication (password confirmation) | Critical |
| NFR-PG-08 | All credential and toggle changes logged to `AuditLog` with actor, IP, timestamp, and change description | Critical |
| NFR-PG-09 | Rate limit credential change endpoint: max 5 attempts per hour per account | High |
| NFR-PG-10 | Failed re-authentication attempts logged and rate-limited (lockout after 5 failures) | High |
| NFR-PG-11 | Admin API returns `403` for non-`super_admin` roles; returns `401` for failed re-auth | Critical |

---

## 9.5 Security & Auditing for Credential Management

### 9.5.1 Encryption at Rest (AES-256-GCM)

All payment gateway API keys are encrypted before being stored in MongoDB:

```javascript
// Encrypt a credential
const crypto = require('crypto')

const encrypt = (plaintext, masterKey) => {
  const iv = crypto.randomBytes(16)
  const key = Buffer.from(masterKey, 'hex') // 32 bytes = 256 bits
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  let encrypted = cipher.update(plaintext, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  const authTag = cipher.getAuthTag().toString('hex')
  return { ciphertext: encrypted, iv: iv.toString('hex'), authTag }
}

// Decrypt a credential (in-memory only, for API calls)
const decrypt = (encryptedObj, masterKey) => {
  const key = Buffer.from(masterKey, 'hex')
  const iv = Buffer.from(encryptedObj.iv, 'hex')
  const authTag = Buffer.from(encryptedObj.authTag, 'hex')
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(authTag)
  let decrypted = decipher.update(encryptedObj.ciphertext, 'hex', 'utf8')
  decrypted += decipher.final('utf8')
  return decrypted
}
```

**Key points:**
- Each credential gets its own random IV (initialization vector) — even identical keys produce different ciphertexts
- GCM mode provides both encryption AND authentication (tamper detection)
- The `lastFour` field stores the last 4 characters of the key in plaintext for UI masking (e.g., `"c92b"`) — this is safe and standard practice

### 9.5.2 Audit Logging

Every credential-related action is logged to `AuditLog`:

| Event | Logged Fields |
|-------|---------------|
| Credential created | `actor`, `action: 'payment_key_created'`, `provider`, `keyType: 'secret'\|'public'`, `newKeyLast4`, `ipAddress`, `timestamp` |
| Credential updated | `actor`, `action: 'payment_key_updated'`, `provider`, `keyType`, `oldKeyLast4 → newKeyLast4`, `ipAddress`, `timestamp` |
| Credential deleted | `actor`, `action: 'payment_key_deleted'`, `provider`, `keyType`, `deletedKeyLast4`, `ipAddress`, `timestamp` |
| Provider toggled | `actor`, `action: 'payment_provider_toggled'`, `provider`, `enabled: true\|false`, `ipAddress`, `timestamp` |
| Default provider changed | `actor`, `action: 'payment_default_changed'`, `oldDefault → newDefault`, `ipAddress`, `timestamp` |
| Re-auth failed | `actor`, `action: 'payment_reauth_failed'`, `ipAddress`, `timestamp`, `failedAttemptCount` |

**Example audit log entry:**
```json
{
  "actor": "65a1b2c3d4e5f6a7b8c9d0e1",
  "actorEmail": "admin@aiinigeria.com",
  "action": "payment_key_updated",
  "details": {
    "provider": "paystack",
    "keyType": "secret",
    "change": "****9ea8 → ****c92b"
  },
  "ipAddress": "105.112.45.67",
  "userAgent": "Mozilla/5.0...",
  "timestamp": "2026-03-10T10:15:00Z"
}
```

### 9.5.3 Access Control & Rate Limiting

| Control | Implementation |
|---------|----------------|
| **Role check** | `requireRole('super_admin')` middleware on all `/admin/payment-settings` routes |
| **Re-authentication** | Password confirmation required before any credential write operation |
| **Rate limit (credential changes)** | Max 5 key changes per hour per account; returns `429 Too Many Requests` |
| **Rate limit (re-auth failures)** | Max 5 failed password attempts per hour; account locked for payment settings for 1 hour |
| **IP logging** | Every request to payment settings endpoints logs `req.ip` |
| **Session validation** | Active session required; credentials endpoint does NOT support API key auth |

---

## 10. Paystack Dashboard Configuration Guide

### 10.1 Test Mode Setup

1. Log in to [dashboard.paystack.com](https://dashboard.paystack.com)
2. Navigate to **Settings → API Keys & Webhooks**
3. Copy **Test Secret Key** → set as `PAYSTACK_SECRET_KEY` in `.env`
4. Copy **Test Public Key** → set as `PAYSTACK_PUBLIC_KEY` in `.env`
5. Set **Test Callback URL:** Leave blank (set dynamically per transaction via API)
6. Set **Test Webhook URL:** `https://learning.aiinigeria.com/api/simple-lms/payments/paystack/webhook`

### 10.2 Live Mode Setup

Same as above but use **Live** keys and URLs.

> [!CAUTION]
> **Never commit API keys to version control.** Store them in `.env` files that are in `.gitignore`. The screenshot shown during planning contains test keys — these should be rotated before production use.

---

## 11. Open Questions

1. **Default provider:** Should the default be Paystack or Flutterwave when both are enabled? **Recommendation:** Let the admin set this in the gateway settings.

2. **Provider preference persistence:** Should the learner's last-used provider be remembered for future purchases (e.g., via cookie), or should it reset to the admin default each time?

3. **Mixed cart:** If a learner has multiple cart items, should all items use the same provider, or can different items use different providers? **Recommendation:** All items in one cart checkout use the same provider.

4. **Provider-specific pricing:** Could different courses have different pricing depending on provider (e.g., to account for different transaction fees)? **Recommendation:** No — keep pricing provider-agnostic.

---

## 12. Implementation Phases

### Phase 1: Core Integration (Week 1)
- Create `paystackService.js`
- Extend `SimpleLmsPayment` model
- Create `SimpleLmsPlatformSettings` model
- Add Paystack callback + webhook routes

### Phase 2: Provider Selection (Week 2)
- Refactor `initiateCoursePaymentCheckout()` to accept provider
- Extract shared `finalizeSuccessfulPayment()`
- Add checkout provider selection UI
- Add admin gateway settings panel

### Phase 3: Testing & Polish (Week 3)
- Test both providers end-to-end (test mode)
- Test webhook verification for both
- Test admin toggle (enable/disable)
- Test two-domain callback handling
- Go live with Paystack in production
