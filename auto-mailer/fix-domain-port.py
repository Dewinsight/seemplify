#!/usr/bin/env python3
"""Update domain port for auto-mailer (fix 502 Bad Gateway)"""
import subprocess
import sys

APP_ID = "aGhnXBzgFhD_59dpL10l5"
DOMAIN = "auto-mailer.seemplifyai.com"
PORT = 5012

def main():
    result = subprocess.run(
        ['docker', 'ps', '--filter', 'name=dokploy-postgres', '--format', '{{.Names}}'],
        capture_output=True,
        text=True
    )
    containers = [c for c in result.stdout.strip().split('\n') if 'dokploy-postgres' in c]
    if not containers:
        print("❌ No postgres container found")
        return 1

    container = containers[0]
    print(f"Updating domain port for {DOMAIN} -> {PORT}")

    update_sql = f'UPDATE domain SET port = {PORT} WHERE "applicationId" = \'{APP_ID}\' AND (host = \'{DOMAIN}\' OR domain = \'{DOMAIN}\');'
    result = subprocess.run(
        ['docker', 'exec', container, 'psql', '-U', 'dokploy', '-d', 'dokploy', '-c', update_sql],
        capture_output=True,
        text=True
    )

    if result.returncode == 0:
        print(f"✅ Updated port to {PORT}")
    else:
        print(f"❌ Error: {result.stderr}")
        return 1

    print("Redeploy the app if Traefik config doesn't update automatically.")
    return 0

if __name__ == '__main__':
    sys.exit(main())
