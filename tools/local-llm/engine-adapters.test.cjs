const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  ENGINE_IDS,
  claudeChildEnv,
  claudeExecArgs,
  claudePrompt,
  claudeSystemPrompt,
  claudeExecutionProfile,
  codexPrompt,
  codexChildEnv,
  codexExecArgs,
  finalizeOutput,
  finiteCvSchema,
  hasOpenObjectSchema,
  ollamaMessages,
  parseCodexJsonl,
  parseClaudeJson,
  recoverCodexUsage,
  parseStructuredContent,
  prepareInferenceInput,
  structuredQualityIssue,
  responseFormatInstruction,
  removeCodexRequestDir,
  runOllama,
  runVllm,
  shouldEnvelopeOllamaText,
  spawnCapture,
  stripThinkingText,
  vllmMessages
} = require('./engine-adapters.cjs');

test('Claude is a managed engine with tool-disabled schema-constrained execution', () => {
  assert.ok(ENGINE_IDS.includes('claude'));
  const input = {
    activity: 'candidate.cv_parse',
    messages: [{ role: 'user', content: 'Jane Doe' }],
    jsonSchema: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
      additionalProperties: false
    }
  };
  const args = claudeExecArgs({ model: 'sonnet' }, input);
  assert.deepEqual(args.slice(0, 5), ['-p', '--model', 'sonnet', '--effort', 'medium']);
  assert.deepEqual(args.slice(args.indexOf('--tools'), args.indexOf('--tools') + 2), ['--tools', '']);
  assert.ok(args.includes('--no-session-persistence'));
  assert.ok(args.includes('--disable-slash-commands'));
  assert.ok(args.includes('--strict-mcp-config'));
  assert.ok(args.includes('--safe-mode'));
  assert.ok(args.includes('--json-schema'));
  assert.equal(args[args.indexOf('--max-turns') + 1], '4');
  assert.match(args[args.indexOf('--system-prompt') + 1], /managed Seemplify Claude local-cloud inference engine/);
  assert.match(claudeSystemPrompt(input), /Extract only CV facts explicitly present/);
  assert.match(claudePrompt(input), /USER:\nJane Doe/);
});

test('Claude execution profiles consume the gateway workload policy and its bounded turn budget', () => {
  assert.deepEqual(
    claudeExecutionProfile({ activity: 'assistant.title', messages: [{ role: 'user', content: 'quick' }], reasoningEffort: 'low', maxTokens: 9000 }).id,
    'short-composition'
  );
  const structured = claudeExecutionProfile({
    activity: 'candidate.cv_parse',
    messages: [{ role: 'user', content: 'structured' }],
    reasoningEffort: 'medium',
    maxTokens: 9000,
    jsonSchema: { type: 'object' }
  });
  assert.equal(structured.id, 'structured-extraction');
  assert.equal(structured.maxTokens, 8000);
  assert.equal(structured.timeoutMs, 300000);
  assert.equal(structured.maxTurns, 4);
  const deep = claudeExecutionProfile({ activity: 'matching.analysis', messages: [{ role: 'user', content: 'deep' }], reasoningEffort: 'high', maxTokens: 20000 });
  assert.equal(deep.id, 'deep-analysis');
  assert.equal(deep.maxTokens, 12000);
  assert.equal(deep.maxTurns, 6);
  assert.throws(
    () => claudeExecutionProfile({ messages: [{ role: 'user', content: 'x'.repeat(1_200_001) }] }),
    (error) => error.code === 'LOCAL_LLM_CONTEXT_TOO_LARGE' && error.retryable === false
  );
});

test('Claude child environment keeps only authentication/runtime settings', () => {
  const env = claudeChildEnv({
    PATH: 'C:\\Windows\\System32',
    USERPROFILE: 'C:\\Users\\runtime',
    CLAUDE_CONFIG_DIR: 'C:\\profiles\\claude-a',
    ANTHROPIC_API_KEY: 'allowed-auth',
    LOCAL_LLM_SHARED_SECRET: 'sentinel-must-not-leak'
  });
  assert.equal(env.CLAUDE_CONFIG_DIR, 'C:\\profiles\\claude-a');
  assert.equal(env.ANTHROPIC_API_KEY, 'allowed-auth');
  assert.equal(env.LOCAL_LLM_SHARED_SECRET, undefined);
});

