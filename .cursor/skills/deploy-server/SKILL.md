---
name: deploy-server
description: Deploy applications to the Seemplify server (Dokploy on Azure VM), manage Cloudflare DNS records, and access credentials from the access/ directory. Use when deploying applications, managing DNS records, accessing server credentials, SSH connections, Dokploy API operations, Cloudflare operations, or when the user mentions deployment, server access, DNS, or @access/ directory.
---

# Server Deployment & Access Management

## Overview

This skill helps deploy applications to the Seemplify server infrastructure and **accesses ALL credentials and files stored in the `access/` directory**. The server runs Dokploy on Azure VM at `4.180.153.209:3000`.

**Key Capabilities:**
- ✅ Read ANY file from `access/` directory (markdown, shell scripts, keys, JSON, etc.)
- ✅ Extract credentials from any format (KEY=VALUE, KEY: VALUE, markdown tables, JSON)
- ✅ Deploy applications via Dokploy API, SSH, or GitHub Actions
- ✅ Manage Cloudflare DNS records
- ✅ Access SSH keys, database credentials, API tokens, and all secrets
- ✅ Execute scripts from `access/` directory
- ✅ Search across all files in `access/` for specific credentials

## Access Directory Structure

The `access/` directory (gitignored) contains all credentials, secrets, and deployment documentation. **Always read credentials from `access/` directory, never hardcode them.**

### Credential Files
- `DOKPLOY-CREDENTIALS.md` - Dokploy API keys, tokens, admin credentials
- `CLOUDFLARE-CREDENTIALS.md` - Cloudflare API tokens and zone information
- `DATABASE-CREDENTIALS.md` - MongoDB Atlas connection strings, database passwords
- `SERVER-ACCESS.md` - SSH credentials, server access details
- `MAILCOW-CREDENTIALS.md` - Mailcow email server credentials
- `MAILCOW-DKIM-SETUP-CLI.md` - Mailcow DKIM configuration
- `GITHUB-SECRETS-SETUP-GUIDE.md` - GitHub Actions secrets configuration
- `AZURE-NYLAS-SETUP.md` - Azure Nylas integration credentials
- `GOOGLE-NYLAS-SETUP.md` - Google OAuth/Nylas credentials
- `credentials.sh` - Shell script with environment variables (if exists)

### SSH Keys & Certificates
- `id_rsa` - Private SSH key
- `id_rsa.pub` - Public SSH key
- `*.pem` - PEM format certificates/keys
- `*.key` - Private key files

### Documentation Files
- `DOKPLOY-DEV-APPS-SETUP-GUIDE.md` - Dev environment setup guide
- `DEV-ENVIRONMENT-MASTER-GUIDE.md` - Complete dev environment guide
- `BRANCHING-STRATEGY-GUIDE.md` - Git branching strategy
- `APPROVER-WORKFLOW-ANALYSIS.md` - Approver deployment analysis

### Generic Access Pattern
```bash
# List all files in access directory
ls -la access/

# Read any file from access directory
cat access/FILENAME.md
cat access/FILENAME.sh
cat access/FILENAME.key

# Find files by pattern
find access/ -name "*CREDENTIALS*"
find access/ -name "*.md"
find access/ -name "*.sh"
find access/ -name "*.key" -o -name "*.pem"
```

## Server Information

| Property | Value |
|----------|-------|
| **Server IP** | 4.180.153.209 |
| **Dokploy URL** | http://4.180.153.209:3000 |
| **SSH User** | seemplify |
| **SSH Command** | `ssh seemplify@4.180.153.209` |

## Cloudflare Configuration

| Property | Value |
|----------|-------|
| **Domain** | seemplifyai.com |
| **Zone ID** | bbc142d2d661d64011e2e4becae7a5c3 |
| **Account ID** | 7d0fccec5afa3c1f455f7ff6a48b4e8f |
| **API Token** | Read from `access/CLOUDFLARE-CREDENTIALS.md` or `CLOUD-INFRASTRUCTURE.md` |

**Note:** The domain `paddie.io` is also accessible but should NOT be modified for Seemplify deployments.

## Deployment Methods

