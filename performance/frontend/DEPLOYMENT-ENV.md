# Performance Frontend - Environment Variables Setup

## Required Environment Variables for Dokploy

### Build-Time Variables (Set in Docker build args in Dokploy)
These are embedded into the build and can be overridden at runtime:

- `NEXT_PUBLIC_API_URL` - Backend API URL
  - Production: `https://api-performance.seemplifyai.com/api`
  - Default: `https://api-performance.seemplifyai.com/api`

- `NEXT_PUBLIC_WS_URL` - WebSocket URL for real-time updates
  - Production: `wss://api-performance.seemplifyai.com/ws`
  - Default: `wss://api-performance.seemplifyai.com/ws`

- `NEXT_PUBLIC_IDP_URL` - Identity Provider URL
  - Production: `https://auth.seemplifyai.com`
  - Default: `https://auth.seemplifyai.com`

- `NEXTAUTH_URL` - NextAuth callback URL
  - Production: `https://performance.seemplifyai.com`
  - Default: `https://performance.seemplifyai.com`

- `NEXTAUTH_SECRET` - NextAuth session encryption secret
  - Production: **Generate a secure random string** (32+ characters)
  - Default: Use a secure secret from your secrets management

- `OIDC_ISSUER` - OIDC issuer URL
  - Production: `https://auth.seemplifyai.com`
  - Default: `https://auth.seemplifyai.com`

- `OIDC_CLIENT_ID` - OIDC client ID
  - Production: `performance-management`
  - Default: `performance-management`

### Runtime Variables (Set in Dokploy Environment Variables)
These are required at runtime and should NOT be in the build:

- `OIDC_CLIENT_SECRET` - OIDC client secret from IdP
  - **IMPORTANT**: Get this from your Identity Provider configuration
  - Set in Dokploy environment variables (NOT build args)

## How to Configure in Dokploy

### 1. Build Arguments
In your Dokploy application settings, under "Build Args", set:

```bash
NEXT_PUBLIC_API_URL=https://api-performance.seemplifyai.com/api
NEXT_PUBLIC_WS_URL=wss://api-performance.seemplifyai.com/ws
NEXT_PUBLIC_IDP_URL=https://auth.seemplifyai.com
NEXTAUTH_URL=https://performance.seemplifyai.com
NEXTAUTH_SECRET=your-secure-secret-here
OIDC_ISSUER=https://auth.seemplifyai.com
OIDC_CLIENT_ID=performance-management
```

### 2. Environment Variables
In your Dokploy application settings, under "Environment Variables", set:

```bash
OIDC_CLIENT_SECRET=your-client-secret-from-idp
```

## What Was Fixed in Docker Build

### Issue 1: Missing OIDC Client Secret Build Dependency
**Problem**: The Dockerfile was trying to use `OIDC_CLIENT_SECRET` at build time, but this secret should only be available at runtime.

**Fix**: Removed `OIDC_CLIENT_SECRET` from build-time environment variables and made it a runtime-only variable.

### Issue 2: Environment Variable Handling
**Problem**: NextAuth configuration was using `!` assertions which would fail if environment variables weren't set during build.

**Fix**: Added default values for OIDC configuration in `route.ts` so the build doesn't fail when secrets aren't available during build.

### Issue 3: Missing Build Configuration
**Problem**: Next.js config was minimal and missing production optimizations.

**Fix**: Added comprehensive `next.config.ts` with:
- Standalone output for Docker
- TypeScript/ESLint configuration
- Image optimization settings
- Webpack configuration
- Environment variable declarations

### Issue 4: No .dockerignore
**Problem**: Large files and unnecessary files were being copied into Docker context, slowing down builds.

**Fix**: Created `.dockerignore` file to exclude:
- `node_modules`
- `.env` files
- `.next` build artifacts
- Documentation and test files

## Testing the Build Locally

Before deploying to Dokploy, test the Docker build locally:

```bash
# From performance/frontend directory
docker build -t performance-frontend:test \
  --build-arg NEXT_PUBLIC_API_URL=https://api-performance.seemplifyai.com/api \
  --build-arg NEXT_PUBLIC_WS_URL=wss://api-performance.seemplifyai.com/ws \
  --build-arg NEXT_PUBLIC_IDP_URL=https://auth.seemplifyai.com \
  --build-arg NEXTAUTH_URL=https://performance.seemplifyai.com \
  --build-arg NEXTAUTH_SECRET=test-secret-for-local-build \
  --build-arg OIDC_ISSUER=https://auth.seemplifyai.com \
  --build-arg OIDC_CLIENT_ID=performance-management \
  .
```

## Troubleshooting

### Build Fails with "OIDC_CLIENT_SECRET not found"
**Solution**: Ensure `OIDC_CLIENT_SECRET` is set as a runtime environment variable in Dokploy, NOT as a build argument.

### Build Fails with TypeScript errors
**Solution**: Check that `next.config.ts` has `typescript: { ignoreBuildErrors: false }` - we want to catch type errors, not ignore them.

### Runtime Authentication Fails
**Solution**: Verify that:
1. `NEXTAUTH_URL` matches the actual domain
2. `OIDC_ISSUER` and `NEXT_PUBLIC_IDP_URL` point to the same IdP
3. `OIDC_CLIENT_ID` matches the client registered in IdP
4. `OIDC_CLIENT_SECRET` matches the secret generated in IdP
5. `NEXTAUTH_SECRET` is the same across all instances

### WebSocket Connections Fail
**Solution**: Ensure `NEXT_PUBLIC_WS_URL` uses `wss://` (secure) protocol, not `ws://` (insecure) for production.

## Security Notes

1. **NEVER commit secrets to git** - Always use environment variables
2. **Generate a secure NEXTAUTH_SECRET** - Use: `openssl rand -base64 32`
3. **Use HTTPS for all URLs** in production
4. **OIDC_CLIENT_SECRET should be runtime-only** - Don't embed in Docker image
5. **Rotate secrets regularly** - Especially OIDC_CLIENT_SECRET

## Monitoring and Logs

After deployment, monitor:
- Application logs for authentication errors
- Build logs for any environment variable warnings
- Browser console for Next.js runtime errors
- Network tab for failed API/WebSocket connections
