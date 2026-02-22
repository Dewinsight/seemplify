#!/usr/bin/env python3
"""Fix UBA FastLane Dokploy build context - run on server: python3 fix-uba-build-context.py"""
import subprocess

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

print("Updating UBA FastLane build context (like approver)...")
run_sql_write(f"""
    UPDATE application
    SET "buildPath" = './uba_branch_optimsation',
        "customGitBuildPath" = './uba_branch_optimsation',
        dockerfile = './uba_branch_optimsation/Dockerfile',
        "dockerContextPath" = './uba_branch_optimsation',
        "applicationStatus" = 'idle'
    WHERE "applicationId" = '{APP_ID}';
""")
print("Done. Redeploy in Dokploy.")
