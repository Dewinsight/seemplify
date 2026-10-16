const test = require('node:test');
const assert = require('node:assert/strict');
const { migrateNomicIndex, sourceHash, ELIGIBLE_CANDIDATES } = require('../services/nomicIndexMigration');
const { embeddingSourceHash } = require('../services/nomicEmbeddingClient');
const { NOMIC_PROFILE } = require('../config/embeddingRuntimeConfig');
const config = { ...NOMIC_PROFILE, candidateClass: 'RecruiterCandidateNomicV1', jobClass: 'RecruiterJobNomicV1' };
function fixture({ changedSource = false, wrongDimension = false } = {}) {
  const schemas = ['Candidate', 'Job'].map(className => ({ class: className, properties: [] }));
  const rows = { candidates: [{ _id: 'a'.repeat(24), organization: 'tenant1', text: 'candidate evidence' }], jobs: [{ _id: 'b'.repeat(24), organization: 'tenant1', text: 'job requirements' }] };
  const objects = new Map([[config.candidateClass, []], [config.jobClass, []]]);
  let reads = 0; let capturedFilter;
  const db = { collection: name => ({ updateMany: async (filter, update) => { assert.ok(filter._id.$in.length); assert.equal(update.$set.isEmbedded, true); return { modifiedCount: 0 }; }, find: filter => { capturedFilter = name === 'candidates' ? filter : capturedFilter; const cursor = { sort: () => cursor, limit: () => cursor, toArray: async () => { reads++; return rows[name].map(row => ({ ...row, text: changedSource && reads > 1 ? 'changed input' : row.text })); } }; return cursor; } }) };
  function builder(kind) { let className; const chain = { withClassName: value => { className = value; return chain; }, withLimit: () => chain, withVector: () => chain, withFields: () => chain, do: async () => kind === 'aggregate' ? { data: { Aggregate: { [className]: [{ meta: { count: objects.get(className).length } }] } } } : { objects: objects.get(className) } }; return chain; }
  const store = { client: { schema: { getter: () => ({ do: async () => ({ classes: schemas }) }), classCreator: () => ({ withClass: schema => ({ do: async () => schemas.push(schema) }) }) }, data: { getter: () => builder('get'), deleter: () => { throw new Error('No original object may be deleted'); } }, graphql: { aggregate: () => builder('aggregate') } } };
  const write = (row, className, idField) => { const item = { id: row._id, properties: { [idField]: row._id, organizationId: row.organization, embeddingSourceHash: embeddingSourceHash(row.text), embeddingProfile: config.vectorIndexVersion }, vector: Array(wrongDimension ? 3072 : 768).fill(0) }; const list = objects.get(className); const index = list.findIndex(item => item.properties[idField] === row._id); if (index < 0) list.push(item); else list[index] = item; };
  const service = { generateEmbedding: async () => Array(768).fill(0), createCandidateEmbeddingText: row => row.text, createJobEmbeddingText: row => row.text, createCandidateEmbedding: async row => write(row, config.candidateClass, 'candidateId'), createJobEmbedding: async row => write(row, config.jobClass, 'jobId') };
  return { db, service, store, config, schemas, filter: () => capturedFilter };
}
test('migration rebuilds canonical rows into separate indexes and resumes without regenerating verified vectors', async () => {
  const input = fixture(); const first = await migrateNomicIndex(input);
  assert.equal(first.candidates, 1); assert.equal(first.jobs, 1); assert.equal(first.written, 2);
  assert.deepEqual(input.filter(), ELIGIBLE_CANDIDATES); assert.equal(input.schemas.length, 4);
  const second = await migrateNomicIndex(input); assert.equal(second.written, 0); assert.equal(second.unchanged, 2);
  assert.equal(second.candidatesSourceFingerprint, first.candidatesSourceFingerprint);
});
test('migration refuses source changes and mixed old vector dimensions before cutover', async () => {
  await assert.rejects(migrateNomicIndex(fixture({ changedSource: true })), /changed during migration/);
  await assert.rejects(migrateNomicIndex(fixture({ wrongDimension: true })), /verification failed/);
});
