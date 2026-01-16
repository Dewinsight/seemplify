# Development Environment Setup Plan

**Created:** January 14, 2026  
**Status:** 🚧 In Progress  
**Goal:** Complete dev/production environment separation with automatic deployments

---

## 📋 Overview

This document outlines the complete setup of a parallel development environment alongside the existing production infrastructure. The dev environment will:

- Deploy from `dev` branch automatically
- Use `-dev` suffix for all domains and databases
- Mirror local development environment naming conventions
- Provide complete isolation from production

---

## 🏗️ Current Production Infrastructure

### Applications (9 total)
| Application | Production URL | Database | Port |
|-------------|---------------|----------|------|
| Identity Provider | https://auth.seemplifyai.com | `identity` | 5008 |
| Recruiter Backend | https://api.seemplifyai.com | `smart_hr_db` | 5001 |
| Recruiter Frontend | https://app.seemplifyai.com | - | 5000 |
| Leave Backend | https://api-leave.seemplifyai.com | `leave-management` | 5002 |
| Leave Frontend | https://leave.seemplifyai.com | - | 5003 |
| Performance Backend | https://api-performance.seemplifyai.com | `performance_db` | 5004 |
| Performance Frontend | https://performance.seemplifyai.com | - | 5005 |
| Payroll Backend | https://api-payroll.seemplifyai.com | `payroll_db` | 5006 |
| Payroll Frontend | https://payroll.seemplifyai.com | - | 5007 |

### Infrastructure
- **Hosting:** Azure VM (4.180.153.209) - Standard_B2s (2 vCPU, 4 GB RAM)
- **Platform:** Dokploy (Docker-based PaaS)
- **Database:** MongoDB Atlas (shared cluster)
- **DNS:** Cloudflare (seemplifyai.com)
- **SSL:** Let's Encrypt (via Traefik)
- **CI/CD:** GitHub Actions (auto-deploy on main branch)

---

## 🎯 Target Development Environment

### Dev Applications (9 total)
| Application | Dev URL | Database | Port |
|-------------|---------|----------|------|
| Identity Provider (Dev) | https://auth-dev.seemplifyai.com | `identity-dev` | TBD |
| Recruiter Backend (Dev) | https://api-dev.seemplifyai.com | `smart_hr_db-dev` | TBD |
| Recruiter Frontend (Dev) | https://app-dev.seemplifyai.com | - | TBD |
| Leave Backend (Dev) | https://api-leave-dev.seemplifyai.com | `leave-management-dev` | TBD |
| Leave Frontend (Dev) | https://leave-dev.seemplifyai.com | - | TBD |
| Performance Backend (Dev) | https://api-performance-dev.seemplifyai.com | `performance_db-dev` | TBD |
| Performance Frontend (Dev) | https://performance-dev.seemplifyai.com | - | TBD |
| Payroll Backend (Dev) | https://api-payroll-dev.seemplifyai.com | `payroll_db-dev` | TBD |
| Payroll Frontend (Dev) | https://payroll-dev.seemplifyai.com | - | TBD |

### Environment Specifications
- **Same Azure VM:** 4.180.153.209 (will need resource monitoring)
- **Same Dokploy:** Separate applications with `-dev` suffix
- **Separate Databases:** MongoDB Atlas with `-dev` suffix
- **Separate DNS:** Cloudflare entries with `-dev` in subdomain
- **Separate Branch:** `dev` branch in Git repository
- **Separate Workflows:** GitHub Actions for dev branch

---

## 📝 Implementation Phases

### Phase 1: Infrastructure Assessment ✅
**Goal:** Ensure Azure VM can handle doubled capacity

**Tasks:**
- [ ] Check current VM resource usage (CPU, RAM, Disk)
- [ ] Review Dokploy container resource limits
- [ ] Determine if VM upgrade needed
- [ ] Plan resource allocation for dev containers

**Decision Point:** Upgrade VM or optimize container resources?

