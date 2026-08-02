#!/usr/bin/env python3
"""
Fix domain port configuration for time-attendance applications in Dokploy
This ensures Traefik routes correctly to the containers
"""

import subprocess
import sys

# Configuration
BACKEND_APP_ID = "gmBjqWd6pQKSWqfBIMNyL"
FRONTEND_APP_ID = "xp6sakCgL0wzSDhfpNc0r"
BACKEND_DOMAIN = "api-time.seemplifyai.com"
FRONTEND_DOMAIN = "time.seemplifyai.com"
BACKEND_PORT = 5010
FRONTEND_PORT = 5011

def run_sql(query, silent=False):
    """Run SQL query on Dokploy PostgreSQL database"""
    try:
        # Get postgres container
        result = subprocess.run(
            ['ssh', 'seemplify@4.180.153.209', 
             'docker ps -q -f name=dokploy-postgres'],
            capture_output=True,
            text=True,
            timeout=10
        )
        if not result.stdout.strip():
            if not silent:
                print("  [ERROR] No postgres container found")
            return None
        
        container_id = result.stdout.strip().split('\n')[0]
        
        # Run SQL query
        sql_cmd = f'docker exec {container_id} psql -U dokploy -d dokploy -t -A -c "{query}"'
        result = subprocess.run(
            ['ssh', 'seemplify@4.180.153.209', sql_cmd],
            capture_output=True,
            text=True,
            timeout=10
        )
        
        if result.returncode == 0:
            return result.stdout.strip()
        else:
            if not silent:
                print(f"  [ERROR] SQL Error: {result.stderr}")
            return None
    except Exception as e:
        if not silent:
            print(f"  [ERROR] Error: {e}")
        return None

def run_sql_write(query):
    """Run SQL write query (UPDATE/INSERT)"""
    try:
        result = subprocess.run(
            ['ssh', 'seemplify@4.180.153.209', 
             'docker ps -q -f name=dokploy-postgres'],
            capture_output=True,
            text=True,
            timeout=10
        )
        if not result.stdout.strip():
            print("  ❌ No postgres container found")
            return False
        
        container_id = result.stdout.strip().split('\n')[0]
        
        sql_cmd = f'docker exec {container_id} psql -U dokploy -d dokploy -c "{query}"'
        result = subprocess.run(
            ['ssh', 'seemplify@4.180.153.209', sql_cmd],
            capture_output=True,
            text=True,
            timeout=10
        )
        
        return result.returncode == 0
    except Exception as e:
        print(f"  ❌ Error: {e}")
        return False

def main():
    print("=== Fix Time Attendance Domain Port Configuration ===\n")
    
    for app_id, label, host, port in [
        (BACKEND_APP_ID, 'Backend', BACKEND_DOMAIN, BACKEND_PORT),
        (FRONTEND_APP_ID, 'Frontend', FRONTEND_DOMAIN, FRONTEND_PORT),
    ]:
        print(f"\n--- {label} ({host}) ---")
        
        # Check if domain exists
        row = run_sql(
            f'SELECT "domainId", host, port, https, "certificateType" '
            f'FROM domain WHERE "applicationId" = \'{app_id}\' AND host = \'{host}\';',
            silent=True
        )
        
        if row and row.strip():
            parts = row.strip().split('|')
            if len(parts) >= 5:
                did, h, current_port, https, cert = parts[:5]
                print(f"  Existing: host={h}, port={current_port}, https={https}, cert={cert}")
                
                if str(current_port) != str(port):
                    print(f"  Updating port from {current_port} to {port}")
                    success = run_sql_write(
                        f'UPDATE domain '
                        f'SET port = {port}, https = true, "certificateType" = \'letsencrypt\' '
                        f'WHERE "domainId" = \'{did}\';'
                    )
                    if success:
                        print(f"  [OK] Updated port to {port}")
                    else:
                        print(f"  [FAIL] Failed to update port")
                else:
                    # Ensure HTTPS and letsencrypt
                    print(f"  Port is correct, ensuring HTTPS and letsencrypt")
                    success = run_sql_write(
                        f'UPDATE domain '
                        f'SET https = true, "certificateType" = \'letsencrypt\' '
                        f'WHERE "domainId" = \'{did}\';'
                    )
                    if success:
                        print(f"  [OK] Ensured https=true, certificateType=letsencrypt")
        else:
            # Check if any domain exists for this app
            any_row = run_sql(
                f'SELECT "domainId", host, port FROM domain WHERE "applicationId" = \'{app_id}\' LIMIT 1;',
                silent=True
            )
            
            if any_row and any_row.strip():
                parts = any_row.strip().split('|')
                if len(parts) >= 3:
                    did, old_host, old_port = parts[:3]
                    print(f"  Updating existing domain: {old_host} -> {host}, port {old_port} -> {port}")
                    success = run_sql_write(
                        f'UPDATE domain '
                        f'SET host = \'{host}\', port = {port}, https = true, "certificateType" = \'letsencrypt\' '
                        f'WHERE "domainId" = \'{did}\';'
                    )
                    if success:
                        print(f"  [OK] Updated domain configuration")
            else:
                # Insert new domain
                print(f"  Creating new domain entry")
                import uuid
                did = str(uuid.uuid4())
                from datetime import datetime
                now = datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S.%f')[:-3] + '+00'
                
                success = run_sql_write(
                    f'INSERT INTO domain ("domainId", host, https, port, path, "createdAt", "applicationId", "certificateType", "domainType") '
                    f'VALUES (\'{did}\', \'{host}\', true, {port}, \'/\', \'{now}\', \'{app_id}\', \'letsencrypt\', \'application\');'
                )
                if success:
                    print(f"  [OK] Created domain: {host} (port {port}, HTTPS, letsencrypt)")
                else:
                    print(f"  [FAIL] Failed to create domain")
    
    print("\n=== Done ===")
    print("Domain ports updated. Traefik will pick up the config on next deployment.")
    print("Redeploy applications to apply Traefik labels.")
    print(f"\n  Backend:  https://{BACKEND_DOMAIN}")
    print(f"  Frontend: https://{FRONTEND_DOMAIN}")
    return 0

if __name__ == '__main__':
    sys.exit(main())
