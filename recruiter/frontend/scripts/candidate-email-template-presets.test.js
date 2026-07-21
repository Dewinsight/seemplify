const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const sourcePath = path.join(__dirname, '..', 'lib', 'candidateEmailTemplatePresets.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
});
const loadedModule = { exports: {} };
new Function('exports', 'module', transpiled.outputText)(loadedModule.exports, loadedModule);

const {
  CANDIDATE_EMAIL_TEMPLATE_PRESETS_BY_TYPE: presetsByType,
  CANDIDATE_EMAIL_TEMPLATE_VARIABLES_BY_TYPE: variablesByType,
  DEFAULT_CANDIDATE_EMAIL_TEMPLATE_PRESET_BY_TYPE: defaultsByType,
} = loadedModule.exports;

const templateTypes = [
  'rejection',
  'shortlistRejection',
  'shortlist',
  'advancement',
  'applicationConfirmation',
];

const assertUsesOnlySupportedVariables = (templateType, content) => {
  const supported = new Set(
    variablesByType[templateType].map((variable) => variable.token.slice(2, -2))
  );

  for (const match of content.matchAll(/{{\s*([^}]+?)\s*}}/g)) {
    const expression = match[1].trim();
    if (expression === '/if') {
      continue;
    }
    const variableName = expression.replace(/^#if\s+/, '');
    assert.ok(
      supported.has(variableName),
      `${templateType} preset uses unsupported placeholder {{${variableName}}}`
    );
  }
};

test('every candidate email type defaults to its plain email preset', () => {
  for (const templateType of templateTypes) {
    const defaultId = defaultsByType[templateType];
    const defaultPreset = presetsByType[templateType].find((preset) => preset.id === defaultId);
    const warmPreset = presetsByType[templateType].find((preset) => preset.id.endsWith('_warm'));

    assert.ok(defaultPreset, `${templateType} is missing its default preset`);
    assert.equal(defaultPreset.name, 'Plain email');
    assert.match(defaultPreset.id, /_plain$/);
    assert.ok(warmPreset, `${templateType} is missing its type-specific warm preset`);
    assert.equal(warmPreset.name, 'Warm email');
  }
});

test('candidate presets use only placeholders supported by their send path', () => {
  for (const templateType of templateTypes) {
    for (const preset of presetsByType[templateType]) {
      assertUsesOnlySupportedVariables(templateType, preset.content);
    }
  }
});

test('every preset communicates the correct candidate outcome', () => {
  for (const preset of presetsByType.rejection) {
    assert.match(preset.content, /not to move forward|not be progressing/i);
    assert.doesNotMatch(preset.content, /Good news|has been shortlisted|moving to the .* stage/i);
  }

  for (const preset of presetsByType.shortlistRejection) {
    assert.match(preset.content, /not to progress|not to progress your|not to progress your shortlisted/i);
    assert.doesNotMatch(preset.content, /Good news|has been shortlisted[^.]*next steps|moving to the .* stage/i);
  }

  for (const preset of presetsByType.shortlist) {
    assert.match(preset.content, /shortlisted/i);
    assert.doesNotMatch(preset.content, /not to move forward|not to progress/i);
  }

  for (const preset of presetsByType.advancement) {
    assert.match(preset.content, /{{nextStageName}}/);
    assert.doesNotMatch(preset.content, /not to move forward|not to progress|not be progressing/i);
  }

  for (const preset of presetsByType.applicationConfirmation) {
    assert.match(preset.content, /received your application|application has been received/i);
    assert.doesNotMatch(preset.content, /not to move forward|not to progress|moving to the .* stage/i);
  }
});
