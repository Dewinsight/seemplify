'use strict';

const crypto = require('node:crypto');

const PLAN = Object.freeze({ domain: 'seemplifyai.com' });
const ACTIONS = Object.freeze({
  'start-infrastructure': { label: 'Start local infrastructure', detail: 'Starts MariaDB, Postal web/SMTP, relay and Mail API without changing production DNS.', services: ['mariadb','postal-web','postal-smtp','postfix-relay','mail-api'] },
  'start-mail': { label: 'Start local mail services', detail: 'Starts the complete local rollback stack.', services: ['mariadb','postal-web','postal-smtp','postfix-relay','postal-worker','mail-api'] },
  'stop-mail': { label: 'Stop local delivery workers', detail: 'Stops the worker and relay while retaining all queues and volumes.', services: ['postal-worker','postfix-relay'], command: 'stop', confirm: true },
  'restart-mail': { label: 'Restart local mail services', detail: 'Restarts the local mail delivery path.', services: ['postal-web','postal-smtp','postfix-relay','postal-worker','mail-api'], command: 'restart', confirm: true },
  'restart-mail-api': { label: 'Restart local management API', detail: 'Restarts the existing API container without recreating its environment.', services: ['mail-api'], command: 'restart' },
  'reload-mail-api': { label: 'Apply credential changes', detail: 'Recreates the API container so it loads the current hashed key inventory.', services: ['mail-api'], command: 'up', recreate: true },
  'stop-all': { label: 'Stop complete local stack', detail: 'Stops local containers but preserves all four state volumes.', command: 'down', confirm: true, destructive: true },
});

const state = (condition, ready, blocked) => condition ? { state: 'ready', detail: ready } : { state: 'blocked', detail: blocked };

async function readContainers(run) {
  try {
    const raw = await run(['ps','-a','--filter','label=com.docker.compose.project=seemplify-mail','--format','{{.Names}}\t{{.State}}\t{{.Status}}\t{{.Label "com.docker.compose.service"}}']);
    const containers = String(raw).split(/\r?\n/).filter(Boolean).map((line) => {
      const [name, containerState, status, service] = line.split('\t');
      return { name, service, state: String(containerState || '').toLowerCase(), status: status || '' };
    });
    return { available: true, containers, detail: `${containers.length} local mail containers observed` };
  } catch (error) {
    return { available: false, containers: [], detail: `Docker inventory unavailable: ${error.message}` };
  }
}

async function readDns(resolver, settings) {
  const records = [];
  const query = async (type, name, role, fn) => {
    try { const values = await fn(name); records.push({ type, name, role, configured: values.length > 0, values }); }
    catch (error) { records.push({ type, name, role, configured: false, values: [], error: error.code || error.message }); }
  };
  const readCloudflareIngress = async () => {
    const name = 'mail-control.seemplifyai.com';
    try {
      const values = await resolver.resolveCname(name);
      if (values.length) return { type: 'CNAME', name, role: 'Cloudflare API ingress', configured: true, values };
    } catch (error) {
      if (!['ENODATA', 'ENOTFOUND'].includes(error.code)) {
        return { type: 'DNS', name, role: 'Cloudflare API ingress', configured: false, values: [], error: error.code || error.message };
      }
    }

    // A proxied Cloudflare hostname intentionally hides its origin CNAME and
    // answers with edge A/AAAA records. Treating that as "missing" made a
    // healthy production route look broken after the Hostinger cutover.
    const addressLookups = await Promise.allSettled([
      typeof resolver.resolve4 === 'function' ? resolver.resolve4(name) : Promise.resolve([]),
      typeof resolver.resolve6 === 'function' ? resolver.resolve6(name) : Promise.resolve([]),
    ]);
    const values = addressLookups.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
    return {
      type: 'A / AAAA', name, role: 'Cloudflare-proxied API ingress', configured: values.length > 0, values,
      error: values.length ? null : 'ENODATA',
    };
  };
  const ingress = readCloudflareIngress().then((record) => records.push(record));
  await Promise.all([
    query('TXT', settings.domain, 'SPF and domain policy', (name) => resolver.resolveTxt(name).then((rows) => rows.map((row) => row.join('')))),
    query('TXT', `_dmarc.${settings.domain}`, 'DMARC policy', (name) => resolver.resolveTxt(name).then((rows) => rows.map((row) => row.join('')))),
    ingress,
  ]);
  return records;
}