---

### Phase 2: Database Setup 🔄
**Goal:** Create isolated dev databases in MongoDB Atlas

**Tasks:**
- [ ] Access MongoDB Atlas dashboard
- [ ] Create new databases with `-dev` suffix:
  - `identity-dev`
  - `smart_hr_db-dev`
  - `leave-management-dev`
  - `performance_db-dev`
  - `payroll_db-dev`
- [ ] Configure database users/permissions (use same credentials or separate?)
- [ ] Test connectivity from Azure VM to dev databases
- [ ] Document connection strings

**Connection String Pattern:**
```
mongodb+srv://tonyegbo1:IHjykby58BtH5zyC@cluster0.8hdkzxw.mongodb.net/<database-name-dev>?retryWrites=true&w=majority&appName=Cluster0
```

**Cost Consideration:** Dev databases will increase MongoDB Atlas costs

---

### Phase 3: DNS Configuration 🔄
**Goal:** Set up Cloudflare DNS for all dev domains

**Cloudflare Details:**
- Zone: `seemplifyai.com`
- Zone ID: `bbc142d2d661d64011e2e4becae7a5c3`
- API Token: `s3BUpfG8KqcRoxVgwmyCSqJ3ho3R_ClCEpI4tEXJ`

**DNS Records to Create (9 A/CNAME records):**
```
auth-dev.seemplifyai.com          -> 4.180.153.209
api-dev.seemplifyai.com           -> 4.180.153.209
app-dev.seemplifyai.com           -> 4.180.153.209
api-leave-dev.seemplifyai.com     -> 4.180.153.209
leave-dev.seemplifyai.com         -> 4.180.153.209
api-performance-dev.seemplifyai.com -> 4.180.153.209
performance-dev.seemplifyai.com   -> 4.180.153.209
api-payroll-dev.seemplifyai.com   -> 4.180.153.209
payroll-dev.seemplifyai.com       -> 4.180.153.209
```

**Tasks:**
- [ ] Create Cloudflare API script for bulk DNS creation
- [ ] Execute DNS record creation
- [ ] Verify DNS propagation (nslookup)
- [ ] Enable Cloudflare proxy (orange cloud) for DDoS protection

---

### Phase 4: Dokploy Dev Apps Setup (Pilot) 🔄
**Goal:** Create first dev app as a test before rolling out to all

**Pilot Application:** Identity Provider (simplest, least dependencies)

