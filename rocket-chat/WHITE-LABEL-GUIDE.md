# Seemplify Chat White-Label Guide

This guide explains how we've removed Rocket.Chat branding to create a fully white-labeled "Seemplify Chat" experience.

---

## 🎨 **White-Labeling Approach**

Instead of rebuilding Rocket.Chat from source (which requires forking and maintaining a custom codebase), we use **Custom CSS** injected via environment variables to hide all Rocket.Chat branding.

### ✅ **Advantages:**
- No need to fork or rebuild Rocket.Chat
- Easy to maintain and update
- Works with official Docker images
- Complies with open-source license

---

## 🔧 **Implementation**

### 1. **Custom CSS Configuration**

The branding removal is handled in `docker-compose.yml` via the `OVERWRITE_SETTING_CSS` environment variable:

```yaml
OVERWRITE_SETTING_CSS: |
  /* Hide Rocket.Chat logo/branding in footer */
  a[href*="rocket.chat"],
  a[href="https://rocket.chat"],
  .rcx-box--with-inline-elements > a[href]:has(svg),
  footer a[href*="rocket.chat"],
  .sidebar-footer a[href*="rocket.chat"],
  [data-qa="sidebar-footer"] a,
  .rcx-sidebar-footer a {
    display: none !important;
  }
  
  /* Hide "Powered by" text if present */
  .powered-by,
  .rcx-sidebar-footer__watermark,
  [class*="watermark"],
  [class*="PoweredBy"] {
    display: none !important;
  }
```

### 2. **Branding Environment Variables**

Additional branding is configured via these environment variables:

```yaml
OVERWRITE_SETTING_Site_Name: Seemplify Chat
OVERWRITE_SETTING_Organization_Name: Seemplify
OVERWRITE_SETTING_Organization_Email: support@seemplifyai.com
```

---

## 🚀 **Deployment**

The Custom CSS is automatically applied when you deploy:

### Via Docker Compose:
```bash
docker compose up -d
```

### Via Dokploy:
Push changes to GitHub - the workflow automatically deploys:
```bash
git add rocket-chat/
git commit -m "Update white-labeling"
git push origin main
```

---

## ✅ **What's Hidden**

| Element | Status | Method |
|---------|--------|--------|
| **Footer Logo** | ✅ Hidden | Custom CSS |
| **"Powered by Rocket.Chat"** | ✅ Hidden | Custom CSS |
| **Sidebar Watermark** | ✅ Hidden | Custom CSS |
| **Rocket.Chat Links** | ✅ Hidden | Custom CSS |
| **Site Title** | ✅ Replaced | `Site_Name` env var |
| **Organization** | ✅ Replaced | `Organization_Name` env var |

---

## 🎯 **What Users See**

### Before (Default Rocket.Chat):
- "Rocket.Chat" in footer
- "Powered by Rocket.Chat" watermark
- Rocket.Chat logo links

### After (Seemplify Chat):
- Clean footer (no branding)
- "Seemplify Chat" everywhere
- "Seemplify" organization name
- No external links to rocket.chat

---

## 🔄 **Updating White-Label CSS**

If you need to hide additional elements:

1. **Find the CSS selector** using browser DevTools (F12)
2. **Add to `docker-compose.yml`** in the `OVERWRITE_SETTING_CSS` section
3. **Commit and push** to trigger auto-deploy
4. **Verify** the changes at https://chat.seemplifyai.com

---

## 📝 **Manual Admin Panel Method** (Alternative)

If you prefer to add Custom CSS via the admin panel:

1. Login to https://chat.seemplifyai.com as admin
2. Go to **Administration** → **Workspace** → **Settings** → **Layout**
3. Find **Custom CSS** setting
4. Paste the CSS from above
5. Click **Save Changes**

**Note:** Using environment variables (current method) is preferred as it persists across container rebuilds.

---

## 🧪 **Testing**

After deploying, verify:

1. **Login Page:** No Rocket.Chat branding ✅
2. **Sidebar Footer:** Clean, no logos ✅
3. **Page Title:** Shows "Seemplify Chat" ✅
4. **Links:** No links to rocket.chat domain ✅

---

## 📚 **Official Rocket.Chat Documentation**

For reference:
- [White-labeling Guide](https://docs.rocket.chat/docs/white-labeling-and-customizing-workspace)
- [Custom CSS Settings](https://docs.rocket.chat/docs/layout)
- [Environment Variables](https://docs.rocket.chat/docs/manage-settings-using-environmental-variables)

---

## ⚖️ **License Compliance**

This approach is fully compliant with Rocket.Chat's MIT license:
- ✅ We're not modifying the source code
- ✅ We're using documented features (Custom CSS)
- ✅ We're not redistributing modified binaries
- ✅ Attribution is maintained in source files

**Note:** Rocket.Chat offers Pro/Enterprise plans with official white-labeling support. This CSS method is a self-hosted alternative that works with the open-source Community edition.

---

**Last Updated:** 2026-01-30  
**Status:** ✅ Fully White-Labeled
