#!/usr/bin/env python3
"""
Disable createEnvFile for uba-fastlane in Dokploy.

Dokploy with createEnvFile=true tries to write .env to a path like
  code/uba_branch_optimsation/uba_branch_optimsation/.env
(doubled build path), which fails with "Directory nonexistent".

The UBA FastLane app uses DASH_HOST/DASH_PORT/DASH_DEBUG from the Dockerfile
defaults; no .env file is needed. Run this on the server, then redeploy.

Usage (on server):
  python3 uba_branch_optimsation/fix-createenvfile.py

Or one-liner via SSH:
  ssh seemplify@4.180.153.209 'python3 -c "
import subprocess
pc = subprocess.check_output([\"docker\", \"ps\", \"--filter\", \"name=dokploy-postgres\", \"--format\", \"{{.Names}}\"]).decode().strip().split(\"/n\")[0]
subprocess.run([\"docker\", \"exec\", pc, \"psql\", \"-U\", \"dokploy\", \"-d\", \"dokploy\", \"-c\", \"UPDATE application SET \\\"createEnvFile\\\" = false WHERE name = \\\"uba-fastlane\\\";\"])
  "'
"""
import subprocess

UBA_APP_ID = '_3NtFvqF3tUk2gEiRVIzE'


def run_sql(query, silent=False):
    pc = subprocess.check_output(
        ['docker', 'ps', '--filter', 'name=dokploy-postgres', '--format', '{{.Names}}']
    ).decode().strip().split('\n')[0]
    out = subprocess.run(
        ['docker', 'exec', pc, 'psql', '-U', 'dokploy', '-d', 'dokploy', '-t', '-A', '-c', query],
        capture_output=True, text=True
    )
    if out.returncode != 0 and not silent:
        raise RuntimeError(out.stderr or out.stdout)
    return (out.stdout or '').strip()


def run_sql_write(query):
    pc = subprocess.check_output(
        ['docker', 'ps', '--filter', 'name=dokploy-postgres', '--format', '{{.Names}}']
    ).decode().strip().split('\n')[0]
    r = subprocess.run(
        ['docker', 'exec', pc, 'psql', '-U', 'dokploy', '-d', 'dokploy', '-c', query],
        capture_output=True, text=True
    )
    if r.returncode != 0:
        print("SQL error:", r.stderr or r.stdout)
        raise SystemExit(1)


def main():
    print("=== Fix createEnvFile for UBA FastLane ===\n")

    app_id = run_sql(f'SELECT "applicationId" FROM application WHERE "applicationId" = \'{UBA_APP_ID}\' OR name = \'uba-fastlane\' LIMIT 1;', silent=True)
    if not app_id:
        print("  ⚠️  uba-fastlane app not found in Dokploy")
        return 1

    run_sql_write(f'''
        UPDATE application
        SET "createEnvFile" = false
        WHERE "applicationId" = '{app_id}';
    ''')
    print("  ✅ uba-fastlane: createEnvFile = false")

    print("\n=== Done ===")
    print("Redeploy uba-fastlane in Dokploy UI (or trigger redeploy via API).")
    return 0


if __name__ == '__main__':
    exit(main())
