#!/usr/bin/env python3
"""
Create all 9 dev applications in Dokploy via API
This script automates the entire dev environment setup in Dokploy
"""

import requests
import json
import sys
import time
from typing import Dict, Optional

# Configuration
DOKPLOY_URL = "http://4.180.153.209:3000"
GITHUB_REPO_OWNER = "YOUR_GITHUB_USERNAME"  # UPDATE THIS
GITHUB_REPO_NAME = "seemplify"

# Application definitions
APPLICATIONS = [
    {
        "name": "identity-provider-dev",
        "buildPath": "Identityprovider",
        "domain": "auth-dev.seemplifyai.com",
        "database": "identity-dev",
        "port": 5008,
        "type": "backend"
    },
    {
        "name": "recruiter-backend-dev",
        "buildPath": "recruiter/backend",
        "domain": "api-dev.seemplifyai.com",
        "database": "smart_hr_db-dev",
        "port": 5001,
        "type": "backend"
    },
    {
        "name": "recruiter-frontend-dev",
        "buildPath": "recruiter/frontend",
        "domain": "app-dev.seemplifyai.com",
        "port": 5000,
        "type": "frontend",
        "backendUrl": "https://api-dev.seemplifyai.com"
    },
    {
        "name": "leave-backend-dev",
        "buildPath": "leave-management/backend",
        "domain": "api-leave-dev.seemplifyai.com",
        "database": "leave-management-dev",
        "port": 5002,
        "type": "backend"
    },
    {
        "name": "leave-frontend-dev",
        "buildPath": "leave-management/frontend",
        "domain": "leave-dev.seemplifyai.com",
        "port": 5003,
        "type": "frontend",
        "backendUrl": "https://api-leave-dev.seemplifyai.com"
    },
    {
        "name": "performance-backend-dev",
        "buildPath": "performance/backend",
        "domain": "api-performance-dev.seemplifyai.com",
        "database": "performance_db-dev",
        "port": 5004,
        "type": "backend"
    },
    {
        "name": "performance-frontend-dev",
        "buildPath": "performance/frontend",
        "domain": "performance-dev.seemplifyai.com",
        "port": 5005,
        "type": "frontend",
        "backendUrl": "https://api-performance-dev.seemplifyai.com"
    },
    {
        "name": "payroll-backend-dev",
        "buildPath": "payroll/backend",
        "domain": "api-payroll-dev.seemplifyai.com",
        "database": "payroll_db-dev",
        "port": 5006,
        "type": "backend"
    },
    {
        "name": "payroll-frontend-dev",
        "buildPath": "payroll/frontend",
        "domain": "payroll-dev.seemplifyai.com",
        "port": 5007,
        "type": "frontend",
        "backendUrl": "https://api-payroll-dev.seemplifyai.com"
    }
]

# MongoDB connection details
MONGO_USER = "tonyegbo1"
MONGO_PASS = "IHjykby58BtH5zyC"
MONGO_CLUSTER = "cluster0.8hdkzxw.mongodb.net"


