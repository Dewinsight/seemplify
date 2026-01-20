# paddie.io Email Configuration Plan

**Status:** Ready for Implementation  
**Date:** January 19, 2026  
**Target Domain:** `paddie.io`  
**Mail Server:** `mail.seemplifyai.com` (Mailcow)

---

## 🎯 Objective

Configure `paddie.io` as a fully functional email domain on the existing Mailcow server so that:
- Users can send/receive emails with `@paddie.io` addresses
- Emails pass authentication checks (SPF, DKIM, DMARC)
- Emails are delivered to inbox (not spam)

---

## 📋 What We're Doing

### Current State
- Mailcow is running at `mail.seemplifyai.com` on server `4.180.153.209`
- Domain `seemplifyai.com` is already configured and working
- `paddie.io` exists in Cloudflare but is not configured for email

### End State
- `paddie.io` added to Mailcow as a **second email domain** (alongside `seemplifyai.com`)
- Both `@seemplifyai.com` and `@paddie.io` addresses work on the same server
- DNS records (MX, SPF, DKIM, DMARC) configured in Cloudflare for `paddie.io`
- Emails from `@paddie.io` are trusted by Gmail, Outlook, etc.

> ⚠️ **Note:** This is an **addition**, NOT a replacement. The existing `seemplifyai.com` email configuration remains unchanged and fully operational.

---

## 🔐 Access Credentials Summary

| Service | How to Access |
|---------|---------------|
| **Server SSH** | `ssh seemplify@4.180.153.209` |
| **Mailcow MySQL** | User: `mailcow` / Pass: `3w8aLaw8jyknrgbs3qFfDgdD4LRQ` |
| **Cloudflare API** | Token: `s3BUpfG8KqcRoxVgwmyCSqJ3ho3R_ClCEpI4tEXJ` |
| **Cloudflare Zone ID** | `89215efb800fcc1bdc2cb1ca528eae59` (paddie.io) |

---

## 📝 Step-by-Step Instructions

### Step 1: SSH into the Server

Open a terminal and connect to the server:

```bash
ssh seemplify@4.180.153.209
```

You should see a Linux prompt. All remaining Mailcow commands are run from this SSH session.

---

### Step 2: Check Current Domains in Mailcow

Verify what domains already exist:

```bash
docker exec mailcowdockerized-mysql-mailcow-1 mysql -u mailcow -p3w8aLaw8jyknrgbs3qFfDgdD4LRQ mailcow -e 'SELECT domain, active FROM domain;'
```

**Expected output:** You should see `seemplifyai.com` listed.

---

### Step 3: Add paddie.io Domain to Mailcow

Run this SQL command to add the domain:

```bash
docker exec mailcowdockerized-mysql-mailcow-1 mysql -u mailcow -p3w8aLaw8jyknrgbs3qFfDgdD4LRQ mailcow -e "
INSERT INTO domain (domain, description, aliases, mailboxes, maxquota, quota, transport, backupmx, active, gal, dkim_enabled)
VALUES ('paddie.io', 'Paddie.io Email Domain', 400, 10, 10240, 10240, 'virtual', 0, 1, 1, 1);
"
```

**What this does:**
- Adds `paddie.io` as an active email domain
- Allows up to 10 mailboxes with 10GB quota each
- Enables DKIM signing

---

### Step 4: Verify Domain Was Added

```bash
docker exec mailcowdockerized-mysql-mailcow-1 mysql -u mailcow -p3w8aLaw8jyknrgbs3qFfDgdD4LRQ mailcow -e "SELECT domain, active, dkim_enabled FROM domain WHERE domain='paddie.io';"
```

**Expected output:** Should show `paddie.io | 1 | 1`

---

### Step 5: Generate DKIM Key

Generate a 2048-bit DKIM signing key:

```bash
docker exec mailcowdockerized-rspamd-mailcow-1 rspamadm dkim_keygen -d paddie.io -s dkim -b 2048
```

**Save the output!** You'll see:
- A private key block (stays on server)
- A public key (goes into DNS)

---

### Step 6: Get the DKIM Public Key

If the key was saved to a file:

```bash
docker exec mailcowdockerized-rspamd-mailcow-1 cat /var/lib/rspamd/dkim/paddie.io.dkim.pub
```

**Copy this value** - you'll need it for the DNS TXT record.

---

### Step 7: Configure DNS Records in Cloudflare

Now exit SSH (`exit`) and run these commands from your local machine to add DNS records via Cloudflare API:

#### 7.1 Add MX Record
```bash
curl -X POST "https://api.cloudflare.com/client/v4/zones/89215efb800fcc1bdc2cb1ca528eae59/dns_records" \
  -H "Authorization: Bearer s3BUpfG8KqcRoxVgwmyCSqJ3ho3R_ClCEpI4tEXJ" \
  -H "Content-Type: application/json" \
  --data '{"type":"MX","name":"@","content":"mail.seemplifyai.com","priority":10,"ttl":3600}'
```

