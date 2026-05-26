/**
 * Verify Azure OpenAI configuration without printing secrets.
 *
 * Usage:
 *   node scripts/verifyAzureAiConfig.js
 *   node scripts/verifyAzureAiConfig.js --probe
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

function readEnvAny(keys, fallback = '') {
    for (const key of keys) {
        const value = process.env[key];
        if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return fallback;
}

function maskSecret(value) {
    const text = String(value || '');
    if (!text) return '(missing)';
    if (text.length <= 8) return `${text.slice(0, 2)}***`;
    return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

function resolveChatConfig() {
    const profile = readEnvAny(['AZURE_OPENAI_PROFILE', 'OPENAI_PROFILE'], 'default').toLowerCase();
    const preferKimi = profile.includes('kimi');
    const apiKeyKeys = preferKimi
        ? ['Azure_openai_kimi2.5_key', 'AZURE_OPENAI_API_KEY']
        : ['AZURE_OPENAI_API_KEY', 'Azure_openai_kimi2.5_key'];
    const endpointKeys = preferKimi
        ? ['Azure_openai_kimi2.5_endpoint', 'AZURE_OPENAI_ENDPOINT']
        : ['AZURE_OPENAI_ENDPOINT', 'Azure_openai_kimi2.5_endpoint'];
    const deploymentKeys = preferKimi
        ? ['Azure_openai_kimi2.5_deployment_name', 'AZURE_OPENAI_DEPLOYMENT_NAME']
        : ['AZURE_OPENAI_DEPLOYMENT_NAME', 'Azure_openai_kimi2.5_deployment_name'];
    const versionKeys = preferKimi
        ? ['Azure_openai_kimi2.5_version', 'AZURE_OPENAI_API_VERSION']
        : ['AZURE_OPENAI_API_VERSION', 'Azure_openai_kimi2.5_version'];
    const targetUriKeys = preferKimi
        ? ['Azure_openai_kimi2.5_target_uri', 'AZURE_OPENAI_TARGET_URI']
        : ['AZURE_OPENAI_TARGET_URI', 'Azure_openai_kimi2.5_target_uri'];

    let endpoint = readEnvAny(endpointKeys).replace(/\/+$/, '');
    let deployment = readEnvAny(deploymentKeys);
    let apiVersion = readEnvAny(versionKeys);
    const targetUri = readEnvAny(targetUriKeys);

    if (targetUri) {
        try {
            const parsed = new URL(targetUri);
            if (!endpoint) endpoint = parsed.origin;
            if (!apiVersion) apiVersion = parsed.searchParams.get('api-version') || apiVersion;
            const deploymentMatch = parsed.pathname.match(/\/openai\/deployments\/([^/]+)/i);
            if (!deployment && deploymentMatch?.[1]) deployment = decodeURIComponent(deploymentMatch[1]);
        } catch (_) {
            // Report target URI as configured; OpenAIService will throw if it is required and invalid.
        }
    }

    return {
        profile,
        apiKey: readEnvAny(apiKeyKeys),
        endpoint,
        deployment,
        apiVersion,
        targetUri
    };
}

function resolveResponsesConfig() {
    return {
        url: readEnvAny(['AZURE_OPENAI_RESPONSES_URL', 'AZURE_OPENAI_PROJECT_RESPONSES_URL']),
        apiKey: readEnvAny(['AZURE_OPENAI_RESPONSES_API_KEY', 'AZURE_OPENAI_API_KEY']),
        model: readEnvAny(['AZURE_OPENAI_RESPONSES_MODEL', 'AZURE_OPENAI_MODEL', 'AZURE_OPENAI_DEPLOYMENT_NAME'])
    };
}

async function run() {
    const probe = process.argv.includes('--probe');
    const responses = resolveResponsesConfig();
    const chat = resolveChatConfig();
    const provider = responses.url ? 'responses' : 'chat_completions';

    const status = {
        provider,
        responses: {
            configured: Boolean(responses.url && responses.apiKey && responses.model),
            url: responses.url || '(missing)',
            model: responses.model || '(missing)',
            apiKey: maskSecret(responses.apiKey)
        },
        chatCompletions: {
            configured: Boolean(chat.apiKey && chat.endpoint && chat.deployment && chat.apiVersion),
            profile: chat.profile,
            endpoint: chat.endpoint || '(missing)',
            deployment: chat.deployment || '(missing)',
            apiVersion: chat.apiVersion || '(missing)',
            targetUri: chat.targetUri || '(not set)',
            apiKey: maskSecret(chat.apiKey)
        }
    };

    console.log(JSON.stringify(status, null, 2));

    if (!probe) return;

    const openAIService = require('../services/OpenAIService');
    const result = await openAIService.createCompletion([
        { role: 'system', content: 'Return JSON only.' },
        { role: 'user', content: 'Return {"ok":true,"model":"configured"}.' }
    ], { temperature: 0, parseJson: true });
    console.log(JSON.stringify({ probe: 'ok', result }, null, 2));
}

run().catch((error) => {
    console.error(JSON.stringify({ error: error.message }, null, 2));
    process.exit(1);
});
