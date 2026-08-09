const axios = require('axios');
const validator = require('validator');

const DEFAULT_TIMEOUT_MS = 10000;

function boundedTimeout(value) {
  const parsed = Number(value);
  return Math.max(2000, Math.min(60000, Number.isFinite(parsed) ? parsed : DEFAULT_TIMEOUT_MS));
}

function resolveConfiguration(environment = process.env) {
  const baseUrl = String(environment.ZULIP_BASE_URL || '').trim().replace(/\/+$/, '');
  const botEmail = String(environment.ZULIP_BOT_EMAIL || '').trim();
  const apiKey = String(environment.ZULIP_BOT_API_KEY || '').trim();
  let endpoint = '';

  try {
    const parsed = new URL(`${baseUrl}/`);
    const productionRequiresTls = String(environment.NODE_ENV || '').toLowerCase() === 'production';
    if (!['http:', 'https:'].includes(parsed.protocol)
      || (productionRequiresTls && parsed.protocol !== 'https:')
      || parsed.username
      || parsed.password) {
      throw new TypeError('Unsupported Zulip base URL.');
    }
    endpoint = new URL('/api/v1/messages', parsed).toString();
  } catch (error) {
    endpoint = '';
  }

  return {
    endpoint,
    botEmail: validator.isEmail(botEmail) ? botEmail : '',
    apiKey,
    timeoutMs: boundedTimeout(environment.ZULIP_REQUEST_TIMEOUT_MS)
  };
}

function isConfigured(environment = process.env) {
  const configuration = resolveConfiguration(environment);
  return Boolean(configuration.endpoint && configuration.botEmail && configuration.apiKey);
}

function classifyFailure(error) {
  const status = Number(error?.response?.status || 0);
  if (status === 401 || status === 403) {
    return { error: 'Zulip authentication failed.', code: 'ZULIP_AUTH_FAILED', retryable: false };
  }
  if (status === 404) {
    return { error: 'Zulip message endpoint was not found.', code: 'ZULIP_ENDPOINT_NOT_FOUND', retryable: false };
  }
  if (status === 408 || status === 425 || status === 429 || status >= 500 || status === 0) {
    return { error: 'Zulip delivery is temporarily unavailable.', code: 'ZULIP_TEMPORARILY_UNAVAILABLE', retryable: true };
  }
  return { error: 'Zulip rejected the direct message.', code: 'ZULIP_MESSAGE_REJECTED', retryable: false };
}

/**
 * Sends one Zulip direct message using the official REST shape:
 * POST /api/v1/messages with HTTP Basic bot credentials and form fields
 * `type=direct`, `to=[email]`, and `content`.
 */
async function sendPrivateMessage(recipientEmail, content) {
  const configuration = resolveConfiguration();
  if (!configuration.endpoint || !configuration.botEmail || !configuration.apiKey) {
    return {
      success: false,
      error: 'Zulip service not configured',
      code: 'ZULIP_NOT_CONFIGURED',
      retryable: false
    };
  }

  const recipient = String(recipientEmail || '').trim();
  if (!validator.isEmail(recipient)) {
    return {
      success: false,
      error: 'Zulip recipient is invalid.',
      code: 'ZULIP_RECIPIENT_INVALID',
      retryable: false
    };
  }

  const safeContent = String(content || '').trim().slice(0, 10000);
  if (!safeContent) {
    return {
      success: false,
      error: 'Zulip message content is empty.',
      code: 'ZULIP_CONTENT_INVALID',
      retryable: false
    };
  }

  const form = new URLSearchParams();
  form.set('type', 'direct');
  form.set('to', JSON.stringify([recipient]));
  form.set('content', safeContent);

  try {
    const response = await axios.post(configuration.endpoint, form.toString(), {
      auth: {
        username: configuration.botEmail,
        password: configuration.apiKey
      },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: configuration.timeoutMs,
      validateStatus: status => status >= 200 && status < 300
    });
    return {
      success: true,
      messageId: String(response.data?.id || '')
    };
  } catch (error) {
    // Do not log credentials, recipient addresses, message content, or the
    // provider response body. The worker persists only this classified result.
    return { success: false, ...classifyFailure(error) };
  }
}

module.exports = {
  boundedTimeout,
  isConfigured,
  resolveConfiguration,
  sendPrivateMessage
};
