# Seemplify Learning

Standalone Simple LMS application with its own authentication, organization/team hierarchy setup, and LMS workspace.

## Features
- Independent login and registration flow (no IDP login dependency)
- Organization + team hierarchy setup workspace
- Full Simple LMS workspace (courses, programs, assignments, requests)
- Banner uploads via Cloudinary
- Email notifications via the Seemplify transactional mail service (optional)
- Dokploy deployment workflow

## Run Locally
1. Copy `.env.example` to `.env` and set values.
2. Install dependencies:
   `npm install`
3. Start app:
   `npm run dev`
4. Open:
   `http://localhost:5012`

## Required Environment Variables
- `PORT`
- `MONGODB_URI`
- `SESSION_SECRET`
- `MAIL_API_BASE_URL` (optional, needed for real emails; local default `http://127.0.0.1:5020`)
- `MAIL_API_TOKEN` (`<keyId>.<secret>`, from the secret store)
- `MAIL_FROM_EMAIL`
- `MAIL_FROM_NAME`
- `APP_BASE_URL`
- `CLOUDINARY_URL` (required for banner uploads)

## Deployment
GitHub Actions workflow:
- `.github/workflows/deploy-seemplify-learning.yml`

Required GitHub secrets:
- `DOKPLOY_URL`
- `DOKPLOY_TOKEN`
- `SEEMPLIFY_LEARNING_APP_ID`
