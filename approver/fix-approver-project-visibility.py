#!/usr/bin/env python3
"""
Fix Approver project visibility in Dokploy UI.
Projects must have organizationId set to appear in the dashboard.
"""
import subprocess

def run_sql(query, want_output=True):
    pc = subprocess.check_output(
        ['docker', 'ps', '--filter', 'name=dokploy-postgres', '--format', '{{.Names}}']
    ).decode().strip().split('\n')[0]
    args = ['docker', 'exec', pc, 'psql', '-U', 'dokploy', '-d', 'dokploy', '-t', '-A', '-c', query]
    out = subprocess.check_output(args).decode().strip()
    return out

def run_sql_write(query):
    pc = subprocess.check_output(
        ['docker', 'ps', '--filter', 'name=dokploy-postgres', '--format', '{{.Names}}']
    ).decode().strip().split('\n')[0]
    subprocess.run(
        ['docker', 'exec', pc, 'psql', '-U', 'dokploy', '-d', 'dokploy', '-c', query],
        check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
    )

def main():
    print("=== Fix Approver project visibility in Dokploy ===\n")

    # 1. Get organizationId from existing seemplify project
    try:
        org_id = run_sql(
            "SELECT \"organizationId\" FROM project WHERE \"projectId\" = 'jSrhrIiOyn0eH02aRSIFY' LIMIT 1;"
        )
    except Exception:
        org_id = run_sql("SELECT \"organizationId\" FROM project WHERE \"organizationId\" IS NOT NULL LIMIT 1;")

    if not org_id:
        print("No organizationId found in project table. Checking organization table...")
        org_id = run_sql("SELECT id FROM organization LIMIT 1;")

    if not org_id:
        print("ERROR: No organization found. Create one in Dokploy first.")
        return 1

    print("Using organizationId:", org_id)

    # 2. Get approver projectId
    approver_pid = run_sql("SELECT \"projectId\" FROM project WHERE name = 'approver' LIMIT 1;")
    if not approver_pid:
        print("ERROR: No 'approver' project found.")
        return 1
    print("Approver projectId:", approver_pid)

    # 3. Update approver project with organizationId
    run_sql_write(
        f"UPDATE project SET \"organizationId\" = '{org_id}' WHERE name = 'approver';"
    )
    print("Updated approver project with organizationId.")

    # 4. If project has 'env' column, copy from seemplify if needed
    try:
        env_val = run_sql("SELECT env FROM project WHERE \"projectId\" = 'jSrhrIiOyn0eH02aRSIFY' LIMIT 1;")
        if env_val:
            run_sql_write(f"UPDATE project SET env = '{env_val}' WHERE name = 'approver';")
            print("Updated env from seemplify project.")
    except Exception:
        pass

    print("\nDone. Refresh the Dokploy dashboard; the 'approver' project should appear.")
    return 0

if __name__ == '__main__':
    exit(main())
