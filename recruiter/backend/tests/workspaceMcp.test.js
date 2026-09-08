'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { validateWorkspaceMcp } = require('../services/aiRuntime/workspaceMcp');
const { AIRuntimeService } = require('../services/aiRuntime/aiRuntimeService');

test('the shared AI boundary only forwards a valid grant for signed messaging chat', () => {
  const grant = { grantToken: 'b'.repeat(43) };
  const scope = { service: 'messaging', activity: 'messaging.chat' };
  assert.equal(validateWorkspaceMcp(undefined, scope), undefined);
  assert.deepEqual(validateWorkspaceMcp(grant, scope), grant);
  for (const unauthorized of [
    { service: 'performance-management', activity: 'messaging.chat' },
    { service: 'messaging', activity: 'messaging.summary' }
  ]) assert.throws(() => validateWorkspaceMcp(grant, unauthorized), { code: 'WORKSPACE_MCP_FORBIDDEN' });
  for (const value of [{ ...grant, url: 'https://attacker.test' }, { ...grant, headers: {} }, { grantToken: 'short' }, []]) {
    assert.throws(() => validateWorkspaceMcp(value, scope), TypeError);
  }
  const runtime = new AIRuntimeService();
  assert.deepEqual(runtime.normalizePayload({ messages: [{ role: 'user', content: 'count tasks' }], workspaceMcp: grant }, {}).workspaceMcp, grant);
  assert.equal(runtime.normalizePayload({ messages: [] }, {}).workspaceMcp, undefined);
});
