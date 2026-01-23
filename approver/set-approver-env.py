#!/usr/bin/env python3
"""
Set environment variables for approver-backend in Dokploy database
Run on the server: python3 set-approver-env.py
"""
import subprocess
import secrets
import os

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
    
    # Generate JWT_SECRET if not provided
    jwt_secret = secrets.token_urlsafe(32)
    
    # Get Azure OpenAI config from environment or use placeholders
    azure_key = os.environ.get('AZURE_OPENAI_API_KEY', '<SET_AZURE_OPENAI_API_KEY>')
    azure_endpoint = os.environ.get('AZURE_OPENAI_ENDPOINT', 'https://ai-tranzfarai913527268236.cognitiveservices.azure.com')
    
    # Environment variables for approver-backend
    env_vars = f"""NODE_ENV=production
PORT=80
MONGO_URI=mongodb+srv://tonyegbo1:IHjykby58BtH5zyC@cluster0.8hdkzxw.mongodb.net/approver?retryWrites=true&w=majority&appName=Cluster0
FRONTEND_URL=https://approver.aiinigeria.com
JWT_SECRET={jwt_secret}
AZURE_OPENAI_API_KEY={azure_key}
AZURE_OPENAI_ENDPOINT={azure_endpoint}
AZURE_OPENAI_DEPLOYMENT_NAME=gpt-4.1
AZURE_OPENAI_API_VERSION=2025-01-01-preview"""
    
    # Escape single quotes for SQL
    env_vars_escaped = env_vars.replace("'", "''")
    
    # Update environment variables (replace entire env field)
    print("Setting environment variables...")
    run_sql_write(f"""
        UPDATE application 
        SET env = E'{env_vars_escaped}'
        WHERE "applicationId" = '{BACKEND_APP_ID}';
    """)
    
    print("✅ Environment variables set successfully!\n")
    
    # Verify
    print("Current environment variables:")
    current_env = run_sql(f"SELECT env FROM application WHERE \"applicationId\" = '{BACKEND_APP_ID}';", silent=True)
    if current_env:
        print(current_env)
    
    print("\n=== Done ===")
    print("Next: Deploy approver-backend in Dokploy UI or via API")
    return 0

if __name__ == '__main__':
    exit(main())
