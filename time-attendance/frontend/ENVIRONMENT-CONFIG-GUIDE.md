# Environment Configuration Guide

**Purpose:** Prevent localhost redirects in production by using centralized environment detection.

---

## ✅ Solution Overview

We've implemented a **centralized environment detection utility** (`lib/env.ts`) that:

1. **Automatically detects production** based on hostname
2. **Always uses production URLs** when on `seemplifyai.com` domain
3. **Prevents localhost fallbacks** in production
4. **Validates at runtime** to catch issues early

---

## 📚 Usage

### Import the Utility

```typescript
import { getApiUrl, getIdpUrl, isProduction, isLocalDevelopment } from '@/lib/env';
```

### Get API URL

```typescript
// ✅ CORRECT - Uses centralized detection
const apiUrl = getApiUrl();

// ❌ WRONG - Don't use direct env vars with localhost fallback
const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5010/api';
```

### Get IDP URL

```typescript
// ✅ CORRECT
const idpUrl = getIdpUrl();

// ❌ WRONG
const idpUrl = process.env.NEXT_PUBLIC_IDP_URL || 'http://localhost:4000';
```

### Check Environment

```typescript
if (isProduction()) {
    // Production-specific logic
}

if (isLocalDevelopment()) {
    // Local development-specific logic
}
```

---

## 🚫 What NOT to Do

### ❌ Don't Use Direct Env Vars with Localhost Fallback

```typescript
// ❌ BAD - Can accidentally use localhost in production
const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5010/api';
```

### ❌ Don't Hardcode URLs

```typescript
// ❌ BAD - Hardcoded URL
const apiUrl = 'https://api-time.seemplifyai.com/api';
```

### ✅ Always Use the Utility

```typescript
// ✅ GOOD - Uses centralized detection
import { getApiUrl } from '@/lib/env';
const apiUrl = getApiUrl();
```

---

## 🔧 How It Works

### Production Detection

The utility checks:
1. **Hostname** - If `hostname.includes('seemplifyai.com')` → Production
2. **NODE_ENV** - If `NODE_ENV === 'production'` → Production
3. **Dev subdomain** - If hostname includes `-dev` → Dev environment

### URL Selection

1. **Production** → Always returns production URLs (hardcoded)
2. **Local Development** → Uses env var or localhost fallback
3. **Dev Environment** → Uses env var or production fallback

### Runtime Validation

The utility automatically validates URLs on module load:
- Checks for localhost in production
- Logs errors if validation fails
- Helps catch issues early

---

## 🧪 Testing

### Test Production Detection

```typescript
import { isProduction, getApiUrl } from '@/lib/env';

// In production (seemplifyai.com)
console.log(isProduction()); // true
console.log(getApiUrl()); // 'https://api-time.seemplifyai.com/api'

// In local development
console.log(isProduction()); // false
console.log(getApiUrl()); // 'http://localhost:5010/api' (or env var)
```

### Validate Build

```bash
# Run validation script
npm run validate:production

# Or as part of build
npm run build:validate
```

---

## 🛡️ Safeguards

### 1. Centralized Utility

All environment detection goes through `lib/env.ts`:
- Single source of truth
- Consistent behavior
- Easy to update

### 2. Build-Time Validation

GitHub Actions workflow checks:
- No hardcoded localhost in production code
- Validates before deployment

### 3. Runtime Validation

Automatic validation on module load:
- Catches issues early
- Logs errors in console
- Prevents silent failures

### 4. Type Safety

TypeScript ensures:
- Correct function signatures
- Type checking
- IDE autocomplete

---

## 📝 Migration Checklist

When adding new code that needs environment detection:

- [ ] Import from `@/lib/env` instead of using `process.env` directly
- [ ] Use `getApiUrl()` for API URLs
- [ ] Use `getIdpUrl()` for IDP URLs
- [ ] Test in both local and production environments
- [ ] Verify no localhost fallbacks in production code

---

## 🔍 Troubleshooting

### Issue: Still seeing localhost in production

**Check:**
1. Are you using `getApiUrl()` from `@/lib/env`?
2. Is the build using correct build arguments?
3. Check browser console for validation errors

**Fix:**
1. Replace direct `process.env` usage with utility functions
2. Verify Dokploy build arguments are set
3. Rebuild and redeploy

### Issue: Validation script fails

**Check:**
1. Are there any hardcoded localhost URLs?
2. Are you using the utility functions?

**Fix:**
1. Replace hardcoded URLs with utility functions
2. Run `npm run validate:production` to check

---

## 📚 Related Files

- `lib/env.ts` - Environment detection utility
- `scripts/validate-production-build.js` - Build validation script
- `.github/workflows/deploy-time-attendance-frontend.yml` - CI/CD validation

---

**Last Updated:** January 27, 2026  
**Status:** ✅ Active
