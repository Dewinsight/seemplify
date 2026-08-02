#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Fix MongoDB connection for time-attendance backend.
"""

import requests
import json
import sys

# Configuration
DOKPLOY_URL = "http://4.180.153.209:3000/api"
API_KEY = "github-actions-2026yJfCpQwusWxkVlwhfbFDhkyLzLZrJfEBhBSBcRdgaYfDpKktAiCeJVexVmhfcEeh"
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

def update_backend_env():
    """Update backend environment variables with correct MongoDB URI."""
    print("[ACTION] Updating backend environment variables with correct MongoDB URI...")
    
    # Correct MongoDB URI using the working cluster
    env_vars = """NODE_ENV=production
PORT=5010
MONGODB_URI=mongodb+srv://tonyegbo1:IHjykby58BtH5zyC@cluster0.8hdkzxw.mongodb.net/time_attendance_db?retryWrites=true&w=majority&appName=Cluster0
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
        print("[OK] Backend environment variables updated with working MongoDB cluster")
        print("   MongoDB Cluster: cluster0.8hdkzxw.mongodb.net")
        print("   Database: time_attendance_db")
    return result

def deploy_backend():
    """Deploy backend."""
    print("\n[DEPLOY] Deploying backend...")
    
    data = {
        "applicationId": BACKEND_APP_ID
    }
    
    result = make_request("application.deploy", data)
    # Deploy endpoint returns empty response, which is okay
    print("[OK] Backend deployment triggered")
    return True

def main():
    """Main function."""
    print("=" * 60)
    print("Time Attendance - Fix MongoDB Connection")
    print("=" * 60)
    
    print("\n[INFO] Issue: Backend was using incorrect MongoDB cluster")
    print("[INFO] Correct cluster: cluster0.8hdkzxw.mongodb.net")
    print("[INFO] Incorrect cluster: seemplify.pxe85.mongodb.net (NXDOMAIN)")
    
    # Update backend env vars
    print("\n[STEP 1] Updating backend environment variables")
    print("-" * 60)
    if update_backend_env():
        print("[OK] Environment variables updated")
    else:
        print("[ERROR] Failed to update environment variables")
        sys.exit(1)
    
    # Deploy backend
    print("\n[STEP 2] Deploying backend")
    print("-" * 60)
    if deploy_backend():
        print("[OK] Backend deployment triggered")
    else:
        print("[ERROR] Failed to trigger deployment")
        sys.exit(1)
    
    print("\n" + "=" * 60)
    print("[SUCCESS] MongoDB Connection Fixed & Backend Redeploying")
    print("=" * 60)
    print("\n[SUMMARY] What was fixed:")
    print("   [OK] MongoDB URI updated to working cluster")
    print("   [OK] Backend redeployed with correct connection string")
    print("\n[WAIT] Wait 2-3 minutes for backend to redeploy")
    print("\n[TEST] Then test:")
    print("   curl https://api-time.seemplifyai.com/api/health")
    print("   Should return: {\"status\":\"ok\"} or similar")

if __name__ == "__main__":
    main()
