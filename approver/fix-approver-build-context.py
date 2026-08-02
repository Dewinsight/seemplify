#!/usr/bin/env python3
"""
Update approver application in Dokploy to use build context approver/
so the Dockerfile can access both backend/ and frontend/.
Run on the server: python3 fix-approver-build-context.py
"""
import subprocess

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

APP_ID = '9e7b7b2a-e8ba-4eac-8e2e-28216ee621cf'

print("Updating approver build path and Dockerfile to use context approver/ (backend+frontend)...")

# buildPath, dockerfile, dockerContextPath, customGitBuildPath: use approver/ so Dockerfile can COPY backend/ and frontend/
run_sql_write(f"""
    UPDATE application
    SET "buildPath" = './approver',
        "customGitBuildPath" = './approver',
        dockerfile = './approver/Dockerfile',
        "dockerContextPath" = './approver'
    WHERE "applicationId" = '{APP_ID}';
""")

print("Done. Redeploy the approver app in Dokploy so the new Dockerfile (with frontend) is used.")
