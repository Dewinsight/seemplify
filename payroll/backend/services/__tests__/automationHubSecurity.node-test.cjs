const assert = require('node:assert/strict');
const crypto = require('crypto');
const test = require('node:test');
const { canonical, createVerifier } = require('../automationHubSecurity');
const { exactApprovalCompensation, exactApprovalMarker, hasExactApproval, totalsHash, revision } = require('../payrollAutomationContract');

function response() { return { statusCode: 200, payload: null, status(code) { this.statusCode = code; return this; }, json(body) { this.payload = body; return this; } }; }

test('accepts one current signed request and rejects its replay', async () => {
  const now = 1_800_000_000_000; const secret = 'payroll-test-secret-with-at-least-24-chars'; const claimed = new Set();
  const middleware = createVerifier({ now: () => now, resolveSecret: () => secret, claimNonce: async key => !claimed.has(key) && Boolean(claimed.add(key)) });
  const body = { organizationId: 'org-1', input: { runId: 'run-1' } }; const nonce = 'nonce-1234567890123456'; const timestamp = String(now); const requestPath = '/api/automation/actions/payroll.finalize_run';
  const signature = crypto.createHmac('sha256', secret).update(canonical({ timestamp, nonce, path: requestPath, body })).digest('hex');
  const req = { body, originalUrl: requestPath, path: requestPath, get: name => ({ 'x-seemplify-automation-timestamp': timestamp, 'x-seemplify-automation-nonce': nonce, 'x-seemplify-automation-signature': `sha256=${signature}` })[name.toLowerCase()] };
  let advanced = 0; const first = response(); await middleware(req, first, () => { advanced += 1; });
  assert.equal(advanced, 1); assert.equal(first.statusCode, 200);
  const second = response(); await middleware(req, second, () => { advanced += 1; });
  assert.equal(second.statusCode, 409); assert.equal(advanced, 1);
});

test('payroll totals approval hash is canonical and revision-bound', () => {
  const first = { __v: 7, summary: { currency: 'NGN', totalNetPayroll: 500, totalEmployees: 2 } };
  const reordered = { __v: 7, summary: { totalEmployees: 2, totalNetPayroll: 500, currency: 'NGN' } };
  assert.equal(totalsHash(first), totalsHash(reordered)); assert.equal(revision(first), '7');
  assert.notEqual(totalsHash({ ...first, summary: { ...first.summary, totalNetPayroll: 501 } }), totalsHash(first));
});

test('exact payroll approval retries are marker-bound and compensatable', () => {
  const marker = exactApprovalMarker('approval-100');
  assert.equal(hasExactApproval({ approvals: [{ comments: `Reviewed ${marker}` }] }, marker), true);
  assert.equal(hasExactApproval({ approvals: [{ comments: 'another approval' }] }, marker), false);
  assert.deepEqual(exactApprovalCompensation(marker), {
    $set: { status: 'pending_approval' },
    $inc: { currentApprovalLevel: -1 },
    $unset: { approvedAt: '' },
    $pull: { approvals: { comments: marker } },
  });
});
