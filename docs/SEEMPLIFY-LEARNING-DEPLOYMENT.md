# Seemplify Learning Deployment Setup

This document defines the deployment setup for the standalone `seemplify-learning` app.

## 1. Dokploy App
Create a Dokploy application for path:
- `seemplify-learning`

Runtime:
- Node.js app using `Dockerfile`

Expose port:
- `5012`

## 2. Environment Variables in Dokploy
Set these in the Dokploy app:
- `PORT=5012`
- `MONGODB_URI=<your mongo uri>`
- `SESSION_SECRET=<strong random secret>`
- `APP_BASE_URL=https://learning.seemplifyai.com`
- `BREVO_API_KEY=<optional>`
- `SENDER_EMAIL=no-reply@seemplifyai.com`
- `SENDER_NAME=Seemplify Learning`
- `CLOUDINARY_URL=<cloudinary url>`

## 3. Cloudflare DNS
Create DNS record:
- Type: `A`
- Name: `learning`
- Content: `<dokploy server public ip>`
- Proxy: Enabled (orange cloud)

Then point Dokploy domain for this app to:
- `learning.seemplifyai.com`

## 4. GitHub Actions Secrets
Add repository secrets:
- `DOKPLOY_URL`
- `DOKPLOY_TOKEN`
- `SEEMPLIFY_LEARNING_APP_ID`

## 5. Workflow
Workflow file:
- `.github/workflows/deploy-seemplify-learning.yml`

Trigger conditions:
- push to `main` affecting `seemplify-learning/**`
- manual trigger (`workflow_dispatch`)

## 6. Notes
- This app uses independent login/register and does not require IDP session/cookies.
- Existing Simple LMS data remains compatible when using same Mongo collections.
