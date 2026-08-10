const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function loadTypeScript(relativePath) {
  const source = fs.readFileSync(path.join(__dirname, '..', ...relativePath.split('/')), 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  });
  const loaded = { exports: {} };
  new Function('exports', 'module', transpiled.outputText)(loaded.exports, loaded);
  return loaded.exports;
}

const runtimePolicy = loadTypeScript('lib/aiRuntimePolicy.ts');

test('effective runtime falls back to a runtime that remains enabled', () => {
  assert.equal(runtimePolicy.normalizedEffectiveRuntime({
    localEnabled: false,
    chatgptEnabled: true,
    defaultRuntime: 'local'
  }, 'default'), 'chatgpt');
  assert.equal(runtimePolicy.normalizedEffectiveRuntime({
    localEnabled: true,
    chatgptEnabled: false,
    defaultRuntime: 'chatgpt'
  }, 'chatgpt'), 'local');
  assert.equal(runtimePolicy.normalizedEffectiveRuntime({
    localEnabled: false,
    chatgptEnabled: false,
    defaultRuntime: 'chatgpt'
  }, 'default'), null);
});

test('AI account settings keep recovery, truthful limits, and saved unavailable choices visible', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'app', 'settings', 'ai', 'page.tsx'), 'utf8');
  assert.match(source, /retryAfterSeconds/);
  assert.match(source, /Try again in \$\{countdown\}/);
  assert.match(source, /state\?\.account\.status === 'pending'/);
  assert.match(source, /await aiAccount\.resetLogin\(\)/);
  assert.match(source, /data-testid="ai-usage-observed-at"/);
  assert.match(source, /does not estimate a quota/);
  assert.match(source, /saved; unavailable/);
  assert.match(source, /saved; unsupported by selected model/);
  assert.match(source, /Disabled by an administrator/);
  assert.match(source, /!preference\.enabled/);
});
