const test = require('node:test');
const assert = require('node:assert/strict');

const {
  finalizeOutput,
  finiteCvSchema,
  hasOpenObjectSchema,
  ollamaMessages,
  parseStructuredContent,
  prepareInferenceInput,
  shouldEnvelopeOllamaText,
  stripThinkingText,
  vllmMessages
} = require('./engine-adapters.cjs');
const { cvSchema } = require('./three-page-cv-fixture.cjs');

test('detects the extensible objects in the public CV contract', () => {
  assert.equal(hasOpenObjectSchema(cvSchema), true);
  assert.equal(hasOpenObjectSchema({
    type: 'object',
    additionalProperties: false,
    properties: { value: { type: 'string' } }
  }), false);
});

test('builds a finite vLLM generation schema without changing required CV fields', () => {
  const schema = finiteCvSchema(cvSchema);
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, cvSchema.required);
  assert.equal(schema.properties.workExperience.additionalProperties, false);
  assert.equal(schema.properties.workExperience.properties.jobHistory.maxItems, 32);
  assert.equal(schema.properties.projects.maxItems, 32);
  assert.deepEqual(schema.properties.fullCVData, {
    type: 'object',
    additionalProperties: false,
    properties: {}
  });
});

test('adds bounded-CV instructions only when the source schema is extensible', () => {
  const input = {
    jsonSchema: cvSchema,
    messages: [{ role: 'user', content: 'Synthetic CV text' }]
  };
  const messages = vllmMessages(input, true);
  assert.equal(messages.length, 2);
  assert.match(messages[0].content, /Set "fullCVData" to exactly \{\}/);
  assert.match(messages[0].content, /never copy the raw CV text/i);
  assert.deepEqual(vllmMessages(input, false), input.messages);
});

test('accepts JSON with harmless fences and rejects truncated output', () => {
  assert.deepEqual(
    parseStructuredContent('```json\n{"firstName":"Ada"}\n```', 'test').data,
    { firstName: 'Ada' }
  );
  assert.throws(
    () => parseStructuredContent('{"firstName":"Ada"', 'test'),
    /malformed JSON/
  );
});

test('passes ordinary text and structured requests through without tool emulation', () => {
  const textInput = {
    activity: 'assistant.chat',
    messages: [{ role: 'user', content: 'Hello' }]
  };
  assert.equal(prepareInferenceInput(textInput).toolEmulation, false);

  const structuredInput = {
    activity: 'interview.questions',
    messages: [{ role: 'user', content: 'Create questions' }],
    jsonSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['questions'],
      properties: { questions: { type: 'array', items: { type: 'string' } } }
    }
  };
  const prepared = prepareInferenceInput(structuredInput);
  assert.equal(prepared.toolEmulation, false);
  assert.deepEqual(prepared.jsonSchema, structuredInput.jsonSchema);
});

test('emulates OpenAI tool selection with a bounded local JSON contract', () => {
  const prepared = prepareInferenceInput({
    activity: 'assistant.tool_selection',
    messages: [{ role: 'user', content: 'Find Node.js candidates' }],
    tools: [{
      type: 'function',
      function: {
        name: 'find_candidates',
        description: 'Find candidates',
        parameters: {
          type: 'object',
          properties: { skills: { type: 'array', items: { type: 'string' } } }
        }
      }
    }]
  });

  assert.equal(prepared.toolEmulation, true);
  assert.deepEqual(prepared.jsonSchema.properties.toolCalls.items.properties.name.enum, ['find_candidates']);
  const output = finalizeOutput({
    content: '{"content":"","toolCalls":[{"name":"find_candidates","arguments":{"skills":["Node.js"]}}]}',
    data: {
      content: '',
      toolCalls: [{ name: 'find_candidates', arguments: { skills: ['Node.js'] } }]
    }
  }, prepared);
  assert.equal(output.finishReason, 'tool_calls');
  assert.equal(output.toolCalls[0].function.name, 'find_candidates');
  assert.deepEqual(JSON.parse(output.toolCalls[0].function.arguments), { skills: ['Node.js'] });
});

test('adds a generic JSON-only instruction for extensible non-CV schemas', () => {
  const schema = { type: 'object', additionalProperties: true };
  const messages = vllmMessages({
    activity: 'analytics.candidates',
    jsonSchema: schema,
    messages: [{ role: 'user', content: 'Summarize counts' }]
  }, true);
  assert.equal(messages.length, 2);
  assert.match(messages[0].content, /Return exactly one JSON object/);
  assert.doesNotMatch(messages[0].content, /fullCVData/);
});

test('removes a separated reasoning block before returning user-visible content', () => {
  assert.equal(
    stripThinkingText('<think>\nPrivate reasoning\n</think>\n\nSEEMPLIFY_LOCAL_OK'),
    'SEEMPLIFY_LOCAL_OK'
  );
  assert.equal(stripThinkingText('Visible answer'), 'Visible answer');
});

test('adds Qwen no-think fallback only to non-thinking Ollama requests', () => {
  const messages = [{ role: 'user', content: 'Reply briefly.' }];
  assert.match(
    ollamaMessages(messages, { model: 'qwen3:30b', enableThinking: false })[0].content,
    /\/no_think$/
  );
  assert.deepEqual(
    ollamaMessages(messages, { model: 'qwen3:30b', enableThinking: true }),
    messages
  );
  assert.deepEqual(
    ollamaMessages(messages, { model: 'gemma4:26b-a4b-it-qat', enableThinking: false }),
    messages
  );
});

test('uses a structured transport envelope only for plain Qwen Ollama text', () => {
  assert.equal(shouldEnvelopeOllamaText('qwen3:30b', {
    messages: [{ role: 'user', content: 'Hello' }],
    toolEmulation: false
  }), true);
  assert.equal(shouldEnvelopeOllamaText('qwen3:30b', {
    messages: [{ role: 'user', content: 'Hello' }],
    jsonSchema: { type: 'object' },
    toolEmulation: false
  }), false);
  assert.equal(shouldEnvelopeOllamaText('gemma4:26b-a4b-it-qat', {
    messages: [{ role: 'user', content: 'Hello' }],
    toolEmulation: false
  }), false);
});
