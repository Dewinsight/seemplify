# Seemplify transactional-mail API integration

The production API is `https://mail-control.seemplifyai.com`. Applications use
this API instead of connecting to Google or Postal directly. Inbound company
mail remains on each domain's existing mail provider.

## Production sender domains

| Domain | State | Notes |
|---|---|---|
| `seemplifyai.com` | Enabled | SPF, Postal DKIM, DMARC and aligned return path verified. |
| `aiinnigeria.com` | Enabled | SPF, Postal DKIM, DMARC and aligned return path verified. |
| `dewinsight.com` | Blocked | Postal identity is staged, but DNS cannot be completed with the current Cloudflare token. Do not add it to `MAIL_API_ALLOWED_DOMAINS` until its DKIM and return-path records pass Postal's DNS check. |

Use meaningful sender identities, for example:

- `no-reply@seemplifyai.com` for automated product messages;
- `security@seemplifyai.com` for sign-in and password alerts;
- `notifications@seemplifyai.com` for workflow notifications;
- `billing@seemplifyai.com` for receipts;
- `support@seemplifyai.com` with a monitored `replyTo` address.

Aliases such as `no-reply`, `noreply` and `dontreply` do not add capacity. They
share the same Google organization limits, and rotating identities damages
sender reputation and makes abuse investigation harder. Concurrency belongs in
the queue and worker layer, not in fabricated From addresses.

## Authentication and API keys

Every application receives a separate bearer:

```text
Authorization: Bearer <keyId>.<secret>
```

Only a SHA-256 hash is stored in `MAIL_API_KEYS`. Keep the plaintext bearer in
the application's protected server environment as `MAIL_API_TOKEN`; never put
it in source code, browser JavaScript, Git, screenshots or logs.

- `send` permits `POST /v1/messages`.
- `read` permits status, message, metric, event, bounce and suppression reads.
- `admin` includes all scopes and permits suppression changes.

Create a dedicated `send` key for each production app. The operator can use
`platform/email/scripts/new-secrets.ps1` against a protected environment copy,
store the generated bearer in the portable encrypted access vault, then
recreate the Mail API container. Create the replacement before revoking an old
key so rotation has no outage.

## Send a message

```bash
curl -X POST 'https://mail-control.seemplifyai.com/v1/messages' \
  -H "Authorization: Bearer $MAIL_API_TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: onboarding-12345' \
  --data '{
    "from":"no-reply@seemplifyai.com",
    "fromName":"Seemplify Recruiter",
    "to":["person@example.com"],
    "replyTo":"recruitment@seemplifyai.com",
    "subject":"Welcome to Seemplify",
    "text":"Welcome to Seemplify",
    "html":"<p>Welcome to Seemplify</p>",
    "tag":"recruiter-onboarding"
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
  body: JSON.stringify({
    from: 'security@seemplifyai.com',
    fromName: 'Seemplify Security',
    to: [user.email],
    subject: 'Reset your password',
    text,
    html,
    tag: 'password-reset',
  }),
});

if (response.status === 429) {
  // Retry after the number of seconds in response.headers.get('Retry-After').
}
if (response.status !== 202) throw new Error(`Mail API returned ${response.status}`);
```

Use a stable, operation-specific `Idempotency-Key` for every retryable send.
Keys may use letters, digits, `.`, `_`, `-` and `:` and must be 8-128
characters. Colon-separated application namespaces such as
`ai_interview_invite:<candidate-id>` are supported. Control characters and
line breaks are rejected.
Queue business events in the client application when losing an email would lose
work, then remove them only after the API returns `202`. Use bounded exponential
backoff for `429` and transient `5xx`; do not retry validation, authentication,
suppression or unapproved-domain responses.

The current API limit is 60 requests of burst capacity and 2 requests/second
sustained per key, with at most 50 recipients per request. Prefer one recipient
per transactional message so recipients cannot be disclosed to one another and
each delivery can be tracked independently.

## Response contract

- `202 accepted`: Postal durably accepted the submission for queueing. It is
  not final-delivery proof.
- `401 unauthorized`: unknown, malformed, revoked or incorrect bearer.
- `403 forbidden`: missing scope or unapproved sender domain.
- `409`: an idempotent request is already in flight or conflicts.
- `422`: invalid message or recipient/suppression behavior.
- `429`: honor `Retry-After` and retry with bounded exponential backoff.
- `503 sending_disabled`: an operator deliberately closed production sending;
  do not bypass it or add a Brevo fallback.

Useful routes are `/health/live`, `/health/ready`, `/v1/status`, `/v1/gates`,
`/v1/metrics`, `/v1/events`, `/v1/bounces` and `/v1/suppressions`. Read and
admin routes require the matching scope.

## Zulip SMTP exception

Zulip is the one production service that does not call the Mail API. It sends
through the private `seemplify-mail_relay_internal` network to
`postfix-relay:25`; that relay then uses the same IP-authorized Google Workspace
hop as the central mail stack. Zulip uses `no-reply@dewinsight.com`, disables
tokenized no-reply addresses and never exposes the private relay publicly.

Keep this exception until Zulip can use a Mail API adapter. Do not change its
visible sender to `seemplifyai.com` while bypassing Postal, because it would not
receive the Postal DKIM signature needed for aligned authentication.

## Dashboard integration

Postal already provides its operations UI at `https://postal.seemplifyai.com`
for message search and delivery history. A branded Seemplify dashboard can be
built on the Mail API without exposing Postal or MariaDB:

- delivery and rejection counters from `/v1/metrics`;
- recent activity from `/v1/events`;
- bounce/complaint health from `/v1/bounces`;
- suppression search and admin actions from `/v1/suppressions`;
- deployment gates and approved domains from `/v1/status` and `/v1/gates`.

Put the dashboard behind Seemplify Identity/OIDC. Its backend holds a `read`
key; only a restricted administrative backend receives `admin`. Do not ship an
API bearer to the browser or query Postal's MariaDB directly.