async function readPtr() {
  return { state: 'not-applicable', detail: 'PTR is not a delivery gate: Google Workspace performs the recipient-facing SMTP hop.' };
}

async function fetchJson(fetchImpl, url, credential, path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  if (timer.unref) timer.unref();
  try {
    const response = await fetchImpl(`${url}${path}`, { headers: credential ? { Authorization: `Bearer ${credential}` } : {}, signal: controller.signal });
    const body = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, body };
  } finally { clearTimeout(timer); }
}

async function readMailApi(fetchImpl, { baseUrl, credential }) {
  try {
    const live = await fetchJson(fetchImpl, baseUrl, '', '/health/live');
    if (!live.ok) return { available: false, detail: `Mail API live probe returned ${live.status}.`, release: null };
    const ready = await fetchJson(fetchImpl, baseUrl, '', '/health/ready');
    let status = {}, metrics = {}, events = {}, suppressions = {};
    if (credential) {
      [status, metrics, events, suppressions] = await Promise.all([
        fetchJson(fetchImpl, baseUrl, credential, '/v1/status?probe=true'),
        fetchJson(fetchImpl, baseUrl, credential, '/v1/metrics'),
        fetchJson(fetchImpl, baseUrl, credential, '/v1/events?limit=100'),
        fetchJson(fetchImpl, baseUrl, credential, '/v1/suppressions?limit=100'),
      ]);
    }
    const protectedResponses = [status, metrics, events, suppressions];
    const telemetryAvailable = Boolean(credential) && protectedResponses.every((response) => response.ok);
    const rejected = protectedResponses.find((response) => response.status === 401 || response.status === 403);
    const telemetry = telemetryAvailable
      ? { available: true, state: 'ready', detail: 'Authenticated live telemetry from Hostinger.' }
      : !credential
        ? { available: false, state: 'credential-missing', detail: 'The Hostinger monitoring credential is not configured on this PC.' }
        : rejected
          ? { available: false, state: 'credential-rejected', status: rejected.status, detail: 'The Hostinger API is online, but it rejected the Control Center monitoring credential.' }
          : { available: false, state: 'request-failed', detail: 'The Hostinger API is online, but one or more telemetry requests failed.' };
    return {
      available: true, detail: ready.ok ? 'Mail API is live and ready.' : `Mail API is live; readiness returned ${ready.status}.`,
      release: live.body.release || status.body?.release || null, ready: ready.ok, blocked: ready.body?.blocked || [],
      telemetry,
      sendEnabled: telemetryAvailable ? status.body?.sendEnabled === true : null,
      status: status.ok ? (status.body || {}) : {}, metrics: metrics.ok ? (metrics.body || {}) : {},
      events: events.ok ? (events.body?.events || []) : [], suppressions: suppressions.ok ? (suppressions.body || {}) : {},
    };
  } catch (error) { return { available: false, detail: `Mail API unavailable: ${error.message}`, release: null, ready: false }; }
}

async function readPublicEndpoint(fetchImpl, { url }) {
  try { const response = await fetchImpl(url, { signal: AbortSignal.timeout(8000) }); return { available: response.status === 200, status: response.status, detail: response.status === 200 ? `${url} returns 200.` : `${url} returned ${response.status}.` }; }
  catch (error) { return { available: false, status: 0, detail: `Public endpoint unavailable: ${error.message}` }; }
}

async function readPostalQueue(run, docker) {
  const db = docker.containers.find((item) => item.service === 'mariadb' && item.state === 'running');
  if (!db) return { available: false, detail: 'MariaDB is not running.', queues: [] };
  try {
    const script = 'set -e; dbs=$(mariadb --user=root --password="$MARIADB_ROOT_PASSWORD" -N -B -e "SHOW DATABASES" | grep -Ev "^(information_schema|performance_schema|mysql|sys)$"); total=0; for db in $dbs; do n=$(mariadb --user=root --password="$MARIADB_ROOT_PASSWORD" -N -B -D "$db" -e "SELECT COUNT(*) FROM queued_messages" 2>/dev/null || echo 0); total=$((total+n)); done; printf "%s" "$total"';
    const output = String(await run(['exec', db.name, 'sh', '-c', script])).trim();
    if (!/^\d+$/.test(output)) throw new Error('unparseable queue depth');
    const count = Number(output);
    return { available: true, detail: count ? `Postal has ${count} queued message(s).` : 'Postal v3 queue is empty (MariaDB).', queues: count ? [{ name: 'Postal/MariaDB', messages: count, ready: count, unacknowledged: 0, consumers: 1 }] : [] };
  } catch (error) { return { available: false, detail: `Database queue check failed: ${error.message}`, queues: [] }; }
}

