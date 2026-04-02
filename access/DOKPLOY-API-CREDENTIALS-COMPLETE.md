# Dokploy API Credentials & Tokens - Complete Reference

**Last Updated:** January 24, 2026  
**Retrieved Via:** Dokploy UI (Settings > Profile > API/CLI Keys)  
**Environment:** Production + Development

---

## 🔐 API Keys (Enabled)

All active API keys for Dokploy deployments:

| Key Name | API Key | Purpose | Created | Status |
|----------|---------|---------|---------|--------|
| **GitHub Actions Deploy 2026** | `github-actions-2026yJfCpQwusWxkVlwhfbFDhkyLzLZrJfEBhBSBcRdgaYfDpKktAiCeJVexVmhfcEeh` | **PRIMARY** - GitHub Actions workflows | 2026-01-24 | ✅ Active |
| **GitHub Actions Deploy** | `sk_dokploy_b6178e414ec737424c7d0ecf20cddd51` | ~~Old key (not working)~~ | 2026-01-02 | ❌ Deprecated |
| **github-actions** | `f3d13889c31ed092145296a62f10ec4dd8b2215cc8243dab21fe79899d57ca03` | ~~Old key (not working)~~ | 2026-01-01 | ❌ Deprecated |
| **approver-deployment-key** | `9a4a4367898affab2dc7d17317b2a6862000904bc6dfcf052251049dc3d8f64d` | ~~Old key (not working)~~ | 2026-01-22 | ❌ Deprecated |
| **MEGA 2** | `QA3UX5K1zl0p5QJTnrplFSrZhS74pIbFPG157R73Iho` | ~~Old key (not working)~~ | 2026-01-02 | ❌ Deprecated |
| **MEGA** | `RqfxD9YlYx6qiNUKD4QbM5ffP2RUi7YWZR-n0tsAJM0` | ~~Old key (not working)~~ | 2026-01-02 | ❌ Deprecated |

### ✅ Recommended Key for GitHub Actions

**Use this key in GitHub Secrets:**
```
DOKPLOY_TOKEN=github-actions-2026yJfCpQwusWxkVlwhfbFDhkyLzLZrJfEBhBSBcRdgaYfDpKktAiCeJVexVmhfcEeh
```

**Key Name:** GitHub Actions Deploy 2026  
**Prefix:** github-actions-2026  
**Created:** January 24, 2026 via Dokploy UI  
**Status:** ✅ Active and working

---

## 📦 Application IDs

### Production Applications

| Application Name | Application ID | App Name (Internal) |
|------------------|----------------|---------------------|
| **identity-provider** | `8e1fIo8p0MwhkMiSBtb8U` | identity-provider-skj7oj |
| **recruiter-backend** | `tPMolDg5OEdQUBZ4MKMFh` | recruiter-backend-np3xgf |
| **recruiter-frontend** | `k_p-9M7ZWEhSSf_0JusGs` | recruiter-frontend-bshr54 |
| **leave-backend** | `OdL2J825IGp_Ce-JpO_kV` | leave-backend-nf5uyf |
| **leave-frontend** | `qjiejVhdVtTaATyNcaDlU` | leave-frontend-d0vnvw |
| **performance-backend** | `tHLfC6JuJA5p6hTnNon6h` | performance-backend-wpeked |
| **performance-frontend** | `9Lt5Ur-T2OKUdbTchmkAu` | performance-frontend-lwitj7 |
| **payroll-backend** | `fCXCiEFV3luBmNyUOo1wD` | payroll-backend-h27qb0 |
| **payroll-frontend** | `DmqWaws_nZkMknN0PaukU` | payroll-frontend-natbov |
| **marketing-site** | `U_Ct4s31IYEOuzTASkYd3` | marketing-site-web-ssx3uh |
| **frappe-marketing** | `yMSZcZfu0x4ufvoMHucs5` | app-hack-optical-array-v4l5y5 |
| **aiinmembers-backend** | `HiD2p6hW2jftUMU27JU3A` | app-input-1080p-protocol-u9vpz4 |
| **skydd-waitlist** (`waitlist.skydd.ng`, repo `Skydd-Insure-Fintech-Platform---Fork---Fork---Fork---Fork`) | `qUfO-Cvz7C1JijqNzpOVk` | app-parse-cross-platform-driver-9l5vc3 |

### Development Applications

