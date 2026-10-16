const { AQL } = require('./aql.cjs');

const NOMIC_COLLECTION = 'experience_chunks_nomic_v1';
// Reuse the version-filtered, receipt-aware queries without sharing an embedding
// collection or vector index with GTE, Azure, or Qwen.
const NOMIC_AQL = Object.freeze({ ...Object.fromEntries(Object.entries(AQL).map(([name, query]) => [
  name, query.replaceAll('experience_chunks_gte_v1', NOMIC_COLLECTION)
    .replaceAll("'gte-node'", "'nomic-node'"),
])), candidateVectors: `FOR chunk IN experience_chunks_nomic_v1
  FILTER chunk._key IN @keys AND chunk.spaceId == @spaceId
  FILTER chunk.knowledgeBaseId IN @knowledgeBaseIds
  FILTER chunk.indexVersion <= @watermarkByBase[chunk.knowledgeBaseId]
  FILTER chunk.activeUntil == null OR chunk.activeUntil > @watermarkByBase[chunk.knowledgeBaseId]
    OR (chunk.supersededByReceiptKey != null AND DOCUMENT('operation_receipts',chunk.supersededByReceiptKey) == null)
  FILTER chunk.receiptKey == null OR DOCUMENT('operation_receipts',chunk.receiptKey) != null
  FILTER chunk.embeddingProvider == 'nomic-node' AND chunk.vectorIndexVersion == @vectorIndexVersion
  LIMIT 80 RETURN {key:chunk._key,embedding:chunk.embedding}` });

module.exports = { NOMIC_COLLECTION, NOMIC_AQL };