class DokployManager:
    """Manages Dokploy API interactions"""
    
    def __init__(self, api_token: str):
        self.api_token = api_token
        self.base_url = DOKPLOY_URL
        self.headers = {
            "x-api-key": api_token,
            "Content-Type": "application/json",
            "accept": "application/json"
        }
        self.project_id = None
        self.app_ids = {}
    
    def _make_request(self, method: str, endpoint: str, data: Optional[Dict] = None) -> Dict:
        """Make API request to Dokploy"""
        url = f"{self.base_url}{endpoint}"
        
        try:
            if method == "GET":
                response = requests.get(url, headers=self.headers)
            elif method == "POST":
                response = requests.post(url, headers=self.headers, json=data)
            else:
                raise ValueError(f"Unsupported method: {method}")
            
            response.raise_for_status()
            return response.json() if response.text else {}
        
        except requests.exceptions.RequestException as e:
            print(f"❌ API Error: {e}")
            if hasattr(e.response, 'text'):
                print(f"Response: {e.response.text}")
            return None
    
    def get_project_id(self) -> Optional[str]:
        """Get the first project ID"""
        print("ℹ️  Getting project information...")
        
        # Try to get all projects
        projects = self._make_request("GET", "/api/project.all")
        
        if projects and len(projects) > 0:
            self.project_id = projects[0].get('projectId') or projects[0].get('id')
            print(f"✅ Using project ID: {self.project_id}")
            return self.project_id
        
        print("❌ No projects found. Please create a project in Dokploy first.")
        return None
    
    def create_application(self, app_config: Dict) -> Optional[str]:
        """Create a single application"""
        print(f"\nℹ️  Creating: {app_config['name']}")
        
        # Prepare application data
        app_data = {
            "name": app_config["name"],
            "appName": app_config["name"],
            "description": f"Development environment for {app_config['name']}",
            "projectId": self.project_id,
            "sourceType": "github",
            "repository": f"{GITHUB_REPO_OWNER}/{GITHUB_REPO_NAME}",
            "branch": "main",  # Will change to dev later
            "buildPath": app_config["buildPath"],
            "dockerfile": "Dockerfile"
        }
        
        # Create application
        result = self._make_request("POST", "/api/application.create", app_data)
        
        if not result:
            print(f"❌ Failed to create {app_config['name']}")
            return None
        
        app_id = result.get('applicationId') or result.get('id')
        
        if not app_id:
            print(f"❌ No application ID returned for {app_config['name']}")
            return None
        
        print(f"✅ Created {app_config['name']} (ID: {app_id})")
        self.app_ids[app_config['name']] = app_id
        
        # Configure domain
        self._configure_domain(app_id, app_config['domain'])
        
        # Configure environment variables
        self._configure_environment(app_id, app_config)
        
        return app_id
    
    def _configure_domain(self, app_id: str, domain: str):
        """Configure domain for application"""
        print(f"  ℹ️  Setting domain: {domain}")
        
        domain_data = {
            "applicationId": app_id,
            "domain": domain,
            "https": True,
            "certificateType": "letsencrypt"
        }
        
        result = self._make_request("POST", "/api/domain.create", domain_data)
        
        if result:
            print(f"  ✅ Domain configured")
        else:
            print(f"  ⚠️  Warning: Could not configure domain")
    
    def _configure_environment(self, app_id: str, app_config: Dict):
        """Configure environment variables"""
        print(f"  ℹ️  Configuring environment variables...")
        
        env_vars = []
        
        # Common variables
        env_vars.append(f"NODE_ENV=development")
        env_vars.append(f"PORT={app_config['port']}")
        
        # Backend-specific variables
        if app_config['type'] == 'backend':
            db_name = app_config.get('database', '')
            mongo_uri = f"mongodb+srv://{MONGO_USER}:{MONGO_PASS}@{MONGO_CLUSTER}/{db_name}?retryWrites=true&w=majority&appName=Cluster0"
            
            env_vars.extend([
                f"MONGO_URI={mongo_uri}",
                "JWT_SECRET=dev_jwt_secret_change_in_production",
                "JWT_ACCESS_TTL=10m",
                "OIDC_ISSUER=https://auth-dev.seemplifyai.com",
                "IDP_API_BASE_URL=https://auth-dev.seemplifyai.com",
                "IDP_HUB_URL=https://auth-dev.seemplifyai.com",
                "OIDC_CLIENT_ID=smarthr-backend",
                "OIDC_CLIENT_SECRET=smarthr-secret"
            ])
        
        # Frontend-specific variables
        if app_config['type'] == 'frontend':
            backend_url = app_config.get('backendUrl', '')
            env_vars.extend([
                f"NEXT_PUBLIC_API_URL={backend_url}",
                "NEXT_PUBLIC_IDP_URL=https://auth-dev.seemplifyai.com"
            ])
        
        # Join environment variables
        env_string = "\n".join(env_vars)
        
        env_data = {
            "applicationId": app_id,
            "environment": env_string
        }
        
        result = self._make_request("POST", "/api/application.updateEnvironment", env_data)
        
        if result:
            print(f"  ✅ Environment configured")
        else:
            print(f"  ⚠️  Warning: Could not configure environment")
    
    def deploy_application(self, app_id: str, app_name: str):
        """Deploy an application"""
        print(f"  ℹ️  Deploying {app_name}...")
        
        deploy_data = {
            "applicationId": app_id
        }
        
        result = self._make_request("POST", "/api/application.deploy", deploy_data)
        
        if result:
            print(f"  ✅ Deployment triggered")
        else:
            print(f"  ⚠️  Warning: Deployment may have failed")
    
    def create_all_applications(self):
        """Create all dev applications"""
        print("\n" + "="*50)
        print("Creating Dev Applications in Dokploy")
        print("="*50)
        
        # Get project ID first
        if not self.get_project_id():
            return False
        
        # Create each application
        for app_config in APPLICATIONS:
            app_id = self.create_application(app_config)
            
            if app_id:
                # Optionally deploy immediately
                # self.deploy_application(app_id, app_config['name'])
                time.sleep(1)  # Rate limiting
        
        return True
    
    def print_summary(self):
        """Print summary of created applications"""
        print("\n" + "="*50)
        print("✅ All Dev Applications Created!")
        print("="*50)
        print("\nApplication IDs for GitHub Secrets:")
        print("-" * 50)
        
        for app_name, app_id in self.app_ids.items():
            # Convert to GitHub secret name format
            secret_name = app_name.upper().replace("-", "_") + "_APP_ID"
            print(f"{secret_name}={app_id}")
        
        print("\nNext steps:")
        print("1. Copy the Application IDs above")
        print("2. Run: ./scripts/setup-github-secrets.sh")
        print("3. Create dev branch: git checkout -b dev && git push -u origin dev")
        print("4. Update each app in Dokploy to use 'dev' branch")
        print("5. Test deployments!")
        print("\n✅ Setup complete! 🎉\n")


def main():
    """Main execution"""
    print("\n" + "="*50)
    print("Dokploy Dev Environment Setup")
    print("="*50)
    
    # Check for API token
    api_token = input("\nEnter your Dokploy API token: ").strip()
    
    if not api_token:
        print("\n❌ API token is required!")
        print("\nTo get your API token:")
        print("1. Log into Dokploy: http://4.180.153.209:3000")
        print("2. Go to Settings → API Keys")
        print("3. Create a new API key")
        print("4. Copy the token and paste it here")
        sys.exit(1)
    
    # Verify GitHub repo owner
    print(f"\nGitHub Repository: {GITHUB_REPO_OWNER}/{GITHUB_REPO_NAME}")
    confirm = input("Is this correct? (y/n): ").strip().lower()
    
    if confirm != 'y':
        print("\n⚠️  Please update GITHUB_REPO_OWNER in the script and run again.")
        sys.exit(1)
    
    # Create manager and run
    manager = DokployManager(api_token)
    
    if manager.create_all_applications():
        manager.print_summary()
    else:
        print("\n❌ Failed to create applications")
        sys.exit(1)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\n⚠️  Operation cancelled by user")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
