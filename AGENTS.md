# Seemplify project rules

## Production credentials

- Never write plaintext production secrets into this repository, Git history, issues, logs, screenshots, or chat output.
- Store the plaintext operational inventory only in the sibling `../access` workspace. Keep the portable credential payload encrypted with `SeemplifyVault.psm1`.
- After an authorized production credential change, update the encrypted access vault, rebuild and verify the AES-256 `access.zip`, refresh `access.zip.sha256`, and commit only the encrypted artifacts.
- Production services read secrets from root-only files under `/opt/seemplify/secrets`; deployment workflows must reference secret names rather than embed values.

## Shared identity and AI

- Production application login and signup must use Seemplify Identity (OIDC). Product-local password authentication must remain disabled in production.
- Organization membership and per-app access originate in IdP claims. Downstream applications may mirror that authorization but must not become a second identity authority.
- Product ChatGPT/Codex integrations use the central Recruiter-hosted shared AI gateway with a service-specific HMAC key and an app-scoped activity allow-list.
- New or changed IdP/gateway integrations require focused contract tests, production OIDC-start smoke coverage, and an authenticated browser acceptance pass.

## Canonical branches and deployment

- The Seemplify monorepo and the separate Workspace repository both use `main` as their only development, integration, and production deployment branch.
- Work on the checked-out `main` branch unless the user explicitly requests a separate branch or pull request.
- Before completion, fetch all refs and confirm every relevant recent task branch has zero commits ahead of `main`; merge relevant work before pushing.
- A legacy `master` ref may only be fast-forwarded to `main`. Never develop on it, deploy from it, merge it back into `main`, or force-push it.
- Production workflows must deploy the exact tested `main` commit and verify the live revision plus OIDC/authenticated browser smoke.
