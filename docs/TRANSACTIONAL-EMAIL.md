# Transactional email integration

Every Seemplify service sends transactional messages through the self-hosted
Seemplify mail API. Brevo, SendGrid and SMTP relays are no longer used for
transactional sends anywhere in this repository.

| App | Client module |
| --- | --- |
| `experience-management/backend` | `src/mailClient.ts` |
| `Identityprovider` | `src/services/mailClient.js` |
| `seemplify-learning` | `src/services/mailClient.js` |
| `recruiter/backend`, `digilog-recruiter/backend` | `services/mailClient.js` |
| `approver/backend` | `services/mailClient.js` |
| `leave-management/backend` | `services/mailClient.js` |
| `payroll/backend` | `services/mailClient.js` |
| `performance/backend` | `services/mailClient.js` |
| `time-attendance/backend` | `services/mailClient.js` |
| `ai-interview/backend` | `src/mailClient.js` |

Each app carries its own client because every app builds and deploys from its
own `Dockerfile` with its own `package.json`; there is no npm workspace linking
them. The copies are identical per module system (one TypeScript source, one
ESM source, one CJS source) and add no runtime dependencies beyond the Node 18+
global `fetch`.

Two send sites keep an app-specific shape rather than calling `sendMail`
directly, so their existing call sites and error handling stay untouched:

- `recruiter` / `digilog-recruiter`: `EmailService.deliverProviderPayload`
  adapts the existing provider-shaped payloads at the `fetch` seam.
- `approver`: `EmailService._sendWithRetry` keeps its 3-attempt exponential
  backoff, now driven by `error.retryable`.

## Runtime configuration

Set these values in each application's deployment secret store:

| Variable | Purpose |
| --- | --- |
| `MAIL_API_BASE_URL` | Mail API origin, without `/v1/messages` |
| `MAIL_API_TOKEN` | Application-specific `<keyId>.<secret>` bearer credential |
| `MAIL_API_TOKEN_FILE` | Preferred local/deployment secret-file alternative; `MAIL_API_TOKEN` takes precedence |
| `MAIL_FROM_EMAIL` | Verified mailbox at `seemplifyai.com` |
| `MAIL_FROM_NAME` | Display name passed separately from the mailbox |
| `MAIL_TIMEOUT_MS` | Bounded request timeout; defaults to 15 seconds |

Experience Management also supports `MAIL_ENV_FILE` for compatibility with an
operator-managed environment file and `EMAIL_MODE=log` for tests. Prefer an
application-specific token or token file in production.

Never expose the bearer token to a frontend, commit it, put it in a URL, or log
message bodies. Identity and Experience Management should use different keys so
either application can be revoked independently.

## Request contract

Applications issue `POST {MAIL_API_BASE_URL}/v1/messages` with:

```http
Authorization: Bearer <keyId>.<secret>
Content-Type: application/json
Idempotency-Key: <stable-business-event-id>
```

The JSON body uses plain mailbox addresses. `fromName` is separately validated
and is the only supported way to set the sender display name:

```json
{
  "from": "no-reply@seemplifyai.com",
  "fromName": "Seemplify",
  "to": ["recipient@example.com"],
  "subject": "Your account is ready",
  "text": "Plain-text alternative",
  "html": "<p>Your account is ready.</p>",
  "tag": "welcome"
}
```

### Supported body fields

| Field | Type | Notes |
| --- | --- | --- |
| `from` | string | Bare mailbox. Defaults to `MAIL_FROM_EMAIL`. |
| `fromName` | string | Display name. Defaults to `MAIL_FROM_NAME`. |
| `to` | string[] | Bare mailboxes. At least one required. |
| `cc`, `bcc` | string[] | Optional. |
| `replyTo` | string | Optional. |
| `subject` | string | Required. |
| `text`, `html` | string | At least one required. |
| `tag` | string | Coarse business-event label for service-side reporting. |
| `headers` | object | Extra headers, e.g. `X-Seemplify-Correlation`. |
| `attachments` | array | `{ name, contentType, data }` where `data` is base64. |

### Response classification