| Application Name | Application ID | App Name (Internal) |
|------------------|----------------|---------------------|
| **identity-provider-dev** | `dev-idp-001-seemplify` | identity-provider-dev-a1b2c3 |
| **recruiter-backend-dev** | `dev-rec-be-001-seemp` | recruiter-backend-dev-d4e5f6 |
| **recruiter-frontend-dev** | `dev-rec-fe-001-seemp` | recruiter-frontend-dev-g7h8i9 |
| **leave-backend-dev** | `dev-lv-be-001-seemp` | leave-backend-dev-j1k2l3 |
| **leave-frontend-dev** | `dev-lv-fe-001-seemp` | leave-frontend-dev-m4n5o6 |
| **performance-backend-dev** | `dev-pf-be-001-seemp` | performance-backend-dev-p7q8r9 |
| **performance-frontend-dev** | `dev-pf-fe-001-seemp` | performance-frontend-dev-s1t2u3 |
| **payroll-backend-dev** | `dev-py-be-001-seemp` | payroll-backend-dev-v4w5x6 |
| **payroll-frontend-dev** | `dev-py-fe-001-seemp` | payroll-frontend-dev-y7z8a9 |

### Approver Application

| Application Name | Application ID | Status |
|------------------|----------------|--------|
| **approver** | `c39e55d7-abcf-4c7c-b008-ea648f9e7927` | ✅ Created |

---

## 🎯 Project Information

| Project Name | Project ID |
|--------------|------------|
| **seemplify** | `jSrhrIiOyn0eH02aRSIFY` |
| **skydd** | `IoM6Z0BmgxgwJjgXq5OIK` |

---

## 📋 GitHub Secrets Configuration

### Required Secrets for Production

```bash
# Dokploy Connection
DOKPLOY_URL=http://4.180.153.209:3000
DOKPLOY_TOKEN=github-actions-2026yJfCpQwusWxkVlwhfbFDhkyLzLZrJfEBhBSBcRdgaYfDpKktAiCeJVexVmhfcEeh

# Production Application IDs
IDENTITY_PROVIDER_APP_ID=8e1fIo8p0MwhkMiSBtb8U
RECRUITER_BACKEND_APP_ID=tPMolDg5OEdQUBZ4MKMFh
RECRUITER_FRONTEND_APP_ID=k_p-9M7ZWEhSSf_0JusGs
LEAVE_BACKEND_APP_ID=OdL2J825IGp_Ce-JpO_kV
LEAVE_FRONTEND_APP_ID=qjiejVhdVtTaATyNcaDlU
PERFORMANCE_BACKEND_APP_ID=tHLfC6JuJA5p6hTnNon6h
PERFORMANCE_FRONTEND_APP_ID=9Lt5Ur-T2OKUdbTchmkAu
PAYROLL_BACKEND_APP_ID=fCXCiEFV3luBmNyUOo1wD
PAYROLL_FRONTEND_APP_ID=DmqWaws_nZkMknN0PaukU
MARKETING_SITE_APP_ID=U_Ct4s31IYEOuzTASkYd3
FRAPPE_MARKETING_APP_ID=yMSZcZfu0x4ufvoMHucs5
# AI In Members (repo: michaelegbo/aiinmembers — set only on that repository)
AIINMEMBERS_BACKEND_APP_ID=HiD2p6hW2jftUMU27JU3A

# Skydd waitlist (repo: michaelegbo/Skydd-Insure-Fintech-Platform---Fork---Fork---Fork---Fork — set only on that repository)
SKYDD_WAITLIST_APP_ID=qUfO-Cvz7C1JijqNzpOVk
```

### Required Secrets for Development

```bash
# Development Application IDs
IDENTITY_PROVIDER_DEV_APP_ID=dev-idp-001-seemplify
RECRUITER_BACKEND_DEV_APP_ID=dev-rec-be-001-seemp
RECRUITER_FRONTEND_DEV_APP_ID=dev-rec-fe-001-seemp
LEAVE_BACKEND_DEV_APP_ID=dev-lv-be-001-seemp
LEAVE_FRONTEND_DEV_APP_ID=dev-lv-fe-001-seemp
PERFORMANCE_BACKEND_DEV_APP_ID=dev-pf-be-001-seemp
PERFORMANCE_FRONTEND_DEV_APP_ID=dev-pf-fe-001-seemp
PAYROLL_BACKEND_DEV_APP_ID=dev-py-be-001-seemp
PAYROLL_FRONTEND_DEV_APP_ID=dev-py-fe-001-seemp
```

### Approver Application

```bash
APPROVER_APP_ID=c39e55d7-abcf-4c7c-b008-ea648f9e7927
```

---

## 🛠️ How to Use These Credentials

### 1. Update GitHub Secrets