function readRelay({ relayMode, host, port, upstreamHost, upstreamPort, username, docker }) {
  const container = docker.containers.find((item) => item.service === 'postfix-relay');
  const enabled = relayMode !== 'disabled' || Boolean(container);
  const running = container?.state === 'running';
  return { enabled, mode: 'google', host, port, upstreamHost, upstreamPort, username: username ? '[configured]' : '', ...state(enabled && running, `Google Workspace authenticated relay is running via ${upstreamHost}:${upstreamPort}.`, enabled ? 'Relay container is not running.' : 'Relay is disabled.') };
}

function buildStatus({ domain, bounceDomain, mailHostname, docker, dns, ptr, relay, mailApi, postalQueue, cloudflare, hostingMode = 'local', dokployComposeUrl = '' }) {
  if (hostingMode === 'dokploy') {
    const telemetryAvailable = mailApi.telemetry?.available === true;
    const remoteGates = Array.isArray(mailApi.status?.gates)
      ? mailApi.status.gates.map((gate) => ({
          id: gate.id,
          label: gate.label || gate.id.replaceAll('-', ' '),
          state: gate.state || 'external',
          detail: gate.detail || '',
        }))
      : [];
    const components = [
      { id: 'mail-api-readiness', label: 'Production Mail API', ...state(mailApi.available && mailApi.ready, mailApi.detail, mailApi.detail) },
      { id: 'cloudflare-tunnel', label: 'Public Cloudflare ingress', state: cloudflare.available ? 'ready' : 'blocked', detail: cloudflare.detail },
      ...remoteGates,
    ];
    const blocked = components.filter((item) => item.state === 'blocked').length;
    const external = components.filter((item) => item.state === 'external').length;
    const ready = components.filter((item) => item.state === 'ready').length;
    const rates = telemetryAvailable ? (mailApi.metrics?.rates || mailApi.status?.rates || null) : null;
    const counters = telemetryAvailable ? (mailApi.metrics?.counters || mailApi.status?.counters || {}) : null;
    const suppressionPayload = mailApi.suppressions || {};
    const events = mailApi.events || [];
    const byKeyId = {};
    for (const event of events) if (event.keyId) { const record = byKeyId[event.keyId] ||= { accepted:0,suppressed:0,rejected:0,total:0,lastUsedAt:null }; if (event.type in record) record[event.type]++; record.total++; record.lastUsedAt = event.at || record.lastUsedAt; }
    const queue = {
      available: false,
      state: 'managed',
      reason: 'hostinger-managed',
      detail: 'Postal queues messages in its Hostinger MariaDB. Queue depth is managed remotely and is not exposed by the public Mail API.',
      queues: [],
    };
    return {
      checkedAt: new Date().toISOString(), mode: 'Hosted on Dokploy', domain, bounceDomain,
      mailHostname, deliveryMode: 'relay', sendEnabled: mailApi.sendEnabled,
      warning: !telemetryAvailable ? mailApi.telemetry?.detail || '' : blocked ? `${blocked} production check(s) need attention.` : '',
      readiness: { ready, total: components.length, state: blocked ? 'blocked' : 'ready' },
      containers: [], components, dns, ptr, relay, mailApi, cloudflare, queue,
      rates, counters, suppressions: telemetryAvailable ? (suppressionPayload.summary || mailApi.status?.suppressions || { total: 0, byReason: {} }) : null,
      suppressionList: suppressionPayload.suppressions || [], events,
      keyUsage: { windowSize: events.length, byKeyId, submissions: null, unattributed: { total: events.filter((event) => !event.keyId).length, byType: {} } },
      gates: components, gateSummary: { ready, total: components.length, blocked, external },
      hostingMode: 'dokploy',
      operations: { owner: 'Dokploy health checks and restart policies', dokployComposeUrl },
      actions: [],
    };
  }
  const expected = ['mariadb','postal-web','postal-smtp','postfix-relay','postal-worker','mail-api'];
  const components = expected.map((service) => {
    const container = docker.containers.find((item) => item.service === service);
    const healthy = container?.state === 'running' && !/unhealthy/i.test(container.status);
    return { id: service, label: service.replaceAll('-',' '), ...state(healthy, container ? `${container.name} is running${/healthy/i.test(container.status) ? ' and healthy' : ''}.` : 'Container is missing.', container ? `${container.name}: ${container.status}` : 'Container is missing.') };
  });
  components.push({ id: 'mail-api-readiness', label: 'Mail API readiness', ...state(mailApi.available && mailApi.ready, mailApi.detail, mailApi.detail) });
  components.push(postalQueue.state === 'managed'
    ? { id: 'database', label: 'Postal queue ownership', state: 'external', detail: postalQueue.detail }
    : { id: 'database', label: 'MariaDB queue check', ...state(postalQueue.available, postalQueue.detail, postalQueue.detail) });
  components.push({ id: 'cloudflare-tunnel', label: 'Public Cloudflare ingress', state: cloudflare.available ? 'ready' : 'blocked', detail: cloudflare.detail });
  const gates = components.map((item) => ({ ...item }));
  const ready = gates.filter((item) => item.state === 'ready').length;
  const blocked = gates.filter((item) => item.state === 'blocked').length;
  const telemetryAvailable = mailApi.telemetry?.available === true;
  const rates = telemetryAvailable ? (mailApi.metrics?.rates || mailApi.status?.rates || null) : null;
  const counters = telemetryAvailable ? (mailApi.metrics?.counters || mailApi.status?.counters || {}) : null;
  const suppressionPayload = mailApi.suppressions || {};
  const events = mailApi.events || [];
  const byKeyId = {};
  for (const event of events) if (event.keyId) { const record = byKeyId[event.keyId] ||= { accepted:0,suppressed:0,rejected:0,total:0,lastUsedAt:null }; if (event.type in record) record[event.type]++; record.total++; record.lastUsedAt = event.at || record.lastUsedAt; }
  return {
    checkedAt: new Date().toISOString(), mode: hostingMode === 'dokploy' ? 'Hosted on Dokploy' : 'Local rollback stack (migration in progress)', domain, bounceDomain,
    mailHostname, deliveryMode: 'relay', sendEnabled: mailApi.sendEnabled,
    warning: !telemetryAvailable
      ? mailApi.telemetry?.detail || ''
      : blocked
        ? `${blocked} ${hostingMode === 'dokploy' ? 'production' : 'local'} check(s) need attention.`
        : '',
    readiness: { ready, total: gates.length, state: blocked ? 'blocked' : 'ready' },
    containers: docker.containers, components, dns, ptr, relay, mailApi, cloudflare, queue: postalQueue,
    rates, counters, suppressions: telemetryAvailable ? (suppressionPayload.summary || mailApi.status?.suppressions || { total: 0, byReason: {} }) : null,
    suppressionList: suppressionPayload.suppressions || [], events,
    keyUsage: { windowSize: events.length, byKeyId, submissions: null, unattributed: { total: events.filter((event) => !event.keyId).length, byType: {} } },
    gates, gateSummary: { ready, total: gates.length, blocked, external: gates.filter((item) => item.state === 'external').length },
    hostingMode,
    operations: { owner: hostingMode === 'dokploy' ? 'Dokploy health checks and restart policies' : 'Local Docker rollback stack', dokployComposeUrl },
    actions: hostingMode === 'dokploy' ? [] : Object.entries(ACTIONS).map(([id, action]) => ({ id, label: action.label, detail: action.detail, confirm: Boolean(action.confirm), destructive: Boolean(action.destructive) })),
  };
}

