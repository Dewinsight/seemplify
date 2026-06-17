// Playwright BROWSER e2e (Chromium): a real browser loads a page whose JS calls
// the protected endpoint via fetch(); authMiddleware validates the token against
// PostgreSQL/Prisma. Proves the migrated auth path works from an actual browser.
//
//   npx playwright test e2e/auth.browser.spec.js
const { test, expect } = require('@playwright/test');
const http = require('http');
const express = require('express');
require('dotenv').config();
const prisma = require('../db/client');
const { newId } = require('../db/objectId');
const sessionService = require('../services/sessionService');
const authMiddleware = require('../middleware/authMiddleware');

let server;
let baseURL;
let testUserId;
let token;
let accessTokenId;

const PAGE_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>auth probe</title></head>
<body><div id="result">pending</div>
<script>
(async () => {
  const token = new URLSearchParams(location.search).get('token');
  try {
    const r = await fetch('/protected', { headers: token ? { Authorization: 'Bearer ' + token } : {} });
    let body = {};
    try { body = await r.json(); } catch (e) {}
    document.getElementById('result').textContent =
      r.status === 200 ? ('OK:' + body.userId) : ('ERR:' + r.status + ':' + (body.code || ''));
  } catch (e) {
    document.getElementById('result').textContent = 'FETCH_FAIL';
  }
})();
</script></body></html>`;

test.beforeAll(async () => {
  testUserId = newId();
  const user = await prisma.user.create({
    data: { id: testUserId, email: `pwbrowser-${Date.now()}@local.test`, isActive: true, security: { sessionVersion: 1 } },
  });
  const s = await sessionService.createSession({ user, fingerprint: 'pw-browser', userAgent: 'pw', ip: '127.0.0.1' });
  token = s.accessToken;
  accessTokenId = s.session.accessTokenId;

  const app = express();
  app.get('/', (req, res) => res.set('content-type', 'text/html').send(PAGE_HTML)); // same-origin as /protected
  app.get('/protected', authMiddleware, (req, res) => res.json({ ok: true, userId: req.user.id }));
  await new Promise((resolve) => { server = http.createServer(app).listen(0, '127.0.0.1', resolve); });
  baseURL = `http://127.0.0.1:${server.address().port}`;
});

test.afterAll(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (testUserId) {
    try { await prisma.userSession.deleteMany({ where: { userId: testUserId } }); } catch (_) {}
    try { await prisma.user.delete({ where: { id: testUserId } }); } catch (_) {}
  }
  await prisma.$disconnect();
});

test('browser fetch with valid token resolves the Postgres user', async ({ page }) => {
  await page.goto(`${baseURL}/?token=${token}`);
  await expect(page.locator('#result')).toHaveText(`OK:${testUserId}`, { timeout: 10000 });
});

test('browser fetch with a revoked session shows session_revoked', async ({ page }) => {
  await sessionService.revokeSessionById(accessTokenId, 'pw_browser_revoke');
  await page.goto(`${baseURL}/?token=${token}`);
  await expect(page.locator('#result')).toContainText('ERR:401:session_revoked', { timeout: 10000 });
});
