#!/usr/bin/env python3
"""
Check deployment scripts and restart Dokploy to pick up database changes.
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


def main():
    print("=== Check Deployment Configuration ===\n")
    
    # Get all columns for both apps
    for app_id, label in [(BACKEND_APP_ID, 'approver-backend'), (FRONTEND_APP_ID, 'approver-frontend')]:
        print(f"\n--- {label} ---")
        
        # Check if deployScript column exists
        result = run_sql(f'''
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'application' 
            AND column_name LIKE '%script%' OR column_name LIKE '%deploy%';
        ''', silent=True)
        
        # Get full application config
        cols_result = run_sql(f'''
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'application' 
            ORDER BY ordinal_position;
        ''', silent=True)
        
        if cols_result:
            print("Available columns:")
            for col in cols_result.split('\n'):
                if col.strip():
                    print(f"  - {col.strip()}")
        
        # Try to get deployScript if it exists
        app_result = run_sql(f'''
            SELECT name, "createEnvFile", "buildPath"
            FROM application
            WHERE "applicationId" = '{app_id}';
        ''', silent=True)
        
        if app_result:
            parts = app_result.split('|')
            if len(parts) >= 3:
                name, create_env_file, build_path = parts[0], parts[1], parts[2]
                print(f"  Name: {name}")
                print(f"  createEnvFile: {create_env_file}")
                print(f"  buildPath: {build_path}")
    
    print("\n=== Restarting Dokploy to pick up changes ===")
    try:
        # Find dokploy container
        dokploy_container = subprocess.check_output(
            ['docker', 'ps', '--filter', 'name=dokploy', '--format', '{{.Names}}']
        ).decode().strip().split('\n')[0]
        
        print(f"Restarting {dokploy_container}...")
        subprocess.run(['docker', 'restart', dokploy_container], check=True)
        print("✅ Dokploy restarted")
        print("\nWait 10-15 seconds for Dokploy to fully restart, then redeploy.")
    except Exception as e:
        print(f"⚠️  Could not restart Dokploy: {e}")
        print("You may need to restart Dokploy manually or wait for it to pick up changes.")
    
    return 0


if __name__ == '__main__':
    exit(main())
