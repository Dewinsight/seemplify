#!/usr/bin/env python3
"""
Restart approver containers to pick up new domain configuration.
"""
import subprocess

def restart_container(app_name):
    """Restart container by app name"""
    containers = subprocess.check_output(
        ['docker', 'ps', '--filter', f'name={app_name}', '--format', '{{.Names}}']
    ).decode().strip().split('\n')
    
    for container in containers:
        if container.strip():
            print(f"Restarting {container}...")
            subprocess.run(['docker', 'restart', container.strip()], check=True)
            print(f"  Restarted {container}")

def main():
    print("=== Restarting Approver Containers ===\n")
    restart_container('approver-backend')
    restart_container('approver-frontend')
    print("\n=== Done ===")
    print("Containers restarted. Wait 30 seconds for them to be healthy, then test:")
    print("  curl https://api.approver.seemplifyai.com/api/health")
    return 0

if __name__ == '__main__':
    exit(main())
