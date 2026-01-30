#!/usr/bin/env python3
"""Deploy time-attendance applications via Dokploy API"""
import requests
import time

DOKPLOY_URL = "http://4.180.153.209:3000"
API_KEY = "github-actions-2026yJfCpQwusWxkVlwhfbFDhkyLzLZrJfEBhBSBcRdgaYfDpKktAiCeJVexVmhfcEeh"
BACKEND_APP_ID = "gmBjqWd6pQKSWqfBIMNyL"
FRONTEND_APP_ID = "xp6sakCgL0wzSDhfpNc0r"

def deploy_app(app_id, label):
    print(f"Deploying {label} ({app_id})...")
    try:
        response = requests.post(
            f"{DOKPLOY_URL}/api/application.deploy",
            headers={
                "x-api-key": API_KEY,
                "Content-Type": "application/json"
            },
            json={"applicationId": app_id},
            timeout=30
        )
        
        if response.ok:
            print(f"  [OK] {label} deployment started")
            return True
        else:
            print(f"  [FAIL] {label} deployment failed: {response.status_code} - {response.text}")
            return False
    except Exception as e:
        print(f"  [ERROR] Error deploying {label}: {e}")
        return False

def main():
    print("=== Deploying Time Attendance Applications ===\n")
    
    backend_ok = deploy_app(BACKEND_APP_ID, "Backend")
    time.sleep(2)
    frontend_ok = deploy_app(FRONTEND_APP_ID, "Frontend")
    
    print("\n=== Deployment Triggered ===")
    if backend_ok and frontend_ok:
        print("Both applications are being deployed.")
        print("Wait 2-3 minutes for deployment to complete, then check:")
        print("  Backend:  https://api-time.seemplifyai.com/api/health")
        print("  Frontend: https://time.seemplifyai.com")
        return 0
    else:
        print("Some deployments failed. Check Dokploy dashboard.")
        return 1

if __name__ == '__main__':
    exit(main())
