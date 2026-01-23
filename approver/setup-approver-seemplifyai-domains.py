#!/usr/bin/env python3
"""
Setup Approver domains using seemplifyai.com (we have Cloudflare access).
1. Update Dokploy domain configuration
2. Add DNS records to Cloudflare
3. Update environment variables (FRONTEND_URL)
"""
import subprocess
import requests
import json
from datetime import datetime

# Dokploy configuration
BACKEND_APP_ID = '72cc56e8-1123-4e22-beeb-04c8184405e4'
FRONTEND_APP_ID = '063229c9-ed49-49be-a331-92c8c47422bc'
BACKEND_DOMAIN = 'api.approver.seemplifyai.com'
FRONTEND_DOMAIN = 'approver.seemplifyai.com'
CONTAINER_PORT = 80
SERVER_IP = '4.180.153.209'

# Cloudflare configuration
CLOUDFLARE_ZONE_ID = 'bbc142d2d661d64011e2e4becae7a5c3'
CLOUDFLARE_API_TOKEN = 's3BUpfG8KqcRoxVgwmyCSqJ3ho3R_ClCEpI4tEXJ'


def run_sql(query, silent=False):
    pc = subprocess.check_output(
        ['docker', 'ps', '--filter', 'name=dokploy-postgres', '--format', '{{.Names}}']
    ).decode().strip().split('\n')[0]
    out = subprocess.run(
        ['docker', 'exec', pc, 'psql', '-U', 'dokploy', '-d', 'dokploy', '-t', '-A', '-c', query],
        capture_output=True, text=True
    )
    if out.returncode != 0 and not silent:
        raise RuntimeError(out.stderr or out.stdout)
    return (out.stdout or '').strip()


def run_sql_write(query):
    pc = subprocess.check_output(
        ['docker', 'ps', '--filter', 'name=dokploy-postgres', '--format', '{{.Names}}']
    ).decode().strip().split('\n')[0]
    r = subprocess.run(
        ['docker', 'exec', pc, 'psql', '-U', 'dokploy', '-d', 'dokploy', '-c', query],
        capture_output=True, text=True
    )
    if r.returncode != 0:
        print("SQL error:", r.stderr or r.stdout)
        raise SystemExit(1)


def add_cloudflare_dns(name, ip, proxied=False):
    """Add or update DNS record in Cloudflare"""
    headers = {
        'Authorization': f'Bearer {CLOUDFLARE_API_TOKEN}',
        'Content-Type': 'application/json'
    }
    
    # Check if record exists
    check_url = f'https://api.cloudflare.com/client/v4/zones/{CLOUDFLARE_ZONE_ID}/dns_records?type=A&name={name}'
    response = requests.get(check_url, headers=headers)
    
    if response.status_code == 200:
        data = response.json()
        if data.get('result') and len(data['result']) > 0:
            # Update existing record
            record_id = data['result'][0]['id']
            update_url = f'https://api.cloudflare.com/client/v4/zones/{CLOUDFLARE_ZONE_ID}/dns_records/{record_id}'
            payload = {
                'type': 'A',
                'name': name,
                'content': ip,
                'ttl': 3600,
                'proxied': proxied
            }
            response = requests.put(update_url, headers=headers, json=payload)
            if response.status_code == 200:
                print(f"  Updated DNS record: {name} -> {ip}")
                return True
            else:
                print(f"  Failed to update DNS: {response.text}")
                return False
    
    # Create new record
    create_url = f'https://api.cloudflare.com/client/v4/zones/{CLOUDFLARE_ZONE_ID}/dns_records'
    payload = {
        'type': 'A',
        'name': name,
        'content': ip,
        'ttl': 3600,
        'proxied': proxied
    }
    response = requests.post(create_url, headers=headers, json=payload)
    if response.status_code == 200:
        print(f"  Created DNS record: {name} -> {ip}")
        return True
    else:
        print(f"  Failed to create DNS: {response.text}")
        return False


