# Frappe LMS Deployment to Dokploy

Deploy Frappe LMS as a Docker Compose application in Dokploy with Traefik reverse proxy and Cloudflare DNS configuration.

## Prerequisites

| Requirement | Status |
|-------------|--------|
| LMS repository in seemplify | ✅ `seemplify/lms` |
| Dokploy access | Needed |
| Cloudflare DNS access | Needed |

---

## Step 1: Prepare Docker Compose for Dokploy

Modify `lms/docker/docker-compose.yml` to add Traefik labels:

```yaml
version: "3.7"
name: lms
services:
  mariadb:
    image: mariadb:10.8
    command:
      - --character-set-server=utf8mb4
      - --collation-server=utf8mb4_unicode_ci
      - --skip-character-set-client-handshake
      - --skip-innodb-read-only-compressed
    environment:
      MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD:-secure_password_here}
    volumes:
      - mariadb-data:/var/lib/mysql
    networks:
      - lms-network

  redis:
    image: redis:alpine
    networks:
      - lms-network

  frappe:
    image: frappe/bench:latest
    command: bash /workspace/init.sh
    environment:
      - SHELL=/bin/bash
    working_dir: /home/frappe
    volumes:
      - .:/workspace
      - frappe-data:/home/frappe
    networks:
      - lms-network
      - dokploy-network
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.lms.rule=Host(`lms.seemplify.com`)"
      - "traefik.http.routers.lms.entrypoints=websecure"
      - "traefik.http.routers.lms.tls.certresolver=letsencrypt"
      - "traefik.http.services.lms.loadbalancer.server.port=8000"

volumes:
  mariadb-data:
  frappe-data:

networks:
  lms-network:
    driver: bridge
  dokploy-network:
    external: true
```

---

## Step 2: Deploy to Dokploy

1. **Login to Dokploy** dashboard
2. Navigate to **Seemplify** project
3. Click **Create Service** → **Docker Compose**
4. Configure:
   - **Name**: `lms` or `frappe-learning`
   - **Source**: Git Repository
   - **Repository URL**: `https://github.com/michaelegbo/seemplify.git`
   - **Branch**: `main`
   - **Compose Path**: `lms/docker/docker-compose.yml`

5. Add **Environment Variables**:
   | Variable | Value |
   |----------|-------|
   | `MYSQL_ROOT_PASSWORD` | Generate secure password |

6. Click **Deploy**

---

## Step 3: Configure Cloudflare DNS

1. **Login to Cloudflare** → Select `seemplify.com` domain
2. Go to **DNS** → **Records**
3. Add new record:
   | Type | Name | Content | Proxy |
   |------|------|---------|-------|
   | A | `lms` | Your Dokploy server IP | Proxied (orange cloud) |

4. **SSL/TLS Settings**: Set to **Full (strict)**

---

## Step 4: Initialize LMS Site

After deployment, SSH into the server and run:

```bash
# Enter the frappe container
docker exec -it lms-frappe-1 bash

# Create the site
bench new-site lms.seemplify.com --mariadb-root-password $MYSQL_ROOT_PASSWORD --admin-password admin123

# Install LMS app
bench --site lms.seemplify.com install-app lms

# Enable developer mode (optional)
bench --site lms.seemplify.com set-config developer_mode 1
```

---

## Verification

1. Visit `https://lms.seemplify.com/lms` in browser
2. Login with `Administrator` / `admin123`
3. Verify LMS dashboard loads correctly

---

## Summary

| Component | Configuration |
|-----------|---------------|
| **App** | Frappe LMS (Docker Compose) |
| **Database** | MariaDB 10.8 (containerized) |
| **Cache** | Redis Alpine (containerized) |
| **Reverse Proxy** | Traefik (via Dokploy) |
| **SSL** | Let's Encrypt (auto via Traefik) |
| **DNS** | Cloudflare (proxied) |
| **Domain** | `lms.seemplify.com` |
