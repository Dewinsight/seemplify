const { resolveLlmRuntimeConfig } = require('./llmRuntimeConfig');

function extractJsonObject(content) {
  const text = String(content || '').trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
      try {
        return JSON.parse(fenced[1].trim());
      } catch {
        return null;
      }
    }
    const first = text.indexOf('{');
    const last = text.lastIndexOf('}');
    if (first !== -1 && last !== -1 && last > first) {
      try {
        return JSON.parse(text.slice(first, last + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

async function chatCompletion(messages, options = {}) {
  const config = resolveLlmRuntimeConfig();
  if (!config.apiKey || !config.endpoint) {
    const error = new Error('LLAMA_AZURE_ENDPOINT and LLAMA_AZURE_API_KEY are required for AI interview harness calls.');
    error.code = 'LLM_NOT_CONFIGURED';
    error.statusCode = 503;
    throw error;
  }

  const body = {
    messages,
    temperature: options.temperature ?? 0.35,
    top_p: options.topP ?? 1,
    max_tokens: options.maxTokens ?? 500,
    model: config.modelName
  };

  if (options.response_format) {
    body.response_format = options.response_format;
  }

  const response = await fetch(config.chatCompletionsUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': config.apiKey
    },
    body: JSON.stringify(body)
  });

  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const errorMessage = payload?.error?.message || payload?.message || text || `Azure Llama request failed with ${response.status}`;
    const error = new Error(errorMessage);
    error.code = 'LLM_REQUEST_FAILED';
    error.statusCode = response.status;
    throw error;
  }

  const content = payload?.choices?.[0]?.message?.content;
  if (!String(content || '').trim()) {
    const error = new Error('Azure Llama returned an empty chat completion.');
    error.code = 'LLM_EMPTY_RESPONSE';
    error.statusCode = 503;
    throw error;
  }

  return {
    content: String(content).trim(),
    model: payload?.model || config.modelName,
    raw: payload
  };
}

module.exports = {
  chatCompletion,
  extractJsonObject
};
