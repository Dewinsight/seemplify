# Approver Troubleshooting Guide

Solutions to common issues encountered with the Approver application.

---

## Authentication Issues

### 401 Unauthorized Error

**Symptoms:** API requests return 401 status

**Solutions:**
1. **Token expired** - Log in again to get a fresh token
2. **Missing token** - Ensure `Authorization: Bearer <token>` header is included
3. **Invalid token** - Verify token wasn't tampered with
4. **Wrong organization** - Check `X-Organization-Id` header if required

```bash
# Test with verbose output
curl -v -X GET https://api.approver.aiinigeria.com/api/projects \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

---

### Cannot Login / Invalid Credentials

**Symptoms:** Login fails with "Invalid credentials"

**Solutions:**
1. Verify email is correct (case-sensitive)
2. Check if account was created (verify OTP)
3. Reset password via "Forgot Password"
4. For admin, ensure admin was seeded:
   ```bash
   curl -X POST https://api.approver.aiinigeria.com/api/auth/seed-admin
   ```

---

### OTP Not Received

**Symptoms:** Registering but no OTP email arrives

**Solutions:**
1. Check spam/junk folder
2. Verify SMTP configuration in backend
3. Check email address is correct
4. Use test endpoint (development only):
   ```javascript
   // In development, OTP is logged to console
   // Check backend terminal output
   ```

---

## API Errors

### 403 Forbidden

**Symptoms:** "Insufficient permissions" error

**Solutions:**
1. Verify user has required role for endpoint
2. Check organization membership
3. Admin can update user roles:
   ```bash
   curl -X PATCH https://api.approver.aiinigeria.com/api/users/role \
     -H "Authorization: Bearer TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"userId":"...","role":"Admin"}'
   ```

---

### 404 Not Found

**Symptoms:** Endpoint returns 404

**Solutions:**
1. Verify endpoint URL is correct
2. Check for trailing slashes
3. Ensure API version prefix (`/api/`) is included
4. Verify route exists in `backend/routes/api.js`

---

### 500 Internal Server Error

**Symptoms:** Generic server error

**Solutions:**
1. Check backend logs for details
2. Verify MongoDB connection
3. Check environment variables are set
4. Verify all required fields in request body

```bash
# Check backend logs
docker logs approver-backend --tail 100
```

---

## Database Issues

### MongoDB Connection Failed

**Symptoms:** "MongoNetworkError" or connection timeout

**Solutions:**
1. Verify `MONGODB_URI` is correct
2. Check MongoDB is running
3. Verify network connectivity to MongoDB server
4. Check firewall allows MongoDB port (27017)

```bash
# Test MongoDB connection
mongosh "mongodb://localhost:27017/approver"
```

---

### Database Migration Errors

**Symptoms:** Data inconsistency or migration failures

**Solutions:**
1. Backup current database
2. Check migration scripts in `backend/scripts/`
3. Run migrations manually:
   ```bash
   cd backend
   node scripts/migrateToMultiOrg.js
   ```

---

## Frontend Issues

### CORS Errors

**Symptoms:** "Access-Control-Allow-Origin" errors in browser console

**Solutions:**
1. Verify `FRONTEND_URL` matches exact frontend URL in backend
2. Check backend CORS configuration
3. Ensure no browser extensions blocking CORS

---

### Blank Page / White Screen

**Symptoms:** Frontend loads but shows blank

**Solutions:**
1. Check browser console for JavaScript errors
2. Verify `VITE_API_URL` is correct in frontend env
3. Clear browser cache
4. Check if API is accessible

---

### Build Errors

**Symptoms:** `npm run build` fails

**Solutions:**
1. Clear node_modules and reinstall:
   ```bash
   rm -rf node_modules package-lock.json
   npm install
   ```
2. Check for TypeScript errors:
   ```bash
   npm run build 2>&1 | head -50
   ```
3. Verify Node.js version (18+ required)

---

## AI & OpenAI Issues

### AI Analysis Not Working

**Symptoms:** Projects not being analyzed by AI

**Solutions:**
1. Verify `OPENAI_API_KEY` is set in backend environment
2. Check API key has sufficient credits
3. Verify backend can reach OpenAI API
4. Check for rate limiting

```bash
# Test OpenAI connection
curl https://api.openai.com/v1/models \
  -H "Authorization: Bearer $OPENAI_API_KEY"
