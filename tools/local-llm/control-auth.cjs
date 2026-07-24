const fs = require('node:fs');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '..', '..');
const runtimeDir = path.join(repositoryRoot, '.local-runtime', 'llm');
const controlSecretFile = process.env.LOCAL_LLM_CONTROL_SECRET_FILE
  || path.join(runtimeDir, 'control-secret');

function readControlSecret() {
  const value = fs.readFileSync(controlSecretFile, 'utf8').trim();
  if (!value) throw new Error('Local LLM control secret is missing');
  return value;
}

function controlHeaders(headers = {}) {
  return {
    ...headers,
    'x-seemplify-control-secret': readControlSecret()
  };
}

async function controlFetch(input, options = {}) {
  return fetch(input, {
    ...options,
    headers: controlHeaders(options.headers)
  });
}

module.exports = {
  controlFetch,
  controlHeaders,
  controlSecretFile,
  readControlSecret
};
