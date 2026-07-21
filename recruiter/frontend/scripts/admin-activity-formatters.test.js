const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const sourcePath = path.join(__dirname, '..', 'lib', 'adminActivityFormatters.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
});
const loadedModule = { exports: {} };
new Function('exports', 'module', transpiled.outputText)(loadedModule.exports, loadedModule);

const { formatTrendDate } = loadedModule.exports;

test('formats day and month activity buckets', () => {
  assert.equal(formatTrendDate('2026-07-21', 'day'), '21 Jul');
  assert.equal(formatTrendDate('2026-07', 'month'), 'Jul 26');
});

test('survives stale tooltip labels while switching to all time', () => {
  assert.doesNotThrow(() => formatTrendDate('2026-07-21', 'month'));
  assert.equal(formatTrendDate('2026-07-21', 'month'), '21 Jul');
});

test('returns a safe label for empty or invalid chart values', () => {
  assert.equal(formatTrendDate(undefined, 'month'), 'Unknown');
  assert.equal(formatTrendDate('not-a-date', 'month'), 'not-a-date');
});
