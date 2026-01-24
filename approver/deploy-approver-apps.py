#!/usr/bin/env python3
"""
Deploy approver-backend and approver-frontend via Dokploy
This script provides instructions and can check deployment status
Run on the server: python3 deploy-approver-apps.py
"""
import subprocess
import requests
import time

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

def check_container_status(app_name):
    """Check if container is running"""
    containers = subprocess.run(
        ['docker', 'ps', '--filter', f'name={app_name}', '--format', '{{.Names}}\t{{.Status}}'],
        capture_output=True, text=True
    ).stdout.strip()
    return containers

def main():
    print("=== Approver Deployment Guide ===\n")
    
    BACKEND_APP_ID = '72cc56e8-1123-4e22-beeb-04c8184405e4'
    FRONTEND_APP_ID = '063229c9-ed49-49be-a331-92c8c47422bc'
    
    print("⚠️  Dokploy API deployment returns 401 Unauthorized.")
    print("   Please deploy via Dokploy UI:\n")
    print("   1. Go to: http://4.180.153.209:3000")
    print("   2. Login: admin@seemplifyai.com / Seemplify2026!")
    print("   3. Navigate to: approver project → approver-backend")
    print("   4. Click 'Deploy' button")
    print("   5. Wait for deployment to complete (check logs)")
    print("   6. Repeat for approver-frontend\n")
    
    # Check current container status
    print("Current container status:")
    backend_status = check_container_status('approver-backend')
    frontend_status = check_container_status('approver-frontend')
    
    if backend_status:
        print(f"  ✅ approver-backend: {backend_status}")
    else:
        print("  ⚠️  approver-backend: Not running")
    
    if frontend_status:
        print(f"  ✅ approver-frontend: {frontend_status}")
    else:
        print("  ⚠️  approver-frontend: Not running")
    
    print("\nAfter deployment, test:")
    print("  curl https://api.approver.aiinigeria.com/api/health")
    print("  curl -I https://approver.aiinigeria.com")
    
    return 0

if __name__ == '__main__':
    exit(main())
