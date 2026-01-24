#!/usr/bin/env python3
"""
Verify and create DNS records for approver domains via Cloudflare API.
Run this script with your Cloudflare API token and Zone ID for aiinigeria.com.

Usage:
  python3 fix-approver-dns-cloudflare.py

You'll need:
  - Cloudflare API Token for aiinigeria.com zone (with DNS:Edit permission)
  - Zone ID for aiinigeria.com (found in Cloudflare Dashboard → Zone Overview)
"""
import requests
import json
import sys

# ============================================
# UPDATE THESE VALUES FOR YOUR CLOUDFLARE ACCOUNT
# ============================================
CLOUDFLARE_API_TOKEN = "YOUR_API_TOKEN_HERE"  # Get from: https://dash.cloudflare.com/profile/api-tokens
ZONE_ID = "YOUR_ZONE_ID_HERE"  # Get from: Cloudflare Dashboard → aiinigeria.com → Overview → Zone ID
# ============================================

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
            if data.get("success") and data.get("result") and len(data["result"]) > 0:
                return data["result"][0]  # Return first matching record
            return None
        elif response.status_code == 401:
            print(f"  FAILED Authentication failed. Check your API token.")
            return None
        elif response.status_code == 403:
            print(f"  FAILED Permission denied. Ensure token has DNS:Edit permission.")
            return None
        else:
            print(f"  WARNING API error: {response.status_code} - {response.text[:200]}")
            return None
    except Exception as e:
        print(f"  WARNING Error checking DNS: {e}")
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
        current_ip = existing["content"]
        is_proxied = existing.get("proxied", False)
        
        if current_ip == ip and is_proxied:
            print(f"  OK Record exists and is correct: {full_domain} -> {ip} (Proxied)")
            return True
        
        # Update existing record
        print(f"  UPDATING record (was: {current_ip}, proxied: {is_proxied})...")
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
            result = response.json()
            if response.status_code == 200 and result.get("success"):
                print(f"  OK Updated: {full_domain} -> {ip} (Proxied)")
                return True
            else:
                print(f"  FAILED Update failed: {result.get('errors', [{}])[0].get('message', response.text[:200])}")
                return False
        except Exception as e:
            print(f"  ❌ Error updating: {e}")
            return False
    else:
        # Create new record
        print(f"  CREATING new DNS record...")
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
            result = response.json()
            if response.status_code == 200 and result.get("success"):
                print(f"  OK Created: {full_domain} -> {ip} (Proxied)")
                return True
            else:
                print(f"  FAILED Creation failed: {result.get('errors', [{}])[0].get('message', response.text[:200])}")
                return False
        except Exception as e:
            print(f"  FAILED Error creating: {e}")
            return False

def verify_zone_access(zone_id, api_token):
    """Verify we can access the zone"""
    url = f"https://api.cloudflare.com/client/v4/zones/{zone_id}"
    headers = {
        "Authorization": f"Bearer {api_token}",
        "Content-Type": "application/json"
    }
    try:
        response = requests.get(url, headers=headers, timeout=10)
        if response.status_code == 200:
            data = response.json()
            if data.get("success"):
                zone_info = data.get("result", {})
                print(f"OK Zone access verified: {zone_info.get('name', 'Unknown')}")
                return True
        return False
    except:
        return False

def main():
    print("=== Fix Approver DNS Records via Cloudflare API ===\n")
    print(f"Zone: {ZONE_NAME}")
    print(f"Target IP: {SERVER_IP}\n")
    
    if CLOUDFLARE_API_TOKEN == "YOUR_API_TOKEN_HERE" or ZONE_ID == "YOUR_ZONE_ID_HERE":
        print("ERROR: Please update CLOUDFLARE_API_TOKEN and ZONE_ID in this script!")
        print("\n📋 How to get these values:")
        print("\n1. API Token:")
        print("   - Go to: https://dash.cloudflare.com/profile/api-tokens")
        print("   - Click 'Create Token'")
        print("   - Use 'Edit zone DNS' template")
        print("   - Select zone: aiinigeria.com")
        print("   - Click 'Continue to summary' → 'Create Token'")
        print("   - Copy the token (you'll only see it once!)")
        print("\n2. Zone ID:")
        print("   - Go to: https://dash.cloudflare.com")
        print("   - Select 'aiinigeria.com' zone")
        print("   - Scroll down on Overview page")
        print("   - Find 'Zone ID' in right sidebar")
        print("   - Copy it")
        print("\n3. Update this script:")
        print("   - Open: approver/fix-approver-dns-cloudflare.py")
        print("   - Replace YOUR_API_TOKEN_HERE with your token")
        print("   - Replace YOUR_ZONE_ID_HERE with your Zone ID")
        print("   - Save and run again")
        return 1
    
    # Verify zone access
    print("Verifying zone access...")
    if not verify_zone_access(ZONE_ID, CLOUDFLARE_API_TOKEN):
        print("FAILED Cannot access zone. Check your API token and Zone ID.")
        return 1
    
    print("\nChecking and fixing DNS records...\n")
    
    all_good = True
    for subdomain, full_domain in DOMAINS:
        print(f"--- {full_domain} ---")
        record = check_dns_record(ZONE_ID, CLOUDFLARE_API_TOKEN, full_domain)
        
        if record:
            current_ip = record['content']
            is_proxied = record.get('proxied', False)
            print(f"  Found: {record['name']} -> {current_ip} (Proxied: {is_proxied})")
            
            if current_ip != SERVER_IP or not is_proxied:
                print(f"  WARNING Needs update (IP: {current_ip} -> {SERVER_IP}, Proxied: {is_proxied} -> True)")
                if create_or_update_dns(ZONE_ID, CLOUDFLARE_API_TOKEN, subdomain, full_domain, SERVER_IP):
                    all_good = True
                else:
                    all_good = False
            else:
                print(f"  OK Correct")
        else:
            print(f"  WARNING Record not found! Creating...")
            if create_or_update_dns(ZONE_ID, CLOUDFLARE_API_TOKEN, subdomain, full_domain, SERVER_IP):
                all_good = True
            else:
                all_good = False
    
    print("\n" + "="*60)
    if all_good:
        print("SUCCESS: All DNS records are configured correctly!")
        print("\nWAIT 2-5 minutes for DNS propagation, then test:")
        print(f"   - https://api.approver.aiinigeria.com/api/health")
        print(f"   - https://approver.aiinigeria.com")
        print("\nTIP: Cloudflare proxied records usually propagate within 1-2 minutes.")
    else:
        print("WARNING Some DNS records need attention. Check the output above.")
        print("\nIf you see authentication errors:")
        print("  1. Verify your API token has 'DNS:Edit' permission")
        print("  2. Ensure the token is for the correct zone (aiinigeria.com)")
        print("  3. Check that the Zone ID matches aiinigeria.com")
    
    return 0 if all_good else 1

if __name__ == '__main__':
    exit(main())