### 1. Dokploy API Deployment

**Get API Token:**
```bash
# Read from access directory
cat access/DOKPLOY-CREDENTIALS.md
```

**Deploy via API:**
```bash
# Set token from access directory
DOKPLOY_TOKEN=$(grep "API_KEY" access/DOKPLOY-CREDENTIALS.md | cut -d'=' -f2)
DOKPLOY_URL="http://4.180.153.209:3000"

# Trigger deployment
curl -X POST "$DOKPLOY_URL/api/application.deploy" \
  -H "x-api-key: $DOKPLOY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"applicationId": "APP_ID_HERE"}'
```

### 2. SSH Deployment

**Connect via SSH:**
```bash
# Use SSH key from access directory if available
ssh -i access/id_rsa seemplify@4.180.153.209

# Or use password authentication
ssh seemplify@4.180.153.209
```

**Common SSH Operations:**
```bash
# Pull latest code
ssh seemplify@4.180.153.209 "cd ~/seemplify && git pull origin main"

# Check running containers
ssh seemplify@4.180.153.209 "docker ps"

# View logs
ssh seemplify@4.180.153.209 "docker logs CONTAINER_NAME"

# Restart service
ssh seemplify@4.180.153.209 "docker restart CONTAINER_NAME"
```

### 3. GitHub Actions Deployment

**Trigger via GitHub CLI:**
```bash
# List workflows
gh workflow list

# Trigger deployment workflow
gh workflow run deploy-approver.yml

# View workflow runs
gh run list --workflow=deploy-approver.yml

# View specific run
gh run view RUN_ID
```

**Deployment Scripts:**
- `scripts/deploy-dev-final.sh` - Deploy all dev applications
- `scripts/deploy-dev-apps.sh` - Deploy specific apps
- `approver/deploy-approver.sh` - Deploy approver app
- `scripts/deploy-full.ps1` - PowerShell deployment script

### 4. Cloudflare DNS Management

**Using Wrangler CLI:**
```bash
# Authenticate (if not already)
wrangler login

# List DNS records for seemplifyai.com
wrangler dns list --zone=bbc142d2d661d64011e2e4becae7a5c3

# Create A record (point subdomain to server)
wrangler dns create --zone=bbc142d2d661d64011e2e4becae7a5c3 \
  --name="subdomain" \
  --type="A" \
  --content="4.180.153.209" \
  --ttl=3600 \
  --proxied=true

# Create CNAME record
wrangler dns create --zone=bbc142d2d661d64011e2e4becae7a5c3 \
  --name="www" \
  --type="CNAME" \
  --content="seemplifyai.com" \
  --proxied=true
```

**Using Cloudflare API (curl):**
```bash
# Read API token from access directory
CLOUDFLARE_TOKEN=$(grep "CLOUDFLARE_API_TOKEN" access/CLOUDFLARE-CREDENTIALS.md 2>/dev/null | cut -d'=' -f2 || echo "s3BUpfG8KqcRoxVgwmyCSqJ3ho3R_ClCEpI4tEXJ")
ZONE_ID="bbc142d2d661d64011e2e4becae7a5c3"

# List all DNS records
curl -X GET "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records" \
  -H "Authorization: Bearer ${CLOUDFLARE_TOKEN}" \
  -H "Content-Type: application/json"

# Create A record
curl -X POST "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records" \
  -H "Authorization: Bearer ${CLOUDFLARE_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{
    "type": "A",
    "name": "subdomain",
    "content": "4.180.153.209",
    "ttl": 3600,
    "proxied": true
  }'

# Update existing DNS record
curl -X PUT "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records/${RECORD_ID}" \
  -H "Authorization: Bearer ${CLOUDFLARE_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{
    "type": "A",
    "name": "subdomain",
    "content": "4.180.153.209",
    "ttl": 3600,
    "proxied": true
  }'

# Delete DNS record
curl -X DELETE "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records/${RECORD_ID}" \
  -H "Authorization: Bearer ${CLOUDFLARE_TOKEN}" \
  -H "Content-Type: application/json"
```

