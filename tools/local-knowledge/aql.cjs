// Every query is static and all caller-controlled values are bind parameters.
// Space filters are intentionally retained even though each space has its own database.
const AQL = Object.freeze({
  findReceipt: `
    FOR receipt IN operation_receipts
      FILTER receipt.spaceId == @spaceId AND receipt.operationId == @operationId
      LIMIT 1
      RETURN receipt
  `,
  closeDocumentRevision: `
    FOR document IN documents
      FILTER document.spaceId == @spaceId
      FILTER document.knowledgeBaseId == @knowledgeBaseId
      FILTER document.documentId == @documentId
      FILTER document.activeUntil == null
      UPDATE document WITH { activeUntil: @indexVersion, updatedAt: @now } IN documents
  `,
  closeChunkRevision: `
    FOR chunk IN chunks
      FILTER chunk.spaceId == @spaceId
      FILTER chunk.knowledgeBaseId == @knowledgeBaseId
      FILTER chunk.documentId == @documentId
      FILTER chunk.activeUntil == null
      UPDATE chunk WITH { activeUntil: @indexVersion, updatedAt: @now } IN chunks
  `,
  closeClaimRevision: `
    FOR claim IN claims
      FILTER claim.spaceId == @spaceId
      FILTER claim.knowledgeBaseId == @knowledgeBaseId
      FILTER claim.documentId == @documentId
      FILTER claim.activeUntil == null
      UPDATE claim WITH { activeUntil: @indexVersion, updatedAt: @now } IN claims
  `,
  closeRelationRevision: `
    FOR relation IN relations
      FILTER relation.spaceId == @spaceId
      FILTER relation.knowledgeBaseId == @knowledgeBaseId
      FILTER relation.documentId == @documentId
      FILTER relation.activeUntil == null
      UPDATE relation WITH { activeUntil: @indexVersion, updatedAt: @now } IN relations
  `,
  upsertDocument: `
    UPSERT { _key: @key }
      INSERT @document
      UPDATE @document
      IN documents
    RETURN NEW
  `,
  upsertChunk: `
    UPSERT { _key: @key }
      INSERT @chunk
      UPDATE @chunk
      IN chunks
  `,
  upsertChunks: `
    FOR item IN @chunks
      UPSERT { _key: item._key }
        INSERT item
        UPDATE item
        IN chunks
  `,
  upsertEntity: `
    UPSERT { _key: @key }
      INSERT @entity
      UPDATE {
        name: @entity.name,
        aliases: UNION_DISTINCT(OLD.aliases || [], @entity.aliases || []),
        mentions: APPEND(OLD.mentions || [], @entity.mentions || [], true),
        updatedAt: @entity.updatedAt
      }
      IN entities
  `,
  upsertEntities: `
    FOR item IN @entities
      UPSERT { _key: item._key }
        INSERT item
        UPDATE {
          name: item.name,
          aliases: UNION_DISTINCT(OLD.aliases || [], item.aliases || []),
          mentions: APPEND(OLD.mentions || [], item.mentions || [], true),
          updatedAt: item.updatedAt
        }
        IN entities
  `,
  upsertClaim: `
    UPSERT { _key: @key }
      INSERT @claim
      UPDATE @claim
      IN claims
  `,
  upsertClaims: `
    FOR item IN @claims
      UPSERT { _key: item._key }
        INSERT item
        UPDATE item
        IN claims
  `,
  upsertRelation: `
    UPSERT { _key: @key }
      INSERT @relation
      UPDATE @relation
      IN relations
  `,
  upsertRelations: `
    FOR item IN @relations
      UPSERT { _key: item._key }
        INSERT item
        UPDATE item
        IN relations
  `,
  upsertReceipt: `
    UPSERT { _key: @key }
      INSERT @receipt
      UPDATE @receipt
      IN operation_receipts
  `,
  candidateChunks: `
    FOR chunk IN chunks
      FILTER chunk.spaceId == @spaceId
      FILTER chunk.knowledgeBaseId IN @knowledgeBaseIds
      FILTER chunk.indexVersion <= @watermarkByBase[chunk.knowledgeBaseId]
      FILTER chunk.activeUntil == null OR chunk.activeUntil > @watermarkByBase[chunk.knowledgeBaseId]
      LIMIT @candidateLimit
      RETURN KEEP(chunk, '_key', 'spaceId', 'knowledgeBaseId', 'documentId', 'documentName', 'indexVersion', 'text', 'page', 'section', 'embedding', 'entityRefs')
  `,
  eligibleChunkCount: `
    RETURN LENGTH(
      FOR chunk IN chunks
        FILTER chunk.spaceId == @spaceId
        FILTER chunk.knowledgeBaseId IN @knowledgeBaseIds
        FILTER chunk.indexVersion <= @watermarkByBase[chunk.knowledgeBaseId]
        FILTER chunk.activeUntil == null OR chunk.activeUntil > @watermarkByBase[chunk.knowledgeBaseId]
        RETURN 1
    )
  `,
  exactVectorChunks: `
    FOR chunk IN chunks
      FILTER chunk.spaceId == @spaceId
      FILTER chunk.knowledgeBaseId IN @knowledgeBaseIds
      FILTER chunk.indexVersion <= @watermarkByBase[chunk.knowledgeBaseId]
      FILTER chunk.activeUntil == null OR chunk.activeUntil > @watermarkByBase[chunk.knowledgeBaseId]
      LET score = COSINE_SIMILARITY(chunk.embedding, @queryVector)
      SORT score DESC
      LIMIT @candidateLimit
      RETURN MERGE(KEEP(chunk, '_key', 'knowledgeBaseId', 'documentId', 'documentName', 'text', 'page', 'section', 'entityRefs'), { channelScore: score })
  `,
  annVectorChunks: `
    FOR chunk IN chunks
      LET score = APPROX_NEAR_COSINE(chunk.embedding, @queryVector)
      SORT score DESC
      LIMIT @annProbeLimit
      FILTER chunk.spaceId == @spaceId
      FILTER chunk.knowledgeBaseId IN @knowledgeBaseIds
      FILTER chunk.indexVersion <= @watermarkByBase[chunk.knowledgeBaseId]
      FILTER chunk.activeUntil == null OR chunk.activeUntil > @watermarkByBase[chunk.knowledgeBaseId]
      LIMIT @candidateLimit
      RETURN MERGE(KEEP(chunk, '_key', 'knowledgeBaseId', 'documentId', 'documentName', 'text', 'page', 'section', 'entityRefs'), { channelScore: score })
  `,
  lexicalChunks: `
    FOR chunk IN chunks_search
      SEARCH ANALYZER(chunk.text IN TOKENS(@query, @analyzer), @analyzer)
      FILTER chunk.spaceId == @spaceId
      FILTER chunk.knowledgeBaseId IN @knowledgeBaseIds
      FILTER chunk.indexVersion <= @watermarkByBase[chunk.knowledgeBaseId]
      FILTER chunk.activeUntil == null OR chunk.activeUntil > @watermarkByBase[chunk.knowledgeBaseId]
      LET score = BM25(chunk)
      SORT score DESC
      LIMIT @candidateLimit
      RETURN MERGE(KEEP(chunk, '_key', 'knowledgeBaseId', 'documentId', 'documentName', 'text', 'page', 'section', 'entityRefs'), { channelScore: score })
  `,
  entitySeeds: `
    LET terms = TOKENS(@query, @analyzer)
    FOR entity IN entities
      FILTER entity.spaceId == @spaceId
      FILTER entity.knowledgeBaseId IN @knowledgeBaseIds
      LET haystack = LOWER(CONCAT_SEPARATOR(' ', entity.name, CONCAT_SEPARATOR(' ', entity.aliases || [])))
      LET matches = LENGTH(terms[* FILTER CONTAINS(haystack, CURRENT)])
      FILTER matches > 0
      SORT matches DESC, entity.name ASC
      LIMIT @seedLimit
      RETURN entity._key
  `,
  graphNeighbors1: `
    FOR relation IN relations
      FILTER relation.spaceId == @spaceId
      FILTER relation.knowledgeBaseId IN @knowledgeBaseIds
      FILTER relation.indexVersion <= @watermarkByBase[relation.knowledgeBaseId]
      FILTER relation.activeUntil == null OR relation.activeUntil > @watermarkByBase[relation.knowledgeBaseId]
      FILTER relation.confidence >= @minConfidence
      LET source = PARSE_IDENTIFIER(relation._from).key
      LET target = PARSE_IDENTIFIER(relation._to).key
      FILTER source IN @seedKeys OR target IN @seedKeys
      LET neighbor = source IN @seedKeys ? target : source
      LIMIT @breadth
      RETURN DISTINCT neighbor
  `,
  graphNeighbors2: `
    LET first = (
      FOR relation IN relations
        FILTER relation.spaceId == @spaceId
        FILTER relation.knowledgeBaseId IN @knowledgeBaseIds
        FILTER relation.indexVersion <= @watermarkByBase[relation.knowledgeBaseId]
        FILTER relation.activeUntil == null OR relation.activeUntil > @watermarkByBase[relation.knowledgeBaseId]
        FILTER relation.confidence >= @minConfidence
        LET source = PARSE_IDENTIFIER(relation._from).key
        LET target = PARSE_IDENTIFIER(relation._to).key
        FILTER source IN @seedKeys OR target IN @seedKeys
        LIMIT @breadth
        RETURN DISTINCT (source IN @seedKeys ? target : source)
    )
    FOR relation IN relations
      FILTER relation.spaceId == @spaceId
      FILTER relation.knowledgeBaseId IN @knowledgeBaseIds
      FILTER relation.indexVersion <= @watermarkByBase[relation.knowledgeBaseId]
      FILTER relation.activeUntil == null OR relation.activeUntil > @watermarkByBase[relation.knowledgeBaseId]
      FILTER relation.confidence >= @minConfidence
      LET source = PARSE_IDENTIFIER(relation._from).key
      LET target = PARSE_IDENTIFIER(relation._to).key
      FILTER source IN first OR target IN first
      LET neighbor = source IN first ? target : source
      LIMIT @breadth
      RETURN DISTINCT neighbor
  `,
  graphChunks: `
    FOR chunk IN chunks
      FILTER chunk.spaceId == @spaceId
      FILTER chunk.knowledgeBaseId IN @knowledgeBaseIds
      FILTER chunk.indexVersion <= @watermarkByBase[chunk.knowledgeBaseId]
      FILTER chunk.activeUntil == null OR chunk.activeUntil > @watermarkByBase[chunk.knowledgeBaseId]
      LET overlap = LENGTH(INTERSECTION(chunk.entityRefs || [], @entityKeys))
      FILTER overlap > 0
      SORT overlap DESC
      LIMIT @candidateLimit
      RETURN MERGE(KEEP(chunk, '_key', 'knowledgeBaseId', 'documentId', 'documentName', 'text', 'page', 'section', 'entityRefs'), { channelScore: overlap })
  `,
  purgeTargetCounts: `
    RETURN {
      documents: LENGTH(FOR document IN documents
        FILTER document.spaceId == @spaceId
        FILTER document.knowledgeBaseId == @knowledgeBaseId
        FILTER @documentId == null OR document.documentId == @documentId
        RETURN 1),
      chunks: LENGTH(FOR chunk IN chunks
        FILTER chunk.spaceId == @spaceId
        FILTER chunk.knowledgeBaseId == @knowledgeBaseId
        FILTER @documentId == null OR chunk.documentId == @documentId
        RETURN 1),
      claims: LENGTH(FOR claim IN claims
        FILTER claim.spaceId == @spaceId
        FILTER claim.knowledgeBaseId == @knowledgeBaseId
        FILTER @documentId == null OR claim.documentId == @documentId
        RETURN 1),
      relations: LENGTH(FOR relation IN relations
        FILTER relation.spaceId == @spaceId
        FILTER relation.knowledgeBaseId == @knowledgeBaseId
        FILTER @documentId == null OR relation.documentId == @documentId
        RETURN 1)
    }
  `,
  purgeRelations: `
    FOR relation IN relations
      FILTER relation.spaceId == @spaceId
      FILTER relation.knowledgeBaseId == @knowledgeBaseId
      FILTER @documentId == null OR relation.documentId == @documentId
      REMOVE relation IN relations OPTIONS { waitForSync: true }
  `,
  purgeClaims: `
    FOR claim IN claims
      FILTER claim.spaceId == @spaceId
      FILTER claim.knowledgeBaseId == @knowledgeBaseId
      FILTER @documentId == null OR claim.documentId == @documentId
      REMOVE claim IN claims OPTIONS { waitForSync: true }
  `,
  purgeChunks: `
    FOR chunk IN chunks
      FILTER chunk.spaceId == @spaceId
      FILTER chunk.knowledgeBaseId == @knowledgeBaseId
      FILTER @documentId == null OR chunk.documentId == @documentId
      REMOVE chunk IN chunks OPTIONS { waitForSync: true }
  `,
  purgeDocuments: `
    FOR document IN documents
      FILTER document.spaceId == @spaceId
      FILTER document.knowledgeBaseId == @knowledgeBaseId
      FILTER @documentId == null OR document.documentId == @documentId
      REMOVE document IN documents OPTIONS { waitForSync: true }
  `,
  purgeIndexReceipts: `
    FOR receipt IN operation_receipts
      FILTER receipt.spaceId == @spaceId
      FILTER receipt.type == 'index'
      FILTER receipt.knowledgeBaseId == @knowledgeBaseId
      FILTER @documentId == null OR receipt.documentId == @documentId
      REMOVE receipt IN operation_receipts OPTIONS { waitForSync: true }
  `,
  pruneEntityMentions: `
    FOR entity IN entities
      FILTER entity.spaceId == @spaceId
      FILTER entity.knowledgeBaseId == @knowledgeBaseId
      LET retained = (
        FOR mention IN entity.mentions || []
          FILTER @documentId != null AND mention.documentId != @documentId
          RETURN mention
      )
      LET retainedNames = UNIQUE(retained[*].quote)
      UPDATE entity WITH {
        mentions: retained,
        name: LENGTH(retainedNames) > 0 ? FIRST(retainedNames) : entity.name,
        aliases: retainedNames,
        updatedAt: @now
      } IN entities
  `,
  removeUnsupportedEntities: `
    FOR entity IN entities
      FILTER entity.spaceId == @spaceId
      FILTER entity.knowledgeBaseId == @knowledgeBaseId
      FILTER LENGTH(entity.mentions || []) == 0
      REMOVE entity IN entities
  `,
  graphSnapshot: `
    LET refs = UNIQUE(FLATTEN(
      FOR chunk IN chunks
        FILTER chunk.spaceId == @spaceId
        FILTER chunk.knowledgeBaseId == @knowledgeBaseId
        FILTER chunk.indexVersion <= @indexVersion
        FILTER chunk.activeUntil == null OR chunk.activeUntil > @indexVersion
        RETURN chunk.entityRefs || []
    ))
    LET nodes = (
      FOR entity IN entities
        FILTER entity.spaceId == @spaceId
        FILTER entity.knowledgeBaseId == @knowledgeBaseId
        FILTER entity._key IN refs
        SORT entity.name ASC
        LIMIT @limit
        RETURN MERGE(KEEP(entity, '_key', 'type', 'name', 'aliases'), {
          supportingSourceCount: LENGTH(UNIQUE((entity.mentions || [])[*].documentId))
        })
    )
    LET nodeKeys = nodes[*]._key
    LET edges = (
      FOR relation IN relations
        FILTER relation.spaceId == @spaceId
        FILTER relation.knowledgeBaseId == @knowledgeBaseId
        FILTER relation.indexVersion <= @indexVersion
        FILTER relation.activeUntil == null OR relation.activeUntil > @indexVersion
        FILTER PARSE_IDENTIFIER(relation._from).key IN nodeKeys
        FILTER PARSE_IDENTIFIER(relation._to).key IN nodeKeys
        LIMIT @edgeLimit
        RETURN {
          id: relation._key,
          source: PARSE_IDENTIFIER(relation._from).key,
          target: PARSE_IDENTIFIER(relation._to).key,
          type: relation.type,
          confidence: relation.confidence,
          supports: SLICE((relation.mentions || [])[* RETURN KEEP(CURRENT, 'documentId', 'documentName', 'sourceRef', 'quote', 'page', 'section')], 0, 5)
        }
    )
    RETURN { nodes, edges }
  `,
  collectionCounts: `
    RETURN {
      documents: LENGTH(documents),
      chunks: LENGTH(chunks),
      entities: LENGTH(entities),
      claims: LENGTH(claims),
      relations: LENGTH(relations)
    }
  `,
  nextIndexVersion: `
    LET versions = (
      FOR document IN documents
        FILTER document.spaceId == @spaceId
        FILTER document.knowledgeBaseId == @knowledgeBaseId
        RETURN document.indexVersion
    )
    RETURN (LENGTH(versions) == 0 ? 1 : MAX(versions) + 1)
  `,
});

module.exports = { AQL };
