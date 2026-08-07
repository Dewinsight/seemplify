import { HttpError, sendJson, sendText, readBody, parseJsonBody, queryInt } from './http.mjs';
import {
  authenticate, hasScope, hashAddress, maskAddress, addressDomain, normalizeAddress,
  verifySignedRequest, ReplayGuard, newRequestId, secureCompare,
} from './security.mjs';
import { RateLimiter, clientIdentity } from './rate-limit.mjs';
import { validateMessage, toPostalPayload } from './messages.mjs';
import { parseBounce, looksLikeReport } from './dsn.mjs';
import { PostalClient, PostalError } from './postal-client.mjs';
import { createLogger } from './logging.mjs';

const SOFT_BOUNCE_SUPPRESSION_THRESHOLD = 5;

/** Maps a Postal webhook event name onto a stored event type. */
const POSTAL_EVENT_MAP = new Map([
  ['messagesent', { type: 'sent' }],
  ['messagedelayed', { type: 'deferred' }],
  ['messagedeliveryfailed', { type: 'failed' }],
  ['messageheld', { type: 'held' }],
  ['messagebounced', { type: 'bounced', bounceType: 'hard' }],
]);

export function createApp({ config, store, logger = createLogger({ release: config.release }), postal = null, fetchImpl = globalThis.fetch, now = () => Date.now() }) {
  const postalClient = postal || new PostalClient({ ...config.postal, fetchImpl });
  const limiter = new RateLimiter(config.rateLimits);
  const replayGuard = new ReplayGuard({ ttlMs: config.limits.replayToleranceMs });
  const inFlightIdempotency = new Set();

  const hash = (address) => hashAddress(address, config.addressHashSalt);

  // ------------------------------------------------------------------ gates
  async function evaluateGates({ probe = false } = {}) {
    const gates = [
      {
        id: 'api-credentials',
        label: 'Application API credentials',
        state: config.apiKeysConfigured ? 'ready' : 'blocked',
        detail: config.apiKeysConfigured
          ? `${config.apiKeys.size} key(s) configured as salted hashes`
          : 'MAIL_API_KEYS is empty; every authenticated route refuses traffic',
      },
      {
        id: 'address-salt',
        label: 'Recipient hash salt',
        state: config.addressHashSalt ? 'ready' : 'blocked',
        detail: config.addressHashSalt ? 'Configured' : 'MAIL_API_ADDRESS_HASH_SALT is empty; suppression lookups cannot be trusted',
      },
      {
        id: 'bounce-webhook-secret',
        label: 'Bounce webhook signing secret',
        state: config.webhookSecret ? 'ready' : 'pending',
        detail: config.webhookSecret ? 'Configured' : 'MAIL_API_WEBHOOK_HMAC_SECRET is empty; the Cloudflare Worker cannot be authenticated',
      },
      {
        id: 'postal-webhook-token',
        label: 'Postal webhook token',
        state: config.postalWebhookToken ? 'ready' : 'pending',
        detail: config.postalWebhookToken ? 'Configured' : 'MAIL_API_POSTAL_WEBHOOK_TOKEN is empty; Postal event intake is disabled',
      },
      {
        id: 'postal-credentials',
        label: 'Postal API credential',
        state: postalClient.configured ? 'ready' : 'pending',
        detail: postalClient.configured ? `Configured for ${postalClient.baseUrl}` : 'POSTAL_API_KEY is empty until the mail server exists in Postal',
      },
      {
        id: 'bounce-domain-isolation',
        label: 'Bounce subdomain isolation',
        state: config.bounceDomain !== config.domain && config.bounceDomain.endsWith(`.${config.domain}`) ? 'ready' : 'blocked',
        detail: config.bounceDomain === config.domain
          ? 'The bounce domain must not be the apex domain; that would collide with Google Workspace inbound mail'
          : `Technical DSNs isolated on ${config.bounceDomain}`,
      },
      {
        id: 'sender-identity',
        label: 'Public IP, forward DNS and PTR',
        state: 'external',
        detail: 'Verified outside this container. A stable public IP whose provider-controlled PTR matches the HELO name is a hard production gate; no tunnel or proxy can substitute for it.',
      },
      {
        id: 'dns-authentication',
        label: 'SPF, DKIM and DMARC alignment',
        state: 'external',
        detail: 'Verified from public DNS by the Local Control Center and by seed tests, not from inside this container.',
      },
    ];

    // Postal v3 holds its queue in MariaDB, so there is no broker to probe.
    // A gate for one would sit permanently pending and drag the readiness
    // fraction down while describing a service the stack does not run.
    if (probe) {
      const postalProbe = await postalClient.reachable();
      gates.push({
        id: 'postal-reachable',
        label: 'Postal web service',
        state: postalProbe.reachable ? 'ready' : 'pending',
        detail: postalProbe.reachable ? `Answering (HTTP ${postalProbe.statusCode})` : `Not reachable (${postalProbe.reason})`,
      });
    }

    gates.push({
      id: 'production-sending',
      label: 'Production sending switch',
      state: config.sendEnabled ? 'ready' : 'pending',
      detail: config.sendEnabled
        ? 'EMAIL_SEND_ENABLED is true; the send proxy forwards to Postal'
        : 'EMAIL_SEND_ENABLED is false; the send proxy validates and refuses. No deployment workflow changes this value.',
    });

    const blocking = gates.filter((gate) => gate.state === 'blocked');
    const pending = gates.filter((gate) => gate.state === 'pending');
    return {
      gates,
      ready: gates.filter((gate) => gate.state === 'ready').length,
      total: gates.length,
      state: blocking.length ? 'blocked' : pending.length ? 'building' : 'ready',
    };
  }

  // ------------------------------------------------------------- suppression
  async function recordBounceRecipient(report, { source, messageId }) {
    const address = normalizeAddress(report.recipient);
    if (!address) return null;
    const recipientHash = hash(address);
    const recipientDomain = addressDomain(address);
    const type = report.bounceType === 'complaint' ? 'complained' : 'bounced';

    const event = await store.appendEvent({
      type,
      source,
      messageId,
      recipientHash,
      recipientMasked: maskAddress(address),
      recipientDomain,
      bounceType: report.bounceType,
      statusCode: report.smtpCode || report.status || null,
      diagnosticCode: report.diagnosticCode || null,
    });

    if (report.bounceType === 'hard' || report.bounceType === 'complaint') {
      await store.addSuppression({
        hash: recipientHash,
        masked: maskAddress(address),
        domain: recipientDomain,
        reason: report.bounceType === 'complaint' ? 'complaint' : 'hard_bounce',
        source,
      });
    } else if (report.bounceType === 'soft') {
      const repeats = store.recentEvents({ limit: 500 })
        .filter((item) => item.recipientHash === recipientHash && item.bounceType === 'soft').length;
      if (repeats >= SOFT_BOUNCE_SUPPRESSION_THRESHOLD) {
        await store.addSuppression({
          hash: recipientHash,
          masked: maskAddress(address),
          domain: recipientDomain,
          reason: 'repeated_soft_bounce',
          source,
        });
      }
    }
    return event;
  }

  // ------------------------------------------------------------------ routes
  async function handleSend(request, response, { principal, requestId }) {
    const raw = await readBody(request, config.limits.maxBodyBytes);
    const body = parseJsonBody(raw);
    const message = validateMessage(body, {
      sendingDomain: config.domain,
      maxRecipients: config.limits.maxRecipients,
    });
    store.increment('sendAttempts');

    const idempotencyKey = String(request.headers['idempotency-key'] || '').trim();
    if (idempotencyKey && !/^[A-Za-z0-9._-]{8,128}$/.test(idempotencyKey)) {
      throw new HttpError(400, 'invalid_idempotency_key', 'Idempotency-Key must be 8-128 characters of [A-Za-z0-9._-].');
    }

    // Keys are scoped to the credential so two applications cannot collide on
    // a common value like an order id.
    const scopedKey = idempotencyKey ? `${principal.keyId}:${idempotencyKey}` : null;
    if (scopedKey) {
      const existing = store.getIdempotency(scopedKey);
      if (existing?.value) {
        return sendJson(response, 200, existing.value, { 'Idempotency-Replayed': 'true' });
      }
      if (inFlightIdempotency.has(scopedKey)) {
        throw new HttpError(409, 'idempotency_in_flight', 'A request with this Idempotency-Key is already being processed.');
      }
    }

    // Suppression is applied per recipient, never silently to the whole
    // message: partially-suppressed messages still deliver to the rest.
    const deliverable = [];
    const suppressed = [];
    for (const address of message.allRecipients) {
      const recipientHash = hash(address);
      if (config.addressHashSalt && store.isSuppressed(recipientHash)) {
        store.noteSuppressionHit(recipientHash);
        suppressed.push({ recipient: maskAddress(address), reason: store.getSuppression(recipientHash)?.reason || 'suppressed' });
        await store.appendEvent({
          type: 'suppressed',
          source: 'send-proxy',
          recipientHash,
          recipientMasked: maskAddress(address),
          recipientDomain: addressDomain(address),
          keyId: principal.keyId,
        });
      } else {
        deliverable.push(address);
      }
    }

    if (!deliverable.length) {
      store.increment('sendSuppressed');
      return sendJson(response, 200, {
        status: 'suppressed',
        requestId,
        messageId: null,
        accepted: [],
        suppressed,
        detail: 'Every recipient is on the suppression list. Nothing was submitted to Postal.',
      });
    }

    if (!config.sendEnabled) {
      store.increment('sendRejected');
      const gates = await evaluateGates();
      await store.appendEvent({ type: 'rejected', source: 'send-proxy', keyId: principal.keyId, detail: 'sending_disabled' });
      throw new HttpError(503, 'sending_disabled', 'Production sending is disabled on this deployment.', {
        gates: gates.gates.filter((gate) => gate.state !== 'ready'),
      });
    }

    if (scopedKey) inFlightIdempotency.add(scopedKey);
    try {
      const result = await postalClient.sendMessage(toPostalPayload(message, { recipients: deliverable }));
      store.increment('sendAccepted');

      for (const address of deliverable) {
        await store.appendEvent({
          type: 'accepted',
          source: 'send-proxy',
          messageId: result.messageId,
          recipientHash: hash(address),
          recipientMasked: maskAddress(address),
          recipientDomain: addressDomain(address),
          keyId: principal.keyId,
        });
      }

      const payload = {
        status: 'accepted',
        requestId,
        messageId: result.messageId,
        accepted: deliverable.map((address) => maskAddress(address)),
        suppressed,
      };
      if (scopedKey) await store.putIdempotency(scopedKey, payload);
      logger.info('message.accepted', {
        requestId, keyId: principal.keyId, messageId: result.messageId, count: deliverable.length,
      });
      return sendJson(response, 202, payload);
    } catch (error) {
      store.increment('sendRejected');
      if (error instanceof PostalError) {
        logger.warn('message.rejected', { requestId, keyId: principal.keyId, reason: error.code });
        throw new HttpError(error.status, error.code, 'Postal did not accept the message.', {
          retryable: error.status >= 500,
        });
      }
      throw error;
    } finally {
      if (scopedKey) inFlightIdempotency.delete(scopedKey);
    }
  }

  async function handleBounceWebhook(request, response, { requestId }) {
    if (!config.webhookSecret) throw new HttpError(503, 'webhook_not_configured', 'Bounce intake is not configured.');
    const raw = await readBody(request, config.limits.maxWebhookBytes);
    const verification = verifySignedRequest({
      secret: config.webhookSecret,
      signature: request.headers['x-seemplify-signature'],
      timestamp: request.headers['x-seemplify-timestamp'],
      nonce: request.headers['x-seemplify-nonce'],
      method: 'POST',
      path: '/v1/webhooks/bounce',
      body: raw,
      now: now(),
      toleranceMs: config.limits.replayToleranceMs,
      replayGuard,
    });
    if (!verification.ok) {
      store.increment('webhooksRejected');
      logger.warn('webhook.rejected', { requestId, source: 'cloudflare-worker', reason: verification.reason });
      // A single opaque response for every failure mode.
      throw new HttpError(401, 'unauthorized', 'Signature verification failed.');
    }

    const body = parseJsonBody(raw);
    const encoded = String(body.rawBase64 || '');
    if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
      throw new HttpError(422, 'invalid_payload', '`rawBase64` must contain a base64-encoded message.');
    }
    const rawMessage = Buffer.from(encoded, 'base64').toString('utf8');

    const shape = looksLikeReport(rawMessage);
    if (!shape.ok) {
      store.increment('webhooksRejected');
      logger.warn('webhook.not_a_report', { requestId, source: 'cloudflare-worker', reason: shape.reasons.join(',') });
      throw new HttpError(422, 'not_a_delivery_report', 'The forwarded message is not a delivery status notification.');
    }

    const parsed = parseBounce(rawMessage);
    const recorded = [];
    for (const report of parsed.recipients) {
      const event = await recordBounceRecipient(report, {
        source: 'cloudflare-worker',
        messageId: parsed.originalMessageId || parsed.postalMessageId || null,
      });
      if (event) recorded.push({ recipient: event.recipientMasked, bounceType: event.bounceType });
    }

    store.increment('webhooksAccepted');
    logger.info('webhook.accepted', {
      requestId, source: 'cloudflare-worker', type: parsed.kind, count: recorded.length, sizeBytes: raw.length,
    });
    return sendJson(response, 202, {
      status: 'accepted',
      requestId,
      kind: parsed.kind,
      recorded,
      // Reported so operators can see intake that produced no recipient record.
      unmatched: parsed.recipients.length - recorded.length,
    });
  }

  async function handlePostalWebhook(request, response, { requestId, token }) {
    if (!config.postalWebhookToken) throw new HttpError(503, 'webhook_not_configured', 'Postal event intake is not configured.');
    if (!secureCompare(token, config.postalWebhookToken)) {
      store.increment('webhooksRejected');
      logger.warn('webhook.rejected', { requestId, source: 'postal', reason: 'bad_token' });
      throw new HttpError(401, 'unauthorized', 'Unknown webhook token.');
    }

    const raw = await readBody(request, config.limits.maxWebhookBytes);
    const body = parseJsonBody(raw);
    const eventName = String(body.event || '').toLowerCase();
    const mapping = POSTAL_EVENT_MAP.get(eventName);
    if (!mapping) {
      // Tracking events (opens, clicks) are deliberately not recorded.
      store.increment('webhooksAccepted');
      return sendJson(response, 202, { status: 'ignored', requestId, event: eventName.slice(0, 64) });
    }

    const payload = body.payload && typeof body.payload === 'object' ? body.payload : {};
    const message = payload.message && typeof payload.message === 'object' ? payload.message : {};
    const address = normalizeAddress(message.to);
    const details = String(payload.details || payload.output || '').slice(0, 240);
    const statusCode = String(payload.status || '').slice(0, 16) || null;

    let bounceType = mapping.bounceType || null;
    if (mapping.type === 'failed' && /^5\d\d|5\.\d+\.\d+/.test(details)) bounceType = 'hard';
    else if (mapping.type === 'failed') bounceType = 'soft';

    const event = await store.appendEvent({
      type: mapping.type,
      source: 'postal',
      messageId: message.message_id || message.token || null,
      recipientHash: address ? hash(address) : null,
      recipientMasked: address ? maskAddress(address) : null,
      recipientDomain: address ? addressDomain(address) : null,
      bounceType,
      statusCode,
      diagnosticCode: details || null,
    });

    if (address && (bounceType === 'hard' || bounceType === 'complaint')) {
      await store.addSuppression({
        hash: hash(address),
        masked: maskAddress(address),
        domain: addressDomain(address),
        reason: bounceType === 'complaint' ? 'complaint' : 'hard_bounce',
        source: 'postal',
      });
    }

    store.increment('webhooksAccepted');
    logger.info('webhook.accepted', { requestId, source: 'postal', type: mapping.type });
    return sendJson(response, 202, { status: 'accepted', requestId, type: event.type });
  }

  async function handleAddSuppression(request, response, { requestId }) {
    const raw = await readBody(request, config.limits.maxBodyBytes);
    const body = parseJsonBody(raw);
    const address = normalizeAddress(body.address);
    if (!address) throw new HttpError(422, 'invalid_address', 'A valid `address` is required.');
    if (!config.addressHashSalt) throw new HttpError(503, 'salt_not_configured', 'MAIL_API_ADDRESS_HASH_SALT must be set before suppressions can be managed.');
    const reason = String(body.reason || 'manual');
    const record = await store.addSuppression({
      hash: hash(address),
      masked: maskAddress(address),
      domain: addressDomain(address),
      reason,
      source: 'api',
    });
    logger.info('suppression.added', { requestId, reason, recipientDomain: record.domain });
    return sendJson(response, 201, { status: 'suppressed', requestId, suppression: record });
  }

  async function handleRemoveSuppression(request, response, { requestId, identifier }) {
    const asHash = /^[a-f0-9]{64}$/i.test(identifier) ? identifier.toLowerCase() : hash(decodeURIComponent(identifier));
    if (!asHash) throw new HttpError(422, 'invalid_address', 'Provide an address or its 64-character hash.');
    const removed = await store.removeSuppression(asHash);
    if (!removed) throw new HttpError(404, 'not_found', 'No suppression matches that address.');
    logger.info('suppression.removed', { requestId });
    return sendJson(response, 200, { status: 'removed', requestId });
  }

  async function buildStatus({ probe = true } = {}) {
    const gates = await evaluateGates({ probe });
    // Reported rather than omitted so the panel can say why the queue-depth
    // tiles are empty instead of implying a broker that failed to answer.
    const queue = {
      available: false,
      reason: 'not_applicable',
      detail: 'Postal v3 queues messages in its MariaDB database; there is no message broker exposing queue depth.',
      queues: [],
    };
    return {
      checkedAt: new Date(now()).toISOString(),
      release: config.release,
      domain: config.domain,
      bounceDomain: config.bounceDomain,
      sendEnabled: config.sendEnabled,
      postal: { configured: postalClient.configured, baseUrl: postalClient.baseUrl || null },
      readiness: { ready: gates.ready, total: gates.total, state: gates.state },
      gates: gates.gates,
      queue,
      counters: store.counters(),
      rates: store.deliveryRates(),
      suppressions: store.suppressionSummary(),
    };
  }

  function prometheus(counters, rates, suppressions) {
    const lines = [];
    const push = (name, help, type, value, labels = '') => {
      lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`, `${name}${labels} ${value}`);
    };
    push('mail_api_send_attempts_total', 'Send requests received.', 'counter', counters.sendAttempts);
    push('mail_api_send_accepted_total', 'Messages accepted by Postal.', 'counter', counters.sendAccepted);
    push('mail_api_send_rejected_total', 'Send requests rejected.', 'counter', counters.sendRejected);
    push('mail_api_send_suppressed_total', 'Sends blocked entirely by suppression.', 'counter', counters.sendSuppressed);
    push('mail_api_webhooks_accepted_total', 'Webhook deliveries accepted.', 'counter', counters.webhooksAccepted);
    push('mail_api_webhooks_rejected_total', 'Webhook deliveries rejected.', 'counter', counters.webhooksRejected);
    push('mail_api_suppressions', 'Addresses currently suppressed.', 'gauge', suppressions.total);
    push('mail_api_bounce_rate', 'Bounce rate over the retained event window.', 'gauge', rates.bounceRate);
    push('mail_api_complaint_rate', 'Complaint rate over the retained event window.', 'gauge', rates.complaintRate);
    push('mail_api_event_window_size', 'Events in the rate calculation window.', 'gauge', rates.sampleSize);
    for (const [type, count] of Object.entries(counters.events)) {
      lines.push(`mail_api_events_total{type="${type}"} ${count}`);
    }
    return `${lines.join('\n')}\n`;
  }

  // --------------------------------------------------------------- dispatch
  async function route(request, response, context) {
    const { url, method } = context;
    const path = url.pathname;

    if (method === 'GET' && path === '/health/live') {
      return sendJson(response, 200, { status: 'live', release: config.release });
    }

    if (method === 'GET' && path === '/health/ready') {
      const gates = await evaluateGates({ probe: true });
      const blocked = gates.gates.filter((gate) => gate.state === 'blocked');
      return sendJson(response, blocked.length ? 503 : 200, {
        status: blocked.length ? 'not_ready' : 'ready',
        release: config.release,
        blocked: blocked.map((gate) => gate.id),
      });
    }

    // Webhooks authenticate with their own mechanisms, not with API keys.
    if (method === 'POST' && path === '/v1/webhooks/bounce') {
      context.rateClass = 'webhook';
      applyRateLimit(response, context, clientIdentity(request, config.trustedProxyHops));
      return handleBounceWebhook(request, response, context);
    }
    const postalWebhook = path.match(/^\/v1\/webhooks\/postal\/([A-Za-z0-9_-]{32,128})$/);
    if (method === 'POST' && postalWebhook) {
      context.rateClass = 'webhook';
      applyRateLimit(response, context, clientIdentity(request, config.trustedProxyHops));
      return handlePostalWebhook(request, response, { ...context, token: postalWebhook[1] });
    }

    // Everything below requires an application or admin credential.
    if (!config.apiKeysConfigured) {
      throw new HttpError(503, 'credentials_not_configured', 'No API credentials are configured on this deployment.');
    }
    const principal = authenticate(request.headers.authorization, config.apiKeys);
    if (!principal) {
      applyRateLimit(response, { ...context, rateClass: 'unauthenticated' }, clientIdentity(request, config.trustedProxyHops));
      throw new HttpError(401, 'unauthorized', 'A valid `Authorization: Bearer <keyId>.<secret>` credential is required.');
    }
    context.principal = principal;

    const requireScope = (scope) => {
      if (!hasScope(principal, scope)) throw new HttpError(403, 'forbidden', `This credential lacks the \`${scope}\` scope.`);
    };

    if (method === 'POST' && path === '/v1/messages') {
      requireScope('send');
      applyRateLimit(response, { ...context, rateClass: 'send' }, principal.keyId);
      return handleSend(request, response, { ...context, principal });
    }

    applyRateLimit(response, { ...context, rateClass: 'read' }, principal.keyId);

    const messageLookup = path.match(/^\/v1\/messages\/([A-Za-z0-9_.@-]{1,128})$/);
    if (method === 'GET' && messageLookup) {
      requireScope('read');
      if (!postalClient.configured) throw new HttpError(503, 'postal_not_configured', 'Postal is not configured.');
      try {
        const data = await postalClient.getMessage(messageLookup[1]);
        return sendJson(response, 200, { status: 'ok', message: data });
      } catch (error) {
        if (error instanceof PostalError) throw new HttpError(error.status, error.code, 'Postal could not return that message.');
        throw error;
      }
    }

    if (method === 'GET' && path === '/v1/status') {
      requireScope('read');
      return sendJson(response, 200, await buildStatus({ probe: url.searchParams.get('probe') !== 'false' }));
    }

    if (method === 'GET' && path === '/v1/gates') {
      requireScope('read');
      return sendJson(response, 200, await evaluateGates({ probe: url.searchParams.get('probe') === 'true' }));
    }

    if (method === 'GET' && path === '/v1/metrics') {
      requireScope('read');
      const counters = store.counters();
      const rates = store.deliveryRates();
      const suppressions = store.suppressionSummary();
      if (url.searchParams.get('format') === 'prometheus') {
        return sendText(response, 200, prometheus(counters, rates, suppressions), 'text/plain; version=0.0.4; charset=utf-8');
      }
      return sendJson(response, 200, { counters, rates, suppressions, replayGuardSize: replayGuard.size });
    }

    if (method === 'GET' && path === '/v1/events') {
      requireScope('read');
      return sendJson(response, 200, {
        events: store.recentEvents({
          limit: queryInt(url.searchParams, 'limit', 50, { min: 1, max: config.limits.recentEventLimit }),
          type: url.searchParams.get('type'),
          domain: url.searchParams.get('domain'),
        }),
      });
    }

    if (method === 'GET' && path === '/v1/bounces') {
      requireScope('read');
      return sendJson(response, 200, {
        bounces: store.recentEvents({
          limit: queryInt(url.searchParams, 'limit', 50, { min: 1, max: config.limits.recentEventLimit }),
          bounceOnly: true,
        }),
        summary: store.deliveryRates(),
      });
    }

    if (method === 'GET' && path === '/v1/suppressions') {
      requireScope('read');
      return sendJson(response, 200, {
        ...store.listSuppressions({
          limit: queryInt(url.searchParams, 'limit', 100, { min: 1, max: 1000 }),
          offset: queryInt(url.searchParams, 'offset', 0),
          reason: url.searchParams.get('reason'),
          domain: url.searchParams.get('domain'),
        }),
        summary: store.suppressionSummary(),
      });
    }

    if (method === 'POST' && path === '/v1/suppressions') {
      requireScope('admin');
      return handleAddSuppression(request, response, context);
    }

    const suppressionDelete = path.match(/^\/v1\/suppressions\/([^/]{1,320})$/);
    if (method === 'DELETE' && suppressionDelete) {
      requireScope('admin');
      return handleRemoveSuppression(request, response, { ...context, identifier: suppressionDelete[1] });
    }

    throw new HttpError(404, 'not_found', 'No such endpoint.');
  }

  function applyRateLimit(response, context, identity) {
    const verdict = limiter.consume(context.rateClass, identity, now());
    if (!verdict.allowed) {
      throw new HttpError(429, 'rate_limited', 'Too many requests.', { retryAfterMs: verdict.retryAfterMs });
    }
    // Set now so the values survive whichever response path runs later.
    response.setHeader('X-RateLimit-Limit', String(verdict.limit));
    response.setHeader('X-RateLimit-Remaining', String(verdict.remaining));
  }

  async function handler(request, response) {
    const startedAt = now();
    const requestId = newRequestId();
    let url;
    try {
      url = new URL(request.url, `http://${request.headers.host || 'mail-api'}`);
    } catch {
      return sendJson(response, 400, { error: { code: 'invalid_request', message: 'Malformed request target.' } });
    }
    const context = { url, method: request.method, requestId, rateClass: 'read' };
    response.setHeader('X-Request-Id', requestId);

    try {
      await route(request, response, context);
      logger.info('request', {
        requestId, method: request.method, path: url.pathname, status: response.statusCode,
        durationMs: now() - startedAt, keyId: context.principal?.keyId,
      });
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      const code = error instanceof HttpError ? error.code : 'internal_error';
      const message = error instanceof HttpError ? error.message : 'The request could not be completed.';
      const headers = {};
      if (error?.extra?.retryAfterMs) headers['Retry-After'] = String(Math.ceil(error.extra.retryAfterMs / 1000));
      if (status >= 500) {
        logger.error('request.failed', { requestId, method: request.method, path: url.pathname, status, reason: code, error: error.message });
      } else {
        logger.warn('request.rejected', { requestId, method: request.method, path: url.pathname, status, reason: code });
      }
      sendJson(response, status, {
        error: { code, message, requestId, ...(error instanceof HttpError ? error.extra : {}) },
      }, headers);
    }
  }

  return { handler, evaluateGates, buildStatus, postalClient, limiter, replayGuard };
}

export { SOFT_BOUNCE_SUPPRESSION_THRESHOLD, POSTAL_EVENT_MAP };
