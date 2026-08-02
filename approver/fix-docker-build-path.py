#!/usr/bin/env python3
"""
Fix Docker build path issues for approver apps.
Checks and fixes buildPath and dockerfile path settings.
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
    print("=== Fix Docker Build Path Configuration ===\n")

    apps = [
        (BACKEND_APP_ID, 'approver-backend', 'approver/backend', 'approver/backend/Dockerfile'),
        (FRONTEND_APP_ID, 'approver-frontend', 'approver/frontend', 'approver/frontend/Dockerfile')
    ]

    for app_id, label, expected_build_path, expected_dockerfile in apps:
        print(f"\n--- {label} ---")
        
        # Get current values
        result = run_sql(f'''
            SELECT name, "buildPath", dockerfile
            FROM application
            WHERE "applicationId" = '{app_id}';
        ''', silent=True)
        
        if not result:
            print(f"  ⚠️  {label} not found")
            continue
        
        parts = result.split('|')
        if len(parts) < 3:
            print(f"  ⚠️  Unexpected format: {result}")
            continue
        
        name, build_path, dockerfile = parts[0], parts[1], parts[2]
        print(f"  Current buildPath: {build_path}")
        print(f"  Current dockerfile: {dockerfile}")
        
        # Fix buildPath
        if build_path != expected_build_path:
            print(f"  🔧 Updating buildPath: {build_path} -> {expected_build_path}")
            run_sql_write(f'''
                UPDATE application
                SET "buildPath" = '{expected_build_path}'
                WHERE "applicationId" = '{app_id}';
            ''')
            print(f"  ✅ Updated buildPath")
        
        # Fix dockerfile path
        if dockerfile != expected_dockerfile:
            print(f"  🔧 Updating dockerfile: {dockerfile} -> {expected_dockerfile}")
            run_sql_write(f'''
                UPDATE application
                SET dockerfile = '{expected_dockerfile}'
                WHERE "applicationId" = '{app_id}';
            ''')
            print(f"  ✅ Updated dockerfile path")
        else:
            print(f"  ✅ dockerfile path is correct")

    print("\n=== Done ===")
    print("Redeploy both apps in Dokploy UI.")
    return 0


if __name__ == '__main__':
    exit(main())
