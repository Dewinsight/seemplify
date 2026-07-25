const { resolveLlmRuntimeConfig } = require('../../config/llmRuntimeConfig');

function combinedRequestSignal(timeoutMs, externalSignal) {
  const timeoutSignal = typeof globalThis.AbortSignal?.timeout === 'function'
    ? globalThis.AbortSignal.timeout(timeoutMs)
    : undefined;
  if (!externalSignal) return timeoutSignal;
  if (!timeoutSignal) return externalSignal;
  if (typeof globalThis.AbortSignal?.any === 'function') {
    return globalThis.AbortSignal.any([externalSignal, timeoutSignal]);
  }
  const controller = new AbortController();
  const abort = (signal) => {
    if (!controller.signal.aborted) controller.abort(signal.reason);
  };
  if (externalSignal.aborted) abort(externalSignal);
  else externalSignal.addEventListener('abort', () => abort(externalSignal), { once: true });
  if (timeoutSignal.aborted) abort(timeoutSignal);
  else timeoutSignal.addEventListener('abort', () => abort(timeoutSignal), { once: true });
  return controller.signal;
}

class AzureTextRollbackAdapter {
  constructor({ fetchImpl = global.fetch, configResolver = resolveLlmRuntimeConfig } = {}) {
    this.fetch = fetchImpl;
    this.configResolver = configResolver;
  }

  getConfiguration() {
    const config = this.configResolver();
    if (!config?.endpoint || !config?.apiKey || !config?.deployment || !config?.apiVersion) {
      const error = new Error('Azure text rollback baseline is not configured');
      error.code = 'AI_AZURE_BASELINE_NOT_CONFIGURED';
      error.statusCode = 503;
      throw error;
    }
    return config;
  }

  assertConfigured() {
    const config = this.getConfiguration();
    return { deployment: config.deployment, endpoint: config.endpoint };
  }

  preparePayload(payload) {
    const prepared = { ...payload };
    delete prepared.model;
    delete prepared.reasoning_effort;
    delete prepared.reasoning_format;
    delete prepared.include_reasoning;
    delete prepared.stream_options;

    if (prepared.response_format?.type === 'json_schema') {
      const schema = prepared.response_format.json_schema?.schema;
      prepared.response_format = { type: 'json_object' };
      if (schema && Array.isArray(prepared.messages)) {
        prepared.messages = [
          ...prepared.messages,
          {
            role: 'system',
            content: `Return one JSON object matching this schema exactly: ${JSON.stringify(schema)}`
          }
        ];
      }
    }
    return prepared;
  }

  async request({ payload, timeoutMs = 90_000, signal }) {
    if (typeof this.fetch !== 'function') {
      const error = new Error('No fetch implementation is available for the Azure rollback baseline');
      error.code = 'AI_PROVIDER_NETWORK_ERROR';
      error.statusCode = 503;
      throw error;
    }
    const config = this.getConfiguration();
    const endpoint = String(config.endpoint).replace(/\/$/, '');
    const url = `${endpoint}/openai/deployments/${encodeURIComponent(config.deployment)}/chat/completions?api-version=${encodeURIComponent(config.apiVersion)}`;
    try {
      return await this.fetch(url, {
        method: 'POST',
        headers: {
          'api-key': config.apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(this.preparePayload(payload)),
        signal: combinedRequestSignal(timeoutMs, signal)
      });
    } catch (cause) {
      if (signal?.aborted && signal.reason instanceof Error) throw signal.reason;
      const error = new Error('Azure text rollback baseline could not be reached');
      error.code = 'AI_PROVIDER_NETWORK_ERROR';
      error.statusCode = 503;
      error.cause = cause;
      throw error;
    }
  }
}

module.exports = { AzureTextRollbackAdapter };
