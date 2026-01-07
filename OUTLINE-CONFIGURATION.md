# Outline Domain Configuration - docs.seemplifyai.com

## Current Status
Outline is currently deployed on Dokploy at: `/etc/dokploy/compose/seemplify-outline-mrgajc/code/docker-compose.yml`
- Current domain: `seemplify-outline-be18bc-127-0-0-1.traefik.me` (free Dokploy subdomain)
- Container port: 3000

## Required Changes

### 1. Update Docker Compose Labels

You need to modify the Traefik labels in the Outline service section to use `docs.seemplifyai.com`.

**Current labels (to REPLACE):**
```yaml
labels:
  - traefik.http.routers.seemplify-outline-mrgajc-13-web.rule=Host(\`seemplify-outline-be18bc-127-0-0-1.traefik.me\`)
  - traefik.http.routers.seemplify-outline-mrgajc-13-web.entrypoints=web
  - traefik.http.services.seemplify-outline-mrgajc-13-web.loadbalancer.server.port=3000
  - traefik.http.routers.seemplify-outline-mrgajc-13-web.service=seemplify-outline-mrgajc-13-web
  - traefik.enable=true
```

**New labels (to USE):**
```yaml
labels:
  - traefik.http.routers.seemplify-outline-mrgajc-13-web.rule=Host(\`docs.seemplifyai.com\`)
  - traefik.http.routers.seemplify-outline-mrgajc-13-web.entrypoints=web
  - traefik.http.routers.seemplify-outline-mrgajc-13-websecure.rule=Host(\`docs.seemplifyai.com\`)
  - traefik.http.routers.seemplify-outline-mrgajc-13-websecure.entrypoints=websecure
  - traefik.http.services.seemplify-outline-mrgajc-13-web.loadbalancer.server.port=3000
  - traefik.http.routers.seemplify-outline-mrgajc-13-websecure.service=seemplify-outline-mrgajc-13-web
  - traefik.enable=true
```

### 2. Cloudflare DNS Configuration

Add a CNAME record to point `docs.seemplifyai.com` to your server's public IP.

**Go to Cloudflare Dashboard → DNS → Records:**

| Type  | Name              | Content/Target                         | TTL  | Proxy Status |
|--------|-------------------|-------------------------------------|------|--------------|
| CNAME  | docs             | `seemplify-outline-be18bc-127-0-0-1.traefik.me` | Auto  | Proxied      |

### 3. Update Dex OIDC Configuration

You also need to update the Dex OIDC issuer to match the new domain.

**In `/etc/dokploy/compose/seemplify-outline-mrgajc/files/etc/dex/config.yaml`:**

**Current:**
```yaml
issuer: http://seemplify-outline-be18bc-127-0-0-1.traefik.me
```

**New:**
```yaml
issuer: https://docs.seemplifyai.com
```

## Deployment Steps

### Step 1: Update Docker Compose Labels

Run these commands to update the labels:

```bash
ssh seemplify@4.180.153.209 "cd /etc/dokploy/compose/seemplify-outline-mrgajc/code && \
  sudo sed -i 's/Host(\`seemplify-outline-be18bc-127-0-0-1.traefik.me\`)/Host(\`docs.seemplifyai.com\`)/g' docker-compose.yml && \
  sudo sed -i 's/entrypoints=web/entrypoints=web/g' docker-compose.yml && \
  sudo sed -i '/traefik.enable=true/a traefik.enable=true\n  - traefik.http.routers.seemplify-outline-mrgajc-13-websecure.rule=Host(\`docs.seemplifyai.com\`)/g' docker-compose.yml && \
  sudo sed -i '/traefik.http.routers.seemplify-outline-mrgajc-13-websecure.entrypoints=web/a traefik.http.routers.seemplify-outline-mrgajc-13-websecure.entrypoints=websecure/g' docker-compose.yml && \
  sudo sed -i '/traefik.http.routers.seemplify-outline-mrgajc-13-websecure.service=/a traefik.http.routers.seemplify-outline-mrgajc-13-websecure.service=/a' docker-compose.yml && \
  sudo sed -i '/traefik.http.routers.seemplify-outline-mrgajc-13-websecure.loadbalancer.server.port=3000/a traefik.http.routers.seemplify-outline-mrgajc-13-websecure.loadbalancer.server.port=3000/g' docker-compose.yml && \
  sudo sed -i '/traefik.http.routers.seemplify-outline-mrgajc-13-websecure.service=/a traefik.http.routers.seemplify-outline-mrgajc-13-websecure.service=/a' docker-compose.yml && \
  echo 'Labels updated successfully'"
```

### Step 2: Update Dex Configuration

```bash
ssh seemplify@4.180.153.209 "sudo sed -i 's|issuer: http://seemplify-outline-be18bc-127-0-0-1.traefik.me|issuer: https://docs.seemplifyai.com|' /etc/dokploy/compose/seemplify-outline-mrgajc/files/etc/dex/config.yaml && \
  echo 'Dex config updated'"
```

### Step 3: Add Cloudflare DNS Record

1. Log in to Cloudflare (https://dash.cloudflare.com)
2. Navigate to: **Domain → DNS → Records** for `seemplifyai.com`
3. Add new record:

**Settings:**
- **Type**: CNAME
- **Name**: `docs` (or `docs.seemplifyai.com` depending on Cloudflare interface)
- **Content/Target**: `seemplify-outline-be18bc-127-0-0-1.traefik.me`
- **TTL**: Auto (or 300)
- **Proxy Status**: Proxied (toggle ON)

### Step 4: Redeploy Outline

```bash
ssh seemplify@4.180.153.209 "cd /etc/dokploy/compose/seemplify-outline-mrgajc/code && \
  docker compose -f docker-compose.yml up -d && \
  echo 'Outline redeployed with new domain'"
```

### Step 5: Verify

After redeployment, verify access at:
- **HTTP**: http://docs.seemplifyai.com (should redirect to HTTPS)
- **HTTPS**: https://docs.seemplifyai.com
- **Health check**: https://docs.seemplifyai.com/_health

## Notes

- The `traefik.me` subdomain is free but only supports HTTP
- Using your own domain (`docs.seemplifyai.com`) will enable HTTPS with SSL via Traefik/Let's Encrypt
- Outline uses port 3000 internally - this must match in the `loadbalancer.server.port` label
- The Dex issuer change is important for OIDC authentication to work correctly

## Troubleshooting

If Outline is not accessible after changes:

1. **Check Traefik logs:**
   ```bash
   ssh seemplify@4.180.153.209 "docker logs $(docker ps --format '{{.Names}}' | grep traefik) | tail -50"
   ```

2. **Check Outline logs:**
   ```bash
   ssh seemplify@4.180.153.209 "docker logs seemplify-outline-mrgajc-outline-1 --tail 30"
   ```

3. **Verify Cloudflare DNS propagation:**
   ```bash
   nslookup docs.seemplifyai.com
   dig docs.seemplifyai.com
   ```

4. **Clear browser cache** - Sometimes SSL certificates take a few minutes to propagate