function buildPlan(domain, { hostingMode = 'local' } = {}) {
  if (hostingMode === 'dokploy') {
    return { domain, mode: 'Production hosted on Hostinger/Dokploy', phases: [
      { title: 'Production hosting', detail: 'Mail API, Postal, MariaDB, Postfix and Cloudflare ingress run on the Hostinger Dokploy host.', state: 'complete' },
      { title: 'Public monitoring', detail: 'Control Center reads health, readiness, analytics, events and suppressions from the public production API.', state: 'complete' },
      { title: 'Recovery ownership', detail: 'Dokploy restart policies and health checks own service recovery; local lifecycle controls are disabled.', state: 'complete' },
    ], api: [
      { method: 'POST', path: '/v1/messages', purpose: 'Submit a transactional message' },
      { method: 'GET', path: '/v1/status', purpose: 'Status, counters and delivery rates' },
      { method: 'GET', path: '/v1/events', purpose: 'Recent privacy-safe delivery events' },
      { method: 'GET', path: '/v1/suppressions', purpose: 'Suppression inventory' },
    ] };
  }
  return { domain, mode: 'Zero-downtime migration to Dokploy', phases: [
    { title: 'Local service protected', detail: 'The existing local stack stays live and is the rollback source.', state: 'complete' },
    { title: 'Dokploy staging', detail: 'Restore isolated state with sending and production ingress disabled.', state: 'building' },
    { title: 'Controlled cutover', detail: 'Freeze local acceptance, final-sync, then switch the unchanged Cloudflare hostname.', state: 'pending' },
    { title: '30-minute rollback window', detail: 'Require continuously healthy production before scoped local cleanup.', state: 'pending' },
  ], api: [
    { method: 'POST', path: '/v1/messages', purpose: 'Submit a transactional message' },
    { method: 'GET', path: '/v1/status', purpose: 'Status, counters and delivery rates' },
    { method: 'GET', path: '/v1/events', purpose: 'Recent privacy-safe delivery events' },
    { method: 'GET', path: '/v1/suppressions', purpose: 'Suppression inventory' },
  ] };
}

