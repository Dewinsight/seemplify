#!/usr/bin/env python3
"""
Check current domain configuration in Dokploy and identify DNS records needed.
"""
import subprocess

BACKEND_APP_ID = '72cc56e8-1123-4e22-beeb-04c8184405e4'
FRONTEND_APP_ID = '063229c9-ed49-49be-a331-92c8c47422bc'
BACKEND_DOMAIN = 'api.approver.aiinigeria.com'
FRONTEND_DOMAIN = 'approver.aiinigeria.com'
SERVER_IP = '4.180.153.209'


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


def main():
    print("=== Approver DNS Requirements Check ===\n")
    print(f"Server IP: {SERVER_IP}\n")
    
    # Check domain configuration in Dokploy
    print("Checking Dokploy domain configuration...")
    for app_id, label, host in [
        (BACKEND_APP_ID, 'Backend', BACKEND_DOMAIN),
        (FRONTEND_APP_ID, 'Frontend', FRONTEND_DOMAIN),
    ]:
        print(f"\n{label} ({host}):")
        row = run_sql(f"""
            SELECT "domainId", host, port, https, "certificateType"
            FROM domain
            WHERE "applicationId" = '{app_id}' AND host = '{host}';
        """, silent=True)
        
        if row and row.strip():
            parts = row.strip().split('|')
            if len(parts) >= 5:
                did, h, port, https, cert = parts[:5]
                print(f"  Configured in Dokploy: host={h}, port={port}, https={https}, cert={cert}")
            else:
                print(f"  Found domain entry: {row}")
        else:
            print(f"  WARNING: Domain not configured in Dokploy!")
    
    # Check container status
    print("\n\nChecking container status...")
    containers = subprocess.check_output(
        ['docker', 'ps', '--filter', 'name=approver', '--format', '{{.Names}}\t{{.Status}}']
    ).decode().strip()
    
    if containers:
        print("Running containers:")
        for line in containers.split('\n'):
            if line.strip():
                print(f"  {line}")
    else:
        print("  WARNING: No approver containers found!")
    
    # DNS Requirements
    print("\n\n=== DNS RECORDS NEEDED IN CLOUDFLARE ===")
    print("\nFor domain: aiinigeria.com")
    print("\nAdd these A records:\n")
    print(f"1. Backend API:")
    print(f"   Type: A")
    print(f"   Name: api.approver")
    print(f"   Content: {SERVER_IP}")
    print(f"   TTL: Auto (or 300)")
    print(f"   Proxied: No (gray cloud - DNS only)")
    print(f"\n2. Frontend:")
    print(f"   Type: A")
    print(f"   Name: approver")
    print(f"   Content: {SERVER_IP}")
    print(f"   TTL: Auto (or 300)")
    print(f"   Proxied: No (gray cloud - DNS only)")
    print("\nNOTE: Make sure 'Proxied' is OFF (gray cloud) for both records.")
    print("      Traefik handles SSL certificates via Let's Encrypt.")
    print("\nAfter adding these records, wait 1-5 minutes for DNS propagation.")
    print("Then verify with: nslookup api.approver.aiinigeria.com")
    print("                  nslookup approver.aiinigeria.com")
    
    return 0


if __name__ == '__main__':
    exit(main())
