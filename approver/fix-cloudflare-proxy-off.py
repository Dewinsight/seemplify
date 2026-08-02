#!/usr/bin/env python3
"""
Set Cloudflare DNS records for api.approver and approver to DNS only (proxied=false).
Required for Traefik/Let's Encrypt to work.
"""
import requests

CLOUDFLARE_ZONE_ID = 'bbc142d2d661d64011e2e4becae7a5c3'
CLOUDFLARE_API_TOKEN = 's3BUpfG8KqcRoxVgwmyCSqJ3ho3R_ClCEpI4tEXJ'
SERVER_IP = '4.180.153.209'

RECORDS = [
    ('api.approver', 'api.approver.seemplifyai.com'),
    ('approver', 'approver.seemplifyai.com'),
]


def main():
    headers = {
        'Authorization': f'Bearer {CLOUDFLARE_API_TOKEN}',
        'Content-Type': 'application/json',
    }

    for name, full in RECORDS:
        # Find record (search by name, can be name or full)
        r = requests.get(
            f'https://api.cloudflare.com/client/v4/zones/{CLOUDFLARE_ZONE_ID}/dns_records',
            headers=headers,
            params={'type': 'A', 'name': full},
        )
        if r.status_code != 200:
            print(f"  [{full}] GET failed: {r.status_code} {r.text[:200]}")
            continue
        data = r.json()
        if not data.get('result'):
            # try name only
            r = requests.get(
                f'https://api.cloudflare.com/client/v4/zones/{CLOUDFLARE_ZONE_ID}/dns_records',
                headers=headers,
                params={'type': 'A'},
            )
            if r.status_code != 200:
                print(f"  [{full}] list failed: {r.status_code}")
                continue
            recs = [x for x in (r.json().get('result') or []) if x.get('name', '').startswith(name)]
            if not recs:
                print(f"  [{full}] record not found")
                continue
            rec = recs[0]
        else:
            rec = data['result'][0]

        rid = rec['id']
        c = rec.get('content', '')
        proxied = rec.get('proxied', False)

        if not proxied:
            print(f"  [{full}] already DNS only (proxied=false)")
            continue

        # Update to proxied=false
        up = requests.put(
            f'https://api.cloudflare.com/client/v4/zones/{CLOUDFLARE_ZONE_ID}/dns_records/{rid}',
            headers=headers,
            json={
                'type': 'A',
                'name': rec.get('name', name),
                'content': c or SERVER_IP,
                'ttl': rec.get('ttl', 3600),
                'proxied': False,
            },
        )
        if up.status_code == 200:
            print(f"  [{full}] set to DNS only (proxied=false)")
        else:
            print(f"  [{full}] update failed: {up.status_code} {up.text[:200]}")


if __name__ == '__main__':
    print("Setting api.approver and approver to DNS only (gray cloud)...")
    main()
    print("Done. Traefik/Let's Encrypt can now obtain certificates. Wait 2-5 min then test.")