test('Claude JSON output preserves structured content, token usage, cache usage, and cost', () => {
  const parsed = parseClaudeJson(JSON.stringify({
    is_error: false,
    subtype: 'success',
    result: '{"name":"Jane Doe"}',
    structured_output: { name: 'Jane Doe' },
    total_cost_usd: 0.03125,
    num_turns: 2,
    terminal_reason: 'end_turn',
    usage: {
      input_tokens: 10,
      cache_creation_input_tokens: 20,
      cache_read_input_tokens: 30,
      output_tokens: 15
    }
  }));
  assert.deepEqual(parsed.structuredOutput, { name: 'Jane Doe' });
  assert.equal(parsed.usage.prompt_tokens, 60);
  assert.equal(parsed.usage.completion_tokens, 15);
  assert.equal(parsed.usage.total_tokens, 75);
  assert.equal(parsed.usage.prompt_tokens_details.cached_tokens, 30);
  assert.equal(parsed.usage.prompt_tokens_details.cache_write_tokens, 20);
  assert.equal(parsed.estimatedCostUsd, 0.03125);
  assert.equal(parsed.numTurns, 2);
  assert.equal(parsed.terminalReason, 'end_turn');
});

test('gateway response-format policy distinguishes analysis Markdown from short plain text', () => {
  const markdownInput = {
    activity: 'matching.analysis',
    messages: [{ role: 'user', content: 'Compare candidates' }],
    executionPlan: claudeExecutionProfile({
      activity: 'matching.analysis',
      messages: [{ role: 'user', content: 'Compare candidates' }]
    })
  };
  const plainInput = {
    activity: 'experience.social_reply_draft',
    messages: [{ role: 'user', content: 'Reply' }],
    executionPlan: claudeExecutionProfile({
      activity: 'experience.social_reply_draft',
      messages: [{ role: 'user', content: 'Reply' }]
    })
  };

  assert.match(responseFormatInstruction(markdownInput), /Markdown/);
  assert.match(responseFormatInstruction(plainInput), /plain text/);
  assert.match(codexPrompt(markdownInput), /clean, concise Markdown/);
  assert.match(claudeSystemPrompt(plainInput), /concise plain text/);
});

test('Claude max-turn envelopes produce a safe actionable diagnostic with usage', () => {
  assert.throws(
    () => parseClaudeJson(JSON.stringify({
      is_error: true,
      subtype: 'error_max_turns',
      terminal_reason: 'max_turns',
      num_turns: 1,
      result: 'sensitive supplied content must not leak',
      errors: ['Reached maximum number of turns (1)'],
      usage: { input_tokens: 11, output_tokens: 7 }
    })),
    (error) => {
      assert.equal(error.code, 'CLAUDE_MAX_TURNS');
      assert.equal(error.terminalReason, 'max_turns');
      assert.equal(error.numTurns, 1);
      assert.equal(error.claudeUsage.total_tokens, 18);
      assert.doesNotMatch(error.message, /sensitive supplied content/);
      return true;
    }
  );
});

test('deep structured analysis rejects placeholder payloads before they reach an app', () => {
  const input = {
    jsonSchema: { type: 'object' },
    executionPlan: { workload: 'deep-analysis' }
  };
  const placeholder = {
    answer: 'test',
    evidence: [{ excerpt: 'test', relevance: 'test' }],
    caveats: ['test'],
    suggestedQuestions: ['test']
  };
  assert.match(structuredQualityIssue(placeholder, input), /placeholder/);
  assert.throws(
    () => finalizeOutput({ content: JSON.stringify(placeholder), data: placeholder }, input),
    (error) => error.code === 'LOCAL_LLM_LOW_QUALITY_OUTPUT' && error.status === 502 && error.retryable === true
  );
  const paddedPlaceholder = { ...placeholder, answer: 'test '.repeat(30).trim() };
  assert.match(structuredQualityIssue(paddedPlaceholder, input), /placeholder/);
  assert.equal(structuredQualityIssue({
    answer: 'The completed response identifies setup and connectivity friction as the clearest immediate priority.',
    evidence: [{ excerpt: 'Connection issues', relevance: 'This directly identifies the reported customer problem.' }],
    caveats: ['Only one completed response is available, so this finding is directional.']
  }, input), null);
});

