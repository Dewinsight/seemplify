/**
 * Weaviate connectivity smoke test.
 *
 * Uses backend .env values:
 * - WEAVIATE_HOST (required)
 * - WEAVIATE_SCHEME (optional, default: https)
 * - WEAVIATE_API_KEY (optional)
 * - USE_WEAVIATE (optional)
 *
 * Run:
 *   node scripts/testWeaviate.js
 */

const path = require('path');
const axios = require('axios');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const REQUEST_TIMEOUT_MS = 15000;

const toBoolean = (value, fallback = false) => {
    if (value === undefined || value === null || value === '') return fallback;
    return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
};

const buildHeaders = () => {
    const apiKey = String(process.env.WEAVIATE_API_KEY || '').trim();
    if (!apiKey) return {};
    return { Authorization: `Bearer ${apiKey}` };
};

const requestUrl = async (url, headers) => {
    try {
        const response = await axios.get(url, {
            timeout: REQUEST_TIMEOUT_MS,
            headers,
            validateStatus: () => true
        });

        const ok = response.status >= 200 && response.status < 300;
        return {
            ok,
            status: response.status,
            data: response.data
        };
    } catch (error) {
        return {
            ok: false,
            status: null,
            error: error.message || 'Request failed'
        };
    }
};

const asSingleLine = (value) => {
    const raw = typeof value === 'string' ? value : JSON.stringify(value);
    return String(raw || '').replace(/\s+/g, ' ').trim();
};

const runCheck = async ({ name, paths }, baseUrl, headers) => {
    for (const pathSuffix of paths) {
        const url = `${baseUrl}${pathSuffix}`;
        const result = await requestUrl(url, headers);
        if (result.ok) {
            return {
                name,
                pass: true,
                url,
                status: result.status,
                detail: asSingleLine(result.data).slice(0, 200)
            };
        }
    }

    const lastUrl = `${baseUrl}${paths[paths.length - 1]}`;
    const lastResult = await requestUrl(lastUrl, headers);
    return {
        name,
        pass: false,
        url: lastUrl,
        status: lastResult.status,
        detail: lastResult.error || asSingleLine(lastResult.data).slice(0, 200)
    };
};

const main = async () => {
    const useWeaviate = toBoolean(process.env.USE_WEAVIATE, true);
    const host = String(process.env.WEAVIATE_HOST || '').trim();
    const scheme = String(process.env.WEAVIATE_SCHEME || 'https').trim().toLowerCase();

    if (!host) {
        console.error('ERROR: WEAVIATE_HOST is missing in approver/backend/.env');
        process.exit(1);
    }

    const baseUrl = `${scheme}://${host.replace(/^https?:\/\//i, '').replace(/\/+$/, '')}`;
    const headers = buildHeaders();

    console.log('Weaviate Smoke Test');
    console.log(`- USE_WEAVIATE: ${useWeaviate}`);
    console.log(`- Base URL: ${baseUrl}`);
    console.log(`- API key configured: ${Boolean(process.env.WEAVIATE_API_KEY)}`);

    const checks = [
        {
            name: 'Ready endpoint',
            paths: ['/v1/.well-known/ready', '/.well-known/ready']
        },
        {
            name: 'Live endpoint',
            paths: ['/v1/.well-known/live', '/.well-known/live']
        },
        {
            name: 'Meta endpoint',
            paths: ['/v1/meta']
        },
        {
            name: 'Schema endpoint',
            paths: ['/v1/schema']
        }
    ];

    const results = [];
    for (const check of checks) {
        const result = await runCheck(check, baseUrl, headers);
        results.push(result);
    }

    console.log('\nResults:');
    results.forEach((result) => {
        const symbol = result.pass ? 'PASS' : 'FAIL';
        const status = result.status == null ? 'n/a' : String(result.status);
        console.log(`- ${symbol} | ${result.name} | status=${status} | url=${result.url}`);
        if (result.detail) {
            console.log(`  detail: ${result.detail}`);
        }
    });

    const failed = results.filter((result) => !result.pass);
    if (failed.length > 0) {
        console.error(`\nWeaviate smoke test failed (${failed.length}/${results.length} checks failed).`);
        process.exit(1);
    }

    console.log('\nWeaviate smoke test passed.');
    process.exit(0);
};

main().catch((error) => {
    console.error('Unexpected error while testing Weaviate:', error.message || error);
    process.exit(1);
});