```

---

### Weaviate Connection Failed

**Symptoms:** Vector search features not working

**Solutions:**
1. Verify `WEAVIATE_URL` is correct
2. Check `WEAVIATE_API_KEY` if using Weaviate Cloud
3. Ensure Weaviate instance is running
4. Check network connectivity

```bash
# Test Weaviate connection
curl https://your-weaviate-url/v1/meta
```

---

## Deployment Issues

### 502 Bad Gateway

**Symptoms:** Browser shows 502 error

**Solutions:**
1. Check backend container is running:
   ```bash
   docker ps | grep approver-backend
   ```
2. Verify backend port (5000) is accessible
3. Check Traefik logs:
   ```bash
   docker logs traefik
   ```
4. Restart backend:
   ```bash
   docker restart approver-backend
   ```

---

### Container Won't Start

**Symptoms:** Docker container exits immediately

**Solutions:**
1. Check container logs:
   ```bash
   docker logs approver-backend
   ```
2. Verify environment variables are set
3. Check for port conflicts:
   ```bash
   netstat -tlnp | grep 5000
   ```
4. Verify volume mounts are correct

---

### DNS Not Resolving

**Symptoms:** Domain doesn't load site

**Solutions:**
1. Verify DNS A records point to server IP
2. Check propagation (may take up to 48 hours):
   ```bash
   nslookup approver.aiinigeria.com
   dig approver.aiinigeria.com
   ```
3. Verify firewall allows HTTP (80) and HTTPS (443)
4. Check Traefik configuration

---

## Email Issues

### Emails Not Sending

**Symptoms:** No emails received (invites, OTP, etc.)

**Solutions:**
1. Verify SMTP configuration:
   - `SMTP_HOST`
   - `SMTP_PORT`
   - `SMTP_USER`
   - `SMTP_PASS`
   - `EMAIL_FROM`
2. Check SMTP credentials are correct
3. Verify email service isn't blocking
4. Check spam folder
5. Use ethereal.email for testing:
   ```bash
   # Set SMTP to Ethereal credentials for testing
   ```

---

## Performance Issues

### Slow API Responses

**Symptoms:** API calls take very long

**Solutions:**
1. Check MongoDB query performance
2. Add indexes to frequently queried fields
3. Check server resources (CPU, memory)
4. Review Weaviate queries if using vector search
5. Consider adding caching layer

---

### High Memory Usage

**Symptoms:** Server running out of memory

**Solutions:**
1. Check for memory leaks in Node.js
2. Monitor with:
   ```bash
   docker stats
   ```
3. Increase container memory limits
4. Restart containers periodically

---

## Data Issues

### Missing Data After Migration

**Symptoms:** Data appears missing after running migration

**Solutions:**
1. Check migration logs for errors
2. Verify MongoDB had proper backup
3. Run data validation scripts
4. Check for organization context issues

---

### Logo Not Uploading

**Symptoms:** Organization logo upload fails

**Solutions:**
1. Check file size (max 2MB)
2. Verify file type (PNG, JPG, SVG)
3. Check upload middleware configuration
4. Verify directory permissions

---

## Getting Help

### Collect Debug Information

When reporting issues, include:

1. **Backend logs:**
   ```bash
   docker logs approver-backend --tail 200 > backend-logs.txt
   ```

2. **Frontend logs:**
   ```bash
   docker logs approver-frontend --tail 200 > frontend-logs.txt
   ```

3. **Environment (redact secrets):**
   ```bash
   docker exec approver-backend env | grep -v SECRET > env.txt
   ```

4. **Docker status:**
   ```bash
   docker ps -a > docker-status.txt
   ```

5. **Network info:**
   ```bash
   docker network inspect bridge > network.txt
   ```

---

### Useful Commands

```bash
# Restart all services
docker-compose restart

# View all logs
docker-compose logs -f

# Access container shell
docker exec -it approver-backend sh

# Check resource usage
docker stats

# Verify port bindings
docker port approver-backend

# Test API from server
curl http://localhost:5000/api/health
```

---

*Last Updated: March 2026*
