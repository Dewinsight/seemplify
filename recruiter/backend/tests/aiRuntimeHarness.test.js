const test = require('node:test');
const assert = require('node:assert/strict');

const aiRuntimeService = require('../services/aiRuntime/aiRuntimeService');
const { AIRuntimeService } = require('../services/aiRuntime/aiRuntimeService');
const AIModelService = require('../services/aiModelService');

const SIMPLE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['value'],
  properties: { value: { type: 'string' } }
};

test('structured harness forwards provider-neutral controls to the runtime', async () => {
  const original = aiRuntimeService.structuredComplete;
  let captured;
  aiRuntimeService.structuredComplete = async (activity, input) => {
    captured = { activity, input };
    return { data: { value: 'ok' }, content: '{"value":"ok"}', usage: {} };
  };
  try {
    const service = new AIModelService();
    await service.generateJsonObject([{ role: 'user', content: 'Return a value.' }], {
      activity: 'job.description',
      promptVersion: 'harness-v1',
      jsonSchema: SIMPLE_SCHEMA,
      schemaName: 'harness_fixture',
      schemaStrict: true,
      max_completion_tokens: 320,
      retry_max_completion_tokens: 640,
      compact_max_completion_tokens: 160,
      compact_max_chars: 900,
      temperature: 0.2,
      top_p: 0.8,
      frequency_penalty: 0.1,
      presence_penalty: 0.2
    });
    assert.equal(captured.activity, 'job.description');
    assert.equal(captured.input.promptVersion, 'harness-v1');
    assert.equal(captured.input.max_tokens, 320);
    assert.equal(captured.input.retryMaxTokens, 640);
    assert.equal(captured.input.compactMaxTokens, 160);
    assert.equal(captured.input.compactMaxChars, 900);
    assert.equal(captured.input.frequency_penalty, 0.1);
    assert.equal(captured.input.presence_penalty, 0.2);
    assert.equal(captured.input.schemaStrict, true);
  } finally {
    aiRuntimeService.structuredComplete = original;
  }
});
test('gateway normalization preserves prompt identity, schema mode, and penalties', () => {
  const service = new AIRuntimeService();
  const normalized = service.normalizePayload({
    messages: [{ role: 'user', content: 'Fixture' }],
    promptVersion: 'fixture-v3',
    schemaStrict: true,
    frequency_penalty: 0.15,
    presence_penalty: 0.25
  }, { reasoningEffort: 'low' });
  assert.equal(normalized.promptVersion, 'fixture-v3');
  assert.equal(normalized.schemaStrict, true);
  assert.equal(normalized.frequencyPenalty, 0.15);
  assert.equal(normalized.presencePenalty, 0.25);
});

test('schema repair gets its own output budget and a bounded prior response', async () => {
  const service = new AIRuntimeService();
  const calls = [];
  service.complete = async (_activity, input) => {
    calls.push(input);
    if (calls.length === 1) return { content: `not-json-${'x'.repeat(2_000)}` };
    return { content: '{"value":"repaired"}' };
  };
  const result = await service.structuredComplete('job.description', {
    messages: [{ role: 'user', content: 'Fixture' }],
    max_tokens: 100,
    retryMaxTokens: 240,
    compactMaxChars: 500,
    jsonSchema: SIMPLE_SCHEMA,
    schemaName: 'repair_fixture',
    schemaStrict: true
  });
  assert.equal(result.data.value, 'repaired');
  assert.equal(calls[0].max_tokens, 100);
  assert.equal(calls[1].max_tokens, 240);
  assert.ok(calls[1].messages[1].content.length <= 500);
  assert.match(calls[1].messages[2].content, /Validation issues/);
});
