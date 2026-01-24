#!/usr/bin/env python3
"""
Configure domains for approver-backend and approver-frontend in Dokploy/Traefik.
Matches Cloudflare DNS: api.approver and approver -> 4.180.153.209.

Dokploy domain table: domainId, host, https, port, path, applicationId, certificateType, ...
- Backend:  api.approver.aiinigeria.com -> port 80
- Frontend: approver.aiinigeria.com -> port 80

Run on server: python3 setup-approver-domains-traefik.py
"""
import subprocess
from datetime import datetime

BACKEND_APP_ID = '72cc56e8-1123-4e22-beeb-04c8184405e4'
FRONTEND_APP_ID = '063229c9-ed49-49be-a331-92c8c47422bc'
BACKEND_DOMAIN = 'api.approver.aiinigeria.com'
FRONTEND_DOMAIN = 'approver.aiinigeria.com'
CONTAINER_PORT = 80  # Dockerfiles EXPOSE 80


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
    print("=== Configure Approver Domains in Dokploy (Traefik) ===\n")
    print("Backend: ", BACKEND_DOMAIN, " -> container port", CONTAINER_PORT)
    print("Frontend:", FRONTEND_DOMAIN, " -> container port", CONTAINER_PORT)

    for app_id, label, host in [
        (BACKEND_APP_ID, 'approver-backend', BACKEND_DOMAIN),
        (FRONTEND_APP_ID, 'approver-frontend', FRONTEND_DOMAIN),
    ]:
        print(f"\n--- {label} ---")
        row = run_sql(f"""
            SELECT "domainId", host, port, https, "certificateType"
            FROM domain
            WHERE "applicationId" = '{app_id}' AND host = '{host}';
        """, silent=True)
        if row and row.strip():
            did, h, port, https, cert = row.strip().split('|')[:5]
            print(f"  Existing: host={h}, port={port}, https={https}, cert={cert}")
            if str(port) != str(CONTAINER_PORT):
                run_sql_write(f"""
                    UPDATE domain
                    SET port = {CONTAINER_PORT}, https = true, "certificateType" = 'letsencrypt'
                    WHERE "domainId" = '{did}';
                """)
                print(f"  Updated port -> {CONTAINER_PORT}, HTTPS, letsencrypt")
            else:
                # Ensure HTTPS and letsencrypt
                run_sql_write(f"""
                    UPDATE domain
                    SET https = true, "certificateType" = 'letsencrypt'
                    WHERE "domainId" = '{did}';
                """)
                print(f"  Ensured https=true, certificateType=letsencrypt")
        else:
            # Check if any domain for this app (we can add or fix host)
            any_row = run_sql(f"""
                SELECT "domainId", host, port FROM domain WHERE "applicationId" = '{app_id}' LIMIT 1;
            """, silent=True)
            if any_row and any_row.strip():
                did, old_host, port = any_row.strip().split('|')[:3]
                print(f"  Updating host from '{old_host}' to '{host}', port -> {CONTAINER_PORT}")
                run_sql_write(f"""
                    UPDATE domain
                    SET host = '{host}', port = {CONTAINER_PORT}, https = true, "certificateType" = 'letsencrypt'
                    WHERE "domainId" = '{did}';
                """)
                print(f"  Updated.")
            else:
                # Insert: domainId, host, https, port, path, createdAt, applicationId, certificateType, domainType
                import uuid as _u
                did = str(_u.uuid4())
                now = datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S.%f')[:-3] + '+00'
                run_sql_write(f"""
                    INSERT INTO domain ("domainId", host, https, port, path, "createdAt", "applicationId", "certificateType", "domainType")
                    VALUES ('{did}', '{host}', true, {CONTAINER_PORT}, '/', '{now}', '{app_id}', 'letsencrypt', 'application');
                """)
                print(f"  Inserted: {host} (port {CONTAINER_PORT}, HTTPS, letsencrypt)")

    print("\n=== Done ===")
    print("Traefik picks up domain config via Dokploy (hot reload for Applications).")
    print("If containers listen on 80, ensure domain port is 80. Redeploy apps if needed.")
    print("\n  Backend:  https://" + BACKEND_DOMAIN)
    print("  Frontend: https://" + FRONTEND_DOMAIN)
    return 0


if __name__ == '__main__':
    exit(main())
