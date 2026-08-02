#!/usr/bin/env python3
"""Check domain configuration for time-attendance apps"""
import subprocess
import sys

BACKEND_APP_ID = "gmBjqWd6pQKSWqfBIMNyL"
FRONTEND_APP_ID = "xp6sakCgL0wzSDhfpNc0r"

def main():
    # Get postgres container - use grep to filter
    result = subprocess.run(
        ['docker', 'ps', '--filter', 'name=dokploy-postgres', '--format', '{{.Names}}'],
        capture_output=True,
        text=True
    )
    containers = [c for c in result.stdout.strip().split('\n') if 'dokploy-postgres' in c]
    if not containers:
        print("No postgres container found")
        return 1
    
    container = containers[0]
    print(f"Using postgres container: {container}\n")
    
    for app_id, label in [(BACKEND_APP_ID, 'Backend'), (FRONTEND_APP_ID, 'Frontend')]:
        print(f"=== {label} ({app_id}) ===")
        result = subprocess.run(
            ['docker', 'exec', container, 'psql', '-U', 'dokploy', '-d', 'dokploy', '-t', '-A', '-c',
             f'SELECT host, port, https, "certificateType" FROM domain WHERE "applicationId" = \'{app_id}\';'],
            capture_output=True,
            text=True
        )
        if result.returncode == 0:
            output = result.stdout.strip()
            if output:
                print(f"  {output}")
            else:
                print("  No domain configured")
        else:
            print(f"  Error: {result.stderr}")
        print()
    
    return 0

if __name__ == '__main__':
    sys.exit(main())
