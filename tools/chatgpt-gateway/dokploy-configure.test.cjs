'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { configureEnvironment, consumerEnvironment, parseEnv } = require('./dokploy-configure.cjs');

test('shared production configuration keeps Local inference separate from ChatGPT Connect', () => {
  const configured = configureEnvironment('KEEP_ME=yes\nRECRUITER_BACKEND_URL=https://legacy.test', {
    CHATGPT_GATEWAY_BASE_URL: 'https://chatgpt-gateway.example.test',
    CHATGPT_GATEWAY_SHARED_SECRET: 'hosted-secret',
    LOCAL_LLM_BASE_URL: 'https://local-gateway.example.test',
    LOCAL_LLM_SHARED_SECRET: 'local-secret'
  }, ['RECRUITER_BACKEND_URL']);
  const values = parseEnv(configured.env).values;
  assert.equal(values.get('KEEP_ME'), 'yes');
  assert.equal(values.has('RECRUITER_BACKEND_URL'), false);
  assert.equal(values.get('CHATGPT_GATEWAY_BASE_URL'), 'https://chatgpt-gateway.example.test');
  assert.equal(values.get('LOCAL_LLM_BASE_URL'), 'https://local-gateway.example.test');
});

test('every consumer receives the platform gateway contract and no Experience consumer is configured', () => {
  const source = {
    CHATGPT_GATEWAY_BASE_URL: 'https://chatgpt.test', CHATGPT_GATEWAY_SHARED_SECRET: 'chatgpt-secret',
    LOCAL_LLM_BASE_URL: 'https://local.test', LOCAL_LLM_SHARED_SECRET: 'local-secret'
  };
  for (const id of ['identity-provider', 'leave-management', 'payroll', 'performance-management', 'recruiter', 'time-attendance']) {
    const env = consumerEnvironment(id, source);
    assert.equal(env.SEEMPLIFY_AI_SOURCE_APP, id);
    assert.equal(env.CHATGPT_GATEWAY_BASE_URL, 'https://chatgpt.test');
    assert.equal(env.LOCAL_LLM_BASE_URL, 'https://local.test');
  }
});
