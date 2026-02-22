# Auto-mailer Deployment Setup

## Summary

Auto-mailer has been deployed end-to-end to the Seemplify Dokploy server.

| Item | Value |
|------|-------|
| **Application ID** | `aGhnXBzgFhD_59dpL10l5` |
| **Domain** | https://auto-mailer.seemplifyai.com |
| **Build Path** | `auto-mailer/` |
| **Repository** | michaelegbo/seemplify (branch: main) |

## GitHub Secret (Required)

Add the application ID to GitHub Actions secrets:

```bash
gh secret set AUTO_MAILER_APP_ID --body "aGhnXBzgFhD_59dpL10l5"
```

Or via GitHub UI: **Settings → Secrets and variables → Actions → New repository secret**

- **Name:** `AUTO_MAILER_APP_ID`
- **Value:** `aGhnXBzgFhD_59dpL10l5`

## Deployment

- **Automatic:** Pushes to `main` that touch `auto-mailer/**` trigger deployment
- **Manual:** `gh workflow run deploy-auto-mailer.yml`
- **API:** `curl -X POST "http://4.180.153.209:3000/api/application.deploy" -H "x-api-key: $DOKPLOY_TOKEN" -H "Content-Type: application/json" -d '{"applicationId": "aGhnXBzgFhD_59dpL10l5"}'`

## Environment Variables (Future)

When adding full mailer functionality, configure in Dokploy UI (from `access/`):

- `MONGODB_URI` - from access/DATABASE-CREDENTIALS.md
- `JWT_SECRET` - from access
- `IDP_ISSUER_URL` - https://auth.seemplifyai.com
- `MAILCOW_*` - from access/MAILCOW-CREDENTIALS.md (if using Mailcow)

## Verify

```bash
curl https://auto-mailer.seemplifyai.com/health
# Expected: {"status":"ok","service":"auto-mailer","timestamp":"..."}
```

## 502 Bad Gateway Fix

If you see 502, the domain port may need updating. Run on the server (SSH seemplify@4.180.153.209):

```bash
# Update domain port to 5012
PG=$(docker ps --filter "name=dokploy-postgres" --format "{{.Names}}" | head -1)
docker exec $PG psql -U dokploy -d dokploy -c 'UPDATE domain SET port = 5012 WHERE "applicationId" = '\''aGhnXBzgFhD_59dpL10l5'\'';'

# Or run the fix script (after copying to server)
python3 auto-mailer/fix-domain-port.py
```

Then redeploy: `gh workflow run deploy-auto-mailer.yml` or trigger via Dokploy UI.
