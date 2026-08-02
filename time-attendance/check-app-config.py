#!/usr/bin/env python3
"""Check application configuration in Dokploy database"""
import subprocess

BACKEND_APP_ID = "gmBjqWd6pQKSWqfBIMNyL"
FRONTEND_APP_ID = "xp6sakCgL0wzSDhfpNc0r"

def run_query(query):
    result = subprocess.run(
        ['docker', 'ps', '--filter', 'name=dokploy-postgres', '--format', '{{.Names}}'],
        capture_output=True,
        text=True
    )
    containers = [c for c in result.stdout.strip().split('\n') if 'dokploy-postgres' in c]
    if not containers:
        print("No postgres container found")
        return None
    
    container = containers[0]
    result = subprocess.run(
        ['docker', 'exec', container, 'psql', '-U', 'dokploy', '-d', 'dokploy', '-t', '-A', '-c', query],
        capture_output=True,
        text=True
    )
    if result.returncode == 0:
        return result.stdout.strip()
    return None

def main():
    print("=== Application Configuration Check ===\n")
    
    # Check application table columns
    print("Available columns in application table:")
    cols = run_query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'application' AND column_name LIKE '%port%';")
    print(f"  {cols}\n" if cols else "  No port columns found\n")
    
    # Check full application config
    for app_id, label in [(BACKEND_APP_ID, 'Backend'), (FRONTEND_APP_ID, 'Frontend')]:
        print(f"=== {label} ({app_id}) ===")
        
        # Get key fields
        query = f"SELECT name, env, \"appName\", \"buildType\", \"sourceType\" FROM application WHERE \"applicationId\" = '{app_id}';"
        result = run_query(query)
        if result:
            print(f"  Config: {result}")
        
        # Check domains
        query = f'SELECT host, port, https, path FROM domain WHERE "applicationId" = \'{app_id}\';'
        result = run_query(query)
        if result:
            print(f"  Domain: {result}")
        print()
    
    return 0

if __name__ == '__main__':
    exit(main())
