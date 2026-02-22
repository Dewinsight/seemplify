#!/usr/bin/env python3
"""
Create UBA FastLane application in Dokploy under seemplify project.
Run on the server (SSH seemplify@4.180.153.209) - uses docker exec to access postgres.
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
    print("=== Create UBA FastLane in Dokploy (under seemplify project) ===\n")

    project_id = 'jSrhrIiOyn0eH02aRSIFY'
    eid = run_sql(f'SELECT "environmentId" FROM environment WHERE "projectId" = \'{project_id}\' LIMIT 1;')
    if not eid:
        print("ERROR: No environment found for seemplify project.")
        return 1
    print("Environment ID (seemplify production):", eid)

    app_id = run_sql("SELECT \"applicationId\" FROM application WHERE name = 'uba-fastlane' LIMIT 1;", silent=True)
    if app_id:
        print("Application 'uba-fastlane' exists:", app_id)
    else:
        app_id = str(uuid.uuid4())
        run_sql_write(f"""
            INSERT INTO application (
                "applicationId", name, "appName", description,
                "sourceType", "applicationStatus", "buildType", "createdAt",
                "customGitUrl", "customGitBranch", "buildPath", dockerfile, "dockerContextPath",
                "environmentId", "createEnvFile", replicas, enabled
            ) VALUES (
                '{app_id}', 'uba-fastlane', 'uba-fastlane-dash', 'UBA FastLane queueing theory dashboard',
                'git', 'idle', 'dockerfile', NOW(),
                'https://github.com/michaelegbo/seemplify.git', 'main', './uba_branch_optimsation', './uba_branch_optimsation/Dockerfile', './uba_branch_optimsation',
                '{eid}', false, 1, true
            );
        """)
        print("Created application 'uba-fastlane':", app_id)

    cnt = run_sql("SELECT COUNT(*) FROM domain WHERE \"applicationId\" = '" + app_id + "';", silent=True)
    if cnt and int(cnt) > 0:
        print("Domain for this application already exists.")
    else:
        did = str(uuid.uuid4())
        run_sql_write(f"""
            INSERT INTO domain ("domainId", host, "applicationId", https, "certificateType", "createdAt")
            VALUES ('{did}', 'uba.seemplifyai.com', '{app_id}', true, 'letsencrypt', NOW());
        """)
        print("Created domain: uba.seemplifyai.com")

    print("\n=== Done ===")
    print("Application ID:", app_id)
    print("URL: https://uba.seemplifyai.com")
    print("\nDeploy via: curl -X POST http://4.180.153.209:3000/api/application.deploy -H 'x-api-key: YOUR_KEY' -H 'Content-Type: application/json' -d '{\"applicationId\": \"" + app_id + "\"}'")
    return 0

if __name__ == '__main__':
    exit(main())
