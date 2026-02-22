# UBA FastLane Deployment

**URL:** https://uba.seemplifyai.com  
**Dokploy:** seemplify project → uba-fastlane

---

## Auto-deploy (GitHub Actions)

Pushes to `uba_branch_optimsation/` on `main` or `master` trigger deploy automatically.

**Workflow:** `.github/workflows/deploy-uba.yml`

**Manual trigger:**
```bash
gh workflow run deploy-uba.yml
```

---

## Required GitHub Secrets

| Secret | Purpose |
|--------|---------|
| `DOKPLOY_URL` | `http://4.180.153.209:3000` |
| `DOKPLOY_TOKEN` | API key from access/DOKPLOY-API-CREDENTIALS-COMPLETE.md |
| `UBA_FASTLANE_APP_ID` | `_3NtFvqF3tUk2gEiRVIzE` |

**Add UBA secret (if missing):**
```bash
gh secret set UBA_FASTLANE_APP_ID --body "_3NtFvqF3tUk2gEiRVIzE"
```

Or run: `.\scripts\setup-uba-github-secret.ps1`

---

## Build

- Build typically takes 3–5 minutes
- First deploy may take longer

---

## Troubleshooting

**502 Bad Gateway:** Build may still be running. Check Dokploy: http://4.180.153.209:3000

**createEnvFile error:** Run `uba_branch_optimsation/fix-createenvfile.py` on the server.