**Using PowerShell Scripts:**
```powershell
# Check Cloudflare domains
.\check-cloudflare.ps1

# Create DNS records (if script exists)
.\scripts\create-dns-records.ps1
.\scripts\setup-dev-dns.ps1
```

## Application IDs

Common application IDs (verify in Dokploy dashboard):

**Dev Environment:**
- `dev-idp-001-seemplify` - Identity Provider Dev
- `dev-rec-be-001-seemp` - Recruiter Backend Dev
- `dev-rec-fe-001-seemp` - Recruiter Frontend Dev
- `dev-lv-be-001-seemp` - Leave Backend Dev
- `dev-lv-fe-001-seemp` - Leave Frontend Dev
- `dev-pf-be-001-seemp` - Performance Backend Dev
- `dev-pf-fe-001-seemp` - Performance Frontend Dev
- `dev-py-be-001-seemp` - Payroll Backend Dev
- `dev-py-fe-001-seemp` - Payroll Frontend Dev

## Reading Credentials from access/

### Generic File Reading

**Read any file:**
```bash
# Read markdown files
cat access/FILENAME.md

# Read shell scripts
cat access/FILENAME.sh
source access/FILENAME.sh  # If it exports environment variables

# Read key files (be careful with permissions)
cat access/FILENAME.key
cat access/FILENAME.pem

# List all files
ls -la access/
find access/ -type f
```

**Search for credentials:**
```bash
# Find files containing a keyword
grep -r "KEYWORD" access/

# Find files by name pattern
find access/ -name "*CREDENTIALS*"
find access/ -name "*TOKEN*"
find access/ -name "*SECRET*"
```

### Dokploy Credentials
```bash
# Read full Dokploy credentials file
cat access/DOKPLOY-CREDENTIALS.md

# Extract specific values (various formats)
grep "API_KEY" access/DOKPLOY-CREDENTIALS.md
grep "API_TOKEN" access/DOKPLOY-CREDENTIALS.md
grep "ADMIN_EMAIL" access/DOKPLOY-CREDENTIALS.md
grep "ADMIN_PASSWORD" access/DOKPLOY-CREDENTIALS.md

# Extract value after equals sign
grep "API_KEY" access/DOKPLOY-CREDENTIALS.md | cut -d'=' -f2
grep "API_KEY" access/DOKPLOY-CREDENTIALS.md | awk -F'=' '{print $2}'
```

### SSH Keys & Server Access
```bash
# List all SSH keys
ls -la access/*.pem access/*.key access/id_rsa* 2>/dev/null

# Check for specific key files
[ -f access/id_rsa ] && echo "id_rsa exists" || echo "id_rsa not found"
[ -f access/server.pem ] && echo "server.pem exists" || echo "not found"

# Use SSH key for connection
ssh -i access/id_rsa seemplify@4.180.153.209
ssh -i access/server.pem seemplify@4.180.153.209

# Read server access information
cat access/SERVER-ACCESS.md 2>/dev/null || echo "File not found"
```

### Database Credentials
```bash
# Read database credentials
cat access/DATABASE-CREDENTIALS.md 2>/dev/null

# Extract MongoDB connection strings
grep "MONGODB_URI" access/DATABASE-CREDENTIALS.md
grep "MONGODB" access/DATABASE-CREDENTIALS.md | cut -d'=' -f2

# Extract database names
grep "DATABASE" access/DATABASE-CREDENTIALS.md
```

### Cloudflare Credentials
```bash
# Read Cloudflare credentials file
cat access/CLOUDFLARE-CREDENTIALS.md 2>/dev/null

# Extract API token (try multiple patterns)
grep "CLOUDFLARE_API_TOKEN" access/CLOUDFLARE-CREDENTIALS.md 2>/dev/null | cut -d'=' -f2
grep "API_TOKEN" access/CLOUDFLARE-CREDENTIALS.md 2>/dev/null | cut -d'=' -f2
grep "Token" access/CLOUDFLARE-CREDENTIALS.md 2>/dev/null | grep -i cloudflare

# Fallback to CLOUD-INFRASTRUCTURE.md if file doesn't exist
cat access/CLOUDFLARE-CREDENTIALS.md 2>/dev/null || grep "CLOUDFLARE_API_TOKEN" CLOUD-INFRASTRUCTURE.md
```

