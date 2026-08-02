const test = require('node:test');
const assert = require('node:assert/strict');

process.env.REDIS_ENABLED = 'false';
process.env.LEGACY_BULK_STATUS_POLL_MS = '1';

const bulkUploadService = require('../services/bulkUploadService');

test.afterEach(() => {
  bulkUploadService._resetDependenciesForTests();
});

test('legacy bulk jobs migrate into the durable CV queue and wait for its terminal result', async () => {
  let submittedRequest;
  let reads = 0;
  bulkUploadService._setDependenciesForTests({
    submitDurableUpload: async (req) => {
      submittedRequest = req;
      return {
        job: { publicId: 'cv_durable_123' },
        statusToken: 'status-token'
      };
    },
    readDurableStatus: async (publicId, statusToken) => {
      assert.equal(publicId, 'cv_durable_123');
      assert.equal(statusToken, 'status-token');
      reads += 1;
      return reads === 1
        ? { state: 'processing', progress: 60 }
        : {
          state: 'completed',
          progress: 100,
          candidateId: 'candidate-123',
          candidate: { firstName: 'Ada', lastName: 'Lovelace' }
        };
    }
  });
  const progress = [];
  const result = await bulkUploadService._migrateLegacyJobForTests({
    id: 'legacy-42',
    data: {
      filePath: 'missing-but-idempotent.pdf',
      fileType: 'application/pdf',
      originalName: 'ada.pdf',
      organizationId: 'organization-1',
      userId: 'user-1'
    },
    updateProgress: async (value) => progress.push(value)
  });

  assert.equal(submittedRequest.user.currentOrganization, 'organization-1');
  assert.equal(submittedRequest.get('Idempotency-Key'), 'legacy-bulk:legacy-42');
  assert.equal(result.durableJobId, 'cv_durable_123');
  assert.equal(result.candidateId, 'candidate-123');
  assert.equal(result.candidateName, 'Ada Lovelace');
  assert.deepEqual(progress, [10, 60, 100]);
});

test('legacy migration never imports or invokes the former direct inference pipeline', () => {
  const source = require('fs').readFileSync(
    require.resolve('../services/bulkUploadService'),
    'utf8'
  );
  assert.doesNotMatch(source, /CVParsingService|analyzeText|runWithGlobalInferencePermit|new Candidate/);
  assert.match(source, /submitUpload\(req, 'bulk'\)/);
  assert.match(source, /inference remains in cv-analysis-local/);
});
