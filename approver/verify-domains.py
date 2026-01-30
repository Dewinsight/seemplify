#!/usr/bin/env python3
"""
Verify and clean up domain configuration in Dokploy.
"""
import subprocess

BACKEND_APP_ID = '72cc56e8-1123-4e22-beeb-04c8184405e4'
FRONTEND_APP_ID = '063229c9-ed49-49be-a331-92c8c47422bc'
BACKEND_DOMAIN = 'api.approver.seemplifyai.com'
FRONTEND_DOMAIN = 'approver.seemplifyai.com'


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


def main():
    print("=== Verify Approver Domain Configuration ===\n")
    
    # Check all domains for both apps
    print("Checking domain configuration...")
    for app_id, label in [
        (BACKEND_APP_ID, 'Backend'),
        (FRONTEND_APP_ID, 'Frontend'),
    ]:
        print(f"\n{label} ({app_id}):")
        domains = run_sql(f"""
            SELECT "domainId", host, port, https, "certificateType"
            FROM domain
            WHERE "applicationId" = '{app_id}';
        """, silent=True)
        
        if domains:
            for domain_line in domains.split('\n'):
                if domain_line.strip():
                    parts = domain_line.strip().split('|')
                    if len(parts) >= 5:
                        did, host, port, https, cert = parts[:5]
                        print(f"  - {host} (port={port}, https={https}, cert={cert})")
        else:
            print("  No domains found!")
    
    # Check for old aiinigeria.com domains and remove them
    print("\n\nChecking for old aiinigeria.com domains...")
    old_domains = run_sql(f"""
        SELECT "domainId", host, "applicationId"
        FROM domain
        WHERE host LIKE '%aiinigeria.com%';
    """, silent=True)
    
    if old_domains and old_domains.strip():
        print("Found old domains:")
        for domain_line in old_domains.split('\n'):
            if domain_line.strip():
                did, host, app_id = domain_line.strip().split('|')[:3]
                print(f"  - {host} (app_id={app_id})")
                # Delete old domain
                run_sql_write(f"""
                    DELETE FROM domain WHERE "domainId" = '{did}';
                """)
                print(f"    Deleted {host}")
    else:
        print("  No old domains found")
    
    # Verify current domains exist
    print("\n\nVerifying current domains...")
    backend_domain = run_sql(f"""
        SELECT host FROM domain
        WHERE "applicationId" = '{BACKEND_APP_ID}' AND host = '{BACKEND_DOMAIN}';
    """, silent=True)
    
    frontend_domain = run_sql(f"""
        SELECT host FROM domain
        WHERE "applicationId" = '{FRONTEND_APP_ID}' AND host = '{FRONTEND_DOMAIN}';
    """, silent=True)
    
    if backend_domain and backend_domain.strip():
        print(f"  ✅ Backend domain configured: {BACKEND_DOMAIN}")
    else:
        print(f"  ❌ Backend domain NOT configured: {BACKEND_DOMAIN}")
    
    if frontend_domain and frontend_domain.strip():
        print(f"  ✅ Frontend domain configured: {FRONTEND_DOMAIN}")
    else:
        print(f"  ❌ Frontend domain NOT configured: {FRONTEND_DOMAIN}")
    
    print("\n=== Done ===")
    print("If domains are correct, Traefik should pick them up automatically.")
    print("You may need to wait a few minutes for SSL certificates to be generated.")
    return 0


if __name__ == '__main__':
    exit(main())