function parseKeys(rawKeys) {
  if (!String(rawKeys || '').trim()) return [];
  return String(rawKeys).split(',').filter(Boolean).map((entry) => {
    const [keyId, hash, scopes=''] = entry.trim().split(':');
    if (!/^[\w-]{3,64}$/.test(keyId || '') || !/^[a-f0-9]{64}$/i.test(hash || '')) throw new Error('MAIL_API_KEYS contains a malformed entry.');
    return { keyId, scopes: scopes.split('|').filter(Boolean) };
  });
}

function buildKeyInventory({ rawKeys, usage, pendingRestart } = {}) {
  try {
    const keys = parseKeys(rawKeys).map((key) => ({ ...key, usage: usage?.byKeyId?.[key.keyId] || {}, runtimeObserved: false }));
    return { available: true, keys, runtimeActiveCount: keys.length, pendingRestart, applyAction: 'reload-mail-api', revokedButActive: Object.keys(usage?.byKeyId || {}).filter((id) => !keys.some((key) => key.keyId === id)), unattributed: usage?.unattributed || { total: 0 }, windowSize: usage?.windowSize || 0 };
  } catch (error) { return { available: false, keys: [], runtimeActiveCount: null, pendingRestart, applyAction: 'reload-mail-api', error: error.message, revokedButActive: [], unattributed: { total: 0 }, windowSize: 0 }; }
}

function validateKeyId(value) { const id=String(value||'').trim(); if(!/^[a-z0-9][a-z0-9_-]{2,63}$/i.test(id)) throw new Error('Key ID must be 3-64 letters, numbers, underscore or hyphen.'); return id; }
function validateKeyScopes(value) { const scopes=(Array.isArray(value)?value:String(value||'').split(',')).map((item)=>String(item).trim().toLowerCase()).filter(Boolean); if(!scopes.length || scopes.some((item)=>!['send','read','admin'].includes(item))) throw new Error('Choose send, read or admin scopes.'); return [...new Set(scopes)]; }
function validateTestSendRecipient(value,{allowedDomains=[]}={}) { const address=String(value||'').trim().toLowerCase(); if(!/^[^\s@]+@[^\s@]+$/.test(address)) throw new Error('Enter a valid recipient address.'); if(allowedDomains.length && !allowedDomains.includes(address.split('@')[1])) throw new Error('Recipient domain is not allowlisted for Control Center tests.'); return address; }
function buildTestSendMessage({domain,recipient,nonce}) { return { method:'POST',path:'/v1/messages',headers:{'Content-Type':'application/json','Idempotency-Key':`control-${nonce}`},body:{from:{email:`no-reply@dewinsight.com`,name:'Seemplify Mail'},to:[{email:recipient}],replyTo:{email:`support@${domain}`},subject:'Seemplify mail delivery test',text:'This is a transactional delivery-path test from the local Control Center.'} }; }
function interpretTestSend({status,body}) { if(status===202) return {state:'ready',headline:'Message accepted',detail:'Postal accepted the test message.',messageId:body?.messageId}; if(status===503 && body?.error?.code==='sending_disabled') return {state:'complete',headline:'Sending gate verified',detail:'Authentication and validation passed; this deployment intentionally has sending disabled.',gates:body.error.gates||[]}; return {state:'blocked',headline:'Test send failed',detail:body?.error?.message||`Mail API returned ${status}.`}; }

