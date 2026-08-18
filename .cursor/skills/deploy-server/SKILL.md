---
name: deploy-server
description: Deploy and diagnose Seemplify production applications on the Hostinger VPS
---

# Hostinger production deployment

Production applications are built from the tested `main` commit by GitHub
Actions and deployed to the Hostinger VPS. Dokploy and its Traefik network run
on that VPS, but application lifecycle is owned by the Compose files under
`deploy/hostinger`; do not call legacy Dokploy application IDs.

## Required process

1. Confirm the relevant workflow packages and tests the exact `main` commit.
2. Use only `HOSTINGER_SSH_HOST`, `HOSTINGER_SSH_USER`,
   `HOSTINGER_SSH_PRIVATE_KEY`, and `HOSTINGER_SSH_KNOWN_HOSTS` secret names.
3. Build an immutable image tagged with the Git commit and label it with
   `org.opencontainers.image.revision`.
4. Deploy through the appropriate Compose file in `deploy/hostinger`.
5. Wait for container health, verify the running revision label, run
   `smoke-hostinger.sh`, and verify the public endpoint.
6. For OIDC changes, complete an authenticated browser acceptance pass.

## Operational access

- Hostinger VPS ID: `1907030`
- Production address: `179.198.192.126`
- SSH account: `root`
- Dokploy URL: `https://dokploy.seemplifyai.com`
- Compose root: `/opt/seemplify/deploy/hostinger`
- Root-only secrets: `/opt/seemplify/secrets`

Use the encrypted sibling `../access` vault when authorized recovery material is
required. Never commit, print, or paste plaintext production credentials.

## Canonical workflows

- Core workforce applications: `deploy-core-hostinger.yml`
- Experience, knowledge, interview, and marketing: `deploy-experience-hostinger.yml`
- Approver: `deploy-approver-hostinger.yml`
- Shared ChatGPT gateway: `deploy-chatgpt-gateway-hostinger.yml`
- Automation Hub: `deploy-automation-hostinger.yml`
- Mail platform: `deploy-mail-service.yml`

Retired or excluded products must not retain an executable production workflow.