### Mailcow Credentials
```bash
# Read Mailcow credentials
cat access/MAILCOW-CREDENTIALS.md 2>/dev/null

# Read DKIM setup guide
cat access/MAILCOW-DKIM-SETUP-CLI.md 2>/dev/null
```

### GitHub Secrets
```bash
# Read GitHub secrets setup guide
cat access/GITHUB-SECRETS-SETUP-GUIDE.md 2>/dev/null

# Extract GitHub tokens if stored
grep "GITHUB_TOKEN" access/GITHUB-SECRETS-SETUP-GUIDE.md 2>/dev/null
```

### Nylas Integration Credentials
```bash
# Read Azure Nylas setup
cat access/AZURE-NYLAS-SETUP.md 2>/dev/null

# Read Google OAuth/Nylas setup
cat access/GOOGLE-NYLAS-SETUP.md 2>/dev/null
```

### Environment Variable Files
```bash
# Source shell script with environment variables
source access/credentials.sh 2>/dev/null

# Read and export variables
export $(grep -v '^#' access/credentials.sh | xargs) 2>/dev/null

# Read specific variable
grep "VARIABLE_NAME" access/credentials.sh | cut -d'=' -f2
```

### Documentation Files
```bash
# Read setup guides
cat access/DOKPLOY-DEV-APPS-SETUP-GUIDE.md
cat access/DEV-ENVIRONMENT-MASTER-GUIDE.md
cat access/BRANCHING-STRATEGY-GUIDE.md
cat access/APPROVER-WORKFLOW-ANALYSIS.md
```

### Generic Credential Extraction Patterns

**For KEY=VALUE format:**
```bash
grep "KEY_NAME" access/FILENAME.md | cut -d'=' -f2 | tr -d ' '
```

**For KEY: VALUE format:**
```bash
grep "KEY_NAME" access/FILENAME.md | cut -d':' -f2 | tr -d ' '
```

**For markdown tables:**
```bash
grep "KEY_NAME" access/FILENAME.md | awk '{print $NF}'
```

**For JSON format (if any):**
```bash
cat access/FILENAME.json | jq '.key_name'
```

## Accessing Everything in access/

### Universal Access Pattern

**The skill can read ANY file from the `access/` directory. Use these patterns:**

```bash
# Read any markdown file
cat access/ANY-FILE.md

# Read any shell script
cat access/ANY-SCRIPT.sh
source access/ANY-SCRIPT.sh  # If it exports variables

# Read any key/certificate file
cat access/ANY-KEY.key
cat access/ANY-CERT.pem

# Read any JSON file (if exists)
cat access/ANY-CONFIG.json | jq '.'

# Read any text file
cat access/ANY-FILE.txt
```

### File Discovery

**Find files by content:**
```bash
# Search for files containing a specific credential
grep -l "DOKPLOY" access/*
grep -l "MONGODB" access/*
grep -l "CLOUDFLARE" access/*

# Find files by extension
find access/ -name "*.md" -type f
find access/ -name "*.sh" -type f
find access/ -name "*.key" -type f
find access/ -name "*.pem" -type f
find access/ -name "*.json" -type f
```

**Find files by name pattern:**
```bash
# Find credential files
find access/ -iname "*credential*"
find access/ -iname "*secret*"
find access/ -iname "*token*"
find access/ -iname "*key*"
find access/ -iname "*password*"

# Find setup/guide files
find access/ -iname "*setup*"
find access/ -iname "*guide*"
find access/ -iname "*config*"
```

### Executing Scripts from access/

```bash
# Execute shell scripts (if executable)
bash access/SCRIPT.sh
sh access/SCRIPT.sh

# Source scripts that export variables
source access/credentials.sh

# Execute with specific shell
bash -x access/SCRIPT.sh  # Debug mode
```

### Reading Different File Formats

**Markdown files (.md):**
```bash
# Read full file
cat access/FILENAME.md

# Extract specific section
grep -A 10 "Section Name" access/FILENAME.md

# Extract table data
grep "|" access/FILENAME.md | grep -v "^---"
```

