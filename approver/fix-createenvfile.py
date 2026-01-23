#!/usr/bin/env python3
"""
Disable createEnvFile for approver-backend and approver-frontend in Dokploy.

Dokploy with createEnvFile=true tries to write .env to a path like
  code/approver/frontend/approver/frontend/.env
(doubled build path), which fails with "Directory nonexistent".

Env is already provided via application.env at runtime; neither app needs
a .env file in the repo. Run this on the server, then redeploy.

Usage (on server):
  python3 approver/fix-createenvfile.py
"""
import subprocess

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
    print("=== Fix createEnvFile for Approver Apps ===\n")

    for app_id, label in [(BACKEND_APP_ID, 'approver-backend'), (FRONTEND_APP_ID, 'approver-frontend')]:
        name = run_sql(f'SELECT name FROM application WHERE "applicationId" = \'{app_id}\';', silent=True)
        if not name:
            print(f"  ⚠️  {label} ({app_id}) not found, skipping")
            continue
        run_sql_write(f'''
            UPDATE application
            SET "createEnvFile" = false
            WHERE "applicationId" = '{app_id}';
        ''')
        print(f"  ✅ {label}: createEnvFile = false")

    print("\n=== Done ===")
    print("Redeploy approver-backend and approver-frontend in Dokploy UI.")
    return 0


if __name__ == '__main__':
    exit(main())
