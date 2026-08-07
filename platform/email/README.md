# Seemplify transactional email

This directory is the deployment owner for the Seemplify transactional-mail
stack. Nothing under Xplorer CRM is required.

Both first-party images are reproducible here: `api/` builds the central Mail
API and `relay/` builds the authenticated SMTP sidecar. Postal and MariaDB use
pinned upstream image versions, while their state remains in named volumes.

## Delivery path

Seemplify products call the central Mail API with their scoped bearer key. The
API validates, meters and queues each message in Postal. Postal submits to the
private Postfix sidecar. Postfix authenticates to `smtp.gmail.com:587` with the
Dew Insight Google Workspace account, normalizes the outbound sender to
`no-reply@dewinsight.com`, and preserves each product's `Reply-To` header.

This path does not depend on the home's public IP, PTR, Dynamic DNS, or
Cloudflare Tunnel for SMTP. Cloudflare Tunnel remains the HTTPS ingress for the
Mail API at `https://mail-control.seemplifyai.com`.

## Documentation

- [API integration](docs/INTEGRATION.md)
- [Dokploy migration and rollback](docs/DOKPLOY-MIGRATION.md)
- [Operations, backups and incidents](docs/OPERATIONS.md)
- [Private access runbook template](docs/PRIVATE-ACCESS-RUNBOOK.template.md)

The Dokploy compose is `compose/docker-compose.dokploy.yml`; its deployment is
fail-closed until the API, worker, sending and tunnel gates are explicitly
opened during the controlled cutover.

## Relay configuration

1. Create `platform/email/.env.local` from `.env.example`.
2. Put the Google app password in the path named by `RELAY_PASSWORD_PATH`.
   The file must contain only the 16-letter password (spaces are accepted).
3. For an existing installation, export the current container settings into an
   ignored runtime file (the script never prints their values):

   ```powershell
   .\scripts\export-running-env.ps1
   ```

4. From `platform/email`, run the complete Seemplify-owned stack:

   ```powershell
   docker compose --env-file .env.runtime -f compose/docker-compose.yml up -d --build
   ```

The relay accepts SMTP only from the private Docker subnet. It exposes no host
SMTP port and never prints the credential.

## Verification

Check that the relay is healthy and that no mail is queued:

```powershell
docker inspect seemplify-mail-postfix-relay-1 --format '{{.State.Health.Status}}'
docker exec seemplify-mail-postfix-relay-1 postqueue -p
```

A successful delivery log ends with `status=sent` and Google's `250 2.0.0`.
Do not treat an API `202` alone as delivery confirmation: it only means Postal
accepted the message for processing.

## Sender behavior

Applications may keep their existing `@seemplifyai.com` From and Reply-To
configuration. The final SMTP hop rewrites the authenticated visible/envelope
sender to Dew Insight. This is deliberate: Google Workspace can authenticate
the Dew Insight identity from any changing residential IP, while the previous
`smtp-relay.gmail.com` configuration rejected the same machine because its IP
was not allowlisted.
