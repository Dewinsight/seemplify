# Seemplify transactional-mail API integration

The public API is `https://mail-control.seemplifyai.com`. Migration between the
local rollback stack and Dokploy does not change this URL or the request shape.
Company inbound email remains on Google Workspace.

## Authentication and API keys

Every application receives a separately scoped bearer in this format:

```text
Authorization: Bearer <keyId>.<secret>
```

Only a SHA-256 hash of the secret is stored in `MAIL_API_KEYS`. The plaintext is
shown once when a key is created. Store it in the application's protected
environment as `MAIL_API_TOKEN`; never put it in Git, screenshots, logs or
client-side code.

- `send` permits `POST /v1/messages`.
- `read` permits status, messages, metrics, events, bounces and suppressions.
- `admin` includes all scopes and permits suppression changes.

Create a replacement before revoking an old key. Switch the application, verify
it, revoke the old ID, then apply credential changes. A key inventory change is
not live until the Mail API container is recreated from the protected
environment. A normal container restart keeps its old environment.

## Send a message

```bash
curl -X POST 'https://mail-control.seemplifyai.com/v1/messages' \
  -H "Authorization: Bearer $MAIL_API_TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: onboarding-12345' \
  --data '{
    "from":{"email":"no-reply@dewinsight.com","name":"Seemplify Recruiter"},
    "to":[{"email":"person@example.com","name":"Person"}],
    "replyTo":{"email":"recruitment@seemplifyai.com"},
    "subject":"Welcome to Seemplify",
    "text":"Welcome to Seemplify",
    "html":"<p>Welcome to Seemplify</p>"
  }'
```

```js
const response = await fetch('https://mail-control.seemplifyai.com/v1/messages', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.MAIL_API_TOKEN}`,
    'Content-Type': 'application/json',
    'Idempotency-Key': `password-reset-${requestId}`,
  },
  body: JSON.stringify(message),
});
if (response.status !== 202) throw new Error(`Mail API returned ${response.status}`);
```

The authenticated visible/envelope sender is `no-reply@dewinsight.com`. A
product may set its own display name and `Reply-To`, and both are preserved.

## Response contract

- `202 accepted`: Postal accepted the submission. This does not yet prove final
  delivery; Google `250 2.0.0` in relay logs confirms the last SMTP hop.
- `401 unauthorized`: unknown, malformed, revoked or incorrect bearer.
- `403 forbidden`: the bearer lacks the route's scope.
- `409 idempotency_conflict`: the idempotency key was reused inconsistently.
- `422`: invalid message or suppressed recipient behavior.
- `429`: honor `Retry-After` and use bounded exponential backoff.
- `503 sending_disabled`: an operator has deliberately closed the production
  sending gate; do not bypass it or fall back to Brevo.

Useful read routes are `/health/live`, `/health/ready`, `/v1/status`,
`/v1/metrics`, `/v1/events`, `/v1/bounces` and `/v1/suppressions`.
