#!/usr/bin/env python3
"""
Fix Docker build context path issues - check and fix dockerContextPath and customGitBuildPath.
"""
import subprocess

BACKEND_APP_ID = '72cc56e8-1123-4e22-beeb-04c8184405e4'
FRONTEND_APP_ID = '063229c9-ed49-49be-a331-92c8c47422bc'


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
    print("=== Fix Docker Context Path Configuration ===\n")

    apps = [
        (BACKEND_APP_ID, 'approver-backend', 'approver/backend'),
        (FRONTEND_APP_ID, 'approver-frontend', 'approver/frontend')
    ]

    for app_id, label, expected_path in apps:
        print(f"\n--- {label} ---")
        
        # Check if dockerContextPath column exists
        cols_check = run_sql(f'''
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'application' 
            AND column_name IN ('dockerContextPath', 'customGitBuildPath');
        ''', silent=True)
        
        # Get current values - try to get all relevant fields
        result = run_sql(f'''
            SELECT name, "buildPath", dockerfile, 
                   COALESCE("dockerContextPath", 'NULL') as dockerContextPath,
                   COALESCE("customGitBuildPath", 'NULL') as customGitBuildPath
            FROM application
            WHERE "applicationId" = '{app_id}';
        ''', silent=True)
        
        if not result:
            print(f"  ⚠️  {label} not found")
            continue
        
        parts = result.split('|')
        if len(parts) < 5:
            # Try without dockerContextPath/customGitBuildPath
            result = run_sql(f'''
                SELECT name, "buildPath", dockerfile
                FROM application
                WHERE "applicationId" = '{app_id}';
            ''', silent=True)
            parts = result.split('|')
            if len(parts) >= 3:
                name, build_path, dockerfile = parts[0], parts[1], parts[2]
                docker_context_path = 'NULL'
                custom_git_build_path = 'NULL'
            else:
                print(f"  ⚠️  Unexpected format: {result}")
                continue
        else:
            name, build_path, dockerfile, docker_context_path, custom_git_build_path = parts
        
        print(f"  buildPath: {build_path}")
        print(f"  dockerfile: {dockerfile}")
        print(f"  dockerContextPath: {docker_context_path}")
        print(f"  customGitBuildPath: {custom_git_build_path}")
        
        # Fix customGitBuildPath - should be NULL to avoid duplication
        if custom_git_build_path and custom_git_build_path != 'NULL' and custom_git_build_path.strip():
            print(f"  🔧 Setting customGitBuildPath to NULL (was: {custom_git_build_path})")
            run_sql_write(f'''
                UPDATE application
                SET "customGitBuildPath" = NULL
                WHERE "applicationId" = '{app_id}';
            ''')
            print(f"  ✅ Fixed customGitBuildPath")
        
        # Set dockerContextPath to match buildPath
        if docker_context_path == 'NULL' or docker_context_path != expected_path:
            print(f"  🔧 Setting dockerContextPath to {expected_path}")
            run_sql_write(f'''
                UPDATE application
                SET "dockerContextPath" = '{expected_path}'
                WHERE "applicationId" = '{app_id}';
            ''')
            print(f"  ✅ Set dockerContextPath")

    print("\n=== Done ===")
    print("Redeploy both apps in Dokploy UI.")
    return 0


if __name__ == '__main__':
    exit(main())
