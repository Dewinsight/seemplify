# SSO Configuration Guide for Identity Provider Hub

## Overview
This guide explains how to configure bidirectional SSO between the Identity Provider Hub and any application.

## How It Works

### Two-Way SSO Flow
1. **App → Identity Provider** ("Login with AIIN" button)
   - User clicks login button on the app
   - App redirects to its backend OIDC endpoint
   - Backend initiates OIDC flow with Identity Provider
   - User logs in (or SSO if already logged in)
   - Identity Provider redirects back with tokens
   - App logs user in

2. **Identity Provider → App** (Hub Launch)
   - User is logged into Identity Provider Hub
   - User clicks app card
   - Hub redirects to app's SSO endpoint with `idp_initiated=true`
   - App backend initiates OIDC without forcing login
   - Identity Provider detects existing session and auto-completes
   - App receives tokens and logs user in

## Adding a New App to the Hub

### Step 1: Register the App in clients.json
Add your app's OIDC client configuration:

```json
{
  "client_id": "your-app-backend",
  "client_secret": "your-app-secret",
  "redirect_uri_patterns": [
    "http://localhost:PORT/api/auth/callback",
    "https://your-app.com/api/auth/callback"
  ],
  "allowed_origins": [
    "http://localhost:PORT",
    "https://your-app.com"
  ],
  "response_types": ["code"],
  "grant_types": ["authorization_code", "refresh_token"],
  "token_endpoint_auth_method": "client_secret_post"
}
```

### Step 2: Add App to MongoDB
The app will be automatically added to MongoDB when the Identity Provider starts, or you can manually add it:

```javascript
// In MongoDB, add to HubApp collection:
{
  appId: 'your-app',
  name: 'Your App Name',
  description: 'Description of your app',
  icon: 'icon-name',  // or emoji
  color: '#667eea',   // Brand color
  url: 'https://your-app.com',
  loginUrl: 'https://your-app-backend.com/api/auth/oidc/start?idp_initiated=true&returnTo=https://your-app.com/dashboard',
  clientId: 'your-app-backend',
  isActive: true,
  isPublic: true,
  category: 'productivity',  // or 'hr', 'communication', etc.
  order: 2  // Display order in hub
}
```

### Step 3: Configure Your App's Backend

Your app's OIDC start endpoint should:

```javascript
// Example: /api/auth/oidc/start
router.get('/api/auth/oidc/start', async (req, res) => {
  // Check if this is IdP-initiated SSO
  const isIdpInitiated = req.query.idp_initiated === 'true';
  const returnTo = req.query.returnTo || '/dashboard';
  
  // Configure OIDC client
  const client = new OidcClient({
    // ... your config
  });
  
  // Build authorization URL
  const authParams = {
    scope: 'openid email profile',
    state: generateState(),
    // ... other params
  };
  
  // IMPORTANT: Only force login if NOT IdP-initiated
  if (!isIdpInitiated) {
    authParams.prompt = 'login';
  }
  
  const authUrl = client.authorizationUrl(authParams);
  res.redirect(authUrl);
});
```

### Step 4: Environment Variables

Add these to your Identity Provider's `.env`:

```env
# Your app configuration
YOUR_APP_URL=https://your-app.com
YOUR_APP_API_URL=https://your-app-backend.com
```

Then update `HubApp.js` to use these in the seed function:

```javascript
const yourAppConfig = {
  appId: 'your-app',
  name: 'Your App',
  url: process.env.YOUR_APP_URL || 'http://localhost:3000',
  loginUrl: `${process.env.YOUR_APP_API_URL || 'http://localhost:3001'}/api/auth/oidc/start?idp_initiated=true&returnTo=${encodeURIComponent(process.env.YOUR_APP_URL || 'http://localhost:3000')}/dashboard`,
  // ... rest of config
};
```

## Key Points for Successful Integration

1. **Always include `idp_initiated=true`** in the `loginUrl` for hub-initiated SSO
2. **Don't force login** when `idp_initiated=true` to allow SSO
3. **Include a `returnTo` parameter** to control where users land after login
4. **Use environment variables** for URLs to support different environments
5. **Store tokens securely** and handle refresh properly

## Testing Your Integration

1. **Test App → IdP flow:**
   - Go to your app's login page
   - Click "Login with AIIN"
   - Should redirect to Identity Provider login
   - After login, should return to your app authenticated

2. **Test IdP → App flow:**
   - Login to Identity Provider Hub
   - Click your app's card
   - Should automatically log into your app without showing login form

## Troubleshooting

- **User lands on login page instead of being logged in:**
  - Check that `idp_initiated=true` is in the URL
  - Verify your backend isn't forcing `prompt: 'login'`
  - Ensure tokens are being processed correctly in your frontend

- **"Invalid redirect_uri" error:**
  - Verify the redirect URI in clients.json matches exactly
  - Check for trailing slashes or protocol mismatches

- **Session not detected:**
  - Ensure cookies are being sent (check SameSite settings)
  - Verify the Identity Provider session is active