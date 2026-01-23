#!/usr/bin/env python3
"""
Set environment variables for approver-backend and approver-frontend in Dokploy database.
Run on the server: python3 set-approver-env.py
"""
import subprocess

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
    print("=== Set Approver Backend Environment Variables ===\n")
    
    BACKEND_APP_ID = '72cc56e8-1123-4e22-beeb-04c8184405e4'
    
    # Verify app exists
    app_name = run_sql(f"SELECT name FROM application WHERE \"applicationId\" = '{BACKEND_APP_ID}';", silent=True)
    if not app_name:
        print(f"ERROR: Application with ID {BACKEND_APP_ID} not found!")
        return 1
    
    print(f"Found application: {app_name}")
    print(f"Application ID: {BACKEND_APP_ID}\n")
    
    # Update only FRONTEND_URL in existing env (preserves MONGO_URI, JWT_SECRET, Azure, etc.)
    cur = run_sql(f"SELECT env FROM application WHERE \"applicationId\" = '{BACKEND_APP_ID}';", silent=True) or ''
    lines = [l for l in cur.splitlines() if l.strip()]
    lines = [l for l in lines if not l.strip().startswith('FRONTEND_URL=')]
    lines.append('FRONTEND_URL=https://approver.seemplifyai.com')
    updated = '\n'.join(lines)
    esc = updated.replace("'", "''")
    print("Updating FRONTEND_URL in backend env...")
    run_sql_write(f"UPDATE application SET env = E'{esc}' WHERE \"applicationId\" = '{BACKEND_APP_ID}';")
    print("✅ Backend: FRONTEND_URL=https://approver.seemplifyai.com\n")
    
    # Verify backend
    print("Backend env (masked):")
    current_env = run_sql(f"SELECT env FROM application WHERE \"applicationId\" = '{BACKEND_APP_ID}';", silent=True)
    if current_env:
        for line in current_env.splitlines():
            if 'SECRET' in line or 'KEY' in line or 'URI' in line:
                print("  ", line.split('=')[0] + "=***")
            else:
                print("  ", line)
    
    # --- Frontend: set VITE_API_BASE_URL (build-time) ---
    FRONTEND_APP_ID = '063229c9-ed49-49be-a331-92c8c47422bc'
    fe_name = run_sql(f"SELECT name FROM application WHERE \"applicationId\" = '{FRONTEND_APP_ID}';", silent=True)
    if not fe_name:
        print(f"\n[WARN] Frontend app {FRONTEND_APP_ID} not found; skipping frontend env.")
    else:
        print(f"\n=== Set Approver Frontend Environment Variables ===\n")
        print(f"Found application: {fe_name}")
        cur = run_sql(f"SELECT env FROM application WHERE \"applicationId\" = '{FRONTEND_APP_ID}';", silent=True) or ''
        lines = [l for l in cur.splitlines() if l.strip()]
        lines = [l for l in lines if not l.strip().startswith('VITE_API_BASE_URL=')]
        lines.append('VITE_API_BASE_URL=https://api.approver.seemplifyai.com/api')
        updated = '\n'.join(lines)
        esc = updated.replace("'", "''")
        run_sql_write(f"UPDATE application SET env = E'{esc}' WHERE \"applicationId\" = '{FRONTEND_APP_ID}';")
        print("✅ Frontend: VITE_API_BASE_URL=https://api.approver.seemplifyai.com/api")
    
    print("\n=== Done ===")
    print("Next: Redeploy approver-backend and approver-frontend in Dokploy UI")
    return 0

if __name__ == '__main__':
    exit(main())
