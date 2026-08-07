/**
 * Thin client for the Postal HTTP API.
 *
 * This service deliberately does not reimplement an MTA. Queueing, DKIM
 * signing, per-destination throttling, TLS negotiation and retry scheduling are
 * Postal's job. Everything here is a bounded, timed-out HTTP call.
 *
 * Postal's v1 API answers with HTTP 200 and a `status` field for application
 * errors, so both the transport status and the body status are checked.
 */

export class PostalError extends Error {
  constructor(message, { code = 'postal_error', status = 502, retryable = false, detail = null } = {}) {
    super(message);
    this.name = 'PostalError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.detail = detail;
  }
}

const RETRYABLE_HTTP = new Set([408, 425, 429, 500, 502, 503, 504]);

export class PostalClient {
  #baseUrl;
  #apiKey;
  #hostHeader;
  #timeoutMs;
  #fetch;
  #sleep;

  constructor({ baseUrl, apiKey, hostHeader = '', timeoutMs = 15_000, fetchImpl = globalThis.fetch, sleep = null } = {}) {
    this.#baseUrl = String(baseUrl || '').replace(/\/+$/, '');
    this.#apiKey = String(apiKey || '');
    this.#hostHeader = String(hostHeader || '').trim();
    this.#timeoutMs = timeoutMs;
    this.#fetch = fetchImpl;
    this.#sleep = sleep || ((ms) => new Promise((resolve) => { setTimeout(resolve, ms).unref?.(); }));
  }

  get configured() {
    return Boolean(this.#baseUrl && this.#apiKey);
  }

  get baseUrl() {
    return this.#baseUrl;
  }

  async #call(pathname, payload, { attempts = 3 } = {}) {
    if (!this.configured) {
      throw new PostalError('Postal is not configured.', { code: 'postal_not_configured', status: 503 });
    }

    let lastError = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
      timer.unref?.();
      try {
        const response = await this.#fetch(`${this.#baseUrl}${pathname}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Server-API-Key': this.#apiKey,
            Accept: 'application/json',
            ...(this.#hostHeader ? { Host: this.#hostHeader } : {}),
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        if (!response.ok) {
          const retryable = RETRYABLE_HTTP.has(response.status);
          lastError = new PostalError(`Postal responded with HTTP ${response.status}.`, {
            code: 'postal_http_error',
            status: retryable ? 503 : 502,
            retryable,
          });
          if (!retryable) throw lastError;
        } else {
          const body = await response.json().catch(() => null);
          if (!body || typeof body !== 'object') {
            throw new PostalError('Postal returned an unreadable response.', { code: 'postal_bad_response' });
          }
          if (body.status === 'success') return body.data ?? {};
          // Postal signals application errors in-band. Only the error code is
          // surfaced; the message may echo submitted content.
          const code = String(body.data?.code || body.status || 'unknown');
          throw new PostalError('Postal rejected the request.', {
            code: `postal_${code.toLowerCase()}`.slice(0, 64),
            status: code === 'ValidationError' ? 422 : 502,
            detail: code,
          });
        }
      } catch (error) {
        if (error instanceof PostalError && !error.retryable) throw error;
        lastError = error instanceof PostalError
          ? error
          : new PostalError(error.name === 'AbortError' ? 'Postal request timed out.' : 'Postal is unreachable.', {
            code: error.name === 'AbortError' ? 'postal_timeout' : 'postal_unreachable',
            status: 503,
            retryable: true,
          });
      } finally {
        clearTimeout(timer);
      }

      if (attempt < attempts) await this.#sleep(Math.min(2_000, 200 * 2 ** (attempt - 1)));
    }
    throw lastError || new PostalError('Postal request failed.', { code: 'postal_error', status: 502 });
  }

  /**
   * @param {object} message Already-validated message payload.
   * @returns {Promise<{messageId: string|null, recipients: object}>}
   */
  async sendMessage(message) {
    const data = await this.#call('/api/v1/send/message', message);
    return {
      messageId: data.message_id || null,
      recipients: data.messages || {},
    };
  }

  /** Sends a fully-formed RFC 5322 message (used by the raw passthrough path). */
  async sendRaw({ mailFrom, rcptTo, data }) {
    const result = await this.#call('/api/v1/send/raw', {
      mail_from: mailFrom,
      rcpt_to: rcptTo,
      data,
    });
    return { messageId: result.message_id || null, recipients: result.messages || {} };
  }

  /** Message detail lookup. `expansions` follows Postal's `_expansions` field. */
  async getMessage(id, expansions = ['status']) {
    return this.#call('/api/v1/messages/message', { id, _expansions: expansions }, { attempts: 2 });
  }

  /**
   * Liveness probe that does not require a valid server key: any HTTP response
   * proves the web server is answering. Used for the readiness gate only.
   */
  async reachable() {
    if (!this.#baseUrl) return { reachable: false, reason: 'not_configured' };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(this.#timeoutMs, 5_000));
    timer.unref?.();
    try {
      const response = await this.#fetch(`${this.#baseUrl}/`, { method: 'GET', redirect: 'manual', signal: controller.signal });
      return { reachable: true, statusCode: response.status };
    } catch (error) {
      return { reachable: false, reason: error.name === 'AbortError' ? 'timeout' : 'unreachable' };
    } finally {
      clearTimeout(timer);
    }
  }
}

/*
 * There is deliberately no queue-depth reader here. Postal dropped RabbitMQ in
 * v2 and v3 keeps queued messages in its MariaDB database, so polling a broker
 * management API would report nothing on this stack no matter how it is
 * configured.
 */
