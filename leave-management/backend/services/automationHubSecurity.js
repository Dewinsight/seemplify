const crypto = require('crypto');
const fs = require('fs');

const REQUEST_TTL_MS = 5 * 60 * 1000;

function readSecret() {
  const file = String(process.env.WORKSPACE_AUTOMATION_HMAC_SECRET_FILE || '').trim();
  const value = file ? fs.readFileSync(file, 'utf8').trim() : String(process.env.WORKSPACE_AUTOMATION_HMAC_SECRET || '').trim();
  if (process.env.NODE_ENV === 'production' || file || value) {
    if (value.length < 24) throw new Error('Workspace automation HMAC secret must contain at least 24 characters');
    return value;
  }
  return 'leave-automation-development-secret';
}

function canonical({ timestamp, nonce, path, body }) {
  return `${timestamp}.${nonce}.POST.${path}.${JSON.stringify(body || {})}`;
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || '')); const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function createVerifier({ now = () => Date.now(), resolveSecret = readSecret, claimNonce } = {}) {
  const claim = claimNonce || (async (key, expiresAt) => {
    const AutomationRequestNonce = require('../models/AutomationRequestNonce');
    await AutomationRequestNonce.init();
    try { await AutomationRequestNonce.create({ key, expiresAt: new Date(expiresAt) }); return true; }
    catch (error) { if (error?.code === 11000) return false; throw error; }
  });
  return async function verify(req, res, next) {
    const timestamp = String(req.get('x-seemplify-automation-timestamp') || '');
    const nonce = String(req.get('x-seemplify-automation-nonce') || '');
    const signature = String(req.get('x-seemplify-automation-signature') || '').replace(/^sha256=/, '');
    const timestampMs = Number(timestamp); const current = now();
    if (!Number.isFinite(timestampMs) || Math.abs(current - timestampMs) > REQUEST_TTL_MS || !/^[A-Za-z0-9_-]{16,128}$/.test(nonce) || !/^[a-f0-9]{64}$/i.test(signature)) {
      return res.status(401).json({ error: 'Invalid automation signature', code: 'AUTOMATION_AUTH_INVALID' });
    }
    let expected;
    try { expected = crypto.createHmac('sha256', resolveSecret()).update(canonical({ timestamp, nonce, path: String(req.originalUrl || req.path).split('?')[0], body: req.body })).digest('hex'); }
    catch { return res.status(503).json({ error: 'Automation authentication unavailable', code: 'AUTOMATION_AUTH_UNAVAILABLE' }); }
    if (!safeEqual(signature, expected)) return res.status(401).json({ error: 'Invalid automation signature', code: 'AUTOMATION_AUTH_INVALID' });
    try {
      if (!await claim(`leave-automation:${nonce}`, Math.max(current, timestampMs) + REQUEST_TTL_MS)) return res.status(409).json({ error: 'Automation request replayed', code: 'AUTOMATION_AUTH_REPLAYED' });
    } catch { return res.status(503).json({ error: 'Automation replay guard unavailable', code: 'AUTOMATION_REPLAY_GUARD_UNAVAILABLE' }); }
    next();
  };
}

module.exports = { REQUEST_TTL_MS, canonical, createVerifier, readSecret };
