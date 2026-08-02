#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Monitor approver-backend and approver-frontend deployment status
Continuously checks health endpoints until both are deployed and healthy
Run: python3 approver/monitor-deployment.py
"""
import requests
import time
import sys
import io
from datetime import datetime

# Fix Windows console encoding
if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

BACKEND_URL = 'https://api.approver.aiinigeria.com'
FRONTEND_URL = 'https://approver.aiinigeria.com'

def check_health_endpoint(url, endpoint='/api/health'):
    """Check if health endpoint responds"""
    try:
        response = requests.get(f"{url}{endpoint}", timeout=10, verify=False)
        if response.status_code == 200:
            return True, response.text.strip()
        return False, f"HTTP {response.status_code}"
    except requests.exceptions.ConnectionError:
        return False, "Connection refused (not deployed yet)"
    except requests.exceptions.Timeout:
        return False, "Timeout"
    except requests.exceptions.RequestException as e:
        return False, str(e)

def check_frontend_accessible(url):
    """Check if frontend is accessible"""
    try:
        response = requests.get(url, timeout=10, verify=False, allow_redirects=True)
        if response.status_code in [200, 301, 302]:
            return True, f"HTTP {response.status_code}"
        return False, f"HTTP {response.status_code}"
    except requests.exceptions.ConnectionError:
        return False, "Connection refused (not deployed yet)"
    except requests.exceptions.Timeout:
        return False, "Timeout"
    except requests.exceptions.RequestException as e:
        return False, str(e)

def main():
    print("=== Approver Deployment Monitor ===\n")
    print("Monitoring health endpoints until both apps are deployed and healthy...")
    print("Press Ctrl+C to stop monitoring\n")
    
    backend_healthy = False
    frontend_healthy = False
    
    check_count = 0
    start_time = time.time()
    
    try:
        while True:
            check_count += 1
            timestamp = datetime.now().strftime("%H:%M:%S")
            
            print(f"\n[{timestamp}] Check #{check_count}")
            print("-" * 60)
            
            # Check backend health endpoint
            healthy, health_msg = check_health_endpoint(BACKEND_URL)
            if healthy:
                print(f"✅ Backend Health: {health_msg}")
                backend_healthy = True
            else:
                print(f"⏳ Backend Health: {health_msg}")
                backend_healthy = False
            
            # Check frontend accessibility
            accessible, access_msg = check_frontend_accessible(FRONTEND_URL)
            if accessible:
                print(f"✅ Frontend Access: {access_msg}")
                frontend_healthy = True
            else:
                print(f"⏳ Frontend Access: {access_msg}")
                frontend_healthy = False
            
            # Summary
            elapsed = int(time.time() - start_time)
            print(f"\n📊 Status Summary (elapsed: {elapsed}s):")
            print(f"   Backend:  {'✅ Deployed & Healthy' if backend_healthy else '⏳ Deploying...'}")
            print(f"   Frontend: {'✅ Deployed & Healthy' if frontend_healthy else '⏳ Deploying...'}")
            
            # Check if both are healthy
            if backend_healthy and frontend_healthy:
                print("\n" + "=" * 60)
                print("🎉 SUCCESS! Both apps are deployed and healthy!")
                print("=" * 60)
                print(f"\n✅ Backend:  {BACKEND_URL}")
                print(f"✅ Frontend: {FRONTEND_URL}")
                print(f"\nTotal time: {elapsed}s ({check_count} checks)")
                print("\nNext steps:")
                print("1. Seed admin: curl -X POST https://api.approver.aiinigeria.com/api/auth/seed-admin")
                print("2. Test login: https://approver.aiinigeria.com")
                return 0
            
            # Wait before next check
            print("\n⏳ Waiting 10 seconds before next check...")
            time.sleep(10)
            
    except KeyboardInterrupt:
        print("\n\n⚠️  Monitoring stopped by user")
        print(f"\nFinal Status (after {check_count} checks, {int(time.time() - start_time)}s):")
        print(f"   Backend:  {'✅ Healthy' if backend_healthy else '⏳ Not Ready'}")
        print(f"   Frontend: {'✅ Healthy' if frontend_healthy else '⏳ Not Ready'}")
        return 1

if __name__ == '__main__':
    # Suppress SSL warnings
    import urllib3
    urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
    
    exit(main())