test('Codex child environment keeps runtime/auth settings and excludes unrelated service secrets', () => {
  const env = codexChildEnv({
    PATH: 'C:\\Windows\\System32',
    SystemRoot: 'C:\\Windows',
    USERPROFILE: 'C:\\Users\\runtime',
    OPENAI_API_KEY: 'codex-auth-key',
    HTTPS_PROXY: 'http://proxy.internal',
    RECRUITER_DATABASE_PASSWORD: 'sentinel-must-not-leak',
    REDIS_URL: 'redis://sentinel-must-not-leak',
    LOCAL_LLM_SHARED_SECRET: 'sentinel-must-not-leak'
  });

  assert.equal(env.PATH, 'C:\\Windows\\System32');
  assert.equal(env.SystemRoot, 'C:\\Windows');
  assert.equal(env.USERPROFILE, 'C:\\Users\\runtime');
  assert.equal(env.OPENAI_API_KEY, 'codex-auth-key');
  assert.equal(env.HTTPS_PROXY, 'http://proxy.internal');
  assert.equal(env.CODEX_NON_INTERACTIVE, '1');
  assert.equal(env.RECRUITER_DATABASE_PASSWORD, undefined);
  assert.equal(env.REDIS_URL, undefined);
  assert.equal(env.LOCAL_LLM_SHARED_SECRET, undefined);
  assert.doesNotMatch(JSON.stringify(env), /sentinel-must-not-leak/);
});

test('Codex execution disables untrusted-resume tool surfaces with strict configuration', () => {
  const args = codexExecArgs({ model: 'gpt-5.6-terra' }, 'C:\\isolated-request');
  assert.deepEqual(args.slice(1, 14), [
    '--strict-config',
    '--disable', 'shell_tool',
    '--disable', 'apps',
    '--disable', 'goals',
    '--disable', 'hooks',
    '--disable', 'multi_agent',
    '--disable', 'remote_plugin'
  ]);
  assert.ok(args.includes('web_search="disabled"'));
  assert.ok(args.includes('shell_environment_policy.inherit="none"'));
  assert.ok(args.includes('--ignore-user-config'));
  assert.ok(args.includes('--ignore-rules'));
  assert.deepEqual(args.slice(args.indexOf('--sandbox'), args.indexOf('--sandbox') + 2), [
    '--sandbox', 'read-only'
  ]);
});

test('Codex request cleanup retries transient Windows locks without replacing inference success', async () => {
  let removalOptions;
  const cleaned = await removeCodexRequestDir('C:\\isolated-request', {
    remove: async (_requestDir, options) => {
      removalOptions = options;
    }
  });

  assert.equal(cleaned, true);
  assert.deepEqual(removalOptions, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100
  });

  const warnings = [];
  const retained = await removeCodexRequestDir('C:\\isolated-request', {
    remove: async () => {
      const error = new Error('resource busy or locked');
      error.code = 'EBUSY';
      throw error;
    },
    warn: (message) => warnings.push(message)
  });

  assert.equal(retained, false);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /resource busy or locked/);
});
const { cvSchema } = require('./three-page-cv-fixture.cjs');

