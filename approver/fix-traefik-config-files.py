#!/usr/bin/env python3
"""
Update Traefik dynamic config files to use seemplifyai.com domains.
Dokploy generates these files but they may be cached with old domains.
"""
import subprocess
import re

BACKEND_DOMAIN = 'api.approver.seemplifyai.com'
FRONTEND_DOMAIN = 'approver.seemplifyai.com'

def update_traefik_file(container, filepath, old_domain, new_domain):
    """Read, update, and write Traefik config file"""
    # Read file
    result = subprocess.run(
        ['docker', 'exec', container, 'cat', filepath],
        capture_output=True, text=True
    )
    
    if result.returncode != 0:
        print(f"  Failed to read {filepath}: {result.stderr}")
        return False
    
    content = result.stdout
    
    # Check if update needed
    if new_domain in content and old_domain not in content:
        print(f"  Already using {new_domain}")
        return True
    
    if old_domain not in content:
        print(f"  Warning: {old_domain} not found in file")
        print(f"  File content preview: {content[:200]}")
        return False
    
    # Replace old domain with new
    updated = content.replace(old_domain, new_domain)
    
    # Write back
    write_result = subprocess.run(
        ['docker', 'exec', '-i', container, 'sh', '-c', f'cat > {filepath}'],
        input=updated,
        text=True
    )
    
    if write_result.returncode == 0:
        print(f"  Updated: {old_domain} -> {new_domain}")
        return True
    else:
        print(f"  Failed to write: {write_result.stderr}")
        return False

def main():
    print("=== Update Traefik Config Files ===\n")
    
    container = 'dokploy-traefik'
    
    # Update backend config
    print("Updating approver-backend-app.yml...")
    update_traefik_file(
        container,
        '/etc/dokploy/traefik/dynamic/approver-backend-app.yml',
        'api.approver.aiinigeria.com',
        BACKEND_DOMAIN
    )
    
    # Update frontend config
    print("\nUpdating approver-frontend-app.yml...")
    update_traefik_file(
        container,
        '/etc/dokploy/traefik/dynamic/approver-frontend-app.yml',
        'approver.aiinigeria.com',
        FRONTEND_DOMAIN
    )
    
    print("\n=== Done ===")
    print("Traefik should auto-reload (watch: true). Wait 10 seconds, then test:")
    print(f"  curl https://{BACKEND_DOMAIN}/api/health")
    return 0

if __name__ == '__main__':
    exit(main())