**What this does:** Tells other mail servers to deliver `@paddie.io` emails to `mail.seemplifyai.com`.

#### 7.2 Add SPF Record
```bash
curl -X POST "https://api.cloudflare.com/client/v4/zones/89215efb800fcc1bdc2cb1ca528eae59/dns_records" \
  -H "Authorization: Bearer s3BUpfG8KqcRoxVgwmyCSqJ3ho3R_ClCEpI4tEXJ" \
  -H "Content-Type: application/json" \
  --data '{"type":"TXT","name":"@","content":"v=spf1 mx a:mail.seemplifyai.com -all","ttl":3600}'
```

**What this does:** Authorizes `mail.seemplifyai.com` to send emails on behalf of `paddie.io`.

#### 7.3 Add DMARC Record
```bash
curl -X POST "https://api.cloudflare.com/client/v4/zones/89215efb800fcc1bdc2cb1ca528eae59/dns_records" \
  -H "Authorization: Bearer s3BUpfG8KqcRoxVgwmyCSqJ3ho3R_ClCEpI4tEXJ" \
  -H "Content-Type: application/json" \
  --data '{"type":"TXT","name":"_dmarc","content":"v=DMARC1; p=quarantine; rua=mailto:admin@seemplifyai.com","ttl":3600}'
```

**What this does:** Sets policy for handling emails that fail SPF/DKIM checks.

#### 7.4 Add DKIM Record
Replace `YOUR_DKIM_PUBLIC_KEY` with the key from Step 6:

```bash
curl -X POST "https://api.cloudflare.com/client/v4/zones/89215efb800fcc1bdc2cb1ca528eae59/dns_records" \
  -H "Authorization: Bearer s3BUpfG8KqcRoxVgwmyCSqJ3ho3R_ClCEpI4tEXJ" \
  -H "Content-Type: application/json" \
  --data '{"type":"TXT","name":"dkim._domainkey","content":"v=DKIM1; k=rsa; p=YOUR_DKIM_PUBLIC_KEY","ttl":3600}'
```

**What this does:** Publishes the public key so recipients can verify DKIM signatures.

---

### Step 8: Wait for DNS Propagation

Wait 5-10 minutes for DNS changes to propagate worldwide.

---

### Step 9: Verify DNS Records

```bash
nslookup -type=MX paddie.io
nslookup -type=TXT paddie.io
nslookup -type=TXT dkim._domainkey.paddie.io
```

All should return the values you configured.

---

### Step 10: Create a Test Mailbox (Optional)

SSH back into the server:

```bash
ssh seemplify@4.180.153.209
```

Generate a password hash:
```bash
docker exec mailcowdockerized-dovecot-mailcow-1 doveadm pw -s SSHA256
```

Enter your desired password when prompted. Copy the output.

Create the mailbox:
```bash
docker exec mailcowdockerized-mysql-mailcow-1 mysql -u mailcow -p3w8aLaw8jyknrgbs3qFfDgdD4LRQ mailcow -e "
INSERT INTO mailbox (username, password, name, maildir, quota, local_part, domain, active)
VALUES ('info@paddie.io', '{SSHA256}YOUR_HASHED_PASSWORD', 'Info', 'paddie.io/info/', 3221225472, 'info', 'paddie.io', 1);
"
```

---

### Step 11: Send Test Email

```bash
docker exec mailcowdockerized-postfix-mailcow-1 sendmail -f info@paddie.io check-auth@verifier.port25.com <<EOF
Subject: Authentication Test from paddie.io
From: info@paddie.io

Testing SPF, DKIM, and DMARC for paddie.io.
EOF
```

You'll receive an automated reply showing pass/fail for each authentication method.

---

## ✅ Success Criteria

- [ ] Domain `paddie.io` appears in Mailcow database
- [ ] DKIM key generated and stored
- [ ] MX record points to `mail.seemplifyai.com`
- [ ] SPF record authorizes the mail server
- [ ] DKIM record contains the public key
- [ ] DMARC record is configured
- [ ] Test email shows SPF: pass, DKIM: pass, DMARC: pass

---

## 🔧 Troubleshooting

### "Domain already exists" error
```bash
docker exec mailcowdockerized-mysql-mailcow-1 mysql -u mailcow -p3w8aLaw8jyknrgbs3qFfDgdD4LRQ mailcow -e "DELETE FROM domain WHERE domain='paddie.io';"
```
Then retry Step 3.

### DNS not propagating
- Check Cloudflare dashboard for the records
- Use `dig` instead of `nslookup`: `dig TXT paddie.io`
- Wait up to 24 hours for full propagation

### DKIM key not found
Restart rspamd to regenerate:
```bash
cd /data/mailcow && docker compose restart rspamd-mailcow
```

---

## 📂 Related Documentation

| File | Location |
|------|----------|
| Mailcow Credentials | `access/MAILCOW-CREDENTIALS.md` |
| DKIM CLI Setup | `access/MAILCOW-DKIM-SETUP-CLI.md` |
| Server Access | `access/SERVER-ACCESS.md` |
