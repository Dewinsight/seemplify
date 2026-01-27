#!/usr/bin/env python3
"""Update domain ports for time-attendance apps"""
import subprocess
import sys

BACKEND_APP_ID = "gmBjqWd6pQKSWqfBIMNyL"
FRONTEND_APP_ID = "xp6sakCgL0wzSDhfpNc0r"
BACKEND_DOMAIN = "api-time.seemplifyai.com"
FRONTEND_DOMAIN = "time.seemplifyai.com"
BACKEND_PORT = 5010
FRONTEND_PORT = 5011

def main():
    # Get postgres container
    result = subprocess.run(
        ['docker', 'ps', '--filter', 'name=dokploy-postgres', '--format', '{{.Names}}'],
        capture_output=True,
        text=True
    )
    containers = [c for c in result.stdout.strip().split('\n') if 'dokploy-postgres' in c]
    if not containers:
        print("❌ No postgres container found")
        return 1
    
    container = containers[0]
    print(f"Using postgres container: {container}\n")
    
    for app_id, domain, port, label in [
        (BACKEND_APP_ID, BACKEND_DOMAIN, BACKEND_PORT, 'Backend'),
        (FRONTEND_APP_ID, FRONTEND_DOMAIN, FRONTEND_PORT, 'Frontend')
    ]:
        print(f"=== {label} ({domain}) ===")
        
        # Update port
        update_sql = f"UPDATE domain SET port = {port} WHERE \"applicationId\" = '{app_id}' AND host = '{domain}';"
        result = subprocess.run(
            ['docker', 'exec', container, 'psql', '-U', 'dokploy', '-d', 'dokploy', '-c', update_sql],
            capture_output=True,
            text=True
        )
        
        if result.returncode == 0:
            if 'UPDATE 1' in result.stdout:
                print(f"  ✅ Updated port to {port}")
            else:
                print(f"  ⚠️  No rows updated - domain might not exist")
        else:
            print(f"  ❌ Error: {result.stderr}")
        
        # Verify
        verify_sql = f'SELECT host, port FROM domain WHERE "applicationId" = \'{app_id}\' AND host = \'{domain}\';'
        result = subprocess.run(
            ['docker', 'exec', container, 'psql', '-U', 'dokploy', '-d', 'dokploy', '-t', '-A', '-c', verify_sql],
            capture_output=True,
            text=True
        )
        if result.returncode == 0 and result.stdout.strip():
            host, current_port = result.stdout.strip().split('|')
            print(f"  Current config: {host} -> port {current_port}")
        print()
    
    print("=== Done ===")
    print("Domains updated. Now redeploy applications to apply Traefik labels.")
    return 0

if __name__ == '__main__':
    sys.exit(main())
