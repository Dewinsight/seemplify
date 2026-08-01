const fs = require('node:fs');
const path = require('node:path');
const { CONFIG } = require('./config.cjs');
const { signRequest } = require('./auth.cjs');

async function signedRequest(requestPath, input, { config = CONFIG, fetchImpl = fetch, timeoutMs = 10_000 } = {}) {
  const secret = fs.readFileSync(path.join(config.paths.runtime, 'service-secret'), 'utf8').trim();
  const body = JSON.stringify(input);
  const signed = signRequest(secret, body, requestPath);
  const response = await fetchImpl(`http://${config.host}:${config.ports.runtime}${requestPath}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-seemplify-timestamp': signed.timestamp, 'x-seemplify-nonce': signed.nonce, 'x-seemplify-signature': signed.signature },
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || `Knowledge runtime returned HTTP ${response.status}.`);
  return payload;
}

if (require.main === module) {
  const action = process.argv[2] || 'status';
  const routes = {
    status: ['/v1/status', { source: 'control-center' }],
    shutdown: ['/v1/shutdown', { source: 'control-center', mode: 'graceful' }],
  };
  if (!routes[action]) throw new Error(`Unsupported client action '${action}'.`);
  signedRequest(...routes[action]).then((payload) => process.stdout.write(`${JSON.stringify(payload)}\n`)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { signedRequest };
