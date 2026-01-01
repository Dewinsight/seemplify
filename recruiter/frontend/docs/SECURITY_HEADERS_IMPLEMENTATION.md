# Security Headers Implementation

This document explains how security headers have been implemented in our Next.js application to address security audit findings.

## Implementation Method

Security headers are configured using Next.js's built-in `headers()` function in `next.config.mjs`. This approach:

1. Works across all deployment platforms
2. Doesn't require modifying application code
3. Applies headers consistently to all routes

## Security Headers Implemented

We've implemented the following security headers:

1. **Content-Security-Policy (CSP)**
   - Controls which resources the browser is allowed to load
   - Prevents Cross-Site Scripting (XSS) attacks
   - Customized for our application's specific needs (APIs, CDNs, etc.)

2. **X-Content-Type-Options**
   - Value: `nosniff`
   - Prevents browsers from MIME-sniffing, reducing security risks

3. **X-Frame-Options**
   - Value: `SAMEORIGIN`
   - Prevents clickjacking attacks by controlling iframe usage

4. **Referrer-Policy**
   - Value: `strict-origin-when-cross-origin`
   - Controls how much referrer information is sent in requests

5. **Permissions-Policy**
   - Restricts browser features (geolocation, microphone, camera)
   - Reduces attack surface and enhances privacy

6. **Strict-Transport-Security (HSTS)**
   - Forces HTTPS connections for enhanced security
   - Set for 1 year (31536000 seconds)

## Verifying Implementation

To verify that security headers are correctly applied after deployment:

1. **Using the Debug Endpoint**
   - Visit `/api/security-debug` on your deployed site
   - This endpoint will show the response headers being applied

2. **Using Security Headers Scanning Tools**
   - Visit [securityheaders.com](https://securityheaders.com)
   - Enter your website URL
   - The scan should now show all headers as properly implemented

3. **Using Browser Developer Tools**
   - Open your browser's developer tools
   - Go to the Network tab
   - Select any request to your domain
   - Check the Response Headers section to confirm headers are present

## Troubleshooting

If security headers are not showing up in production:

1. **Verify Deployment**: Ensure the updated code is deployed
2. **Check for Overrides**: Confirm no proxy, CDN, or hosting platform is stripping headers
3. **Alternative Methods**: If Next.js headers aren't working, consider:
   - For Azure: Use `web.config` file
   - For Vercel: Use `vercel.json` 
   - For Netlify: Use `_headers` file

## CSP Customization

If certain functionality breaks after deployment, you may need to adjust the Content-Security-Policy. The current policy is:

```
default-src 'self'; 
script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://api.nylas.com; 
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; 
font-src 'self' https://fonts.gstatic.com; 
img-src 'self' data: https: http: blob:; 
connect-src 'self' https://api.seemplifyai.com https://idp.seemplifyai.com https://api.nylas.com https://api.brevo.com wss: ws: http://localhost:* https://thesmarthr.netlify.app; 
media-src 'self' blob:; 
object-src 'none'; 
frame-src 'self' https://api.nylas.com; 
worker-src 'self' blob:; 
child-src 'self' blob:; 
form-action 'self'; 
upgrade-insecure-requests
```

If you need to add additional allowed sources, update the appropriate directive in `next.config.mjs`.