async function waitUntil(predicate, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

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

for (const [engine, run, payload] of [
  ['ollama', runOllama, {
    model: 'test-ollama',
    message: { content: '{"answer":' },
    prompt_eval_count: 40,
    eval_count: 7,
    done_reason: 'length'
  }],
  ['vllm', runVllm, {
    id: 'vllm-failed-output',
    model: 'test-vllm',
    choices: [{
      message: { content: '{"answer":' },
      finish_reason: 'length'
    }],
    usage: { prompt_tokens: 40, completion_tokens: 7, total_tokens: 47 }
  }]
]) {
  test(`${engine} preserves authoritative usage when generated structured output is invalid`, async (context) => {
    let dispatches = 0;
    context.mock.method(global, 'fetch', async () => {
      assert.equal(dispatches, 1);
      return new Response(
        JSON.stringify(payload),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    });
    await assert.rejects(
      () => run({
        activity: 'interview.questions',
        messages: [{ role: 'user', content: 'Return structured data.' }],
        onProviderDispatch: async () => { dispatches += 1; },
        jsonSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['answer'],
          properties: { answer: { type: 'string' } }
        }
      }, {
        selectedEngine: engine,
        engines: {
          [engine]: { model: `test-${engine}`, baseUrl: 'http://runtime.test' }
        }
      }),
      (error) => {
        assert.equal(error.code, 'LOCAL_LLM_OUTPUT_TRUNCATED');
        assert.equal(error.usageEnvelope.usage.prompt_tokens, 40);
        assert.equal(error.usageEnvelope.usage.completion_tokens, 7);
        assert.equal(error.usageEnvelope.usage.total_tokens, 47);
        assert.equal(error.usageEnvelope.usageReported, true);
        return true;
      }
    );
    assert.equal(dispatches, 1);
  });
}

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

test('builds Codex prompts for both ordinary text and structured local-cloud activities', () => {
  const textPrompt = codexPrompt({
    activity: 'recruiter.general',
    messages: [{ role: 'user', content: 'Summarize this role.' }]
  });
  assert.match(textPrompt, /managed Seemplify local-cloud inference engine/i);
  assert.match(textPrompt, /complete user-visible answer/i);
  assert.doesNotMatch(textPrompt, /required_json_schema/);

  const structuredPrompt = codexPrompt(prepareInferenceInput({
    activity: 'assistant.tool_selection',
    messages: [{ role: 'user', content: 'Find Node.js candidates.' }],
    tools: [{
      type: 'function',
      function: {
        name: 'find_candidates',
        parameters: { type: 'object', properties: {} }
      }
    }]
  }));
  assert.match(structuredPrompt, /required_json_schema/);
  assert.match(structuredPrompt, /find_candidates/);
});

test('extracts Terra content and authoritative token details from Codex JSONL', () => {
  const result = parseCodexJsonl([
    JSON.stringify({ type: 'thread.started', thread_id: 'thread-1' }),
    JSON.stringify({ type: 'turn.started' }),
    JSON.stringify({
      type: 'item.completed',
      item: { id: 'item-1', type: 'agent_message', text: '{"ok":true}' }
    }),
    JSON.stringify({
      type: 'turn.completed',
      usage: {
        input_tokens: 12740,
        cached_input_tokens: 10496,
        cache_write_input_tokens: 64,
        output_tokens: 25,
        reasoning_output_tokens: 20
      }
    })
  ].join('\n'));

  assert.equal(result.content, '{"ok":true}');
  assert.equal(result.usageReported, true);
  assert.deepEqual(result.usage, {
    prompt_tokens: 12740,
    completion_tokens: 25,
    total_tokens: 12765,
    prompt_tokens_details: {
      cached_tokens: 10496,
      cache_write_tokens: 64
    },
    completion_tokens_details: {
      reasoning_tokens: 20
    }
  });
});

test('does not claim Codex usage was reported when the completed turn omitted metering', () => {
  const result = parseCodexJsonl([
    JSON.stringify({
      type: 'item.completed',
      item: { id: 'item-1', type: 'agent_message', text: 'done' }
    }),
    JSON.stringify({ type: 'turn.completed' })
  ].join('\n'));

  assert.equal(result.usageReported, false);
  assert.equal(result.usage.total_tokens, 0);
});

test('rejects failed and malformed Codex JSONL turns', () => {
  assert.throws(
    () => parseCodexJsonl(JSON.stringify({
      type: 'turn.failed',
      error: { code: 'model_error', message: 'Terra failed' },
      usage: {
        input_tokens: 100,
        cached_input_tokens: 40,
        output_tokens: 12,
        reasoning_output_tokens: 8,
        total_tokens: 112
      }
    })),
    (error) => {
      assert.match(error.message, /Terra failed/);
      assert.equal(error.code, 'model_error');
      assert.equal(error.usageReported, true);
      assert.deepEqual(error.codexUsage, {
        prompt_tokens: 100,
        completion_tokens: 12,
        total_tokens: 112,
        prompt_tokens_details: {
          cached_tokens: 40,
          cache_write_tokens: 0
        },
        completion_tokens_details: {
          reasoning_tokens: 8
        }
      });
      return true;
    }
  );
  assert.throws(() => parseCodexJsonl('not json'), /malformed JSONL/);
});

test('non-zero Codex capture retains stdout privately for usage recovery', async () => {
  const event = JSON.stringify({
    type: 'turn.failed',
    error: { message: 'fixture failure' },
    usage: { input_tokens: 9, output_tokens: 3, total_tokens: 12 }
  });
  await assert.rejects(
    () => spawnCapture(process.execPath, [
      '-e',
      `process.stdout.write(${JSON.stringify(event)}); process.exit(7)`
    ]),
    (error) => {
      assert.equal(error.code, 'CODEX_EXEC_FAILED');
      assert.equal(error.capturedStdout, event);
      assert.equal(Object.keys(error).includes('capturedStdout'), false);
      assert.doesNotMatch(JSON.stringify(error), /fixture failure/);
      return true;
    }
  );
});

test('timed-out Codex capture preserves only privately recoverable usage', async () => {
  const usageEvent = JSON.stringify({
    type: 'turn.completed',
    usage: {
      input_tokens: 41,
      cached_input_tokens: 17,
      cache_write_input_tokens: 2,
      output_tokens: 11,
      reasoning_output_tokens: 7,
      total_tokens: 52
    }
  });
  const privateOutput = 'private-model-output-must-not-leak';
  const messageEvent = JSON.stringify({
    type: 'item.completed',
    item: { type: 'agent_message', text: privateOutput }
  });
  let capturedError;

  await assert.rejects(
    () => spawnCapture(process.execPath, [
      '-e',
      `process.stdout.write(${JSON.stringify(`${messageEvent}\n${usageEvent}\n`)}); setInterval(() => {}, 1000)`
    ], { timeoutMs: 150 }),
    (error) => {
      capturedError = error;
      assert.equal(error.code, 'CODEX_EXEC_TIMEOUT');
      assert.equal(Object.keys(error).includes('capturedStdout'), false);
      assert.doesNotMatch(JSON.stringify(error), new RegExp(privateOutput));
      return true;
    }
  );

  assert.deepEqual(recoverCodexUsage(capturedError.capturedStdout), {
    usage: {
      prompt_tokens: 41,
      completion_tokens: 11,
      total_tokens: 52,
      prompt_tokens_details: {
        cached_tokens: 17,
        cache_write_tokens: 2
      },
      completion_tokens_details: {
        reasoning_tokens: 7
      }
    },
    usageReported: true
  });
});

test('aborted Codex capture waits until the child process tree is gone', async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-cancel-test-'));
  const pidFile = path.join(directory, 'pids.json');
  let pids = [];
  context.after(() => {
    for (const pid of pids) {
      try { process.kill(pid, 'SIGKILL'); } catch {}
    }
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const script = [
    "const fs = require('node:fs');",
    "const { spawn } = require('node:child_process');",
    "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true });",
    "fs.writeFileSync(process.argv[1], JSON.stringify([process.pid, child.pid]));",
    `process.stdout.write(${JSON.stringify(`${JSON.stringify({
      type: 'turn.failed',
      usage: { input_tokens: 23, output_tokens: 5, total_tokens: 28 }
    })}\n`)});`,
    "setInterval(() => {}, 1000);"
  ].join('');
  const controller = new AbortController();
  const pending = spawnCapture(process.execPath, ['-e', script, pidFile], {
    signal: controller.signal,
    timeoutMs: 30_000
  });
  assert.equal(await waitUntil(() => fs.existsSync(pidFile)), true);
  pids = JSON.parse(fs.readFileSync(pidFile, 'utf8'));

  controller.abort();
  let capturedError;
  await assert.rejects(pending, (error) => {
    capturedError = error;
    return error?.code === 'CODEX_EXEC_ABORTED';
  });
  assert.deepEqual(recoverCodexUsage(capturedError.capturedStdout), {
    usage: {
      prompt_tokens: 23,
      completion_tokens: 5,
      total_tokens: 28,
      prompt_tokens_details: {
        cached_tokens: 0,
        cache_write_tokens: 0
      },
      completion_tokens_details: {
        reasoning_tokens: 0
      }
    },
    usageReported: true
  });
  assert.equal(await waitUntil(() => pids.every((pid) => !processExists(pid))), true);
});
