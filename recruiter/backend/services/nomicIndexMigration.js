const crypto = require('node:crypto');
const { NOMIC_PROFILE } = require('../config/embeddingRuntimeConfig');
const ELIGIBLE_CANDIDATES = { publicApplicationCommitState: { $nin: ['provisional', 'committing'] }, deletionState: { $ne: 'tombstoned' } };
const MAX_RECORDS = 10000;
const sourceHash = text => crypto.createHash('sha256').update(text).digest('hex');

async function ensureSchemas(client, config) {
  const schemas = (await client.schema.getter().do()).classes;
  for (const [legacy, target] of [['Candidate', config.candidateClass], ['Job', config.jobClass]]) {
    const existing = schemas.find(item => item.class === target);
    if (existing) {
      if (existing.description !== NOMIC_PROFILE.vectorIndexVersion || existing.vectorizer !== 'none' || existing.vectorIndexConfig?.distance !== 'cosine') throw new Error('Existing Nomic class has an incompatible profile.');
      continue;
    }
    const original = schemas.find(item => item.class === legacy);
    if (!original) throw new Error('Original Recruiter schema is missing.');
    await client.schema.classCreator().withClass({ class: target, description: NOMIC_PROFILE.vectorIndexVersion,
      vectorizer: 'none', vectorIndexType: 'hnsw', vectorIndexConfig: { distance: 'cosine', efConstruction: 128, ef: 64 },
      properties: [...original.properties.map(item => ({ ...item })), { name: 'embeddingProfile', dataType: ['text'], tokenization: 'field' }, { name: 'embeddingSourceHash', dataType: ['text'], tokenization: 'field' }],
    }).do();
  }
}

async function migrateNomicIndex({ db, service, store, config }) {
  if (config.provider !== 'nomic-node') throw new Error('Nomic migration requires the pinned local provider.');
  await service.generateEmbedding('Recruiter local embedding migration readiness probe');
  await ensureSchemas(store.client, config);
  const plans = [
    { collection: 'candidates', filter: ELIGIBLE_CANDIDATES, className: config.candidateClass, idField: 'candidateId', text: row => service.createCandidateEmbeddingText(row), write: row => service.createCandidateEmbedding(row) },
    { collection: 'jobs', filter: {}, className: config.jobClass, idField: 'jobId', text: row => service.createJobEmbeddingText(row), write: row => service.createJobEmbedding(row) },
  ];
  const flagUpdates = [];
  const proof = { provider: NOMIC_PROFILE, candidates: 0, jobs: 0, written: 0, unchanged: 0, removedOrphans: 0, originalsRetained: true };
  for (const plan of plans) {
    const readSource = async () => {
      const rows = await db.collection(plan.collection).find(plan.filter).sort({ _id: 1 }).limit(MAX_RECORDS + 1).toArray();
      if (rows.length > MAX_RECORDS) throw new Error('Recruiter migration exceeds its bounded record limit.');
      return rows.map(row => {
        if (!row.organization || !/^[a-f0-9]{24}$/i.test(String(row._id))) throw new Error('Canonical Recruiter record has no valid tenant or identity.');
        const text = plan.text(row);
        if (!text.trim()) throw new Error('Canonical Recruiter record has no embedding text.');
        return { row, id: String(row._id), tenant: String(row.organization), hash: sourceHash(text) };
      });
    };
    const signature = rows => sourceHash(JSON.stringify(rows.map(item => [item.id, item.tenant, item.hash])));
    const before = await readSource();
    const count = await store.client.graphql.aggregate().withClassName(plan.className).withFields('meta { count }').do();
    if (Number(count.data?.Aggregate?.[plan.className]?.[0]?.meta?.count) > MAX_RECORDS) throw new Error('Recruiter target index exceeds its bounded record limit.');
    const existing = (await store.client.data.getter().withClassName(plan.className).withLimit(MAX_RECORDS).withVector().do()).objects || [];
    const byId = new Map(existing.map(item => [item.properties[plan.idField], item]));
    const valid = (item, row) => item?.properties.embeddingSourceHash === row.hash && item.properties.embeddingProfile === NOMIC_PROFILE.vectorIndexVersion && item.properties.organizationId === row.tenant && Array.isArray(item.vector) && item.vector.length === 768 && item.vector.every(Number.isFinite);
    for (const row of before) {
      if (valid(byId.get(row.id), row)) proof.unchanged++;
      else { await plan.write(row.row); proof.written++; }
    }
    const expected = new Set(before.map(row => row.id));
    for (const orphan of existing.filter(item => !expected.has(item.properties[plan.idField]))) {
      await store.client.data.deleter().withClassName(plan.className).withId(orphan.id).do(); proof.removedOrphans++;
    }
    const after = await readSource();
    if (signature(before) !== signature(after)) throw new Error('Canonical Recruiter data changed during migration; rerun before cutover.');
    const verified = (await store.client.data.getter().withClassName(plan.className).withLimit(MAX_RECORDS).withVector().do()).objects || [];
    const verifiedById = new Map(verified.map(item => [item.properties[plan.idField], item]));
    if (verified.length !== after.length || after.some(row => !valid(verifiedById.get(row.id), row))) throw new Error('Nomic index verification failed; refusing cutover.');
    flagUpdates.push({ collection: plan.collection, filter: plan.filter, ids: after.map(item => item.row._id) });
    proof[plan.collection] = after.length;
    proof[`${plan.collection}SourceFingerprint`] = signature(after);
  }
  // Update only operational readiness flags after every collection verifies.
  // Existing profile fields and historical creation dates remain untouched.
  proof.embeddingFlagsUpdated = 0;
  for (const plan of flagUpdates) {
    const result = await db.collection(plan.collection).updateMany({ ...plan.filter, _id: { $in: plan.ids }, isEmbedded: { $ne: true } }, { $set: { isEmbedded: true, embeddingCreatedAt: new Date() } });
    proof.embeddingFlagsUpdated += result.modifiedCount || 0;
  }
  return proof;
}
module.exports = { ensureSchemas, migrateNomicIndex, sourceHash, ELIGIBLE_CANDIDATES };
