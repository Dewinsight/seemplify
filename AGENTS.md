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
