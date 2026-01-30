#!/usr/bin/env python3
"""
Verify and fix DNS records for approver domains via Cloudflare API.
Since aiinigeria.com is in a different Cloudflare account, this script
helps verify DNS records exist and are correct.

Usage:
  python3 verify-approver-dns.py

You'll need:
  - Cloudflare API Token for aiinigeria.com zone
  - Zone ID for aiinigeria.com
"""
import requests
import json
import sys

# UPDATE THESE VALUES for aiinigeria.com zone
CLOUDFLARE_API_TOKEN = "YOUR_API_TOKEN_HERE"  # Get from Cloudflare Dashboard
ZONE_ID = "YOUR_ZONE_ID_HERE"  # Get from Cloudflare Dashboard → Zone Overview
ZONE_NAME = "aiinigeria.com"
SERVER_IP = "4.180.153.209"

DOMAINS = [
    ("api.approver", "api.approver.aiinigeria.com"),
    ("approver", "approver.aiinigeria.com"),
]

def check_dns_record(zone_id, api_token, domain_name):
    """Check if DNS record exists"""
    url = f"https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records"
    headers = {
        "Authorization": f"Bearer {api_token}",
        "Content-Type": "application/json"
    }
    params = {"type": "A", "name": domain_name}
    
    try:
        response = requests.get(url, headers=headers, params=params, timeout=10)
        if response.status_code == 200:
            data = response.json()
            if data.get("success") and data.get("result"):
                return data["result"][0]  # Return first matching record
            return None
        else:
            print(f"  ⚠️  API error: {response.status_code} - {response.text[:200]}")
            return None
    except Exception as e:
        print(f"  ⚠️  Error checking DNS: {e}")
        return None

def create_or_update_dns(zone_id, api_token, subdomain, full_domain, ip):
    """Create or update DNS A record"""
    headers = {
        "Authorization": f"Bearer {api_token}",
        "Content-Type": "application/json"
    }
    
    # Check if exists
    existing = check_dns_record(zone_id, api_token, full_domain)
    
    if existing:
        record_id = existing["id"]
        if existing["content"] == ip and existing["proxied"]:
            print(f"  ✅ Record exists and is correct: {full_domain} -> {ip} (Proxied)")
            return True
        
        # Update existing record
        url = f"https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records/{record_id}"
        data = {
            "type": "A",
            "name": subdomain,
            "content": ip,
            "ttl": 1,  # Auto
            "proxied": True
        }
        try:
            response = requests.put(url, headers=headers, json=data, timeout=10)
            if response.status_code == 200 and response.json().get("success"):
                print(f"  ✅ Updated: {full_domain} -> {ip} (Proxied)")
                return True
            else:
                print(f"  ❌ Update failed: {response.text[:200]}")
                return False
        except Exception as e:
            print(f"  ❌ Error updating: {e}")
            return False
    else:
        # Create new record
        url = f"https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records"
        data = {
            "type": "A",
            "name": subdomain,
            "content": ip,
            "ttl": 1,  # Auto
            "proxied": True
        }
        try:
            response = requests.post(url, headers=headers, json=data, timeout=10)
            if response.status_code == 200 and response.json().get("success"):
                print(f"  ✅ Created: {full_domain} -> {ip} (Proxied)")
                return True
            else:
                print(f"  ❌ Creation failed: {response.text[:200]}")
                return False
        except Exception as e:
            print(f"  ❌ Error creating: {e}")
            return False

def main():
    print("=== Verify Approver DNS Records ===\n")
    print(f"Zone: {ZONE_NAME}")
    print(f"Target IP: {SERVER_IP}\n")
    
    if CLOUDFLARE_API_TOKEN == "YOUR_API_TOKEN_HERE" or ZONE_ID == "YOUR_ZONE_ID_HERE":
        print("⚠️  Please update CLOUDFLARE_API_TOKEN and ZONE_ID in this script!")
        print("\nTo get these values:")
        print("1. Go to: https://dash.cloudflare.com")
        print("2. Select 'aiinigeria.com' zone")
        print("3. Zone ID: Found in Overview page (right sidebar)")
        print("4. API Token: Profile → API Tokens → Create Token (Edit zone DNS)")
        return 1
    
    print("Checking DNS records...\n")
    
    all_good = True
    for subdomain, full_domain in DOMAINS:
        print(f"--- {full_domain} ---")
        record = check_dns_record(ZONE_ID, CLOUDFLARE_API_TOKEN, full_domain)
        
        if record:
            print(f"  Found: {record['name']} -> {record['content']} (Proxied: {record.get('proxied', False)})")
            if record['content'] != SERVER_IP:
                print(f"  ⚠️  IP mismatch! Expected {SERVER_IP}, got {record['content']}")
                print(f"  🔧 Updating...")
                if create_or_update_dns(ZONE_ID, CLOUDFLARE_API_TOKEN, subdomain, full_domain, SERVER_IP):
                    all_good = True
                else:
                    all_good = False
            elif not record.get('proxied', False):
                print(f"  ⚠️  Record is not proxied! Updating...")
                if create_or_update_dns(ZONE_ID, CLOUDFLARE_API_TOKEN, subdomain, full_domain, SERVER_IP):
                    all_good = True
                else:
                    all_good = False
            else:
                print(f"  ✅ Correct")
        else:
            print(f"  ⚠️  Record not found! Creating...")
            if create_or_update_dns(ZONE_ID, CLOUDFLARE_API_TOKEN, subdomain, full_domain, SERVER_IP):
                all_good = True
            else:
                all_good = False
    
    print("\n=== Done ===")
    if all_good:
        print("✅ All DNS records are correct!")
        print("\nWait 2-5 minutes for DNS propagation, then test:")
        print(f"  - https://api.approver.aiinigeria.com/api/health")
        print(f"  - https://approver.aiinigeria.com")
    else:
        print("⚠️  Some DNS records need attention. Check the output above.")
    
    return 0 if all_good else 1

if __name__ == '__main__':
    exit(main())
