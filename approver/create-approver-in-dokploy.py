#!/usr/bin/env python3
"""
Create Approver project, environment, application and domain in Dokploy
so they appear in the dashboard. Uses the same structure as seemplify.
"""
import subprocess
import uuid

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

def run_sql_write(query, show_err=True):
    pc = subprocess.check_output(
        ['docker', 'ps', '--filter', 'name=dokploy-postgres', '--format', '{{.Names}}']
    ).decode().strip().split('\n')[0]
    r = subprocess.run(
        ['docker', 'exec', pc, 'psql', '-U', 'dokploy', '-d', 'dokploy', '-c', query],
        capture_output=True, text=True
    )
    if r.returncode != 0 and show_err:
        print("SQL error:", r.stderr or r.stdout)
        raise subprocess.CalledProcessError(r.returncode, r.args)
    return r.returncode

def main():
    print("=== Create Approver in Dokploy (visible in UI) ===\n")

    org_id = run_sql("SELECT \"organizationId\" FROM project WHERE \"projectId\" = 'jSrhrIiOyn0eH02aRSIFY' LIMIT 1;")
    if not org_id:
        org_id = run_sql("SELECT id FROM organization LIMIT 1;")
    if not org_id:
        print("ERROR: No organizationId found.")
        return 1
    print("organizationId:", org_id)

    # 1) Create project "approver" with organizationId
    pid = run_sql("SELECT \"projectId\" FROM project WHERE name = 'approver' LIMIT 1;", silent=True)
    if pid:
        print("Project 'approver' exists:", pid)
    else:
        pid = ''.join([format(uuid.uuid4().int >> (8*i) & 0xff, '02x') for i in range(10)]).upper()[:20]
        run_sql_write(
            f"INSERT INTO project (\"projectId\", name, description, \"createdAt\", \"organizationId\") "
            f"VALUES ('{pid}', 'approver', 'Approver Application', NOW(), '{org_id}');"
        )
        print("Created project 'approver':", pid)

    # 2) Create environment "production" under approver project
    eid = run_sql("SELECT \"environmentId\" FROM environment WHERE \"projectId\" = '" + pid + "' LIMIT 1;", silent=True)
    if eid:
        print("Environment exists:", eid)
    else:
        # e.g. LRloZifVPbZcVc-D9jUd4
        eid = run_sql("SELECT lower(substring(md5(random()::text) from 1 for 10)) || '-' || lower(substring(md5((random()*999)::text) from 1 for 10));")
        run_sql_write(
            "INSERT INTO environment (\"environmentId\", name, description, \"createdAt\", \"projectId\", \"isDefault\") "
            f"VALUES ('{eid}', 'production', 'Production', NOW(), '{pid}', true);"
        )
        print("Created environment 'production':", eid)

    eid = run_sql("SELECT \"environmentId\" FROM environment WHERE \"projectId\" = '" + pid + "' LIMIT 1;")
    if not eid:
        print("ERROR: Could not get environmentId for approver project.")
        return 1

    # 3) Create application "approver" under that environment
    app_id = run_sql("SELECT \"applicationId\" FROM application WHERE name = 'approver' LIMIT 1;", silent=True)
    if app_id:
        print("Application 'approver' exists:", app_id)
    else:
        app_id = str(uuid.uuid4())
        run_sql_write(f"""
            INSERT INTO application (
                "applicationId", name, "appName", description,
                "sourceType", "applicationStatus", "buildType", "createdAt",
                "customGitUrl", "customGitBranch", "buildPath", dockerfile, "dockerContextPath",
                "environmentId", "createEnvFile", replicas, enabled
            ) VALUES (
                '{app_id}', 'approver', 'approver-app', 'Approver Application',
                'git', 'idle', 'dockerfile', NOW(),
                'https://github.com/michaelegbo/seemplify.git', 'main', './approver/backend', './approver/backend/Dockerfile', './approver/backend',
                '{eid}', true, 1, true
            );
        """)
        print("Created application 'approver':", app_id)

    # 4) Add domain (skip if one already for this app)
    cnt = run_sql("SELECT COUNT(*) FROM domain WHERE \"applicationId\" = '" + app_id + "';", silent=True)
    if cnt and int(cnt) > 0:
        print("Domain for this application already exists.")
    else:
        # domain table: "domainId", host, "applicationId", https, "certificateType", "createdAt"
        did = str(uuid.uuid4())
        run_sql_write(f"""
            INSERT INTO domain ("domainId", host, "applicationId", https, "certificateType", "createdAt")
            VALUES ('{did}', 'approver.aiinigeria.com', '{app_id}', true, 'letsencrypt', NOW());
        """)
        print("Created domain: approver.aiinigeria.com")

    print("\n=== Done ===")
    print("Project ID:", pid)
    print("Environment ID:", eid)
    print("Application ID:", app_id)
    print("\nRefresh Dokploy: you should see project 'approver' with app 'approver'.")
    return 0

if __name__ == '__main__':
    exit(main())
