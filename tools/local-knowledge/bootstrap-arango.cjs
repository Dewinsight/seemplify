const fs = require('node:fs');
const path = require('node:path');
const { CONFIG } = require('./config.cjs');

function secret(name) {
  return fs.readFileSync(path.join(CONFIG.paths.secrets, name), 'utf8').trim();
}

async function request(requestPath, { method = 'GET', body } = {}) {
  const authorization = `Basic ${Buffer.from(`root:${secret('arango-root')}`).toString('base64')}`;
  const response = await fetch(`http://${CONFIG.host}:${CONFIG.ports.arango}/_db/_system${requestPath}`, {
    method,
    headers: { authorization, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.errorMessage || `ArangoDB returned HTTP ${response.status}.`);
  return payload;
}

async function upsertUser(username, password) {
  const encoded = encodeURIComponent(username);
  const current = await request(`/_api/user/${encoded}`).catch((error) => (/not found/i.test(error.message) ? null : Promise.reject(error)));
  if (current) return request(`/_api/user/${encoded}`, { method: 'PUT', body: { passwd: password, active: true, extra: { owner: 'seemplify-local-knowledge' } } });
  return request('/_api/user', { method: 'POST', body: { user: username, passwd: password, active: true, extra: { owner: 'seemplify-local-knowledge' } } });
}

async function bootstrap() {
  await upsertUser(CONFIG.database.provisionerUser, secret('arango-provisioner'));
  await upsertUser(CONFIG.database.appUser, secret('arango-app'));
  await request(`/_api/user/${encodeURIComponent(CONFIG.database.provisionerUser)}/database/_system`, { method: 'PUT', body: { grant: 'rw' } });
  return {
    ok: true,
    databaseStrategy: 'one-database-per-space',
    appUser: CONFIG.database.appUser,
    provisionerUser: CONFIG.database.provisionerUser,
    provisionerScope: '_system only; tenant databases are granted to the data app user on creation',
  };
}

if (require.main === module) {
  bootstrap().then((result) => process.stdout.write(`${JSON.stringify(result)}\n`)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { bootstrap };
