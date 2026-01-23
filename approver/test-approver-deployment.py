#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Test approver deployment after DNS/SSL propagation.
Tests backend health, frontend accessibility, admin seeding, and login.
"""
import requests
import time
import sys
import os

# Fix Windows Unicode output
if sys.platform == 'win32':
    import codecs
    sys.stdout = codecs.getwriter('utf-8')(sys.stdout.buffer, 'strict')
    sys.stderr = codecs.getwriter('utf-8')(sys.stderr.buffer, 'strict')

BACKEND_URL = 'https://api.approver.seemplifyai.com'
FRONTEND_URL = 'https://approver.seemplifyai.com'

def test_backend_health():
    """Test backend health endpoint"""
    try:
        r = requests.get(f'{BACKEND_URL}/api/health', timeout=10, verify=False)
        if r.status_code == 200:
            data = r.json()
            if 'status' in data and data['status'] == 'ok':
                print(f"[OK] Backend health: OK - {data}")
                return True
            else:
                print(f"[WARN] Backend health: Unexpected response - {data}")
                return False
        else:
            print(f"[FAIL] Backend health: HTTP {r.status_code} - {r.text[:200]}")
            return False
    except Exception as e:
        print(f"[FAIL] Backend health: Error - {e}")
        return False

def test_frontend():
    """Test frontend accessibility"""
    try:
        r = requests.get(FRONTEND_URL, timeout=10, verify=False, allow_redirects=True)
        if r.status_code == 200:
            print(f"[OK] Frontend: Accessible (HTTP {r.status_code})")
            return True
        else:
            print(f"[WARN] Frontend: HTTP {r.status_code}")
            return False
    except Exception as e:
        print(f"[FAIL] Frontend: Error - {e}")
        return False

def seed_admin():
    """Seed admin user"""
    try:
        r = requests.post(f'{BACKEND_URL}/api/auth/seed-admin', timeout=10, verify=False)
        if r.status_code == 200:
            data = r.json()
            print(f"[OK] Admin seed: {data.get('message', 'Success')}")
            return True
        else:
            print(f"[WARN] Admin seed: HTTP {r.status_code} - {r.text[:200]}")
            return False
    except Exception as e:
        print(f"[FAIL] Admin seed: Error - {e}")
        return False

def test_login():
    """Test admin login"""
    try:
        r = requests.post(
            f'{BACKEND_URL}/api/auth/login',
            json={'email': 'admin@approver.com', 'password': 'password123'},
            headers={'Content-Type': 'application/json'},
            timeout=10,
            verify=False
        )
        if r.status_code == 200:
            data = r.json()
            if 'token' in data:
                print(f"[OK] Login: Success - Token received")
                return True
            else:
                print(f"[WARN] Login: No token in response - {data}")
                return False
        else:
            print(f"[FAIL] Login: HTTP {r.status_code} - {r.text[:200]}")
            return False
    except Exception as e:
        print(f"[FAIL] Login: Error - {e}")
        return False

def main():
    print("=== Testing Approver Deployment ===\n")
    print(f"Backend: {BACKEND_URL}")
    print(f"Frontend: {FRONTEND_URL}\n")
    
    results = {}
    
    print("1. Testing backend health...")
    results['health'] = test_backend_health()
    print()
    
    print("2. Testing frontend...")
    results['frontend'] = test_frontend()
    print()
    
    if results['health']:
        print("3. Seeding admin user...")
        results['seed'] = seed_admin()
        print()
        
        print("4. Testing login...")
        results['login'] = test_login()
        print()
    else:
        print("[WARN] Skipping seed/login tests (backend not healthy)")
        results['seed'] = False
        results['login'] = False
    
    print("\n=== Test Summary ===")
    print(f"Backend Health: {'[OK]' if results['health'] else '[FAIL]'}")
    print(f"Frontend: {'[OK]' if results['frontend'] else '[FAIL]'}")
    print(f"Admin Seed: {'[OK]' if results['seed'] else '[FAIL]'}")
    print(f"Login: {'[OK]' if results['login'] else '[FAIL]'}")
    
    if all(results.values()):
        print("\n[SUCCESS] All tests passed! Deployment is working.")
        return 0
    else:
        print("\n[FAIL] Some tests failed. Investigation needed.")
        return 1

if __name__ == '__main__':
    sys.exit(main())
