#!/usr/bin/env python3
"""
Fix UBA FastLane Dokploy build context - set customGitBuildPath=NULL to prevent
path doubling (e.g. code/uba_branch_optimsation/uba_branch_optimsation).
Run on the server: python3 fix-uba-build-context.py
See: DEV-ENVIRONMENT-WORKING-GUIDE.md
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

APP_ID = '_3NtFvqF3tUk2gEiRVIzE'

print("Fixing UBA FastLane build context (customGitBuildPath=NULL to avoid path doubling)...")

run_sql_write(f"""
    UPDATE application
    SET "buildPath" = NULL,
        "customGitBuildPath" = NULL,
        "customGitBranch" = 'master',
        dockerfile = './uba_branch_optimsation/Dockerfile',
        "dockerContextPath" = './uba_branch_optimsation',
        "applicationStatus" = 'idle'
    WHERE "applicationId" = '{APP_ID}';
""")

print("Done. Redeploy the UBA app in Dokploy.")
