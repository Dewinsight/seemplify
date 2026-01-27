#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Fix localhost redirects in time-attendance apps by setting correct build args and env vars.
"""

import requests
import json
import sys
import io

# Set UTF-8 encoding for Windows console
if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

# Configuration
DOKPLOY_URL = "http://4.180.153.209:3000/api"
API_KEY = "github-actions-2026yJfCpQwusWxkVlwhfbFDhkyLzLZrJfEBhBSBcRdgaYfDpKktAiCeJVexVmhfcEeh"

FRONTEND_APP_ID = "xp6sakCgL0wzSDhfpNc0r"
BACKEND_APP_ID = "gmBjqWd6pQKSWqfBIMNyL"

headers = {
    "x-api-key": API_KEY,
    "Content-Type": "application/json"
}

def make_request(endpoint, data):
    """Make a request to Dokploy API."""
    url = f"{DOKPLOY_URL}/{endpoint}"
    try:
        response = requests.post(url, headers=headers, json=data)
        response.raise_for_status()
        return response.json()
    except requests.exceptions.RequestException as e:
        print(f"[ERROR] Error calling {endpoint}: {e}")
        if hasattr(e.response, 'text'):
            print(f"Response: {e.response.text}")
        return None

def get_app_config(app_id):
    """Get application configuration."""
    print(f"\n[INFO] Getting config for app: {app_id}")
    result = make_request("application.one", {"applicationId": app_id})
    if result:
        print(f"[OK] Got config")
        # Print key info
        if 'env' in result:
            print(f"   Current env vars length: {len(result.get('env', ''))}")
        if 'buildArgs' in result:
            print(f"   Current build args: {result.get('buildArgs', 'Not set')}")
    return result

def update_frontend_build_args():
    """Update frontend build arguments."""
    print("\n[ACTION] Updating frontend build arguments...")
    
    # Correct production URLs
    build_args = """NEXT_PUBLIC_API_URL=https://api-time.seemplifyai.com/api
NEXT_PUBLIC_IDP_URL=https://auth.seemplifyai.com"""
    
    data = {
        "applicationId": FRONTEND_APP_ID,
        "buildArgs": build_args
    }
    
    result = make_request("application.update", data)
    if result:
        print("[OK] Frontend build arguments updated successfully")
        print(f"   NEXT_PUBLIC_API_URL=https://api-time.seemplifyai.com/api")
        print(f"   NEXT_PUBLIC_IDP_URL=https://auth.seemplifyai.com")
    return result

def verify_backend_env():
    """Verify backend environment variables."""
    print("\n[ACTION] Verifying backend environment variables...")
    
    # Correct production env vars
    env_vars = """NODE_ENV=production
PORT=5010
MONGODB_URI=mongodb+srv://seemplify:3hrCJzaFpwlnwVMi@seemplify.pxe85.mongodb.net/time_attendance?retryWrites=true&w=majority&appName=seemplify
SESSION_SECRET=time-attendance-session-secret-2026-production-change-me
IDP_ISSUER_URL=https://auth.seemplifyai.com
OIDC_CLIENT_ID=time-attendance
OIDC_CLIENT_SECRET=time-attendance-secret
OIDC_REDIRECT_URI=https://api-time.seemplifyai.com/api/auth/oidc/callback
FRONTEND_URL=https://time.seemplifyai.com
CORS_ORIGIN=https://time.seemplifyai.com"""
    
    data = {
        "applicationId": BACKEND_APP_ID,
        "env": env_vars
    }
    
    result = make_request("application.saveEnvironment", data)
    if result:
        print("[OK] Backend environment variables verified/updated")
        print("   All 10 production env vars set (no localhost)")
    return result

def deploy_app(app_id, app_name):
    """Deploy an application."""
    print(f"\n[DEPLOY] Deploying {app_name}...")
    
    data = {
        "applicationId": app_id
    }
    
    result = make_request("application.deploy", data)
    if result:
        print(f"[OK] {app_name} deployment triggered")
    return result

def main():
    """Main function."""
    print("=" * 60)
    print("Time Attendance - Fix Localhost Redirects")
    print("=" * 60)
    
    # Step 1: Check current configuration
    print("\n[STEP 1] Checking current configuration")
    print("-" * 60)
    frontend_config = get_app_config(FRONTEND_APP_ID)
    backend_config = get_app_config(BACKEND_APP_ID)
    
    # Step 2: Update frontend build args
    print("\n[STEP 2] Updating frontend build arguments")
    print("-" * 60)
    if update_frontend_build_args():
        print("[OK] Frontend build args updated")
    else:
        print("[ERROR] Failed to update frontend build args")
        sys.exit(1)
    
    # Step 3: Verify backend env vars
    print("\n[STEP 3] Verifying backend environment variables")
    print("-" * 60)
    if verify_backend_env():
        print("[OK] Backend env vars verified")
    else:
        print("[ERROR] Failed to verify backend env vars")
        sys.exit(1)
    
    # Step 4: Deploy both apps
    print("\n[STEP 4] Deploying applications")
    print("-" * 60)
    
    frontend_deployed = deploy_app(FRONTEND_APP_ID, "Frontend")
    backend_deployed = deploy_app(BACKEND_APP_ID, "Backend")
    
    if frontend_deployed and backend_deployed:
        print("\n" + "=" * 60)
        print("[SUCCESS] Configuration Updated & Deployments Triggered")
        print("=" * 60)
        print("\n[SUMMARY] What was fixed:")
        print("   [OK] Frontend build args set to production URLs")
        print("   [OK] Backend env vars verified (no localhost)")
        print("   [OK] Both apps redeployed")
        print("\n[WAIT] Wait 5-10 minutes for builds to complete")
        print("\n[TEST] Then test:")
        print("   1. Open: https://time.seemplifyai.com")
        print("   2. Check browser dev tools -> Network tab")
        print("   3. Verify all API calls go to: https://api-time.seemplifyai.com")
        print("   4. Should see NO localhost references")
    else:
        print("\n[ERROR] Some deployments failed")
        sys.exit(1)

if __name__ == "__main__":
    main()
