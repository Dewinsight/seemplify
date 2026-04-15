/**
 * Single source of truth for Azure-hosted chat/completions (gpt-4.1 or other deployments).
 * All LLM call sites should use this resolver so job chat, matching analysis, and LangChain stay aligned.
 *
 * Primary env vars (in priority order):
 *   LLAMA_AZURE_ENDPOINT, LLAMA_AZURE_DEPLOYMENT, LLAMA_AZURE_API_KEY, LLAMA_AZURE_API_VERSION
 * Fallbacks: azure_openai_*, AZURE_OPENAI_*, GPT_MODEL
 */

const DEFAULT_DEPLOYMENT = 'gpt-4.1';

function parseAzureEndpointUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return null;
  }

  try {
    const parsed = new URL(rawUrl);
    const pathParts = parsed.pathname.split('/').filter(Boolean);
    const deploymentsIndex = pathParts.findIndex((part) => part.toLowerCase() === 'deployments');
    const deploymentFromPath = deploymentsIndex !== -1 ? pathParts[deploymentsIndex + 1] : null;
    const apiVersion = parsed.searchParams.get('api-version');

    return {
      endpoint: `${parsed.protocol}//${parsed.host}`,
      deploymentFromPath,
      apiVersion,
    };
  } catch (_error) {
    return null;
  }
}

/**
 * @returns {{
 *   endpoint: string | undefined,
 *   deployment: string,
 *   modelName: string,
 *   apiKey: string | undefined,
 *   apiVersion: string,
 *   urlBasedConfig: ReturnType<typeof parseAzureEndpointUrl> | null
 * }}
 */
function resolveLlmRuntimeConfig() {
  const urlBasedConfig =
    parseAzureEndpointUrl(process.env.LLAMA_AZURE_ENDPOINT) ||
    parseAzureEndpointUrl(process.env.azure_openai_url) ||
    parseAzureEndpointUrl(process.env.AZURE_OPENAI_ENDPOINT);

  const endpoint =
    process.env.LLAMA_AZURE_BASE_ENDPOINT ||
    urlBasedConfig?.endpoint ||
    process.env.AZURE_OPENAI_ENDPOINT;

  // Resolution priority: explicit deployment vars → URL-derived deployment → azure_openai_model → default
  // NOTE: GPT_MODEL and AZURE_OPENAI_DEPLOYMENT_NAME are checked AFTER azure_openai_model so that
  // a properly-set azure_openai_url (which encodes the real deployment) takes precedence.
  const deployment =
    process.env.LLAMA_AZURE_DEPLOYMENT ||
    process.env.azure_openai_model ||
    urlBasedConfig?.deploymentFromPath ||
    process.env.GPT_MODEL ||
    process.env.AZURE_OPENAI_DEPLOYMENT_NAME ||
    DEFAULT_DEPLOYMENT;

  const apiKey =
    process.env.LLAMA_AZURE_API_KEY ||
    process.env.azure_openai_key ||
    process.env.AZURE_OPENAI_API_KEY ||
    process.env.AZURE_GPT4O_API_KEY;

  const apiVersion =
    process.env.LLAMA_AZURE_API_VERSION ||
    urlBasedConfig?.apiVersion ||
    process.env.AZURE_OPENAI_API_VERSION ||
    '2025-01-01-preview';

  return {
    endpoint,
    deployment,
    modelName: deployment,
    apiKey,
    apiVersion,
    urlBasedConfig,
  };
}

module.exports = {
  DEFAULT_DEPLOYMENT,
  parseAzureEndpointUrl,
  resolveLlmRuntimeConfig,
};
