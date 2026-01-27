#!/usr/bin/env python3
"""Fix Traefik configuration files to use correct ports"""
import subprocess

def fix_config(filename, old_port, new_port):
    """Fix port in Traefik config file"""
    print(f"Fixing {filename}: {old_port} -> {new_port}")
    
    # Read current config
    result = subprocess.run(
        ['docker', 'exec', 'dokploy-traefik', 'cat', f'/etc/dokploy/traefik/dynamic/{filename}'],
        capture_output=True,
        text=True
    )
    
    if result.returncode != 0:
        print(f"  [ERROR] Could not read {filename}")
        return False
    
    config = result.stdout
    
    # Replace port
    new_config = config.replace(f':{old_port}', f':{new_port}')
    
    if config == new_config:
        print(f"  [WARN] No changes made - port {old_port} not found")
        return False
    
    # Write updated config
    result = subprocess.run(
        ['docker', 'exec', '-i', 'dokploy-traefik', 'sh', '-c', 
         f'cat > /etc/dokploy/traefik/dynamic/{filename}'],
        input=new_config.encode(),
        capture_output=True
    )
    
    if result.returncode == 0:
        print(f"  [OK] Updated {filename}")
        return True
    else:
        print(f"  [ERROR] Failed to write {filename}: {result.stderr.decode()}")
        return False

def main():
    print("=== Fixing Traefik Configuration Files ===\n")
    
    configs = [
        ('time-attendance-backend-w7ewpk.yml', 3000, 5010),
        ('time-attendance-frontend-4vqr2w.yml', 3000, 5011)
    ]
    
    for filename, old_port, new_port in configs:
        fix_config(filename, old_port, new_port)
        print()
    
    print("=== Done ===")
    print("Traefik should pick up changes automatically (watch: true).")
    print("Wait 10-20 seconds, then test:")
    print("  Backend:  https://api-time.seemplifyai.com/api/health")
    print("  Frontend: https://time.seemplifyai.com")
    
    return 0

if __name__ == '__main__':
    exit(main())
