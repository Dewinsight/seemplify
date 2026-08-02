#!/usr/bin/env python3
"""
Complete Approver Deployment Script
Fixes issues, deploys both apps, and verifies deployment
Run on the server: python3 approver/deploy-approver-complete.py
"""
import subprocess
import requests
import time
import sys

BACKEND_APP_ID = '72cc56e8-1123-4e22-beeb-04c8184405e4'
FRONTEND_APP_ID = '063229c9-ed49-49be-a331-92c8c47422bc'
DOKPLOY_URL = 'http://4.180.153.209:3000'
DOKPLOY_TOKEN = 'sk_dokploy_b6178e414ec737424c7d0ecf20cddd51'

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

def check_container_running(app_name):
    """Check if container is running"""
    result = subprocess.run(
        ['docker', 'ps', '--filter', f'name={app_name}', '--format', '{{.Names}}\t{{.Status}}'],
        capture_output=True, text=True
    )
    return result.stdout.strip() if result.returncode == 0 else None

def deploy_via_api(app_id, app_name):
    """Deploy application via Dokploy API"""
    print(f"\n📦 Deploying {app_name}...")
    try:
        response = requests.post(
            f"{DOKPLOY_URL}/api/application.deploy",
            headers={
                "x-api-key": DOKPLOY_TOKEN,
                "Content-Type": "application/json"
            },
            json={"applicationId": app_id},
            timeout=30
        )
        if response.status_code == 200:
            print(f"   ✅ Deployment triggered successfully")
            return True
        else:
            print(f"   ❌ Deployment failed: HTTP {response.status_code}")
            print(f"   Response: {response.text}")
            return False
    except Exception as e:
        print(f"   ❌ API call failed: {str(e)}")
        return False

def verify_domains():
    """Verify domain entries exist"""
    print("\n🌐 Verifying domain configuration...")
    
    backend_domain = run_sql(f"SELECT COUNT(*) FROM domain WHERE \"applicationId\" = '{BACKEND_APP_ID}' AND host = 'api.approver.aiinigeria.com';", silent=True)
    frontend_domain = run_sql(f"SELECT COUNT(*) FROM domain WHERE \"applicationId\" = '{FRONTEND_APP_ID}' AND host = 'approver.aiinigeria.com';", silent=True)
    
    if backend_domain and int(backend_domain) > 0:
        print("   ✅ Backend domain configured: api.approver.aiinigeria.com")
    else:
        print("   ⚠️  Backend domain missing, creating...")
        domain_id = str(subprocess.check_output(['uuidgen']).decode().strip())
        run_sql_write(f"""
            INSERT INTO domain ("domainId", host, "applicationId", https, "certificateType", "createdAt")
            VALUES ('{domain_id}', 'api.approver.aiinigeria.com', '{BACKEND_APP_ID}', true, 'letsencrypt', NOW());
        """)
        print("   ✅ Backend domain created")
    
    if frontend_domain and int(frontend_domain) > 0:
        print("   ✅ Frontend domain configured: approver.aiinigeria.com")
    else:
        print("   ⚠️  Frontend domain missing, creating...")
        domain_id = str(subprocess.check_output(['uuidgen']).decode().strip())
        run_sql_write(f"""
            INSERT INTO domain ("domainId", host, "applicationId", https, "certificateType", "createdAt")
            VALUES ('{domain_id}', 'approver.aiinigeria.com', '{FRONTEND_APP_ID}', true, 'letsencrypt', NOW());
        """)
        print("   ✅ Frontend domain created")

def main():
    print("=== Complete Approver Deployment ===\n")
    
    # Step 1: Fix createEnvFile
    print("1️⃣  Fixing createEnvFile issue...")
    for app_id, label in [(BACKEND_APP_ID, 'approver-backend'), (FRONTEND_APP_ID, 'approver-frontend')]:
        name = run_sql(f'SELECT name FROM application WHERE "applicationId" = \'{app_id}\';', silent=True)
        if not name:
            print(f"   ⚠️  {label} ({app_id}) not found, skipping")
            continue
        run_sql_write(f'''
            UPDATE application
            SET "createEnvFile" = false
            WHERE "applicationId" = '{app_id}';
        ''')
        print(f"   ✅ {label}: createEnvFile = false")
    
    # Step 2: Verify domains
    verify_domains()
    
    # Step 3: Deploy backend
    print("\n2️⃣  Deploying backend...")
    if not deploy_via_api(BACKEND_APP_ID, 'approver-backend'):
        print("   ⚠️  API deployment failed, please deploy via Dokploy UI")
    
    # Step 4: Wait and check backend
    print("\n⏳ Waiting 30 seconds for backend build...")
    time.sleep(30)
    
    backend_container = check_container_running('approver-backend')
    if backend_container:
        print(f"   ✅ Backend container running: {backend_container}")
    else:
        print("   ⏳ Backend container not running yet (may still be building)")
    
    # Step 5: Deploy frontend
    print("\n3️⃣  Deploying frontend...")
    if not deploy_via_api(FRONTEND_APP_ID, 'approver-frontend'):
        print("   ⚠️  API deployment failed, please deploy via Dokploy UI")
    
    # Step 6: Wait and check frontend
    print("\n⏳ Waiting 30 seconds for frontend build...")
    time.sleep(30)
    
    frontend_container = check_container_running('approver-frontend')
    if frontend_container:
        print(f"   ✅ Frontend container running: {frontend_container}")
    else:
        print("   ⏳ Frontend container not running yet (may still be building)")
    
    # Step 7: Final status
    print("\n📊 Final Status:")
    print("=" * 60)
    backend_status = check_container_running('approver-backend')
    frontend_status = check_container_running('approver-frontend')
    
    print(f"Backend:  {'✅ Running' if backend_status else '⏳ Building/Not Started'}")
    print(f"Frontend: {'✅ Running' if frontend_status else '⏳ Building/Not Started'}")
    
    print("\n📋 Next Steps:")
    print("1. Wait 2-3 minutes for builds to complete")
    print("2. Check Dokploy UI for deployment logs")
    print("3. Test endpoints:")
    print("   - curl https://api.approver.aiinigeria.com/api/health")
    print("   - curl -I https://approver.aiinigeria.com")
    print("4. Seed admin: curl -X POST https://api.approver.aiinigeria.com/api/auth/seed-admin")
    
    return 0

if __name__ == '__main__':
    exit(main())
