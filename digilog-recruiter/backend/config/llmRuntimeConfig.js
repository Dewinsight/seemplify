/**
 * Single source of truth for the Azure-hosted Llama 3.3 70B deployment.
 * All LLM call sites import resolveLlmRuntimeConfig() from here.
 *
 * Required env vars:
 *   LLAMA_AZURE_ENDPOINT  – full chat-completions URL
 *                           e.g. https://<resource>.cognitiveservices.azure.com/openai/deployments/Llama-3.3-70B-Instruct/chat/completions?api-version=2024-05-01-preview
 *   LLAMA_AZURE_API_KEY   – Azure API key for that resource
 *
 * Optional overrides:
 *   LLAMA_AZURE_DEPLOYMENT   – deployment name (parsed from LLAMA_AZURE_ENDPOINT if omitted)
 *   LLAMA_AZURE_API_VERSION  – api-version (parsed from LLAMA_AZURE_ENDPOINT if omitted)
 */

const DEFAULT_DEPLOYMENT = 'Llama-3.3-70B-Instruct';
const DEFAULT_API_VERSION = '2024-05-01-preview';

function parseAzureEndpointUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  try {
    const parsed = new URL(rawUrl);
    const parts = parsed.pathname.split('/').filter(Boolean);
    const idx = parts.findIndex((p) => p.toLowerCase() === 'deployments');
    return {
      endpoint: `${parsed.protocol}//${parsed.host}`,
      deploymentFromPath: idx !== -1 ? parts[idx + 1] : null,
      apiVersion: parsed.searchParams.get('api-version'),
    };
  } catch {
    return null;
  }
}

function resolveLlmRuntimeConfig() {
  const urlParsed = parseAzureEndpointUrl(process.env.LLAMA_AZURE_ENDPOINT);

  const endpoint =
    urlParsed?.endpoint ||
    process.env.LLAMA_AZURE_BASE_ENDPOINT ||
    parseAzureEndpointUrl(process.env.azure_openai_url)?.endpoint ||
    process.env.AZURE_OPENAI_ENDPOINT;

  const deployment =
    process.env.LLAMA_AZURE_DEPLOYMENT ||
    urlParsed?.deploymentFromPath ||
    process.env.azure_openai_model ||
    parseAzureEndpointUrl(process.env.azure_openai_url)?.deploymentFromPath ||
    DEFAULT_DEPLOYMENT;

  const apiKey =
    process.env.LLAMA_AZURE_API_KEY ||
    process.env.azure_openai_key ||
    process.env.AZURE_OPENAI_API_KEY;

  const apiVersion =
    process.env.LLAMA_AZURE_API_VERSION ||
    urlParsed?.apiVersion ||
    parseAzureEndpointUrl(process.env.azure_openai_url)?.apiVersion ||
    process.env.AZURE_OPENAI_API_VERSION ||
    DEFAULT_API_VERSION;

  if (!endpoint || !apiKey) {
    console.warn(
      '⚠️  LLM config incomplete — LLAMA_AZURE_ENDPOINT and/or LLAMA_AZURE_API_KEY not set.'
    );
  }

  return {
    endpoint,
    deployment,
    modelName: deployment,
    apiKey,
    apiVersion,
    urlBasedConfig: urlParsed,
  };
}

module.exports = {
  DEFAULT_DEPLOYMENT,
  parseAzureEndpointUrl,
  resolveLlmRuntimeConfig,
};
