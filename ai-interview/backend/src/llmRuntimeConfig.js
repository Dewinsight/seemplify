const DEFAULT_DEPLOYMENT = 'Llama-3.3-70B-Instruct';
const DEFAULT_API_VERSION = '2024-05-01-preview';

function parseAzureEndpointUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  try {
    const parsed = new URL(rawUrl);
    const parts = parsed.pathname.split('/').filter(Boolean);
    const deploymentIndex = parts.findIndex((part) => part.toLowerCase() === 'deployments');
    return {
      endpoint: `${parsed.protocol}//${parsed.host}`,
      fullChatCompletionsUrl: /\/chat\/completions\/?$/i.test(parsed.pathname) ? parsed.toString() : null,
      deploymentFromPath: deploymentIndex !== -1 ? parts[deploymentIndex + 1] : null,
      apiVersion: parsed.searchParams.get('api-version')
    };
  } catch {
    return null;
  }
}

function resolveLlmRuntimeConfig() {
  const parsed = parseAzureEndpointUrl(process.env.LLAMA_AZURE_ENDPOINT);
  const endpoint =
    parsed?.endpoint ||
    process.env.LLAMA_AZURE_BASE_ENDPOINT ||
    parseAzureEndpointUrl(process.env.azure_openai_url)?.endpoint ||
    process.env.AZURE_OPENAI_ENDPOINT;
  const deployment =
    process.env.LLAMA_AZURE_DEPLOYMENT ||
    parsed?.deploymentFromPath ||
    process.env.azure_openai_model ||
    parseAzureEndpointUrl(process.env.azure_openai_url)?.deploymentFromPath ||
    process.env.AZURE_OPENAI_DEPLOYMENT_NAME ||
    DEFAULT_DEPLOYMENT;
  const apiKey =
    process.env.LLAMA_AZURE_API_KEY ||
    process.env.azure_openai_key ||
    process.env.AZURE_OPENAI_API_KEY;
  const apiVersion =
    process.env.LLAMA_AZURE_API_VERSION ||
    parsed?.apiVersion ||
    parseAzureEndpointUrl(process.env.azure_openai_url)?.apiVersion ||
    process.env.AZURE_OPENAI_API_VERSION ||
    DEFAULT_API_VERSION;
  const chatCompletionsUrl = parsed?.fullChatCompletionsUrl ||
    `${String(endpoint || '').replace(/\/$/, '')}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`;

  return {
    endpoint,
    deployment,
    modelName: deployment,
    apiKey,
    apiVersion,
    chatCompletionsUrl
  };
}

module.exports = {
  DEFAULT_DEPLOYMENT,
  DEFAULT_API_VERSION,
  parseAzureEndpointUrl,
  resolveLlmRuntimeConfig
};
