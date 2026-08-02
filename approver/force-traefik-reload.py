#!/usr/bin/env python3
"""
Force Dokploy to regenerate Traefik configuration by touching domain records.
"""
import subprocess
from datetime import datetime

BACKEND_APP_ID = '72cc56e8-1123-4e22-beeb-04c8184405e4'
FRONTEND_APP_ID = '063229c9-ed49-49be-a331-92c8c47422bc'

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
    print("=== Force Traefik Configuration Reload ===\n")
    
    # Update domain updatedAt to trigger Traefik reload
    for app_id, label in [
        (BACKEND_APP_ID, 'Backend'),
        (FRONTEND_APP_ID, 'Frontend'),
    ]:
        print(f"Updating {label} domain timestamp...")
        now = datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S.%f')[:-3] + '+00'
        run_sql_write(f"""
            UPDATE domain
            SET "updatedAt" = '{now}'
            WHERE "applicationId" = '{app_id}';
        """)
        print(f"  Updated {label} domain timestamp")
    
    print("\n=== Done ===")
    print("Traefik should reload configuration. Wait 30 seconds, then test.")
    return 0

if __name__ == '__main__':
    exit(main())