**Tasks:**
- [ ] Access Dokploy dashboard (http://4.180.153.209:3000)
- [ ] Create new application: `identity-provider-dev`
- [ ] Configure Git repository (same repo, will use dev branch later)
- [ ] Set build path: `Identityprovider/`
- [ ] Configure environment variables for dev:
  ```env
  NODE_ENV=development
  MONGO_URI=mongodb+srv://...../identity-dev?...
  JWT_SECRET=<separate-dev-secret>
  # All other vars...
  ```
- [ ] Set domain: `auth-dev.seemplifyai.com`
- [ ] Deploy and test
- [ ] Verify SSL certificate generation
- [ ] Verify application starts successfully
- [ ] Document any issues or learnings

**Success Criteria:** https://auth-dev.seemplifyai.com is accessible and working

---

### Phase 5: Dokploy Dev Apps Setup (Full Rollout) 🔄
**Goal:** Create remaining 8 dev applications

**Applications to Create:**
1. `recruiter-backend-dev` → api-dev.seemplifyai.com
2. `recruiter-frontend-dev` → app-dev.seemplifyai.com
3. `leave-backend-dev` → api-leave-dev.seemplifyai.com
4. `leave-frontend-dev` → leave-dev.seemplifyai.com
5. `performance-backend-dev` → api-performance-dev.seemplifyai.com
6. `performance-frontend-dev` → performance-dev.seemplifyai.com
7. `payroll-backend-dev` → api-payroll-dev.seemplifyai.com
8. `payroll-frontend-dev` → payroll-dev.seemplifyai.com

**For Each Application:**
- [ ] Create application in Dokploy
- [ ] Configure build path (same as production)
- [ ] Set dev domain
- [ ] Configure environment variables (dev databases, dev API URLs)
- [ ] Deploy and verify
- [ ] Note the Application ID (needed for GitHub Actions)

**Critical: Inter-Service URLs**

Frontends must point to dev backends:
```env
# Recruiter Frontend Dev
NEXT_PUBLIC_API_URL=https://api-dev.seemplifyai.com
NEXT_PUBLIC_IDP_URL=https://auth-dev.seemplifyai.com

# Similar for other frontends
```

---

### Phase 6: Git Branch Strategy 🔄
**Goal:** Set up dev branch and branching workflow

**Tasks:**
- [ ] Create `dev` branch from `main`
  ```bash
  git checkout main
  git pull
  git checkout -b dev
  git push -u origin dev
  ```
- [ ] Set up branch protection rules for `dev` (optional)
- [ ] Document branching workflow
- [ ] Create merge strategy documentation

**Recommended Workflow:**
```
feature branches → dev (PR & review) → main (PR & review)
                    ↓                    ↓
                dev environment      production
```

---

### Phase 7: GitHub Actions Workflows (Dev) 🔄
**Goal:** Create automated deployments for dev branch

**Tasks:**
- [ ] Create 9 new workflow files in `.github/workflows/`:
  - `deploy-identity-provider-dev.yml`
  - `deploy-recruiter-backend-dev.yml`
  - `deploy-recruiter-frontend-dev.yml`
  - `deploy-leave-backend-dev.yml`
  - `deploy-leave-frontend-dev.yml`
  - `deploy-performance-backend-dev.yml`
  - `deploy-performance-frontend-dev.yml`
  - `deploy-payroll-backend-dev.yml`
  - `deploy-payroll-frontend-dev.yml`

**Workflow Template (example for recruiter-backend-dev):**
```yaml
name: Deploy Recruiter Backend (Dev)

on:
  push:
    branches: [dev]  # Changed from main
    paths:
      - 'recruiter/backend/**'
      - '.github/workflows/deploy-recruiter-backend-dev.yml'
  workflow_dispatch:

env:
  APP_NAME: recruiter-backend-dev
  APP_PATH: recruiter/backend

jobs:
  deploy:
    name: Deploy to Dokploy (Dev)
    runs-on: ubuntu-latest
    
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Trigger Dokploy Deployment
        run: |
          response=$(curl -s -w "%{http_code}" -o /tmp/response.txt -X POST "${{ secrets.DOKPLOY_URL }}/api/application.deploy" \
            -H "x-api-key: ${{ secrets.DOKPLOY_TOKEN }}" \
            -H "Content-Type: application/json" \
            -H "accept: application/json" \
            -d '{"applicationId": "${{ secrets.RECRUITER_BACKEND_DEV_APP_ID }}"}')
          
          if [ "$response" -eq 200 ]; then
            echo "✅ Dev ${{ env.APP_NAME }} deployment triggered successfully (HTTP $response)"
            cat /tmp/response.txt 2>/dev/null || true
          else
            echo "❌ Dev deployment failed with HTTP status code: $response"
            cat /tmp/response.txt 2>/dev/null || true
            exit 1
          fi
```

**Key Changes from Production Workflows:**
- Trigger on `dev` branch instead of `main`
- Use `*_DEV_APP_ID` secrets instead of production IDs
- Update names to indicate dev environment

---

### Phase 8: GitHub Secrets Configuration 🔄
**Goal:** Set up GitHub secrets for dev app deployments

**Required Secrets (9 new ones):**
```
IDENTITY_PROVIDER_DEV_APP_ID=<from-dokploy>
RECRUITER_BACKEND_DEV_APP_ID=<from-dokploy>
RECRUITER_FRONTEND_DEV_APP_ID=<from-dokploy>
LEAVE_BACKEND_DEV_APP_ID=<from-dokploy>
LEAVE_FRONTEND_DEV_APP_ID=<from-dokploy>
PERFORMANCE_BACKEND_DEV_APP_ID=<from-dokploy>
PERFORMANCE_FRONTEND_DEV_APP_ID=<from-dokploy>
PAYROLL_BACKEND_DEV_APP_ID=<from-dokploy>
PAYROLL_FRONTEND_DEV_APP_ID=<from-dokploy>
```

**How to Set:**
```bash
gh secret set IDENTITY_PROVIDER_DEV_APP_ID --body "<app-id-from-dokploy>"
# Repeat for each app
```

**Tasks:**
- [ ] Get Application IDs from Dokploy for all 9 dev apps
- [ ] Set GitHub secrets
- [ ] Verify secrets are accessible in workflows

---

### Phase 9: Local Development Configuration 🔄
**Goal:** Update local environment to support dev/prod switching

**Tasks:**
- [ ] Update all `.env.example` files with dev database examples
- [ ] Create `.env.dev` template files (optional)
- [ ] Create local environment switcher script
- [ ] Document how to switch between dev and prod locally
- [ ] Update README files with dev environment instructions

**Example .env Configuration:**
```env
# Development (default for local)
NODE_ENV=development
MONGO_URI=mongodb+srv://...../smart_hr_db-dev?...

# Production (for testing prod locally - use with caution)
# NODE_ENV=production
# MONGO_URI=mongodb+srv://...../smart_hr_db?...
```

**Switcher Script (PowerShell):**
```powershell
# switch-env.ps1
param([string]$env = "dev")

if ($env -eq "dev") {
    # Copy .env.dev to .env
} elseif ($env -eq "prod") {
    # Copy .env.prod to .env
}
```

---

### Phase 10: Documentation 🔄
**Goal:** Create comprehensive documentation for the new setup

**Documents to Create:**
1. **BRANCHING-STRATEGY.md** - Git workflow and merge process
2. **DEPLOYMENT-WORKFLOW.md** - How deployments work for dev vs prod
3. **ENVIRONMENT-VARIABLES.md** - Complete list of env vars for both environments
4. **DEV-ENVIRONMENT-GUIDE.md** - Developer guide for using dev environment
5. **TROUBLESHOOTING-DEV.md** - Common issues and solutions
6. **Update existing docs** - Update README, deployment guides, etc.

---

### Phase 11: Testing & Validation 🔄
**Goal:** Verify complete end-to-end functionality

**Test Scenarios:**

**1. Dev Branch Deployment:**
- [ ] Make a small change in `recruiter/backend/` on dev branch
- [ ] Commit and push to dev branch
- [ ] Verify GitHub Actions workflow triggers
- [ ] Verify Dokploy deploys the application
- [ ] Verify changes appear at https://api-dev.seemplifyai.com

**2. Main Branch Deployment (verify prod still works):**
- [ ] Make a small change in `recruiter/backend/` on main branch
- [ ] Commit and push to main branch
- [ ] Verify GitHub Actions workflow triggers
- [ ] Verify Dokploy deploys to production app
- [ ] Verify changes appear at https://api.seemplifyai.com

**3. Database Isolation:**
- [ ] Create test data in dev database
- [ ] Verify data does NOT appear in production
- [ ] Create test data in production database
- [ ] Verify data does NOT appear in dev

**4. Inter-Service Communication (Dev):**
- [ ] Test recruiter frontend (dev) → recruiter backend (dev)
- [ ] Test authentication flow with identity provider (dev)
- [ ] Verify all API calls stay within dev environment

**5. SSL/TLS:**
- [ ] Verify all -dev domains have valid SSL certificates
- [ ] Check certificate auto-renewal is configured

**6. Performance:**
- [ ] Monitor Azure VM resources with both environments running
- [ ] Check for any performance degradation
- [ ] Verify no resource conflicts between dev and prod

---

## 🔐 Security Considerations

### Separate Secrets (Recommended)
- Dev environment should have separate JWT secrets
- Separate API keys for external services (if applicable)
- Separate database credentials (optional but recommended)

### Access Control
- Consider restricting dev environment access (IP whitelist, VPN, basic auth)
- Dev environment data should be treated as sensitive (may contain prod-like data)

### Data Management
- Implement data retention policy for dev databases
- Regular cleanup of dev databases to reduce costs
- Never copy production data to dev without anonymization

---

## 💰 Cost Implications

### Azure VM
- **Current:** Standard_B2s (~$34/month)
- **With Dev:** May need upgrade to Standard_B4ms (~$125/month)
- **Alternative:** Optimize container resources to fit in current VM

### MongoDB Atlas
- **Current:** Shared cluster (~$0-60/month depending on usage)
- **With Dev:** Additional databases will increase storage and operation costs
- **Estimate:** +$20-40/month

### Cloudflare
- **No additional cost** (DNS records are free)

### Total Estimated Additional Cost: $20-100/month

---

## 📊 Resource Monitoring

### VM Resources to Monitor:
```bash
# SSH into VM
ssh seemplify@4.180.153.209

# Check current resource usage
docker stats

# Check disk usage
df -h

# Check memory usage
free -h

# Check overall system resources
htop
```

### Optimization Strategies if Resources are Tight:
1. Set container memory limits in Dokploy
2. Use Alpine-based Docker images (smaller)
3. Share resources between dev apps (lower priority)
4. Implement auto-stop for dev environment during non-business hours
5. Upgrade VM if necessary

---

## ✅ Success Criteria

The implementation is complete when:

1. ✅ All 9 dev applications are deployed and accessible
2. ✅ All -dev domains have valid SSL certificates
3. ✅ Dev branch pushes trigger automatic deployments to dev environment
4. ✅ Main branch pushes trigger automatic deployments to production
5. ✅ Dev and production databases are completely isolated
6. ✅ Inter-service communication works within each environment
7. ✅ Local development can easily switch between dev and prod
8. ✅ All documentation is complete and up-to-date
9. ✅ Team can develop on dev, merge to main for production release
10. ✅ No manual intervention needed for deployments

---

## 🚀 Rollback Plan

If issues arise:

1. **Immediate:** Disable dev workflows (comment out triggers)
2. **Database:** Dev databases can be deleted without affecting production
3. **Dokploy Apps:** Dev applications can be stopped/deleted independently
4. **DNS:** Remove -dev DNS records from Cloudflare
5. **Git:** Dev branch remains, just don't merge or deploy from it
6. **No Production Impact:** All changes are additive, production remains untouched

---

## 📅 Implementation Timeline

**Estimated Time:** 4-6 hours for complete setup

| Phase | Time Estimate | Dependencies |
|-------|---------------|--------------|
| Phase 1: Assessment | 30 min | None |
| Phase 2: Databases | 30 min | None |
| Phase 3: DNS | 30 min | None |
| Phase 4: Pilot App | 45 min | Phases 2, 3 |
| Phase 5: Full Rollout | 1.5 hours | Phase 4 |
| Phase 6: Git Branch | 15 min | None |
| Phase 7: Workflows | 45 min | Phase 5 |
| Phase 8: Secrets | 15 min | Phase 5, 7 |
| Phase 9: Local Config | 30 min | None |
| Phase 10: Docs | 1 hour | All above |
| Phase 11: Testing | 1 hour | All above |

---

## 📝 Notes

- This setup provides true dev/prod parity
- Development changes are tested in production-like environment before going live
- Team can work on dev branch without affecting production
- Automatic deployments reduce manual errors and save time
- Clear separation reduces risk of accidental production changes

---

**Next Steps:** Begin with Phase 1 (Assessment) and proceed sequentially.
