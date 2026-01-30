#!/usr/bin/env python3
"""
Check and fix deployment issues for approver apps.
Checks createEnvFile, buildPath, and fixes any issues.
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
    print("=== Check and Fix Approver Deployment Issues ===\n")

    for app_id, label, expected_build_path in [
        (BACKEND_APP_ID, 'approver-backend', 'approver/backend'),
        (FRONTEND_APP_ID, 'approver-frontend', 'approver/frontend')
    ]:
        print(f"\n--- {label} ---")
        
        # Get current values
        result = run_sql(f'''
            SELECT name, "createEnvFile", "buildPath"
            FROM application
            WHERE "applicationId" = '{app_id}';
        ''', silent=True)
        
        if not result:
            print(f"  ⚠️  {label} not found in database")
            continue
        
        parts = result.split('|')
        if len(parts) < 3:
            print(f"  ⚠️  Unexpected result format: {result}")
            continue
        
        name, create_env_file, build_path = parts[0], parts[1], parts[2]
        print(f"  Name: {name}")
        print(f"  createEnvFile: {create_env_file}")
        print(f"  buildPath: {build_path}")
        
        # Fix createEnvFile
        if create_env_file.lower() in ('t', 'true', '1'):
            print(f"  🔧 Fixing createEnvFile...")
            run_sql_write(f'''
                UPDATE application
                SET "createEnvFile" = false
                WHERE "applicationId" = '{app_id}';
            ''')
            print(f"  ✅ Set createEnvFile = false")
        
        # Fix buildPath if it's doubled or wrong
        if build_path and build_path != expected_build_path:
            if build_path.endswith(f'/{expected_build_path}'):
                print(f"  🔧 Fixing doubled buildPath: {build_path} -> {expected_build_path}")
                run_sql_write(f'''
                    UPDATE application
                    SET "buildPath" = '{expected_build_path}'
                    WHERE "applicationId" = '{app_id}';
                ''')
                print(f"  ✅ Set buildPath = {expected_build_path}")
            elif build_path != expected_build_path:
                print(f"  ⚠️  buildPath is '{build_path}', expected '{expected_build_path}'")
                print(f"  🔧 Updating buildPath...")
                run_sql_write(f'''
                    UPDATE application
                    SET "buildPath" = '{expected_build_path}'
                    WHERE "applicationId" = '{app_id}';
                ''')
                print(f"  ✅ Set buildPath = {expected_build_path}")

    print("\n=== Done ===")
    print("Redeploy both apps in Dokploy UI.")
    return 0


if __name__ == '__main__':
    exit(main())