def update_dokploy_domain(app_id, label, host):
    """Update or create domain entry in Dokploy"""
    print(f"\n--- {label} ({host}) ---")
    
    # Check if domain exists
    row = run_sql(f"""
        SELECT "domainId", host, port, https, "certificateType"
        FROM domain
        WHERE "applicationId" = '{app_id}' AND host = '{host}';
    """, silent=True)
    
    if row and row.strip():
        did, h, port, https, cert = row.strip().split('|')[:5]
        print(f"  Domain exists: host={h}, port={port}, https={https}, cert={cert}")
        # Update to ensure correct settings
        run_sql_write(f"""
            UPDATE domain
            SET host = '{host}', port = {CONTAINER_PORT}, https = true, "certificateType" = 'letsencrypt'
            WHERE "domainId" = '{did}';
        """)
        print(f"  Updated domain configuration")
    else:
        # Check if any domain exists for this app (update it)
        any_row = run_sql(f"""
            SELECT "domainId", host, port FROM domain WHERE "applicationId" = '{app_id}' LIMIT 1;
        """, silent=True)
        
        if any_row and any_row.strip():
            did, old_host, port = any_row.strip().split('|')[:3]
            print(f"  Updating existing domain from '{old_host}' to '{host}'")
            run_sql_write(f"""
                UPDATE domain
                SET host = '{host}', port = {CONTAINER_PORT}, https = true, "certificateType" = 'letsencrypt'
                WHERE "domainId" = '{did}';
            """)
            print(f"  Updated domain")
        else:
            # Insert new domain
            import uuid as _u
            did = str(_u.uuid4())
            now = datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S.%f')[:-3] + '+00'
            run_sql_write(f"""
                INSERT INTO domain ("domainId", host, https, port, path, "createdAt", "applicationId", "certificateType", "domainType")
                VALUES ('{did}', '{host}', true, {CONTAINER_PORT}, '/', '{now}', '{app_id}', 'letsencrypt', 'application');
            """)
            print(f"  Created new domain entry")


def update_backend_env():
    """Update backend environment variables with new FRONTEND_URL"""
    print("\n--- Updating Backend Environment Variables ---")
    
    # Get current env
    current_env = run_sql(f"SELECT env FROM application WHERE \"applicationId\" = '{BACKEND_APP_ID}';", silent=True)
    
    if current_env:
        # Update FRONTEND_URL in env string
        import re
        updated_env = re.sub(
            r'FRONTEND_URL=.*',
            f'FRONTEND_URL=https://{FRONTEND_DOMAIN}',
            current_env
        )
        
        # Escape single quotes for SQL
        env_escaped = updated_env.replace("'", "''")
        
        run_sql_write(f"""
            UPDATE application 
            SET env = E'{env_escaped}'
            WHERE "applicationId" = '{BACKEND_APP_ID}';
        """)
        print(f"  Updated FRONTEND_URL to https://{FRONTEND_DOMAIN}")
    else:
        print("  WARNING: No environment variables found to update")


def main():
    print("=== Setup Approver Domains with seemplifyai.com ===\n")
    print(f"Backend:  {BACKEND_DOMAIN}")
    print(f"Frontend: {FRONTEND_DOMAIN}")
    print(f"Server IP: {SERVER_IP}\n")
    
    # Step 1: Update Dokploy domain configuration
    print("Step 1: Updating Dokploy domain configuration...")
    update_dokploy_domain(BACKEND_APP_ID, 'approver-backend', BACKEND_DOMAIN)
    update_dokploy_domain(FRONTEND_APP_ID, 'approver-frontend', FRONTEND_DOMAIN)
    
    # Step 2: Add DNS records to Cloudflare
    print("\nStep 2: Adding DNS records to Cloudflare...")
    print(f"  Zone ID: {CLOUDFLARE_ZONE_ID}")
    
    # Backend DNS: api.approver.seemplifyai.com
    add_cloudflare_dns('api.approver', SERVER_IP, proxied=False)
    
    # Frontend DNS: approver.seemplifyai.com
    add_cloudflare_dns('approver', SERVER_IP, proxied=False)
    
    # Step 3: Update backend environment variables
    print("\nStep 3: Updating backend environment variables...")
    update_backend_env()
    
    print("\n=== Done ===")
    print(f"\nDomains configured:")
    print(f"  Backend:  https://{BACKEND_DOMAIN}")
    print(f"  Frontend: https://{FRONTEND_DOMAIN}")
    print("\nDNS records added to Cloudflare (proxied=false for Let's Encrypt)")
    print("Wait 1-5 minutes for DNS propagation, then test:")
    print(f"  curl https://{BACKEND_DOMAIN}/api/health")
    print(f"  curl -I https://{FRONTEND_DOMAIN}")
    
    return 0


if __name__ == '__main__':
    exit(main())