| Status | Meaning | Client behaviour |
| --- | --- | --- |
| 202 | Accepted | Success. `messageId` is recorded where the caller keeps a delivery ledger. |
| 409 | Replay of a known `Idempotency-Key` | **Treated as success.** The business event already completed and must not be re-sent. |
| 401, 403 | Bad or missing credential | **Permanent.** Retrying cannot help; fix the deployment configuration. |
| 429 | Rate limited | **Retryable.** |
| 5xx, including `503 sending_disabled` while the production gate is closed | Service unavailable | **Retryable.** |
| Other 4xx | Message rejected | **Permanent.** |
| Network error / timeout | Transport fault | **Retryable.** |

Failures are raised as `MailError` carrying `status`, `code`, `retryable` and
`permanent`, so no caller has to pattern-match on message text.

### Retries

**The client performs exactly one attempt.** Retry policy belongs to the caller,
because several services already own a durable attempt ledger — campaign
deliveries, e-sign deliveries, account email attempts — and a hidden retry
inside the client would corrupt their accounting. Where a service already had a
retry loop (`approver`), that loop now retries only on `error.retryable` and
reuses the same `Idempotency-Key`, so an ambiguous failure cannot produce a
second message.

### Idempotency keys

Keys are derived from the business event, never from the request:

- A stable business identifier where one exists — campaign delivery id, e-sign
  delivery id, collector recipient id, space invitation id, password-reset token
  id, leave request id + lifecycle event + recipient, payslip period + employee.
- A SHA-256 digest of the business event where the identifier *is* the secret
  (one-time codes, reset tokens). The secret is hashed, never transmitted.
- A per-request UUID as a last resort for ad-hoc sends with no business
  identifier. This still protects against transport-level replay.

A deliberate resend — an invitation reminder, for example — regenerates its
token, so it produces a new key and is never suppressed.

### Failing closed

If the base URL, the token or the sender is missing, the client raises a
permanent `MailError` with code `mail_not_configured` and **never touches the
network**. Nothing is queued and nothing is silently dropped.

## Intentionally preserved

- **Brevo marketing platform** (`Identityprovider/src/services/brevoMarketingService.js`
  and the campaign services and worker around it). These drive Brevo *marketing
  campaigns* — contacts, lists, campaign scheduling, reports, sender-domain
  authentication — not transactional sends. `BREVO_API_KEY` remains required for
  that feature and is documented as such in `Identityprovider/.env.example`.
- **Inbound delivery-event webhook** (`experience-management/backend/src/brevoWebhook.ts`,
  mounted at `POST /api/webhooks/brevo/transactional`). It feeds the
  `email_suppressions` table and the campaign and e-sign delivery-event ledgers.
  Removing it would delete bounce and complaint suppression with no replacement,
  so the endpoint, its secret (`BREVO_WEBHOOK_SECRET_FILE`) and its behaviour are
  retained. **It no longer receives traffic** now that outbound sending has moved.
- **Nylas mailbox integration** (`recruiter`, `digilog-recruiter`,
  `experience-management`). Inbound mailbox and user-email identity behaviour,
  unrelated to outbound transactional sends.
- **Frappe LMS (`lms/`) and Zulip (`zulip/`)**. Vendored third-party
  applications that send through SMTP relays configured in their own deployment
  files. The mail API exposes no SMTP endpoint, so they are out of scope.

## Remaining work

1. **Bounce route activation.** The Cloudflare Email Worker and mail API bounce
   endpoint are implemented, but the Cloudflare Email Routing rule must remain
   active for delivery reports to reach suppression handling.
2. **Production sending gate.** This integration does not open it. Expect
   `503 sending_disabled` — classified retryable — until it is opened
   deliberately.
3. **Recipient display names.** The contract carries bare mailboxes in `to[]`
   and a display name only for the sender, so recipient display names are no
   longer transmitted. Sender identity, including the per-campaign `senderName`
   in Experience Management, is preserved.

## Verifying a deployment

```bash
# Identity Provider — configuration check only, sends nothing
node Identityprovider/check-mail-service.js

```

The script requires `--send recipient@example.com` before it delivers anything.

## Local service repository

The Docker stack, operational runbooks, Cloudflare Worker, DNS checks and API
documentation live at
`C:\Users\User\Documents\github\crm\Xplorer-crm\platform\email` on the local
control machine.
