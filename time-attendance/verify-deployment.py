#!/usr/bin/env python3
"""Verify time-attendance deployment"""
import subprocess
import requests
import json

def check_container_labels():
    """Check if containers have Traefik labels"""
    print("=== Checking Container Labels ===\n")
    
    for app_name, expected_host in [
        ('time-attendance-backend', 'api-time.seemplifyai.com'),
        ('time-attendance-frontend', 'time.seemplifyai.com')
    ]:
        print(f"--- {app_name} ---")
        result = subprocess.run(
            ['ssh', 'seemplify@4.180.153.209', 
             f'docker ps -q -f name={app_name}'],
            capture_output=True,
            text=True,
            timeout=10
        )
        
        if not result.stdout.strip():
            print(f"  [WARN] Container not found")
            continue
        
        container_id = result.stdout.strip().split('\n')[0]
        
        # Check for traefik.http.routers label
        result = subprocess.run(
            ['ssh', 'seemplify@4.180.153.209',
             f'docker inspect {container_id} --format "{{{{json .Config.Labels}}}}"'],
            capture_output=True,
            text=True,
            timeout=10
        )
        
        if result.returncode == 0:
            try:
                labels = json.loads(result.stdout.strip())
                traefik_labels = {k: v for k, v in labels.items() if 'traefik' in k.lower()}
                
                if traefik_labels:
                    print(f"  [OK] Traefik labels found: {len(traefik_labels)} labels")
                    # Check for specific host label
                    host_labels = [v for k, v in traefik_labels.items() if 'Host' in v]
                    if any(expected_host in label for label in host_labels):
                        print(f"  [OK] Host label contains {expected_host}")
                    else:
                        print(f"  [WARN] Expected host {expected_host} not found in labels")
                        for k, v in traefik_labels.items():
                            if 'rule' in k.lower():
                                print(f"       {k}: {v}")
                else:
                    print(f"  [FAIL] No Traefik labels found!")
            except Exception as e:
                print(f"  [ERROR] Error parsing labels: {e}")
        print()

def test_urls():
    """Test if URLs are accessible"""
    print("=== Testing URLs ===\n")
    
    urls = [
        ("Backend Health", "https://api-time.seemplifyai.com/api/health"),
        ("Frontend", "https://time.seemplifyai.com")
    ]
    
    for label, url in urls:
        print(f"Testing {label}: {url}")
        try:
            response = requests.get(url, timeout=10, verify=True)
            if response.status_code == 200:
                print(f"  [OK] {response.status_code} - Success!")
            else:
                print(f"  [WARN] {response.status_code} - {response.reason}")
        except requests.exceptions.RequestException as e:
            print(f"  [FAIL] Error: {e}")
        print()

def main():
    print("=== Time Attendance Deployment Verification ===\n")
    check_container_labels()
    test_urls()
    return 0

if __name__ == '__main__':
    exit(main())