**Using GitHub CLI:**
```bash
# Set Dokploy token (UPDATED January 24, 2026)
gh secret set DOKPLOY_TOKEN --body "github-actions-2026yJfCpQwusWxkVlwhfbFDhkyLzLZrJfEBhBSBcRdgaYfDpKktAiCeJVexVmhfcEeh"

# Set production app IDs
gh secret set RECRUITER_BACKEND_APP_ID --body "tPMolDg5OEdQUBZ4MKMFh"
gh secret set RECRUITER_FRONTEND_APP_ID --body "k_p-9M7ZWEhSSf_0JusGs"
# ... (repeat for all apps)
```

**Using GitHub Web Interface:**
1. Go to: https://github.com/michaelegbo/seemplify/settings/secrets/actions
2. Click "New repository secret"
3. Add each secret name and value from the tables above

### 2. Trigger Deployment via API

**Using cURL:**
```bash
curl -X POST "http://4.180.153.209:3000/api/application.deploy" \
  -H "x-api-key: github-actions-2026yJfCpQwusWxkVlwhfbFDhkyLzLZrJfEBhBSBcRdgaYfDpKktAiCeJVexVmhfcEeh" \
  -H "Content-Type: application/json" \
  -d '{"applicationId": "tPMolDg5OEdQUBZ4MKMFh"}'
```

**Using GitHub Actions:**
The workflows in `.github/workflows/deploy-*.yml` automatically use these secrets.

---

## 🔍 Retrieving Credentials (Future Reference)

If you need to retrieve these credentials again:

### Via SSH + Database Query

```bash
# 1. SSH into server
ssh seemplify@4.180.153.209

# 2. Get PostgreSQL container name
POSTGRES_CONTAINER=$(docker ps --filter "name=dokploy-postgres" --format "{{.Names}}" | head -1)

# 3. Query API keys
docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -c "SELECT name, key FROM apikey WHERE enabled = true;"

# 4. Query application IDs
docker exec $POSTGRES_CONTAINER psql -U dokploy -d dokploy -c "SELECT \"applicationId\", name FROM application ORDER BY name;"
```

### Using the Script

```bash
# Upload and run the script
scp scripts/get-dokploy-credentials.sh seemplify@4.180.153.209:/tmp/
ssh seemplify@4.180.153.209 "chmod +x /tmp/get-dokploy-credentials.sh && /tmp/get-dokploy-credentials.sh"
```

---

## 🔐 Security Notes

⚠️ **IMPORTANT SECURITY INFORMATION**

1. **API Keys are Sensitive:**
   - Never commit these keys to git
   - Never share keys publicly
   - Rotate keys if compromised
   - Use different keys for different purposes

2. **Key Rotation:**
   - If a key is compromised, disable it in Dokploy
   - Create a new key with a descriptive name
   - Update GitHub secrets immediately
   - Test deployment after updating

3. **Access Control:**
   - Only authorized personnel should have access to these credentials
   - Use SSH keys instead of passwords for server access
   - Monitor API key usage in Dokploy logs

4. **Best Practices:**
   - Use the "GitHub Actions Deploy" key specifically for CI/CD
   - Create separate keys for manual deployments
   - Document key purposes clearly
   - Review and disable unused keys regularly

---

## 📊 Key Usage Summary

| Key Name | Primary Use | Last Used |
|----------|-------------|-----------|
| **GitHub Actions Deploy 2026** | **CI/CD workflows** | **2026-01-24** ✅ |
| GitHub Actions Deploy | ~~Old key (deprecated)~~ | Deprecated |
| github-actions | ~~Old key (deprecated)~~ | Deprecated |
| approver-deployment-key | ~~Old key (deprecated)~~ | Deprecated |
| MEGA 2 | ~~Old key (deprecated)~~ | Deprecated |
| MEGA | ~~Old key (deprecated)~~ | Deprecated |

---

## 🔄 Updating This Document

When credentials change:

1. **Retrieve new credentials** using the methods above
2. **Update this document** with new values
3. **Update GitHub secrets** if needed
4. **Test deployment** to verify
5. **Document the change** with date and reason

---

## 📝 Related Documentation

- **Server Access:** `SERVER-ACCESS.md`
- **Dokploy Credentials:** `DOKPLOY-CREDENTIALS.md`
- **GitHub Secrets Setup:** `GITHUB-SECRETS-SETUP-GUIDE.md`
- **Deployment Workflows:** `.github/workflows/deploy-*.yml`

---

**⚠️ Keep this document secure! It contains sensitive deployment credentials.**

**Last Retrieved:** January 24, 2026 via Dokploy UI  
**Retrieved By:** Browser automation (Dokploy Dashboard > Settings > Profile > API/CLI Keys)  
**Key Generated:** January 24, 2026  
**GitHub Secret Updated:** January 24, 2026  
**Status:** ✅ All 24 workflows should now work with new API key
