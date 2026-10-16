const { AQL } = require('./aql.cjs');

const NOMIC_COLLECTION = 'experience_chunks_nomic_v1';
// Reuse the version-filtered, receipt-aware queries without sharing an embedding
// collection or vector index with GTE, Azure, or Qwen.
const NOMIC_AQL = Object.freeze(Object.fromEntries(Object.entries(AQL).map(([name, query]) => [
  name, query.replaceAll('experience_chunks_gte_v1', NOMIC_COLLECTION),
])));

module.exports = { NOMIC_COLLECTION, NOMIC_AQL };
