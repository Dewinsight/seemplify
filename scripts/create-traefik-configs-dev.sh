#!/bin/bash
# Create Traefik configuration files for all dev applications

TRAEFIK_DIR="/etc/dokploy/traefik/dynamic"

# 1. Identity Provider Dev
cat > $TRAEFIK_DIR/identity-provider-dev-a1b2c3.yml << 'EOF'
http:
  routers:
    identity-provider-dev-a1b2c3-router-1:
      rule: Host(`auth-dev.seemplifyai.com`)
      service: identity-provider-dev-a1b2c3-service-1
      middlewares:
        - redirect-to-https
      entryPoints:
        - web
    identity-provider-dev-a1b2c3-router-websecure-1:
      rule: Host(`auth-dev.seemplifyai.com`)
      service: identity-provider-dev-a1b2c3-service-1
      middlewares: []
      entryPoints:
        - websecure
      tls:
        certResolver: letsencrypt
  services:
    identity-provider-dev-a1b2c3-service-1:
      loadBalancer:
        servers:
          - url: http://identity-provider-dev-a1b2c3:3000
        passHostHeader: true
EOF

# 2. Recruiter Backend Dev
cat > $TRAEFIK_DIR/recruiter-backend-dev-d4e5f6.yml << 'EOF'
http:
  routers:
    recruiter-backend-dev-d4e5f6-router-2:
      rule: Host(`api-dev.seemplifyai.com`)
      service: recruiter-backend-dev-d4e5f6-service-2
      middlewares:
        - redirect-to-https
      entryPoints:
        - web
    recruiter-backend-dev-d4e5f6-router-websecure-2:
      rule: Host(`api-dev.seemplifyai.com`)
      service: recruiter-backend-dev-d4e5f6-service-2
      middlewares: []
      entryPoints:
        - websecure
      tls:
        certResolver: letsencrypt
  services:
    recruiter-backend-dev-d4e5f6-service-2:
      loadBalancer:
        servers:
          - url: http://recruiter-backend-dev-d4e5f6:5001
        passHostHeader: true
EOF

# 3. Recruiter Frontend Dev
cat > $TRAEFIK_DIR/recruiter-frontend-dev-g7h8i9.yml << 'EOF'
http:
  routers:
    recruiter-frontend-dev-g7h8i9-router-3:
      rule: Host(`app-dev.seemplifyai.com`)
      service: recruiter-frontend-dev-g7h8i9-service-3
      middlewares:
        - redirect-to-https
      entryPoints:
        - web
    recruiter-frontend-dev-g7h8i9-router-websecure-3:
      rule: Host(`app-dev.seemplifyai.com`)
      service: recruiter-frontend-dev-g7h8i9-service-3
      middlewares: []
      entryPoints:
        - websecure
      tls:
        certResolver: letsencrypt
  services:
    recruiter-frontend-dev-g7h8i9-service-3:
      loadBalancer:
        servers:
          - url: http://recruiter-frontend-dev-g7h8i9:5000
        passHostHeader: true
EOF

# 4. Leave Backend Dev
cat > $TRAEFIK_DIR/leave-backend-dev-j1k2l3.yml << 'EOF'
http:
  routers:
    leave-backend-dev-j1k2l3-router-4:
      rule: Host(`api-leave-dev.seemplifyai.com`)
      service: leave-backend-dev-j1k2l3-service-4
      middlewares:
        - redirect-to-https
      entryPoints:
        - web
    leave-backend-dev-j1k2l3-router-websecure-4:
      rule: Host(`api-leave-dev.seemplifyai.com`)
      service: leave-backend-dev-j1k2l3-service-4
      middlewares: []
      entryPoints:
        - websecure
      tls:
        certResolver: letsencrypt
  services:
    leave-backend-dev-j1k2l3-service-4:
      loadBalancer:
        servers:
          - url: http://leave-backend-dev-j1k2l3:5002
        passHostHeader: true
EOF

