const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const sourcePath = path.resolve(__dirname, '../lib/transition-flow.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020
  }
}).outputText;

const moduleUnderTest = { exports: {} };
const run = new Function('exports', 'require', 'module', '__filename', '__dirname', compiled);
run(moduleUnderTest.exports, require, moduleUnderTest, sourcePath, path.dirname(sourcePath));

const { buildTransitionFlow, transitionActionHref } = moduleUnderTest.exports;

const baseRecord = {
  _id: 'transition1',
  title: 'Onboarding packet',
  processType: 'onboarding',
  status: 'in_progress',
  candidate: { _id: 'candidate1', email: 'candidate@example.com' },
  workflowItems: [
    {
      _id: 'workflowForm',
      type: 'form',
      title: 'Complete personal details',
      status: 'pending',
      ownerType: 'candidate',
      sourceId: 'form1',
      order: 10
    },
    {
      _id: 'workflowDocuments',
      type: 'document',
      title: 'Review documents',
      status: 'pending',
      ownerType: 'candidate',
      sourceId: 'envelope1',
      order: 20
    }
  ],
  forms: [
    {
      _id: 'form1',
      title: 'Personal details',
      status: 'draft',
      values: [],
      hasSensitiveValues: false
    }
  ],
  envelopes: [
    {
      _id: 'envelope1',
      title: 'Candidate packet',
      status: 'sent',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      signers: [
        {
          _id: 'signer1',
          role: 'candidate',
          email: 'candidate@example.com',
          order: 1,
          status: 'viewed'
        }
      ],
      documents: [
        document('autoDoc', 'Auto-stamped only', 'pending', [{ role: 'candidate', type: 'date' }]),
        document('fillDoc', 'Biodata', 'pending', [{ role: 'candidate', type: 'text' }]),
        document('signDoc', 'Agreement', 'pending', [{ role: 'candidate', type: 'signature' }])
      ]
    }
  ],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

const steps = buildTransitionFlow(baseRecord);
assert.deepStrictEqual(
  steps.map((step) => ({ id: step.id, type: step.type, actionable: step.actionable, disabled: Boolean(step.disabled) })),
  [
    { id: 'form:form1', type: 'form', actionable: true, disabled: false },
    { id: 'document:autoDoc', type: 'document_sign', actionable: false, disabled: true },
    { id: 'document:fillDoc', type: 'document_fill', actionable: true, disabled: false },
    { id: 'document:signDoc', type: 'document_sign', actionable: true, disabled: false }
  ],
  'step rail should preserve packet order and disable auto-only documents'
);

assert.strictEqual(
  transitionActionHref({
    ...baseRecord,
    nextAction: {
      type: 'document_fill',
      label: 'Fill Biodata',
      href: '/documents/fillDoc/sign',
      processType: 'onboarding',
      recordId: 'transition1'
    }
  }),
  '/documents/fillDoc/sign',
  'actionable document next action should route directly to signing page'
);

assert.strictEqual(
  transitionActionHref({
    ...baseRecord,
    nextAction: {
      type: 'waiting',
      label: 'Waiting on HR review',
      href: '/transitions/transition1',
      processType: 'onboarding',
      recordId: 'transition1'
    }
  }),
  '/transitions/transition1',
  'waiting next action should stay on transition detail'
);

console.log('Candidate portal transition step flow verified.');

function document(id, title, status, fields) {
  return {
    _id: id,
    document: id,
    title,
    status,
    signatureFields: fields.map((field, index) => ({
      id: `${id}-field-${index}`,
      page: 1,
      x: 0.1,
      y: 0.1,
      width: 0.2,
      height: 0.08,
      required: true,
      ...field
    }))
  };
}
