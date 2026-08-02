# Time Attendance 502 Fix - Complete

## Problem
Time-attendance applications were showing 502 Bad Gateway errors on both frontend and backend URLs despite containers running correctly.

## Root Cause
The domain configuration in Dokploy database had **incorrect ports** (3000 instead of the actual container ports), which caused Traefik to route requests to the wrong ports:
- Backend needed port **5010** (was 3000)
- Frontend needed port **5011** (was 3000)

## Solution Steps

### 1. Updated Dokploy Database Domain Configuration
```python
# Updated domain table to set correct ports
UPDATE domain SET port = 5010 WHERE applicationId = 'gmBjqWd6pQKSWqfBIMNyL';
UPDATE domain SET port = 5011 WHERE applicationId = 'xp6sakCgL0wzSDhfpNc0r';
```

### 2. Fixed Traefik Configuration Files
Dokploy wasn't using the domain port values when generating Traefik configs during deployment, so we manually edited the Traefik config files:

**Backend:** `/etc/dokploy/traefik/dynamic/time-attendance-backend-w7ewpk.yml`
```yaml
# Changed from:
- url: http://time-attendance-backend-w7ewpk:3000
# To:
- url: http://time-attendance-backend-w7ewpk:5010
```

**Frontend:** `/etc/dokploy/traefik/dynamic/time-attendance-frontend-4vqr2w.yml`
```yaml
# Changed from:
- url: http://time-attendance-frontend-4vqr2w:3000
# To:
- url: http://time-attendance-frontend-4vqr2w:5011
```

### 3. Traefik Auto-Reload
Traefik automatically picked up the changes within 10-20 seconds due to `watch: true` configuration.

## Verification Results

✅ **Backend Health Endpoint:**
```bash
$ curl https://api-time.seemplifyai.com/health
{"status":"ok","service":"time-attendance-backend"}
```

✅ **Frontend:**
```bash
$ curl -I https://time.seemplifyai.com
HTTP/2 200 OK
```

## Technical Details

### Dokploy Architecture
- **Deployment Mode:** Docker Swarm
- **Proxy:** Traefik with file provider
- **Config Location:** `/etc/dokploy/traefik/dynamic/` inside `dokploy-traefik` container
- **Database:** PostgreSQL (dokploy-postgres)

### How Routing Works
1. Cloudflare DNS points domains to server IP (4.180.153.209)
2. Traefik receives HTTPS requests
3. Traefik reads config files from `/etc/dokploy/traefik/dynamic/`
4. Routes requests to Docker Swarm services based on Host rules
5. Connects to containers on specified ports

### Application IDs
- Backend: `gmBjqWd6pQKSWqfBIMNyL`
- Frontend: `xp6sakCgL0wzSDhfpNc0r`

### Service Names
- Backend: `time-attendance-backend-w7ewpk`
- Frontend: `time-attendance-frontend-4vqr2w`

## Scripts Created

All scripts are in `time-attendance/` directory:

1. **check-domains.py** - Check domain configuration in Dokploy database
2. **update-domain-ports.py** - Update domain ports in database
3. **check-app-config.py** - Check full application configuration
4. **fix-traefik-configs.py** - Update Traefik config files directly
5. **deploy-apps.py** - Deploy applications via Dokploy API
6. **verify-deployment.py** - Verify deployment with container labels and URL tests
7. **test-urls.py** - Test application URLs

## Key Learnings

1. **Domain Port vs Container Port:** The `port` column in Dokploy's `domain` table doesn't automatically propagate to Traefik configs during deployment
2. **Traefik File Provider:** Dokploy uses Traefik's file provider for dynamic routing, not just Docker/Swarm labels
3. **Config Hot Reload:** Traefik's `watch: true` allows config changes without restart
4. **Manual Override:** When Dokploy deployment doesn't generate correct configs, manually editing Traefik config files is a valid workaround

## URLs

- **Frontend:** https://time.seemplifyai.com
- **Backend API:** https://api-time.seemplifyai.com
- **Backend Health:** https://api-time.seemplifyai.com/health

## Status

✅ **FIXED** - Both applications are now accessible and responding with 200 OK

Date: 2026-01-27
Time: ~14:30 UTC