# 5. Leave Frontend Dev
cat > $TRAEFIK_DIR/leave-frontend-dev-m4n5o6.yml << 'EOF'
http:
  routers:
    leave-frontend-dev-m4n5o6-router-5:
      rule: Host(`leave-dev.seemplifyai.com`)
      service: leave-frontend-dev-m4n5o6-service-5
      middlewares:
        - redirect-to-https
      entryPoints:
        - web
    leave-frontend-dev-m4n5o6-router-websecure-5:
      rule: Host(`leave-dev.seemplifyai.com`)
      service: leave-frontend-dev-m4n5o6-service-5
      middlewares: []
      entryPoints:
        - websecure
      tls:
        certResolver: letsencrypt
  services:
    leave-frontend-dev-m4n5o6-service-5:
      loadBalancer:
        servers:
          - url: http://leave-frontend-dev-m4n5o6:5003
        passHostHeader: true
EOF

# 6. Performance Backend Dev
cat > $TRAEFIK_DIR/performance-backend-dev-p7q8r9.yml << 'EOF'
http:
  routers:
    performance-backend-dev-p7q8r9-router-6:
      rule: Host(`api-performance-dev.seemplifyai.com`)
      service: performance-backend-dev-p7q8r9-service-6
      middlewares:
        - redirect-to-https
      entryPoints:
        - web
    performance-backend-dev-p7q8r9-router-websecure-6:
      rule: Host(`api-performance-dev.seemplifyai.com`)
      service: performance-backend-dev-p7q8r9-service-6
      middlewares: []
      entryPoints:
        - websecure
      tls:
        certResolver: letsencrypt
  services:
    performance-backend-dev-p7q8r9-service-6:
      loadBalancer:
        servers:
          - url: http://performance-backend-dev-p7q8r9:5004
        passHostHeader: true
EOF

# 7. Performance Frontend Dev
cat > $TRAEFIK_DIR/performance-frontend-dev-s1t2u3.yml << 'EOF'
http:
  routers:
    performance-frontend-dev-s1t2u3-router-7:
      rule: Host(`performance-dev.seemplifyai.com`)
      service: performance-frontend-dev-s1t2u3-service-7
      middlewares:
        - redirect-to-https
      entryPoints:
        - web
    performance-frontend-dev-s1t2u3-router-websecure-7:
      rule: Host(`performance-dev.seemplifyai.com`)
      service: performance-frontend-dev-s1t2u3-service-7
      middlewares: []
      entryPoints:
        - websecure
      tls:
        certResolver: letsencrypt
  services:
    performance-frontend-dev-s1t2u3-service-7:
      loadBalancer:
        servers:
          - url: http://performance-frontend-dev-s1t2u3:5005
        passHostHeader: true
EOF

# 8. Payroll Backend Dev
cat > $TRAEFIK_DIR/payroll-backend-dev-v4w5x6.yml << 'EOF'
http:
  routers:
    payroll-backend-dev-v4w5x6-router-8:
      rule: Host(`api-payroll-dev.seemplifyai.com`)
      service: payroll-backend-dev-v4w5x6-service-8
      middlewares:
        - redirect-to-https
      entryPoints:
        - web
    payroll-backend-dev-v4w5x6-router-websecure-8:
      rule: Host(`api-payroll-dev.seemplifyai.com`)
      service: payroll-backend-dev-v4w5x6-service-8
      middlewares: []
      entryPoints:
        - websecure
      tls:
        certResolver: letsencrypt
  services:
    payroll-backend-dev-v4w5x6-service-8:
      loadBalancer:
        servers:
          - url: http://payroll-backend-dev-v4w5x6:5006
        passHostHeader: true
EOF

# 9. Payroll Frontend Dev
cat > $TRAEFIK_DIR/payroll-frontend-dev-y7z8a9.yml << 'EOF'
http:
  routers:
    payroll-frontend-dev-y7z8a9-router-9:
      rule: Host(`payroll-dev.seemplifyai.com`)
      service: payroll-frontend-dev-y7z8a9-service-9
      middlewares:
        - redirect-to-https
      entryPoints:
        - web
    payroll-frontend-dev-y7z8a9-router-websecure-9:
      rule: Host(`payroll-dev.seemplifyai.com`)
      service: payroll-frontend-dev-y7z8a9-service-9
      middlewares: []
      entryPoints:
        - websecure
      tls:
        certResolver: letsencrypt
  services:
    payroll-frontend-dev-y7z8a9-service-9:
      loadBalancer:
        servers:
          - url: http://payroll-frontend-dev-y7z8a9:5007
        passHostHeader: true
EOF

echo "✅ All 9 Traefik configuration files created!"
ls -lh $TRAEFIK_DIR/*dev*.yml