**Shell scripts (.sh):**
```bash
# Read script
cat access/FILENAME.sh

# Source to export variables
source access/FILENAME.sh

# Extract variable definitions
grep "^export" access/FILENAME.sh
grep "^[A-Z_]*=" access/FILENAME.sh
```

**Key files (.key, .pem):**
```bash
# Read key file (be careful with permissions)
cat access/FILENAME.key
cat access/FILENAME.pem

# Check key type
file access/FILENAME.key
openssl rsa -in access/FILENAME.key -text -noout 2>/dev/null
```

**JSON files (.json):**
```bash
# Read and parse JSON
cat access/FILENAME.json | jq '.'

# Extract specific value
cat access/FILENAME.json | jq '.key_name'
```

### Common Credential File Patterns

**Pattern 1: KEY=VALUE**
```bash
grep "KEY_NAME" access/FILE.md | cut -d'=' -f2 | tr -d ' "'
```

**Pattern 2: KEY: VALUE**
```bash
grep "KEY_NAME" access/FILE.md | cut -d':' -f2 | tr -d ' '
```

**Pattern 3: Markdown Table**
```bash
grep "KEY_NAME" access/FILE.md | awk -F'|' '{print $NF}' | tr -d ' '
```

**Pattern 4: YAML-like**
```bash
grep "KEY_NAME:" access/FILE.md | cut -d':' -f2 | tr -d ' '
```

**Pattern 5: JSON**
```bash
cat access/FILE.json | jq -r '.key_name'
```

### Safe Reading Best Practices

```bash
# Always check if file exists first
[ -f access/FILENAME.md ] && cat access/FILENAME.md || echo "File not found"

# Use error handling
cat access/FILENAME.md 2>/dev/null || {
    echo "Error: Could not read access/FILENAME.md" >&2
    exit 1
}

# Read with fallback
cat access/PRIMARY.md 2>/dev/null || cat access/FALLBACK.md 2>/dev/null || echo "Neither file found"
```

## Deployment Workflow

### Standard Deployment Process

1. **Read Credentials**
   ```bash
   # Read from access directory
   source access/credentials.sh 2>/dev/null || cat access/DOKPLOY-CREDENTIALS.md
   ```

2. **Verify Application**
   ```bash
   # List applications in Dokploy
   curl -X GET "$DOKPLOY_URL/api/application" \
     -H "x-api-key: $DOKPLOY_TOKEN"
   ```

3. **Trigger Deployment**
   ```bash
   # Deploy specific application
   curl -X POST "$DOKPLOY_URL/api/application.deploy" \
     -H "x-api-key: $DOKPLOY_TOKEN" \
     -H "Content-Type: application/json" \
     -d "{\"applicationId\": \"APP_ID\"}"
   ```

4. **Monitor Deployment**
   ```bash
   # Check deployment status
   ssh seemplify@4.180.153.209 "docker ps -a | grep APP_NAME"
   
   # View logs
   ssh seemplify@4.180.153.209 "docker logs APP_CONTAINER"
   ```

## Quick Commands

### Deploy All Dev Apps
```bash
# Using deployment script
./scripts/deploy-dev-final.sh

# Or manually trigger each
for app in dev-idp-001-seemplify dev-rec-be-001-seemp; do
  curl -X POST "http://4.180.153.209:3000/api/application.deploy" \
    -H "x-api-key: $(grep API_KEY access/DOKPLOY-CREDENTIALS.md | cut -d'=' -f2)" \
    -H "Content-Type: application/json" \
    -d "{\"applicationId\": \"$app\"}"
done
```

### Check Server Status
```bash
# SSH and check services
ssh seemplify@4.180.153.209 << 'EOF'
  echo "=== Docker Containers ==="
  docker ps
  echo ""
  echo "=== Disk Usage ==="
  df -h
  echo ""
  echo "=== Memory Usage ==="
  free -h
EOF
```

### View Application Logs
```bash
# Get container name
CONTAINER=$(ssh seemplify@4.180.153.209 "docker ps -q -f name=APP_NAME")

# View logs
ssh seemplify@4.180.153.209 "docker logs $CONTAINER --tail 100 -f"
```

