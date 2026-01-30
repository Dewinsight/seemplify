# DNS Troubleshooting Guide for approver.aiinigeria.com

## Current Issue: DNS_PROBE_FINISHED_NXDOMAIN

The domain `approver.aiinigeria.com` is not resolving. This means:
- DNS records don't exist, OR
- Domain is not configured in Cloudflare, OR  
- DNS hasn't propagated yet

## Quick Fix Steps

### 1. Verify Domain Zone in Cloudflare

**Check if `aiinigeria.com` is in your Cloudflare account:**

1. Go to: https://dash.cloudflare.com
2. Check if you see `aiinigeria.com` in your zones list
3. If NOT visible:
   - The domain might be in a different Cloudflare account
   - Or the domain might not be added to Cloudflare yet

### 2. Add Domain to Cloudflare (if needed)

If `aiinigeria.com` is not in Cloudflare:

1. Go to: https://dash.cloudflare.com
2. Click **"Add a Site"**
3. Enter: `aiinigeria.com`
4. Follow the setup wizard
5. Update nameservers at your domain registrar to point to Cloudflare's nameservers

### 3. Verify DNS Records Exist

**In Cloudflare Dashboard:**

1. Select `aiinigeria.com` zone
2. Go to **DNS → Records**
3. Verify these records exist:

| Type | Name | Content | Proxy Status |
|------|------|---------|--------------|
| A | `api.approver` | `4.180.153.209` | Proxied (orange cloud) |
| A | `approver` | `4.180.153.209` | Proxied (orange cloud) |

**If records don't exist, add them:**

1. Click **"Add record"**
2. Type: `A`
3. Name: `api.approver` (or `approver`)
4. IPv4: `4.180.153.209`
5. Proxy status: **Proxied** (orange cloud icon)
6. TTL: `Auto`
7. Click **"Save"**

### 4. Check Nameservers

**Verify domain is using Cloudflare nameservers:**

```bash
dig +short NS aiinigeria.com
```

Should return Cloudflare nameservers like:
- `aliza.ns.cloudflare.com`
- `noel.ns.cloudflare.com`

If not, update nameservers at your domain registrar.

### 5. Wait for Propagation

After adding/updating DNS records:
- **Cloudflare Proxied records:** Usually instant (1-2 minutes)
- **Global DNS propagation:** 5-30 minutes

### 6. Test DNS Resolution

```bash
# Test from command line
nslookup approver.aiinigeria.com 8.8.8.8
nslookup api.approver.aiinigeria.com 8.8.8.8

# Should return: 4.180.153.209 (or Cloudflare proxy IPs)
```

## If Domain is in Different Cloudflare Account

If `aiinigeria.com` is in a different Cloudflare account:

1. **Option A:** Get API token from that account and use `verify-approver-dns.py`
2. **Option B:** Manually add DNS records in that Cloudflare dashboard
3. **Option C:** Transfer domain to your main Cloudflare account

## Current Status

✅ **Server-side:** Everything working
- Containers running and healthy
- Traefik configured correctly
- Apps responding on correct ports

❌ **DNS:** Not resolving
- Need to verify DNS records in Cloudflare
- Need to ensure domain is in Cloudflare
- Need to wait for propagation

## Next Steps

1. **Check Cloudflare Dashboard** - Verify `aiinigeria.com` zone exists
2. **Verify DNS Records** - Ensure `api.approver` and `approver` A records exist
3. **Check Nameservers** - Ensure domain uses Cloudflare nameservers
4. **Wait 5-10 minutes** - For DNS propagation
5. **Test again** - Try accessing https://approver.aiinigeria.com
