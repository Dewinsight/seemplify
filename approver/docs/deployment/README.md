# Approver Deployment Guide

This guide covers deploying the Approver application to production using Docker and Dokploy.

## Prerequisites

Before deploying, ensure you have:

- [ ] Docker installed on the server
- [ ] Dokploy installed (for automated deployment)
- [ ] Domain configured (or use default domains)
- [ ] MongoDB instance (local or Atlas)
- [ ] Weaviate instance (optional, for AI features)
- [ ] OpenAI API key (optional, for AI features)

---

## Quick Deploy (Dokploy)

### 1. Access Dokploy Dashboard

```
URL: http://<server-ip>:3000
Login: admin@seemplifyai.com / Seemplify2026!
```

### 2. Deploy Backend

1. Navigate to **approver** project
2. Click on **approver-backend** application
3. Click **Deploy** button
4. Wait for build to complete
5. Verify: `docker ps | grep approver-backend`

### 3. Deploy Frontend

1. Navigate to **approver** project
2. Click on **approver-frontend** application
3. Click **Deploy** button
4. Wait for build to complete
5. Verify: `docker ps | grep approver-frontend`

---

## Manual Deployment (Docker)

### 1. Build Docker Images

```bash
# Build backend
cd approver/backend
docker build -t approver-backend:latest .

# Build frontend
cd ../frontend
docker build -t approver-frontend:latest .
```

### 2. Run Containers

```bash
# Backend
docker run -d \
  --name approver-backend \
  -p 5000:5000 \
  -e MONGODB_URI=mongodb://host:27017/approver \
  -e JWT_SECRET=your-secret \
  -e OPENAI_API_KEY=sk-... \
  approver-backend:latest

# Frontend
docker run -d \
  --name approver-frontend \
  -p 80:80 \
  -e VITE_API_URL=https://api.approver.aiinigeria.com \
  approver-frontend:latest
```

---

## Environment Variables

### Backend (.env)

| Variable | Required | Description | Default |
|----------|----------|-------------|---------|
| `PORT` | Yes | Server port | `5000` |
| `NODE_ENV` | Yes | Environment | `production` |
| `MONGODB_URI` | Yes | MongoDB connection string | - |
| `JWT_SECRET` | Yes | JWT signing secret | - |
| `JWT_EXPIRES_IN` | No | Token expiration | `7d` |
| `OPENAI_API_KEY` | No | OpenAI for AI features | - |
| `WEAVIATE_URL` | No | Weaviate endpoint | - |
| `WEAVIATE_API_KEY` | No | Weaviate API key | - |
| `SMTP_HOST` | No | Email SMTP host | - |
| `SMTP_PORT` | No | SMTP port | `587` |
| `SMTP_USER` | No | SMTP username | - |
| `SMTP_PASS` | No | SMTP password | - |
| `EMAIL_FROM` | No | From email address | - |
| `FRONTEND_URL` | Yes | Frontend URL for links | - |

### Frontend (.env.production)

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_API_URL` | Yes | Backend API URL |
| `VITE_APP_NAME` | No | App name |

---

## Domain Configuration

### Required DNS Records

| Type | Name | Value |
|------|------|-------|
| A | approver.aiinigeria.com | `<server-ip>` |
| A | api.approver.aiinigeria.com | `<server-ip>` |

### Traefik Configuration

The application uses Traefik for reverse proxy and SSL termination. Configuration files:

- `approver/traefik-approver-frontend.yml`

---

## SSL/HTTPS Setup

### Using Let's Encrypt (Automatic)

Traefik automatically provisions SSL certificates via Let's Encrypt. Ensure:

1. Domain points to server IP
2. Ports 80 and 443 are open
3. Traefik is running

### Manual SSL

```bash
# Generate self-signed cert (testing only)
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout /etc/ssl/private/nginx-selfsigned.key \
  -out /etc/ssl/certs/nginx-selfsigned.crt
```

---

## Database Setup

### MongoDB

1. **Local MongoDB:**
   ```bash
   # Using Docker
   docker run -d \
     --name mongodb \
     -p 27017:27017 \
     -e MONGO_INITDB_ROOT_USERNAME=admin \
     -e MONGO_INITDB_ROOT_PASSWORD=password \
     mongo
   ```

2. **MongoDB Atlas:**
   - Create cluster
   - Get connection string
   - Add to environment variables

### Seed Initial Data

```bash
# Seed admin user
curl -X POST https://api.approver.aiinigeria.com/api/auth/seed-admin

# Seed departments
curl -X POST https://api.approver.aiinigeria.com/api/scripts/seed-departments

# Seed rules
curl -X POST https://api.approver.aiinigeria.com/api/scripts/seed-rules
```

---

## Post-Deployment Verification

### 1. Health Check

```bash
# Backend health
curl https://api.approver.aiinigeria.com/api/health

# Frontend
curl -I https://approver.aiinigeria.com
```

### 2. Test Authentication

```bash
curl -X POST https://api.approver.aiinigeria.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@approver.com","password":"password123"}'
```

### 3. Check Logs

```bash
# Backend logs
docker logs approver-backend

# Frontend logs
docker logs approver-frontend

# Or via Dokploy
# Dashboard → Application → Logs
```

---

## Scaling

### Horizontal Scaling

```bash
# Scale backend
docker-compose up -d --scale approver-backend=3
```

### Load Balancing

Traefik automatically load balances across instances.

---

## Monitoring

### Health Checks

| Endpoint | Purpose |
|----------|---------|
| `/api/health` | Basic health check |
| `/api/health/ready` | Readiness probe |

### Logging

```bash
# View logs
docker logs approver-backend --tail 100 -f

# Or use Docker Compose
docker-compose logs -f backend
```

---

## Backup & Recovery

### Database Backup

```bash
# MongoDB dump
mongodump --uri="mongodb://localhost:27017/approver" \
  --out=/backup/approver-$(date +%Y%m%d)
```

### Restore

```bash
mongorestore --uri="mongodb://localhost:27017/approver" \
  /backup/approver-20260311
```

---

## Troubleshooting

### Common Issues

| Issue | Solution |
|-------|----------|
| 502 Bad Gateway | Check backend is running and accessible |
| 401 Unauthorized | Verify JWT_SECRET matches frontend config |
| CORS errors | Check FRONTEND_URL in backend env |
| MongoDB connection | Verify MONGODB_URI is correct |
| AI not working | Check OPENAI_API_KEY is set |

### Restart Services

```bash
# Via Docker
docker restart approver-backend approver-frontend

# Via Dokploy
# Dashboard → Application → Restart
```

---

## Security Checklist

- [ ] Change default admin password
- [ ] Use strong JWT_SECRET
- [ ] Enable HTTPS/SSL
- [ ] Configure firewall rules
- [ ] Regular database backups
- [ ] Monitor access logs
- [ ] Keep dependencies updated

---

## Production Checklist

Before going live:

- [ ] All environment variables configured
- [ ] SSL certificates valid
- [ ] Domain DNS resolved
- [ ] Health checks passing
- [ ] Authentication working
- [ ] Database seeded with initial data
- [ ] Logging configured
- [ ] Backup strategy in place

---

*Last Updated: March 2026*
