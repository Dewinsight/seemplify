# GitHub Actions Auto-Deployment Setup

## ✅ YES! All Apps Auto-Deploy on Push

When you push code to GitHub, it will **automatically deploy** to your Dokploy server. No manual deployment needed!

## How It Works

### 1. **Push Trigger**
Each app has a GitHub Actions workflow that watches its specific folder:
- Push to `recruiter/frontend/**` → Auto-deploys Recruiter Frontend
- Push to `recruiter/backend/**` → Auto-deploys Recruiter Backend
- Push to `leave-management/frontend/**` → Auto-deploys Leave Frontend
- Push to `payroll/backend/**` → Auto-deploys Payroll Backend
- etc.

### 2. **Automatic Deployment**
GitHub Actions automatically:
- Detects the change
- Triggers Dokploy deployment via API
- Dokploy pulls latest code from GitHub
- Builds Docker container
- Deploys to production
- Updates your live site

### 3. **Build Time**
- Small changes: ~2-3 minutes
- Large changes (deps): ~4-5 minutes

## Configured Workflows

All these apps have auto-deployment enabled:

### ✅ Frontends
- **Recruiter Frontend** (`recruiter/frontend/`)
  - URL: https://app.seemplifyai.com
  - Workflow: `.github/workflows/deploy-recruiter-frontend.yml`

- **Leave Frontend** (`leave-management/frontend/`)
  - URL: https://leave.seemplifyai.com
  - Workflow: `.github/workflows/deploy-leave-frontend.yml`

- **Performance Frontend** (`performance/frontend/`)
  - URL: https://performance.seemplifyai.com
  - Workflow: `.github/workflows/deploy-performance-frontend.yml`

- **Payroll Frontend** (`payroll/frontend/`)
  - URL: https://payroll.seemplifyai.com
  - Workflow: `.github/workflows/deploy-payroll-frontend.yml`

- **Marketing Site** (`marketing-site/`)
  - URL: https://www.seemplifyai.com
  - Workflow: `.github/workflows/deploy-marketing-site.yml`

### ✅ Backends
- **Recruiter Backend** (`recruiter/backend/`)
- **Leave Backend** (`leave-management/backend/`)
- **Performance Backend** (`performance/backend/`)
- **Payroll Backend** (`payroll/backend/`)
- **Identity Provider** (`Identityprovider/`)
  - URL: https://auth.seemplifyai.com

## Example Workflow

**You make a change:**
```bash
# Edit a file
code recruiter/frontend/app/page.tsx

# Commit and push
git add .
git commit -m "Update homepage design"
git push origin main
```

**What happens automatically:**
1. ✅ GitHub receives your push
2. ✅ Workflow triggers (within 10 seconds)
3. ✅ Calls Dokploy API to deploy
4. ✅ Dokploy pulls latest code
5. ✅ Builds new Docker container
6. ✅ Deploys to production (2-4 minutes)
7. ✅ Your changes are LIVE!

## Checking Deployment Status

### GitHub Actions
Visit: https://github.com/michaelegbo/seemplify/actions
- See all deployments
- Check if workflow succeeded
- View deployment logs

### Dokploy Dashboard
Visit: http://4.180.153.209:3000
- Login with credentials from `/access/DOKPLOY-CREDENTIALS.md`
- See build progress
- View container logs
- Check deployment status

## Manual Deployment (Optional)

If you need to manually deploy:

### Single App
Go to GitHub Actions → Choose workflow → "Run workflow"

### All Apps at Once
Go to: https://github.com/michaelegbo/seemplify/actions/workflows/deploy-all.yml
- Click "Run workflow"
- Type `deploy-all` to confirm
- Deploys all apps in sequence (backends first, then frontends)

## Technical Details

### API Endpoint Used
All workflows use the correct Dokploy tRPC API format:
```bash
POST /api/trpc/application.deploy?batch=1
Headers:
  - Authorization: Bearer {DOKPLOY_TOKEN}
  - Content-Type: application/json
Body:
  {"0":{"json":{"applicationId":"{APP_ID}"}}}
```

### GitHub Secrets Required
These are already configured in your repo:
- `DOKPLOY_URL` - http://4.180.153.209:3000
- `DOKPLOY_TOKEN` - Your auth token
- `{APP_NAME}_APP_ID` - Each app's Dokploy ID

## Troubleshooting

### Deployment Failed?
1. Check GitHub Actions logs
2. Check Dokploy build logs
3. Verify environment variables in Dokploy
4. Check if Docker build succeeded

### Changes Not Showing?
1. Wait 3-4 minutes for full deployment
2. Hard refresh browser (Ctrl+Shift+R)
3. Check Dokploy container is running: `docker ps`
4. Check application logs in Dokploy

### Manual Re-deploy
If auto-deploy fails, you can manually trigger from GitHub Actions or Dokploy dashboard.

## Summary

**YES!** Every time you push to `main` branch:
- ✅ GitHub Actions detects which app changed
- ✅ Automatically triggers Dokploy deployment
- ✅ Dokploy builds and deploys latest code
- ✅ Your changes go live in 2-4 minutes

**No manual deployment needed!** Just push your code and it automatically deploys. 🚀
