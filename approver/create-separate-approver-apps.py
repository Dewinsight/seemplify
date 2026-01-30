#!/usr/bin/env python3
"""
Create SEPARATE approver-backend and approver-frontend applications in Dokploy
Following the same pattern as recruiter-backend + recruiter-frontend, etc.
Run on the server: python3 create-separate-approver-apps.py
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
    print("=== Create Separate Approver Backend + Frontend Apps ===\n")

    # Get organization ID
    org_id = run_sql("SELECT \"organizationId\" FROM project WHERE \"projectId\" = 'jSrhrIiOyn0eH02aRSIFY' LIMIT 1;")
    if not org_id:
        org_id = run_sql("SELECT id FROM organization LIMIT 1;")
    if not org_id:
        print("ERROR: No organizationId found.")
        return 1
    print("organizationId:", org_id)

    # Get or create approver project
    pid = run_sql("SELECT \"projectId\" FROM project WHERE name = 'approver' LIMIT 1;", silent=True)
    if not pid:
        pid = ''.join([format(uuid.uuid4().int >> (8*i) & 0xff, '02x') for i in range(10)]).upper()[:20]
        run_sql_write(
            f"INSERT INTO project (\"projectId\", name, description, \"createdAt\", \"organizationId\") "
            f"VALUES ('{pid}', 'approver', 'Approver Application', NOW(), '{org_id}');"
        )
        print("Created project 'approver':", pid)
    else:
        print("Using existing project 'approver':", pid)

    # Get or create production environment
    eid = run_sql("SELECT \"environmentId\" FROM environment WHERE \"projectId\" = '" + pid + "' LIMIT 1;", silent=True)
    if not eid:
        eid = run_sql("SELECT lower(substring(md5(random()::text) from 1 for 10)) || '-' || lower(substring(md5((random()*999)::text) from 1 for 10));")
        run_sql_write(
            "INSERT INTO environment (\"environmentId\", name, description, \"createdAt\", \"projectId\", \"isDefault\") "
            f"VALUES ('{eid}', 'production', 'Production', NOW(), '{pid}', true);"
        )
        print("Created environment 'production':", eid)
    else:
        print("Using existing environment:", eid)

    # 1) Create approver-backend application
    backend_app_id = run_sql("SELECT \"applicationId\" FROM application WHERE name = 'approver-backend' LIMIT 1;", silent=True)
    if backend_app_id:
        print("Application 'approver-backend' exists:", backend_app_id)
    else:
        backend_app_id = str(uuid.uuid4())
        run_sql_write(f"""
            INSERT INTO application (
                "applicationId", name, "appName", description,
                "sourceType", "applicationStatus", "buildType", "createdAt",
                "customGitUrl", "customGitBranch", "customGitBuildPath", dockerfile, "dockerContextPath",
                "environmentId", "createEnvFile", replicas, enabled
            ) VALUES (
                '{backend_app_id}', 'approver-backend', 'approver-backend-app', 'Approver Backend API',
                'git', 'idle', 'dockerfile', NOW(),
                'https://github.com/michaelegbo/seemplify.git', 'main', './approver/backend', './approver/backend/Dockerfile', './approver/backend',
                '{eid}', true, 1, true
            );
        """)
        print("Created application 'approver-backend':", backend_app_id)

    # 2) Create approver-frontend application
    frontend_app_id = run_sql("SELECT \"applicationId\" FROM application WHERE name = 'approver-frontend' LIMIT 1;", silent=True)
    if frontend_app_id:
        print("Application 'approver-frontend' exists:", frontend_app_id)
    else:
        frontend_app_id = str(uuid.uuid4())
        run_sql_write(f"""
            INSERT INTO application (
                "applicationId", name, "appName", description,
                "sourceType", "applicationStatus", "buildType", "createdAt",
                "customGitUrl", "customGitBranch", "customGitBuildPath", dockerfile, "dockerContextPath",
                "environmentId", "createEnvFile", replicas, enabled
            ) VALUES (
                '{frontend_app_id}', 'approver-frontend', 'approver-frontend-app', 'Approver Frontend',
                'git', 'idle', 'dockerfile', NOW(),
                'https://github.com/michaelegbo/seemplify.git', 'main', './approver/frontend', './approver/frontend/Dockerfile', './approver/frontend',
                '{eid}', true, 1, true
            );
        """)
        print("Created application 'approver-frontend':", frontend_app_id)

    # 3) Delete old combined "approver" app if it exists
    old_app_id = run_sql("SELECT \"applicationId\" FROM application WHERE name = 'approver' AND name != 'approver-backend' AND name != 'approver-frontend' LIMIT 1;", silent=True)
    if old_app_id:
        print(f"\n⚠️  Found old combined 'approver' app: {old_app_id}")
        print("   You may want to delete it in Dokploy UI if not needed.")

    # 4) Set up domains
    # Backend: api.approver.aiinigeria.com
    backend_domain_exists = run_sql("SELECT COUNT(*) FROM domain WHERE \"applicationId\" = '" + backend_app_id + "';", silent=True)
    if backend_domain_exists and int(backend_domain_exists) > 0:
        print("Domain for approver-backend already exists.")
    else:
        backend_did = str(uuid.uuid4())
        run_sql_write(f"""
            INSERT INTO domain ("domainId", host, "applicationId", https, "certificateType", "createdAt")
            VALUES ('{backend_did}', 'api.approver.aiinigeria.com', '{backend_app_id}', true, 'letsencrypt', NOW());
        """)
        print("Created domain: api.approver.aiinigeria.com (backend)")

    # Frontend: approver.aiinigeria.com
    frontend_domain_exists = run_sql("SELECT COUNT(*) FROM domain WHERE \"applicationId\" = '" + frontend_app_id + "';", silent=True)
    if frontend_domain_exists and int(frontend_domain_exists) > 0:
        print("Domain for approver-frontend already exists.")
    else:
        frontend_did = str(uuid.uuid4())
        run_sql_write(f"""
            INSERT INTO domain ("domainId", host, "applicationId", https, "certificateType", "createdAt")
            VALUES ('{frontend_did}', 'approver.aiinigeria.com', '{frontend_app_id}', true, 'letsencrypt', NOW());
        """)
        print("Created domain: approver.aiinigeria.com (frontend)")

    print("\n=== Done ===")
    print("Project ID:", pid)
    print("Environment ID:", eid)
    print("Backend Application ID:", backend_app_id)
    print("Frontend Application ID:", frontend_app_id)
    print("\nNext steps:")
    print("1. Set GitHub secrets:")
    print(f"   APPROVER_BACKEND_APP_ID={backend_app_id}")
    print(f"   APPROVER_FRONTEND_APP_ID={frontend_app_id}")
    print("2. Set environment variables in Dokploy for both apps")
    print("3. Deploy both applications")
    print("\nRefresh Dokploy UI - you should see:")
    print("  - approver-backend (api.approver.aiinigeria.com)")
    print("  - approver-frontend (approver.aiinigeria.com)")
    return 0

if __name__ == '__main__':
    exit(main())
