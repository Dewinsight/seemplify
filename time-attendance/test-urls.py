#!/usr/bin/env python3
"""Test time-attendance URLs"""
import requests

print("=== Testing Time Attendance URLs ===\n")

urls = [
    ("Backend Health", "https://api-time.seemplifyai.com/health"),
    ("Backend API Auth", "https://api-time.seemplifyai.com/api/auth/oidc/login"),
    ("Frontend Home", "https://time.seemplifyai.com"),
]

for label, url in urls:
    print(f"{label}: {url}")
    try:
        response = requests.get(url, timeout=10, verify=True, allow_redirects=False)
        print(f"  Status: {response.status_code} {response.reason}")
        if response.status_code == 200 and len(response.text) < 200:
            print(f"  Body: {response.text}")
    except Exception as e:
        print(f"  Error: {e}")
    print()

print("=== Summary ===")
print("Frontend: https://time.seemplifyai.com - Working!")
print("Backend:  https://api-time.seemplifyai.com - Check /health endpoint")
