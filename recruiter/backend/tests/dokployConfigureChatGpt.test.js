'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { configureEnvironment, parseEnv } = require('../scripts/dokployConfigureChatGpt');

test('production configuration locks Recruiter to hosted ChatGPT and removes obsolete providers', () => {
  const configured = configureEnvironment([
    'KEEP_ME=yes',
    'LOCAL_LLM_BASE_URL=http://127.0.0.1:11435',
    'LOCAL_LLM_SHARED_SECRET=obsolete',
    'CHATGPT_GATEWAY_BASE_URL=http://old-gateway'
  ].join('\n'), {
    CHATGPT_GATEWAY_BASE_URL: 'https://chatgpt-gateway.example.test',
    CHATGPT_GATEWAY_SHARED_SECRET: 'hosted-secret'
  }, ['LOCAL_LLM_BASE_URL', 'LOCAL_LLM_SHARED_SECRET']);

  const values = parseEnv(configured.env).values;
  assert.equal(values.get('KEEP_ME'), 'yes');
  assert.equal(values.get('CHATGPT_GATEWAY_BASE_URL'), 'https://chatgpt-gateway.example.test');
  assert.equal(values.get('CHATGPT_GATEWAY_SHARED_SECRET'), 'hosted-secret');
  assert.equal(values.has('LOCAL_LLM_BASE_URL'), false);
  assert.equal(values.has('LOCAL_LLM_SHARED_SECRET'), false);
});
