# Access Credentials & Server Information

This folder contains all access credentials and server information for the Seemplify production infrastructure.

---

## New: Master Access Guide

**Start here for complete service access documentation:**

**[ACCESS-GUIDE.md](./ACCESS-GUIDE.md)** - Comprehensive guide to accessing all four primary services:
- Dokploy Dashboard and API
- Cloudflare DNS Management
- Azure Virtual Machine (SSH)
- GitHub Repository and Actions

The ACCESS-GUIDE.md includes URLs, CLI commands, credential locations, and troubleshooting for all services.

---

## Quick Reference

| Service | Where to Find |
|---------|---------------|
| Dokploy Dashboard | ACCESS-GUIDE.md Section 1 or DOKPLOY-CREDENTIALS.md |
| Dokploy API | ACCESS-GUIDE.md Section 1 or DOKPLOY-API-CREDENTIALS-COMPLETE.md |
| Cloudflare DNS | ACCESS-GUIDE.md Section 2 |
| Azure VM (SSH) | ACCESS-GUIDE.md Section 3 or SERVER-ACCESS.md |
| **Azure budget VM** (separate dev box) | **[azure-budget-vm/](./azure-budget-vm/README.md)** — keys + docs |
| GitHub Repository | ACCESS-GUIDE.md Section 4 or GITHUB-SECRETS-SETUP-GUIDE.md |

---

## 📁 Files in this Folder

|| File | Description |
||------|-------------|
|| **CREDENTIALS-INDEX.md** | Master index of all passwords and secrets |
|| **ACCESS-GUIDE.md** | Comprehensive service access guide (NEW) |
|| **SERVER-ACCESS.md** | Complete server access guide |
|| **DOKPLOY-CREDENTIALS.md** | Dokploy dashboard quick login reference |
|| **DOKPLOY-API-CREDENTIALS-COMPLETE.md** | Dokploy API keys and application IDs |
|| **ZULIP-CREDENTIALS.md** | Zulip environment variables |
|| **BREVO-CONFIGURATION.md** | Brevo API and SMTP settings |
|| **GITHUB-SECRETS-SETUP-GUIDE.md** | GitHub Actions secrets configuration |
|| **CREDENTIALS-UPDATE-SUMMARY.md** | Credentials update history |
|| **CLOUDFLARE-API-ISSUE.md** | Cloudflare API troubleshooting |
|| **azure-budget-vm/** | Budget Azure Linux VM: SSH keys + [AZURE-BUDGET-VM-ACCESS.md](./azure-budget-vm/AZURE-BUDGET-VM-ACCESS.md) |

---

## 🔐 Quick Access

### Dokploy Dashboard
- **URL:** http://4.180.153.209:3000
- **Email:** admin@seemplifyai.com
- **Password:** See DOKPLOY-CREDENTIALS.md

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

### ACCESS-GUIDE.md (New)
Comprehensive guide to accessing all infrastructure services:
- Dokploy Dashboard and API access
- Cloudflare DNS management
- Azure VM SSH access
- GitHub repository and Actions
- Quick reference card and troubleshooting

### SERVER-ACCESS.md
- Complete infrastructure details
- All production URLs
- SSH access information
- MongoDB database credentials
- Application port mappings
- Common operations and troubleshooting

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

1. Check ACCESS-GUIDE.md troubleshooting section
2. Verify credentials are correct
3. Check if services are running
4. Review application logs in Dokploy dashboard

---

**Last Updated:** February 3, 2026
