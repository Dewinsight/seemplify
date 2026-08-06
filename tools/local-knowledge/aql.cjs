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
        OR (document.supersededByReceiptKey != null AND DOCUMENT('operation_receipts', document.supersededByReceiptKey) == null)
      UPDATE document WITH { activeUntil: @indexVersion, supersededByReceiptKey: @receiptKey, updatedAt: @now } IN documents
  `,
  closeChunkRevision: `
    FOR chunk IN chunks
      FILTER chunk.spaceId == @spaceId
      FILTER chunk.knowledgeBaseId == @knowledgeBaseId
      FILTER chunk.documentId == @documentId
      FILTER chunk.activeUntil == null
        OR (chunk.supersededByReceiptKey != null AND DOCUMENT('operation_receipts', chunk.supersededByReceiptKey) == null)
        OR (chunk.supersededByReceiptKey != null AND DOCUMENT('operation_receipts', chunk.supersededByReceiptKey) == null)
      UPDATE chunk WITH { activeUntil: @indexVersion, supersededByReceiptKey: @receiptKey, updatedAt: @now } IN chunks
  `,
  closeGteChunkRevision: `
    FOR chunk IN experience_chunks_gte_v1
      FILTER chunk.spaceId == @spaceId
      FILTER chunk.knowledgeBaseId == @knowledgeBaseId
      FILTER chunk.documentId == @documentId
      FILTER chunk.activeUntil == null
        OR (chunk.supersededByReceiptKey != null AND DOCUMENT('operation_receipts', chunk.supersededByReceiptKey) == null)
      UPDATE chunk WITH { activeUntil: @indexVersion, supersededByReceiptKey: @receiptKey, updatedAt: @now } IN experience_chunks_gte_v1
  `,
  closeClaimRevision: `
    FOR claim IN claims
      FILTER claim.spaceId == @spaceId
      FILTER claim.knowledgeBaseId == @knowledgeBaseId
      FILTER claim.documentId == @documentId
      FILTER claim.activeUntil == null
        OR (claim.supersededByReceiptKey != null AND DOCUMENT('operation_receipts', claim.supersededByReceiptKey) == null)
      UPDATE claim WITH { activeUntil: @indexVersion, supersededByReceiptKey: @receiptKey, updatedAt: @now } IN claims
  `,
  closeRelationRevision: `
    FOR relation IN relations
      FILTER relation.spaceId == @spaceId
      FILTER relation.knowledgeBaseId == @knowledgeBaseId
      FILTER relation.documentId == @documentId
      FILTER relation.activeUntil == null
        OR (relation.supersededByReceiptKey != null AND DOCUMENT('operation_receipts', relation.supersededByReceiptKey) == null)
      UPDATE relation WITH { activeUntil: @indexVersion, supersededByReceiptKey: @receiptKey, updatedAt: @now } IN relations
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
  upsertGteChunks: `
    FOR item IN @chunks
      UPSERT { _key: item._key }
        INSERT item
        UPDATE item
        IN experience_chunks_gte_v1
  `,
  upsertGteBackfillChunks: `
    FOR item IN @chunks
      LET source = DOCUMENT('chunks', item._key)
      FILTER source != null
      FILTER source.spaceId == item.spaceId
      FILTER source.knowledgeBaseId == item.knowledgeBaseId
      FILTER source.documentId == item.documentId
      FILTER source.indexVersion == item.indexVersion
      FILTER source.indexVersion == @sourceIndexVersion
      FILTER source.activeUntil == null
        OR (source.supersededByReceiptKey != null AND DOCUMENT('operation_receipts', source.supersededByReceiptKey) == null)
      FILTER source.contentHash == item.contentHash
      FILTER source.sourceSha256 == null OR source.sourceSha256 == item.sourceSha256
      LET sourceProfileMatches = (
        source.embeddingProvider == null AND LENGTH(source.embedding || []) == @sourceEmbeddingDimensions
      ) OR (
        source.embeddingProvider == @sourceEmbeddingProvider
        AND source.embeddingModel == @sourceEmbeddingModel
        AND source.embeddingRevision == @sourceEmbeddingRevision
        AND source.embeddingDtype == @sourceEmbeddingDtype
        AND source.embeddingDimensions == @sourceEmbeddingDimensions
        AND source.vectorIndexVersion == @sourceVectorIndexVersion
      )
      FILTER sourceProfileMatches
      FILTER source.receiptKey == null OR DOCUMENT('operation_receipts', source.receiptKey) != null
      LET sourceDocument = FIRST(
        FOR document IN documents
          FILTER document.spaceId == item.spaceId
          FILTER document.knowledgeBaseId == item.knowledgeBaseId
          FILTER document.documentId == item.documentId
          FILTER document.indexVersion == @sourceIndexVersion
          FILTER document.sha256 == @sourceSha256
          FILTER document.chunkerVersion == @sourceChunkerVersion
          FILTER document.embeddingModel == @sourceEmbeddingModel
          FILTER document.embeddingDimension == @sourceEmbeddingDimensions
          FILTER document.activeUntil == null
            OR (document.supersededByReceiptKey != null AND DOCUMENT('operation_receipts', document.supersededByReceiptKey) == null)
          LIMIT 1
          RETURN document._key
      )
      FILTER sourceDocument != null
      UPSERT { _key: item._key }
        INSERT MERGE(item, { activeUntil: null })
        UPDATE MERGE(item, { activeUntil: null })
        IN experience_chunks_gte_v1
      RETURN NEW._key
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
        OR (chunk.supersededByReceiptKey != null AND DOCUMENT('operation_receipts', chunk.supersededByReceiptKey) == null)
      FILTER chunk.receiptKey == null OR DOCUMENT('operation_receipts', chunk.receiptKey) != null
      LIMIT @candidateLimit
      RETURN KEEP(chunk, '_key', 'spaceId', 'knowledgeBaseId', 'documentId', 'documentName', 'indexVersion', 'text', 'page', 'section', 'embedding', 'entityRefs')
  `,
  scanDocumentChunks: `
    FOR chunk IN chunks
      FILTER chunk.spaceId == @spaceId
      FILTER chunk.knowledgeBaseId == @knowledgeBaseId
      FILTER chunk.documentId == @documentId
      FILTER chunk.indexVersion <= @indexVersion
      FILTER chunk.activeUntil == null OR chunk.activeUntil > @indexVersion
        OR (chunk.supersededByReceiptKey != null AND DOCUMENT('operation_receipts', chunk.supersededByReceiptKey) == null)
      FILTER chunk.receiptKey == null OR DOCUMENT('operation_receipts', chunk.receiptKey) != null
      SORT chunk.ordinal, chunk._key
      LIMIT @offset, @limit
      RETURN KEEP(chunk, '_key', 'knowledgeBaseId', 'documentId', 'documentName', 'indexVersion', 'ordinal', 'text', 'tokenEstimate', 'page', 'section', 'contentHash')
  `,
  eligibleChunkCount: `
    RETURN LENGTH(
      FOR chunk IN chunks
        FILTER chunk.spaceId == @spaceId
        FILTER chunk.knowledgeBaseId IN @knowledgeBaseIds
        FILTER chunk.indexVersion <= @watermarkByBase[chunk.knowledgeBaseId]
        FILTER chunk.activeUntil == null OR chunk.activeUntil > @watermarkByBase[chunk.knowledgeBaseId]
          OR (chunk.supersededByReceiptKey != null AND DOCUMENT('operation_receipts', chunk.supersededByReceiptKey) == null)
        FILTER chunk.receiptKey == null OR DOCUMENT('operation_receipts', chunk.receiptKey) != null
        RETURN 1
    )
  `,
  eligibleGteChunkCount: `
    RETURN LENGTH(
      FOR chunk IN experience_chunks_gte_v1
        FILTER chunk.spaceId == @spaceId
        FILTER chunk.knowledgeBaseId IN @knowledgeBaseIds
        FILTER chunk.indexVersion <= @watermarkByBase[chunk.knowledgeBaseId]
        FILTER chunk.activeUntil == null OR chunk.activeUntil > @watermarkByBase[chunk.knowledgeBaseId]
          OR (chunk.supersededByReceiptKey != null AND DOCUMENT('operation_receipts', chunk.supersededByReceiptKey) == null)
        FILTER chunk.receiptKey == null OR DOCUMENT('operation_receipts', chunk.receiptKey) != null
        FILTER chunk.embeddingProvider == 'gte-node'
        FILTER chunk.vectorIndexVersion == @vectorIndexVersion
        RETURN 1
    )
  `,
  exactVectorChunks: `
    FOR chunk IN chunks
      FILTER chunk.spaceId == @spaceId
      FILTER chunk.knowledgeBaseId IN @knowledgeBaseIds
      FILTER chunk.indexVersion <= @watermarkByBase[chunk.knowledgeBaseId]
      FILTER chunk.activeUntil == null OR chunk.activeUntil > @watermarkByBase[chunk.knowledgeBaseId]
        OR (chunk.supersededByReceiptKey != null AND DOCUMENT('operation_receipts', chunk.supersededByReceiptKey) == null)
      FILTER chunk.receiptKey == null OR DOCUMENT('operation_receipts', chunk.receiptKey) != null
      LET score = COSINE_SIMILARITY(chunk.embedding, @queryVector)
      SORT score DESC
      LIMIT @candidateLimit
      RETURN MERGE(KEEP(chunk, '_key', 'knowledgeBaseId', 'documentId', 'documentName', 'text', 'page', 'section', 'entityRefs'), { channelScore: score })
  `,
  exactGteVectorChunks: `
    FOR chunk IN experience_chunks_gte_v1
      FILTER chunk.spaceId == @spaceId
      FILTER chunk.knowledgeBaseId IN @knowledgeBaseIds
      FILTER chunk.indexVersion <= @watermarkByBase[chunk.knowledgeBaseId]
      FILTER chunk.activeUntil == null OR chunk.activeUntil > @watermarkByBase[chunk.knowledgeBaseId]
        OR (chunk.supersededByReceiptKey != null AND DOCUMENT('operation_receipts', chunk.supersededByReceiptKey) == null)
      FILTER chunk.receiptKey == null OR DOCUMENT('operation_receipts', chunk.receiptKey) != null
      FILTER chunk.embeddingProvider == 'gte-node'
      FILTER chunk.vectorIndexVersion == @vectorIndexVersion
      LET score = COSINE_SIMILARITY(chunk.embedding, @queryVector)
      SORT score DESC
      LIMIT @candidateLimit
      RETURN MERGE(KEEP(chunk, '_key', 'knowledgeBaseId', 'documentId', 'documentName', 'text', 'page', 'section', 'entityRefs'), { channelScore: score })
  `,
  annVectorChunks: `
    FOR chunk IN chunks
      FILTER chunk.spaceId == @spaceId
      FILTER chunk.knowledgeBaseId IN @knowledgeBaseIds
      FILTER chunk.indexVersion <= @watermarkByBase[chunk.knowledgeBaseId]
      FILTER chunk.activeUntil == null OR chunk.activeUntil > @watermarkByBase[chunk.knowledgeBaseId]
        OR (chunk.supersededByReceiptKey != null AND DOCUMENT('operation_receipts', chunk.supersededByReceiptKey) == null)
      FILTER chunk.receiptKey == null OR DOCUMENT('operation_receipts', chunk.receiptKey) != null
      LET score = APPROX_NEAR_COSINE(chunk.embedding, @queryVector)
      SORT score DESC
      LIMIT @annProbeLimit
      LIMIT @candidateLimit
      RETURN MERGE(KEEP(chunk, '_key', 'knowledgeBaseId', 'documentId', 'documentName', 'text', 'page', 'section', 'entityRefs'), { channelScore: score })
  `,
  annGteVectorChunks: `
    FOR chunk IN experience_chunks_gte_v1
      FILTER chunk.spaceId == @spaceId
      FILTER chunk.knowledgeBaseId IN @knowledgeBaseIds
      FILTER chunk.indexVersion <= @watermarkByBase[chunk.knowledgeBaseId]
      FILTER chunk.activeUntil == null OR chunk.activeUntil > @watermarkByBase[chunk.knowledgeBaseId]
        OR (chunk.supersededByReceiptKey != null AND DOCUMENT('operation_receipts', chunk.supersededByReceiptKey) == null)
      FILTER chunk.receiptKey == null OR DOCUMENT('operation_receipts', chunk.receiptKey) != null
      FILTER chunk.embeddingProvider == 'gte-node'
      FILTER chunk.vectorIndexVersion == @vectorIndexVersion
      LET score = APPROX_NEAR_COSINE(chunk.embedding, @queryVector)
      SORT score DESC
      LIMIT @annProbeLimit
      LIMIT @candidateLimit
      RETURN MERGE(KEEP(chunk, '_key', 'knowledgeBaseId', 'documentId', 'documentName', 'text', 'page', 'section', 'entityRefs'), { channelScore: score })
  `,
  lexicalChunks: `
    FOR chunk IN chunks_search
      SEARCH ANALYZER(chunk.text IN TOKENS(@query, @analyzer), @analyzer)
      FILTER chunk.embeddingProvider == @embeddingProvider
      FILTER chunk.spaceId == @spaceId
      FILTER chunk.knowledgeBaseId IN @knowledgeBaseIds
      FILTER chunk.indexVersion <= @watermarkByBase[chunk.knowledgeBaseId]
      FILTER chunk.activeUntil == null OR chunk.activeUntil > @watermarkByBase[chunk.knowledgeBaseId]
        OR (chunk.supersededByReceiptKey != null AND DOCUMENT('operation_receipts', chunk.supersededByReceiptKey) == null)
      FILTER chunk.receiptKey == null OR DOCUMENT('operation_receipts', chunk.receiptKey) != null
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
        OR (relation.supersededByReceiptKey != null AND DOCUMENT('operation_receipts', relation.supersededByReceiptKey) == null)
      FILTER relation.receiptKey == null OR DOCUMENT('operation_receipts', relation.receiptKey) != null
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
          OR (relation.supersededByReceiptKey != null AND DOCUMENT('operation_receipts', relation.supersededByReceiptKey) == null)
        FILTER relation.receiptKey == null OR DOCUMENT('operation_receipts', relation.receiptKey) != null
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
        OR (relation.supersededByReceiptKey != null AND DOCUMENT('operation_receipts', relation.supersededByReceiptKey) == null)
      FILTER relation.receiptKey == null OR DOCUMENT('operation_receipts', relation.receiptKey) != null
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
        OR (chunk.supersededByReceiptKey != null AND DOCUMENT('operation_receipts', chunk.supersededByReceiptKey) == null)
        OR (chunk.supersededByReceiptKey != null AND DOCUMENT('operation_receipts', chunk.supersededByReceiptKey) == null)
      FILTER chunk.receiptKey == null OR DOCUMENT('operation_receipts', chunk.receiptKey) != null
      LET overlap = LENGTH(INTERSECTION(chunk.entityRefs || [], @entityKeys))
      FILTER overlap > 0
      SORT overlap DESC
      LIMIT @candidateLimit
      RETURN MERGE(KEEP(chunk, '_key', 'knowledgeBaseId', 'documentId', 'documentName', 'text', 'page', 'section', 'entityRefs'), { channelScore: overlap })
  `,
  graphGteChunks: `
    FOR chunk IN experience_chunks_gte_v1
      FILTER chunk.spaceId == @spaceId
      FILTER chunk.knowledgeBaseId IN @knowledgeBaseIds
      FILTER chunk.indexVersion <= @watermarkByBase[chunk.knowledgeBaseId]
      FILTER chunk.activeUntil == null OR chunk.activeUntil > @watermarkByBase[chunk.knowledgeBaseId]
        OR (chunk.supersededByReceiptKey != null AND DOCUMENT('operation_receipts', chunk.supersededByReceiptKey) == null)
      FILTER chunk.receiptKey == null OR DOCUMENT('operation_receipts', chunk.receiptKey) != null
      FILTER chunk.embeddingProvider == 'gte-node'
      FILTER chunk.vectorIndexVersion == @vectorIndexVersion
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
  purgeGteTargetCount: `
    RETURN LENGTH(FOR chunk IN experience_chunks_gte_v1
      FILTER chunk.spaceId == @spaceId
      FILTER chunk.knowledgeBaseId == @knowledgeBaseId
      FILTER @documentId == null OR chunk.documentId == @documentId
      RETURN 1)
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
  purgeGteChunks: `
    FOR chunk IN experience_chunks_gte_v1
      FILTER chunk.spaceId == @spaceId
      FILTER chunk.knowledgeBaseId == @knowledgeBaseId
      FILTER @documentId == null OR chunk.documentId == @documentId
      REMOVE chunk IN experience_chunks_gte_v1 OPTIONS { waitForSync: true }
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
          OR (chunk.supersededByReceiptKey != null AND DOCUMENT('operation_receipts', chunk.supersededByReceiptKey) == null)
        FILTER chunk.receiptKey == null OR DOCUMENT('operation_receipts', chunk.receiptKey) != null
        RETURN chunk.entityRefs || []
    ))
    LET nodes = (
      FOR entity IN entities
        FILTER entity.spaceId == @spaceId
        FILTER entity.knowledgeBaseId == @knowledgeBaseId
        FILTER entity._key IN refs
        LET supportingSourceCount = LENGTH(UNIQUE((entity.mentions || [])[*].documentId))
        SORT supportingSourceCount DESC, entity.name ASC
        LIMIT @limit
        RETURN MERGE(KEEP(entity, '_key', 'type', 'name', 'aliases'), {
          supportingSourceCount
        })
    )
    LET nodeKeys = nodes[*]._key
    LET edges = (
      FOR relation IN relations
        FILTER relation.spaceId == @spaceId
        FILTER relation.knowledgeBaseId == @knowledgeBaseId
        FILTER relation.indexVersion <= @indexVersion
        FILTER relation.activeUntil == null OR relation.activeUntil > @indexVersion
          OR (relation.supersededByReceiptKey != null AND DOCUMENT('operation_receipts', relation.supersededByReceiptKey) == null)
        FILTER relation.receiptKey == null OR DOCUMENT('operation_receipts', relation.receiptKey) != null
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
  gteCollectionCount: `
    RETURN LENGTH(experience_chunks_gte_v1)
  `,
  gteBackfillSourceDocument: `
    FOR document IN documents
      FILTER document.spaceId == @spaceId
      FILTER document.knowledgeBaseId == @knowledgeBaseId
      FILTER document.documentId == @documentId
      FILTER document.indexVersion == @sourceIndexVersion
      FILTER document.sha256 == @sourceSha256
      FILTER document.chunkerVersion == @sourceChunkerVersion
      FILTER document.embeddingModel == @sourceEmbeddingModel
      FILTER document.embeddingDimension == @sourceEmbeddingDimensions
      FILTER document.activeUntil == null
        OR (document.supersededByReceiptKey != null AND DOCUMENT('operation_receipts', document.supersededByReceiptKey) == null)
      FILTER document.receiptKey == null OR DOCUMENT('operation_receipts', document.receiptKey) != null
      LIMIT 1
      RETURN KEEP(document, '_key', 'indexVersion', 'sha256', 'chunkerVersion', 'embeddingModel', 'embeddingDimension')
  `,
  gteBackfillCandidates: `
    FOR chunk IN chunks
      FILTER chunk.spaceId == @spaceId
      FILTER @knowledgeBaseId == null OR chunk.knowledgeBaseId == @knowledgeBaseId
      FILTER @documentId == null OR chunk.documentId == @documentId
      FILTER @sourceIndexVersion == null OR chunk.indexVersion == @sourceIndexVersion
      FILTER chunk.activeUntil == null
        OR (chunk.supersededByReceiptKey != null AND DOCUMENT('operation_receipts', chunk.supersededByReceiptKey) == null)
      FILTER chunk.receiptKey == null OR DOCUMENT('operation_receipts', chunk.receiptKey) != null
      FILTER @sourceSha256 == null OR chunk.sourceSha256 == null OR chunk.sourceSha256 == @sourceSha256
      LET sourceProfileMatches = (
        chunk.embeddingProvider == null AND LENGTH(chunk.embedding || []) == @sourceEmbeddingDimensions
      ) OR (
        chunk.embeddingProvider == @sourceEmbeddingProvider
        AND chunk.embeddingModel == @sourceEmbeddingModel
        AND chunk.embeddingRevision == @sourceEmbeddingRevision
        AND chunk.embeddingDtype == @sourceEmbeddingDtype
        AND chunk.embeddingDimensions == @sourceEmbeddingDimensions
        AND chunk.vectorIndexVersion == @sourceVectorIndexVersion
      )
      FILTER sourceProfileMatches
      LET source = FIRST(
        FOR document IN documents
          FILTER document.spaceId == chunk.spaceId
          FILTER document.knowledgeBaseId == chunk.knowledgeBaseId
          FILTER document.documentId == chunk.documentId
          FILTER document.indexVersion == chunk.indexVersion
          FILTER @sourceSha256 == null OR document.sha256 == @sourceSha256
          FILTER @sourceChunkerVersion == null OR document.chunkerVersion == @sourceChunkerVersion
          FILTER document.embeddingModel == @sourceEmbeddingModel
          FILTER document.embeddingDimension == @sourceEmbeddingDimensions
          FILTER document.activeUntil == null
            OR (document.supersededByReceiptKey != null AND DOCUMENT('operation_receipts', document.supersededByReceiptKey) == null)
          LIMIT 1
          RETURN { sha256: document.sha256, chunkerVersion: document.chunkerVersion }
      )
      FILTER source != null
      FILTER chunk._key > @afterKey
      LET target = DOCUMENT('experience_chunks_gte_v1', chunk._key)
      FILTER target == null
        OR (target.activeUntil != null AND (target.supersededByReceiptKey == null
          OR DOCUMENT('operation_receipts', target.supersededByReceiptKey) != null))
        OR target.indexVersion != chunk.indexVersion
        OR target.contentHash != chunk.contentHash
        OR target.sourceSha256 != source.sha256
        OR target.embeddingProvider != @embeddingProvider
        OR target.embeddingModel != @embeddingModel
        OR target.embeddingRevision != @embeddingRevision
        OR target.embeddingDtype != @embeddingDtype
        OR target.embeddingDimensions != @embeddingDimensions
        OR LENGTH(target.embedding || []) != @embeddingDimensions
        OR target.vectorIndexVersion != @vectorIndexVersion
      SORT chunk._key ASC
      LIMIT @batchSize
      RETURN MERGE(KEEP(chunk, '_key', 'spaceId', 'knowledgeBaseId', 'documentId', 'documentName', 'indexVersion', 'ordinal', 'text', 'contentHash', 'tokenEstimate', 'start', 'end', 'section', 'page', 'entityRefs', 'receiptKey', 'activeUntil', 'createdAt', 'updatedAt'), { sourceSha256: source.sha256, sourceChunkerVersion: source.chunkerVersion })
  `,
  gteBackfillRemaining: `
    RETURN LENGTH(
      FOR chunk IN chunks
        FILTER chunk.spaceId == @spaceId
        FILTER @knowledgeBaseId == null OR chunk.knowledgeBaseId == @knowledgeBaseId
        FILTER @documentId == null OR chunk.documentId == @documentId
        FILTER @sourceIndexVersion == null OR chunk.indexVersion == @sourceIndexVersion
        FILTER chunk.activeUntil == null
          OR (chunk.supersededByReceiptKey != null AND DOCUMENT('operation_receipts', chunk.supersededByReceiptKey) == null)
        FILTER chunk.receiptKey == null OR DOCUMENT('operation_receipts', chunk.receiptKey) != null
        FILTER @sourceSha256 == null OR chunk.sourceSha256 == null OR chunk.sourceSha256 == @sourceSha256
        LET sourceProfileMatches = (
          chunk.embeddingProvider == null AND LENGTH(chunk.embedding || []) == @sourceEmbeddingDimensions
        ) OR (
          chunk.embeddingProvider == @sourceEmbeddingProvider
          AND chunk.embeddingModel == @sourceEmbeddingModel
          AND chunk.embeddingRevision == @sourceEmbeddingRevision
          AND chunk.embeddingDtype == @sourceEmbeddingDtype
          AND chunk.embeddingDimensions == @sourceEmbeddingDimensions
          AND chunk.vectorIndexVersion == @sourceVectorIndexVersion
        )
        FILTER sourceProfileMatches
        LET sourceDocument = FIRST(
          FOR document IN documents
            FILTER document.spaceId == chunk.spaceId
            FILTER document.knowledgeBaseId == chunk.knowledgeBaseId
            FILTER document.documentId == chunk.documentId
            FILTER document.indexVersion == chunk.indexVersion
            FILTER @sourceSha256 == null OR document.sha256 == @sourceSha256
            FILTER @sourceChunkerVersion == null OR document.chunkerVersion == @sourceChunkerVersion
            FILTER document.embeddingModel == @sourceEmbeddingModel
            FILTER document.embeddingDimension == @sourceEmbeddingDimensions
            FILTER document.activeUntil == null
              OR (document.supersededByReceiptKey != null AND DOCUMENT('operation_receipts', document.supersededByReceiptKey) == null)
            LIMIT 1
            RETURN { _key: document._key, sha256: document.sha256, chunkerVersion: document.chunkerVersion }
        )
        FILTER sourceDocument != null
        LET target = DOCUMENT('experience_chunks_gte_v1', chunk._key)
        FILTER target == null
          OR (target.activeUntil != null AND (target.supersededByReceiptKey == null
            OR DOCUMENT('operation_receipts', target.supersededByReceiptKey) != null))
          OR target.indexVersion != chunk.indexVersion
          OR target.contentHash != chunk.contentHash
          OR target.sourceSha256 != sourceDocument.sha256
          OR target.embeddingProvider != @embeddingProvider
          OR target.embeddingModel != @embeddingModel
          OR target.embeddingRevision != @embeddingRevision
          OR target.embeddingDtype != @embeddingDtype
          OR target.embeddingDimensions != @embeddingDimensions
          OR LENGTH(target.embedding || []) != @embeddingDimensions
          OR target.vectorIndexVersion != @vectorIndexVersion
        RETURN 1
    )
  `,
  gteBackfillCoverage: `
    LET canonical = (
      FOR chunk IN chunks
        FILTER chunk.spaceId == @spaceId
        FILTER chunk.knowledgeBaseId == @knowledgeBaseId
        FILTER chunk.documentId == @documentId
        FILTER chunk.indexVersion == @sourceIndexVersion
        FILTER chunk.activeUntil == null
          OR (chunk.supersededByReceiptKey != null AND DOCUMENT('operation_receipts', chunk.supersededByReceiptKey) == null)
        FILTER chunk.receiptKey == null OR DOCUMENT('operation_receipts', chunk.receiptKey) != null
        RETURN chunk
    )
    LET validSource = (
      FOR source IN canonical
        FILTER source.sourceSha256 == null OR source.sourceSha256 == @sourceSha256
        FILTER IS_STRING(source.contentHash) AND LENGTH(source.contentHash) > 0
        FILTER IS_STRING(source.text)
        LET sourceProfileMatches = (
          source.embeddingProvider == null AND LENGTH(source.embedding || []) == @sourceEmbeddingDimensions
        ) OR (
          source.embeddingProvider == @sourceEmbeddingProvider
          AND source.embeddingModel == @sourceEmbeddingModel
          AND source.embeddingRevision == @sourceEmbeddingRevision
          AND source.embeddingDtype == @sourceEmbeddingDtype
          AND source.embeddingDimensions == @sourceEmbeddingDimensions
          AND source.vectorIndexVersion == @sourceVectorIndexVersion
        )
        FILTER sourceProfileMatches
        RETURN source
    )
    LET validTargetCount = LENGTH(
      FOR source IN validSource
        LET target = DOCUMENT('experience_chunks_gte_v1', source._key)
        FILTER target != null
        FILTER target.spaceId == @spaceId
        FILTER target.knowledgeBaseId == @knowledgeBaseId
        FILTER target.documentId == @documentId
        FILTER target.indexVersion == @sourceIndexVersion
        FILTER target.activeUntil == null
          OR (target.supersededByReceiptKey != null AND DOCUMENT('operation_receipts', target.supersededByReceiptKey) == null)
        FILTER target.receiptKey == null OR DOCUMENT('operation_receipts', target.receiptKey) != null
        FILTER target.contentHash == source.contentHash
        FILTER target.sourceSha256 == @sourceSha256
        FILTER target.embeddingProvider == @embeddingProvider
        FILTER target.embeddingModel == @embeddingModel
        FILTER target.embeddingRevision == @embeddingRevision
        FILTER target.embeddingDtype == @embeddingDtype
        FILTER target.embeddingDimensions == @embeddingDimensions
        FILTER LENGTH(target.embedding || []) == @embeddingDimensions
        FILTER target.vectorIndexVersion == @vectorIndexVersion
        RETURN 1
    )
    LET targetCount = LENGTH(
      FOR target IN experience_chunks_gte_v1
        FILTER target.spaceId == @spaceId
        FILTER target.knowledgeBaseId == @knowledgeBaseId
        FILTER target.documentId == @documentId
        FILTER target.indexVersion == @sourceIndexVersion
        FILTER target.activeUntil == null
          OR (target.supersededByReceiptKey != null AND DOCUMENT('operation_receipts', target.supersededByReceiptKey) == null)
        FILTER target.receiptKey == null OR DOCUMENT('operation_receipts', target.receiptKey) != null
        RETURN 1
    )
    RETURN {
      canonicalCount: LENGTH(canonical),
      validSourceCount: LENGTH(validSource),
      validTargetCount,
      targetCount,
      exact: LENGTH(canonical) == LENGTH(validSource)
        AND LENGTH(validSource) == validTargetCount
        AND validTargetCount == targetCount
    }
  `,
  gteCoverageByBase: `
    FOR knowledgeBaseId IN @knowledgeBaseIds
      LET canonical = (
        FOR chunk IN chunks
          FILTER chunk.spaceId == @spaceId
          FILTER chunk.knowledgeBaseId == knowledgeBaseId
          FILTER chunk.indexVersion <= @watermarkByBase[knowledgeBaseId]
          FILTER chunk.activeUntil == null OR chunk.activeUntil > @watermarkByBase[knowledgeBaseId]
            OR (chunk.supersededByReceiptKey != null AND DOCUMENT('operation_receipts', chunk.supersededByReceiptKey) == null)
          FILTER chunk.receiptKey == null OR DOCUMENT('operation_receipts', chunk.receiptKey) != null
          LET sourceDocument = FIRST(
            FOR document IN documents
              FILTER document.spaceId == chunk.spaceId
              FILTER document.knowledgeBaseId == chunk.knowledgeBaseId
              FILTER document.documentId == chunk.documentId
              FILTER document.indexVersion == chunk.indexVersion
              LIMIT 1
              RETURN document.sha256
          )
          FILTER sourceDocument != null
          RETURN MERGE(KEEP(chunk, '_key', 'indexVersion', 'contentHash'), { sourceSha256: chunk.sourceSha256 || sourceDocument })
      )
      LET valid = LENGTH(
        FOR source IN canonical
          LET target = DOCUMENT('experience_chunks_gte_v1', source._key)
          FILTER target != null
          FILTER target.spaceId == @spaceId
          FILTER target.knowledgeBaseId == knowledgeBaseId
          FILTER target.indexVersion == source.indexVersion
          FILTER target.activeUntil == null OR target.activeUntil > @watermarkByBase[knowledgeBaseId]
            OR (target.supersededByReceiptKey != null AND DOCUMENT('operation_receipts', target.supersededByReceiptKey) == null)
          FILTER target.receiptKey == null OR DOCUMENT('operation_receipts', target.receiptKey) != null
          FILTER target.contentHash == source.contentHash
          FILTER target.sourceSha256 == source.sourceSha256
          FILTER target.embeddingProvider == @embeddingProvider
          FILTER target.embeddingModel == @embeddingModel
          FILTER target.embeddingRevision == @embeddingRevision
          FILTER target.embeddingDtype == @embeddingDtype
          FILTER target.embeddingDimensions == @embeddingDimensions
          FILTER LENGTH(target.embedding || []) == @embeddingDimensions
          FILTER target.vectorIndexVersion == @vectorIndexVersion
          RETURN 1
      )
      LET targetCount = LENGTH(
        FOR chunk IN experience_chunks_gte_v1
          FILTER chunk.spaceId == @spaceId
          FILTER chunk.knowledgeBaseId == knowledgeBaseId
          FILTER chunk.indexVersion <= @watermarkByBase[knowledgeBaseId]
          FILTER chunk.activeUntil == null OR chunk.activeUntil > @watermarkByBase[knowledgeBaseId]
            OR (chunk.supersededByReceiptKey != null AND DOCUMENT('operation_receipts', chunk.supersededByReceiptKey) == null)
          FILTER chunk.receiptKey == null OR DOCUMENT('operation_receipts', chunk.receiptKey) != null
          FILTER chunk.vectorIndexVersion == @vectorIndexVersion
          RETURN 1
      )
      RETURN {
        knowledgeBaseId,
        canonical: LENGTH(canonical),
        gte: targetCount,
        valid,
        complete: LENGTH(canonical) > 0 AND valid == LENGTH(canonical) AND targetCount == LENGTH(canonical)
      }
  `,
  gteStandaloneCoverageByBase: `
    FOR knowledgeBaseId IN @knowledgeBaseIds
      LET targetCount = LENGTH(
        FOR chunk IN experience_chunks_gte_v1
          FILTER chunk.spaceId == @spaceId
          FILTER chunk.knowledgeBaseId == knowledgeBaseId
          FILTER chunk.indexVersion <= @watermarkByBase[knowledgeBaseId]
          FILTER chunk.activeUntil == null OR chunk.activeUntil > @watermarkByBase[knowledgeBaseId]
            OR (chunk.supersededByReceiptKey != null AND DOCUMENT('operation_receipts', chunk.supersededByReceiptKey) == null)
          FILTER chunk.receiptKey == null OR DOCUMENT('operation_receipts', chunk.receiptKey) != null
          FILTER chunk.embeddingProvider == @embeddingProvider
          FILTER chunk.embeddingModel == @embeddingModel
          FILTER chunk.embeddingRevision == @embeddingRevision
          FILTER chunk.embeddingDtype == @embeddingDtype
          FILTER chunk.embeddingDimensions == @embeddingDimensions
          FILTER LENGTH(chunk.embedding || []) == @embeddingDimensions
          FILTER chunk.vectorIndexVersion == @vectorIndexVersion
          RETURN 1
      )
      RETURN { knowledgeBaseId, canonical: targetCount, gte: targetCount, valid: targetCount,
        complete: targetCount > 0 }
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
