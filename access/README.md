# Access Credentials & Server Information

This folder contains all access credentials and server information for the Semplify production infrastructure.

## 📁 Files in this Folder

| File | Description |
|------|-------------|
| **SERVER-ACCESS.md** | Complete server access guide with all credentials, URLs, and operational information |
| **DOKPLOY-CREDENTIALS.md** | Quick reference card for Dokploy dashboard login |
| **DOKPLOY-API-CREDENTIALS-COMPLETE.md** | Complete reference for all Dokploy API keys and application IDs (Updated: Jan 22, 2026) |
| **CREDENTIALS-UPDATE-SUMMARY.md** | Summary of latest credential retrieval and updates |

---

## 🔐 Quick Access

### Dokploy Dashboard
- **URL:** http://4.180.153.209:3000
- **Email:** admin@seemplifyai.com
- **Password:** Seemplify2026!

### SSH Access
```bash
ssh seemplify@4.180.153.209
```

---

## ⚠️ Security Warning

**THIS FOLDER CONTAINS SENSITIVE CREDENTIALS!**

- ⛔ **DO NOT** commit these files to public repositories
- ⛔ **DO NOT** share these credentials publicly
- ✅ **DO** keep these files secure and encrypted if possible
- ✅ **DO** update passwords regularly
- ✅ **DO** use this folder only for authorized team members

---

## 📋 What's Documented

### SERVER-ACCESS.md
- Complete infrastructure details
- All production URLs
- SSH access information
- MongoDB database credentials
- Application port mappings
- Common operations and troubleshooting
- CI/CD information

### DOKPLOY-CREDENTIALS.md
- Quick login reference
- Dashboard access steps
- Password change instructions

---

## 🔄 Keeping Credentials Updated

If you change any credentials:

1. Update the relevant file in this folder
2. Notify team members of the change
3. Keep a backup of old credentials (in case rollback needed)
4. Update any automated scripts that use these credentials

---

## 📞 Support

For issues accessing the server or applications:
1. Check SERVER-ACCESS.md troubleshooting section
2. Verify credentials are correct
3. Check if services are running
4. Review application logs in Dokploy dashboard

---

**Last Updated:** January 22, 2026

## 🔐 Latest Credentials Update

**Date:** January 22, 2026  
**Action:** Retrieved and documented all Dokploy API credentials via SSH + PostgreSQL

### What Was Retrieved:
- ✅ 5 Active API Keys (including GitHub Actions deployment key)
- ✅ 19 Application IDs (9 production + 9 dev + 1 marketing-site)
- ✅ Project information

### New Documents:
- **[DOKPLOY-API-CREDENTIALS-COMPLETE.md](./DOKPLOY-API-CREDENTIALS-COMPLETE.md)** - Full credentials reference
- **[CREDENTIALS-UPDATE-SUMMARY.md](./CREDENTIALS-UPDATE-SUMMARY.md)** - Update summary

See the new documents for complete API keys, application IDs, and deployment credentials.
