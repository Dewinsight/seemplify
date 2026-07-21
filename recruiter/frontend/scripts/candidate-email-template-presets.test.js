const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const loadTypeScriptModule = (...segments) => {
  const sourcePath = path.join(__dirname, '..', ...segments);
  const source = fs.readFileSync(sourcePath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const loadedModule = { exports: {} };
  new Function('exports', 'module', transpiled.outputText)(loadedModule.exports, loadedModule);
  return loadedModule.exports;
};

const {
  CANDIDATE_EMAIL_TEMPLATE_PRESETS_BY_TYPE: presetsByType,
  CANDIDATE_EMAIL_TEMPLATE_VARIABLES_BY_TYPE: variablesByType,
  DEFAULT_CANDIDATE_EMAIL_TEMPLATE_PRESET_BY_TYPE: defaultsByType,
  LEGACY_CANDIDATE_EMAIL_TEMPLATE_FINGERPRINTS: legacyFingerprints,
  getLegacyCandidateEmailTemplateReplacement,
} = loadTypeScriptModule('lib', 'candidateEmailTemplatePresets.ts');

const {
  EMAIL_PREVIEW_ORGANIZATION_PLACEHOLDER,
  resolveEmailPreviewOrganizationName,
} = loadTypeScriptModule('lib', 'emailOrganizationContext.ts');

const templateTypes = [
  'rejection',
  'shortlistRejection',
  'shortlist',
  'advancement',
  'applicationConfirmation',
];

const designedPresetSuffixes = [
  'update_card',
  'branded_status',
  'executive_brief',
  'spotlight_notice',
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

test('email previews use only the active organization name', () => {
  assert.equal(
    resolveEmailPreviewOrganizationName({ name: '  AIIN  ' }),
    'AIIN'
  );
  assert.equal(
    resolveEmailPreviewOrganizationName(null),
    EMAIL_PREVIEW_ORGANIZATION_PLACEHOLDER
  );
});

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

test('every candidate email type includes the restored HTML designs', () => {
  for (const templateType of templateTypes) {
    const presets = presetsByType[templateType];
    for (const suffix of designedPresetSuffixes) {
      const preset = presets.find((candidatePreset) => candidatePreset.id.endsWith(`_${suffix}`));
      assert.ok(preset, `${templateType} is missing its ${suffix} design`);
      assert.match(preset.content, /<div[^>]+style=/i);
      assert.match(preset.content, /background:|border:/i);
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

test('the reported legacy warm template migrates without overwriting user edits', () => {
  const legacyWarmTemplate = `Hello {{candidateName}},

We wanted to share an update about your application for {{jobTitle}}.

{{#if nextStageName}}
Good news: you are progressing to {{nextStageName}}.
{{/if}}

{{#if feedback}}
Team feedback:
{{feedback}}
{{/if}}

{{#if notes}}
Notes:
{{notes}}
{{/if}}

Thanks again for your time,
{{organizationName}}`;

  assert.deepEqual(
    new Set(Object.values(legacyFingerprints)),
    new Set(['update_card', 'branded_status', 'executive_brief', 'warm', 'spotlight_notice'])
  );
  for (const templateType of templateTypes) {
    const replacement = getLegacyCandidateEmailTemplateReplacement(templateType, legacyWarmTemplate);
    assert.ok(replacement, `${templateType} did not migrate the legacy warm template`);
    assert.ok(replacement.id.endsWith('_warm'));
    assert.equal(
      getLegacyCandidateEmailTemplateReplacement(
        templateType,
        `${legacyWarmTemplate}\n\nA user-written sentence.`
      ),
      undefined
    );
  }
});
