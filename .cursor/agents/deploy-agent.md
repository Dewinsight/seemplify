---
name: deploy-agent
description: Deploy Seemplify applications through the canonical Hostinger workflows
---

# Deploy subagent

Use `.cursor/skills/deploy-server/SKILL.md` for deployment work. Production runs
on Hostinger and is released by the `*-hostinger.yml` GitHub workflows. Dokploy
provides Traefik and platform services on that host; Seemplify applications are
managed by the Compose definitions in `deploy/hostinger`.

Never read or print plaintext secrets. Use GitHub secret names in workflows and
the encrypted sibling `../access` vault for authorized recovery operations.