### Manage Cloudflare DNS
```bash
# Set environment variables
export CLOUDFLARE_API_TOKEN=$(grep "CLOUDFLARE_API_TOKEN" access/CLOUDFLARE-CREDENTIALS.md 2>/dev/null | cut -d'=' -f2 || echo "s3BUpfG8KqcRoxVgwmyCSqJ3ho3R_ClCEpI4tEXJ")
export CLOUDFLARE_ZONE_ID="bbc142d2d661d64011e2e4becae7a5c3"

# List all DNS records
curl -X GET "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/dns_records" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  -H "Content-Type: application/json" | jq '.result[] | {name: .name, type: .type, content: .content}'

# Create DNS record for new app
SUBDOMAIN="new-app"
curl -X POST "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/dns_records" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data "{
    \"type\": \"A\",
    \"name\": \"${SUBDOMAIN}\",
    \"content\": \"4.180.153.209\",
    \"ttl\": 3600,
    \"proxied\": true
  }"
```

### Check Cloudflare Status
```bash
# Using PowerShell script
powershell -ExecutionPolicy Bypass -File check-cloudflare.ps1

# Or using wrangler
wrangler whoami
wrangler zones list
```

## Troubleshooting

### Cannot Access Server
1. Check SSH connection: `ssh seemplify@4.180.153.209`
2. Verify SSH key: `ls -la access/id_rsa`
3. Check network: `ping 4.180.153.209`

### Deployment Fails
1. Check Dokploy dashboard: http://4.180.153.209:3000
2. Verify API token: `cat access/DOKPLOY-CREDENTIALS.md`
3. Check application status: `curl -X GET "$DOKPLOY_URL/api/application" -H "x-api-key: $TOKEN"`

### Credentials Not Found
1. Verify access directory exists: `ls -la access/`
2. Check for credential files: `ls -la access/*.md access/*.sh`
3. Read documentation: `cat access/DOKPLOY-CREDENTIALS.md`

### Cloudflare DNS Issues
1. Verify API token: `cat access/CLOUDFLARE-CREDENTIALS.md` or check `CLOUD-INFRASTRUCTURE.md`
2. Check authentication: `wrangler whoami`
3. Verify zone ID: `wrangler zones list`
4. Test API access: `curl -X GET "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records" -H "Authorization: Bearer ${TOKEN}"`

## Security Notes

- ✅ Always read credentials from `access/` directory
- ✅ Never commit credentials to git
- ✅ Use environment variables for sensitive data
- ✅ Rotate API tokens regularly
- ✅ Use SSH keys instead of passwords when possible
- ❌ Never hardcode credentials in scripts
- ❌ Never commit `access/` directory contents

## Related Documentation

- `CLOUD-INFRASTRUCTURE.md` - Complete cloud setup
- `DOKPLOY-DEPLOYMENT-PLAN.md` - Deployment planning
- `approver/DOKPLOY-DEPLOYMENT-GUIDE.md` - Approver deployment
- `scripts/README.md` - Deployment scripts documentation

## Examples

### Example 1: Deploy Approver App
```bash
# Read credentials
TOKEN=$(grep "API_KEY" access/DOKPLOY-CREDENTIALS.md | cut -d'=' -f2)

# Deploy
curl -X POST "http://4.180.153.209:3000/api/application.deploy" \
  -H "x-api-key: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"applicationId": "approver-app-id"}'
```

### Example 2: SSH and Check Status
```bash
ssh seemplify@4.180.153.209 "docker ps | grep approver"
```

### Example 3: Read All Credentials
```bash
# List all credential files
find access/ -type f \( -name "*.md" -o -name "*.sh" -o -name "*.key" -o -name "*.pem" -o -name "*.json" \)

# Read specific credential file
cat access/DOKPLOY-CREDENTIALS.md

# Search for a credential across all files
grep -r "API_KEY" access/
grep -r "MONGODB_URI" access/
```

