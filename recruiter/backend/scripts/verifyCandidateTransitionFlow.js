const assert = require('assert');
const fs = require('fs');
const Module = require('module');
const path = require('path');
const { computeCandidateNextAction } = require('../services/onboardingWorkflowService');

const onboarding = {
  _id: 'transition1',
  processType: 'onboarding',
  candidateAccount: 'candidateAccount1',
  status: 'in_progress'
};

const workflowItems = [
  {
    _id: 'workflowForm',
    type: 'form',
    ownerType: 'candidate',
    sourceId: 'form1',
    order: 10,
    status: 'pending'
  },
  {
    _id: 'workflowDocuments',
    type: 'document',
    ownerType: 'candidate',
    sourceId: 'envelope1',
    order: 20,
    status: 'pending'
  },
  {
    _id: 'workflowSecondEnvelope',
    type: 'document',
    ownerType: 'candidate',
    sourceId: 'envelope2',
    order: 30,
    status: 'pending'
  }
];

function envelope(id, documents) {
  return {
    _id: id,
    status: 'sent',
    signers: [
      {
        role: 'candidate',
        candidateAccount: 'candidateAccount1',
        order: 1,
        status: 'viewed'
      }
    ],
    documents
  };
}

function fillDocument(id, title, status = 'pending') {
  return {
    _id: id,
    title,
    status,
    signatureFields: [
      { role: 'candidate', type: 'text' }
    ]
  };
}

function signatureDocument(id, title, status = 'pending') {
  return {
    _id: id,
    title,
    status,
    signatureFields: [
      { role: 'candidate', type: 'signature' }
    ]
  };
}

function nextAction({ formStatus = 'draft', envelopes }) {
  return computeCandidateNextAction({
    onboarding,
    workflowItems,
    formSubmissions: [
      {
        _id: 'form1',
        title: 'Personal details',
        status: formStatus
      }
    ],
    envelopes
  });
}

const firstEnvelope = envelope('envelope1', [
  fillDocument('biodataDocument', 'Biodata'),
  signatureDocument('agreementDocument', 'Agreement')
]);
const secondEnvelope = envelope('envelope2', [
  fillDocument('bankDocument', 'Bank details')
]);

assert.deepStrictEqual(
  pick(nextAction({ envelopes: [firstEnvelope, secondEnvelope] })),
  { type: 'form', href: '/forms/form1' },
  'draft candidate form should be the first action'
);

assert.deepStrictEqual(
  pick(nextAction({ formStatus: 'approved', envelopes: [firstEnvelope, secondEnvelope] })),
  { type: 'document_fill', href: '/documents/biodataDocument/sign' },
  'first pending document should be selected after form completion'
);

assert.deepStrictEqual(
  pick(nextAction({
    formStatus: 'approved',
    envelopes: [
      envelope('envelope1', [
        fillDocument('biodataDocument', 'Biodata', 'completed'),
        signatureDocument('agreementDocument', 'Agreement')
      ]),
      secondEnvelope
    ]
  })),
  { type: 'document_sign', href: '/documents/agreementDocument/sign' },
  'signature document should follow the completed fill-only document'
);

assert.deepStrictEqual(
  pick(nextAction({
    formStatus: 'approved',
    envelopes: [
      envelope('envelope1', [
        fillDocument('biodataDocument', 'Biodata', 'completed'),
        signatureDocument('agreementDocument', 'Agreement', 'completed')
      ]),
      secondEnvelope
    ]
  })),
  { type: 'document_fill', href: '/documents/bankDocument/sign' },
  'next envelope should follow completed documents in the first envelope'
);

const { findNextPendingCandidateDocumentId } = loadCandidatePortalHelpers();
const candidateSigner = {
  role: 'candidate',
  candidateAccount: 'candidateAccount1',
  order: 1,
  status: 'viewed'
};
const routeEnvelope = {
  status: 'sent',
  signers: [candidateSigner],
  documents: [
    fillDocument('firstFillDocument', 'First fill document', 'completed'),
    {
      _id: 'autoOnlyDocument',
      title: 'Auto stamped only',
      status: 'pending',
      signatureFields: [{ role: 'candidate', type: 'date' }]
    },
    signatureDocument('secondSignatureDocument', 'Second signature document')
  ]
};

assert.strictEqual(
  findNextPendingCandidateDocumentId(routeEnvelope, routeEnvelope.documents[0], candidateSigner),
  'secondSignatureDocument',
  'route nextDocumentId should skip auto-only documents and continue to the next candidate-actionable document'
);

routeEnvelope.documents[2].status = 'completed';
assert.strictEqual(
  findNextPendingCandidateDocumentId(routeEnvelope, routeEnvelope.documents[2], candidateSigner),
  null,
  'route nextDocumentId should be null when no candidate-actionable document remains'
);

console.log('Candidate transition next-action flow verified.');

function pick(action) {
  return {
    type: action?.type,
    href: action?.href
  };
}

function loadCandidatePortalHelpers() {
  const routePath = path.resolve(__dirname, '../routes/candidatePortal.js');
  const source = fs.readFileSync(routePath, 'utf8').replace(
    /module\.exports = router;\s*$/,
    'module.exports = { findNextPendingCandidateDocumentId };'
  );
  const routeModule = { exports: {} };
  const routeRequire = Module.createRequire(routePath);
  const runRoute = new Function('exports', 'require', 'module', '__filename', '__dirname', source);
  const originalLog = console.log;
  const originalError = console.error;
  try {
    console.log = () => {};
    console.error = () => {};
    runRoute(routeModule.exports, routeRequire, routeModule, routePath, path.dirname(routePath));
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
  return routeModule.exports;
}
