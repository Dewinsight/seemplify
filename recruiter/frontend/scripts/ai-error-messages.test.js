const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function load(relativePath) {
  const source = fs.readFileSync(path.join(__dirname, '..', ...relativePath.split('/')), 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  });
  const loaded = { exports: {} };
  new Function('exports', 'module', transpiled.outputText)(loaded.exports, loaded);
  return loaded.exports;
}

const { aiError, aiErrorMessage, messageFromAiFailure } = load('utils/aiError.ts');

test('a usage limit keeps the date the plan resets', () => {
  // This is the failure the workspace hit: without the detail the user is told
  // only "Failed to generate job description", which explains nothing and
  // invites them to retry immediately and fail again.
  const message = aiErrorMessage({
    msg: 'Failed to generate job description',
    code: 'CODEX_TURN_FAILED',
    error: "You've hit your usage limit. Upgrade to Pro or try again at Aug 13th, 2026 5:26 PM."
  });
  assert.match(message, /usage limit/i);
  assert.match(message, /Aug 13th, 2026 5:26 PM/, 'the reset time is the actionable part');
  assert.doesNotMatch(message, /Network error/);
});

test('a runtime gate says what to do rather than what broke', () => {
  assert.match(
    aiErrorMessage({ msg: 'Failed to generate job description', code: 'CHATGPT_NOT_CONNECTED' }),
    /Connect your ChatGPT account/
  );
  assert.match(
    aiErrorMessage({ msg: 'AI is unavailable', code: 'AI_ACTIVITY_DISABLED' }),
    /turned off by an administrator/
  );
});

test('the runtime\'s own words are kept beside the headline', () => {
  assert.equal(
    aiErrorMessage({ msg: 'Failed to analyze candidates', error: 'The model returned no usable output' }),
    'Failed to analyze candidates: The model returned no usable output'
  );
});

test('a detail that merely repeats the headline is not said twice', () => {
  assert.equal(
    aiErrorMessage({ msg: 'AI matching is unavailable', error: 'AI matching is unavailable' }),
    'AI matching is unavailable'
  );
});

test('an empty payload still says something, never nothing', () => {
  assert.equal(aiErrorMessage({}), 'The AI request could not be completed.');
  assert.equal(aiErrorMessage(null, 'Custom fallback'), 'Custom fallback');
});

test('the thrown error carries the code the runtime gate routes on', () => {
  const error = aiError({ msg: 'Failed', code: 'CHATGPT_CONSENT_REQUIRED', error: 'no consent' }, 409);
  assert.ok(error instanceof Error);
  assert.equal(error.code, 'CHATGPT_CONSENT_REQUIRED');
  assert.equal(error.status, 409);
  assert.equal(error.detail, 'no consent');
  assert.match(error.message, /Confirm data sharing/);
});

test('a raw payload thrown by an older service still reads correctly', () => {
  // Services used to `throw errorData` — a bare object with no .message. That
  // is what produced "Network error occurred" for every AI failure.
  const raw = { msg: 'Failed to send message', code: 'CODEX_TURN_FAILED', error: "You've hit your usage limit." };
  assert.match(messageFromAiFailure(raw), /usage limit/i);
  assert.equal(messageFromAiFailure(new Error('boom')), 'boom');
  assert.equal(messageFromAiFailure(undefined, 'Fallback'), 'Fallback');
});

test('a generation failure stays on screen until the user acts', () => {
  // The job form had an effect that cleared aiAssistantError whenever the
  // required fields were filled — which they always are by the time an API
  // call fails. The panel rendered for one frame and vanished, so a usage-
  // limit refusal looked like nothing happening at all. Only the missing-
  // fields hint may clear itself.
  const source = fs.readFileSync(path.join(__dirname, '..', 'app', 'jobs', 'new', 'page.tsx'), 'utf8');
  assert.match(
    source,
    /aiAssistantError\.startsWith\("Please fill in"\)/,
    'auto-clearing must be scoped to the validation hint'
  );
  assert.doesNotMatch(
    source,
    /if \(aiAssistantError && watchedTitle && watchedDepartment && watchedLocation\)/,
    'the unscoped clear erased API failures on the next render'
  );
});

test('no AI service flattens a failure to a generic network message', () => {
  // A regression guard: the old pattern silently destroyed every AI error
  // reason across 30-odd call sites.
  for (const file of ['services/assistantService.ts', 'services/aiService.ts']) {
    const source = fs.readFileSync(path.join(__dirname, '..', ...file.split('/')), 'utf8');
    assert.doesNotMatch(source, /'Network error occurred'/, `${file} must not mask AI failures`);
    assert.doesNotMatch(source, /throw errorData;/, `${file} must throw a real Error`);
  }
});