function resolveAction(id,{confirm,composeFile,envFile}) {
  const definition=ACTIONS[id]; if(!definition) throw new Error(`Unknown email stack action: ${id}`); if(definition.confirm && confirm!==true) throw new Error(`${definition.label} requires explicit confirmation.`);
  const argv=['compose']; if(envFile) argv.push('--env-file',envFile); argv.push('-f',composeFile);
  if(definition.command==='down') argv.push('down'); else if(definition.command==='stop') argv.push('stop',...definition.services); else if(definition.command==='restart') argv.push('restart',...definition.services); else { argv.push('up','-d'); if(definition.recreate) argv.push('--force-recreate','--no-deps'); argv.push(...definition.services); }
  return {definition,argv};
}

function buildDocs({domain,mailApiUrl,publicMailApiUrl,controlCenterUrl}) {
  const publicBaseUrl=publicMailApiUrl||mailApiUrl;
  return { domain, baseUrl:mailApiUrl, publicBaseUrl, controlBaseUrl:controlCenterUrl, reference:'platform/email/docs/INTEGRATION.md', authentication:{header:'Authorization: Bearer <keyId>.<secret>',detail:'Create a scoped API key in Control Center, copy it once, and store it as MAIL_API_TOKEN.',scopes:[{id:'send',detail:'Submit messages'},{id:'read',detail:'Read status/events/suppressions'},{id:'admin',detail:'All read/send operations and suppression management'}]}, endpoints:[{method:'POST',path:'/v1/messages',scope:'send',purpose:'Submit a message'},{method:'GET',path:'/v1/status',scope:'read',purpose:'Runtime status and analytics'},{method:'GET',path:'/v1/events',scope:'read',purpose:'Recent delivery events'},{method:'GET',path:'/v1/suppressions',scope:'read',purpose:'Suppression list'}], errors:[{code:'unauthorized',status:'401',action:'Check key ID and secret; replace revoked credentials.'},{code:'forbidden',status:'403',action:'Use a key with the required scope.'},{code:'sending_disabled',status:'503',action:'Do not retry until an operator opens the production sending gate.'},{code:'rate_limited',status:'429',action:'Honor Retry-After and retry with backoff.'}], examples:[{id:'curl',title:'cURL',code:`curl -X POST '${publicBaseUrl}/v1/messages' -H 'Authorization: Bearer $MAIL_API_TOKEN' -H 'Content-Type: application/json' -d '{"from":{"email":"no-reply@dewinsight.com","name":"Seemplify"},"to":[{"email":"person@example.com"}],"subject":"Welcome","text":"Welcome to Seemplify"}'`},{id:'node',title:'Node.js',code:`await fetch('${publicBaseUrl}/v1/messages', { method: 'POST', headers: { Authorization: \`Bearer \${process.env.MAIL_API_TOKEN}\`, 'Content-Type': 'application/json' }, body: JSON.stringify(message) });`}],notes:['Inbound company email remains on Google Workspace.','The visible/envelope sender is no-reply@dewinsight.com; product display name and Reply-To are preserved.','A 202 response means queued, not delivered. Confirm Google 250 2.0.0 in relay logs for delivery-path acceptance.'] };
}

module.exports={PLAN,ACTIONS,readContainers,readDns,readPtr,readMailApi,readPublicEndpoint,readPostalQueue,readRelay,buildStatus,buildPlan,buildKeyInventory,validateKeyId,validateKeyScopes,validateTestSendRecipient,buildTestSendMessage,interpretTestSend,resolveAction,buildDocs};
