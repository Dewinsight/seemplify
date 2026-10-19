const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../lib/one-off-appraisal-policy.ts'), 'utf8');
const loaded = { exports: {} };
new Function('exports', 'module', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(loaded.exports, loaded);
const { oneOffAppraisalPolicy: policy } = loaded.exports;
const design = { version: 1, scoring: { goalsWeight: 40, competenciesWeight: 60 }, stages: { goalSetting: { enabled: true }, discussion: { enabled: false }, selfAssessment: { enabled: true } }, sections: [
  { id: 'g', type: 'goals', scored: true, weight: 40, questions: [] },
  { id: 'c', type: 'competencies', scored: true, weight: 60, questions: [] },
  { id: 'q', type: 'custom', scored: false, weight: 0, required: true, evidenceRequired: false, questions: [{ id: 'required-answer', required: true, prompt: 'Explain the evidence.' }] },
] };
test('approved goals remain required by default and preserve the exact template', () => { const result = policy(design, true, true); assert.equal(result.settings.requireOkrAlignment, true); assert.equal(result.workflowDefinition, design); });
test('turning role assessment off restores required goals even with a stale unchecked choice', () => { const result = policy(design, false, false); assert.equal(result.settings.requireOkrAlignment, true); assert.equal(result.workflowDefinition, design); });
test('explicit role-only review removes only goals and gives balanced competencies 100 percent', () => { const result = policy(design, false, true); assert.deepEqual(result.settings, { requireOkrAlignment: false }); assert.deepEqual(result.workflowDefinition.scoring, { goalsWeight: 0, competenciesWeight: 100 }); assert.equal(result.workflowDefinition.sections[0].weight, 100); assert.equal(result.workflowDefinition.stages.goalSetting.enabled, false); });
test('all non-goal questions, required flags and unrelated workflow stages remain unchanged', () => { const next = policy(design, false, true).workflowDefinition; assert.equal(next.sections[1], design.sections[2]); assert.deepEqual(next.stages.discussion, design.stages.discussion); assert.deepEqual(design.scoring, { goalsWeight: 40, competenciesWeight: 60 }); assert.equal(design.sections.length, 3); });
test('scored custom questions retain their proportional weight instead of being silently removed', () => { const input = structuredClone(design); input.sections[1].weight = 40; input.sections[2].scored = true; input.sections[2].weight = 20; const result = policy(input, false, true).workflowDefinition; assert.equal(result.sections[0].weight, 200 / 3); assert.equal(result.sections[1].weight, 100 / 3); assert.equal(result.sections.reduce((sum, s) => sum + s.weight, 0), 100); });
test('zero, negative and nonfinite scored weights fail before constructing a launch', () => { for (const weight of [0, -1, Infinity, NaN]) { const input = structuredClone(design); input.sections[1].weight = weight; assert.throws(() => policy(input, false, true), /positively weighted/); } });
test('goal-only scoring cannot become a review with no measurable evidence', () => { const input = structuredClone(design); input.sections[1].scored = false; assert.throws(() => policy(input, false, true), /positively weighted/); });