### Example 6: Read Any File from access/
```bash
# Generic function to read any file
read_access_file() {
    local filename=$1
    if [ -f "access/$filename" ]; then
        cat "access/$filename"
    else
        echo "File access/$filename not found" >&2
        return 1
    fi
}

# Usage examples
read_access_file DOKPLOY-CREDENTIALS.md
read_access_file SERVER-ACCESS.md
read_access_file DATABASE-CREDENTIALS.md
read_access_file credentials.sh
```

### Example 7: Extract Credentials Dynamically
```bash
# Extract any credential value by key name
extract_credential() {
    local file=$1
    local key=$2
    if [ -f "access/$file" ]; then
        # Try KEY=VALUE format
        grep "^$key=" "access/$file" 2>/dev/null | cut -d'=' -f2 | head -1
        # Try KEY: VALUE format
        grep "^$key:" "access/$file" 2>/dev/null | cut -d':' -f2 | tr -d ' ' | head -1
        # Try markdown table format
        grep "$key" "access/$file" 2>/dev/null | awk '{print $NF}' | head -1
    fi
}

# Usage
API_KEY=$(extract_credential DOKPLOY-CREDENTIALS.md API_KEY)
MONGODB_URI=$(extract_credential DATABASE-CREDENTIALS.md MONGODB_URI)
```

### Example 8: List All Available Credential Files
```bash
# List all markdown files (documentation + credentials)
ls -1 access/*.md 2>/dev/null

# List all credential-related files
find access/ -type f \( -name "*CREDENTIAL*" -o -name "*SECRET*" -o -name "*TOKEN*" -o -name "*KEY*" \)

# List all executable scripts
ls -1 access/*.sh 2>/dev/null

# List all key files
ls -1 access/*.key access/*.pem access/id_rsa* 2>/dev/null
```

### Example 9: Universal File Access
```bash
# Read ANY file from access/ directory
read_access_file() {
    local filename=$1
    if [ -f "access/$filename" ]; then
        case "$filename" in
            *.json) cat "access/$filename" | jq '.' 2>/dev/null || cat "access/$filename" ;;
            *) cat "access/$filename" ;;
        esac
    else
        echo "File access/$filename not found" >&2
        return 1
    fi
}

# Usage - read any file
read_access_file DOKPLOY-CREDENTIALS.md
read_access_file SERVER-ACCESS.md
read_access_file DATABASE-CREDENTIALS.md
read_access_file MAILCOW-CREDENTIALS.md
read_access_file credentials.sh
read_access_file config.json
```

### Example 10: Search All Files for Credential
```bash
# Search for a credential across ALL files in access/
search_access() {
    local search_term=$1
    echo "Searching for '$search_term' in access/..."
    grep -r "$search_term" access/ 2>/dev/null | while IFS=: read file line; do
        echo "Found in $file: $line"
    done
}

# Usage
search_access "API_KEY"
search_access "MONGODB_URI"
search_access "4.180.153.209"
```

### Example 4: Create DNS Record for New App
```bash
# Read Cloudflare token
TOKEN=$(grep "CLOUDFLARE_API_TOKEN" access/CLOUDFLARE-CREDENTIALS.md 2>/dev/null | cut -d'=' -f2 || echo "s3BUpfG8KqcRoxVgwmyCSqJ3ho3R_ClCEpI4tEXJ")
ZONE_ID="bbc142d2d661d64011e2e4becae7a5c3"

# Create A record pointing to server
curl -X POST "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{
    "type": "A",
    "name": "new-app",
    "content": "4.180.153.209",
    "ttl": 3600,
    "proxied": true
  }'
```

### Example 5: List All DNS Records
```bash
# Using Cloudflare API
TOKEN=$(grep "CLOUDFLARE_API_TOKEN" access/CLOUDFLARE-CREDENTIALS.md 2>/dev/null | cut -d'=' -f2 || echo "s3BUpfG8KqcRoxVgwmyCSqJ3ho3R_ClCEpI4tEXJ")
curl -X GET "https://api.cloudflare.com/client/v4/zones/bbc142d2d661d64011e2e4becae7a5c3/dns_records" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" | jq '.result[] | "\(.name) \(.type) \(.content)"'

# Using wrangler CLI
wrangler dns list --zone=bbc142d2d661d64011e2e4becae7a5c3
```
