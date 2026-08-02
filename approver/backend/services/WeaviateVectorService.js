const axios = require('axios');
const crypto = require('crypto');

const RULE_CLASS = 'ApproverRuleEmbedding';
const INITIATIVE_CHUNK_CLASS = 'ApproverInitiativeChunkEmbedding';
const INITIATIVE_MEMORY_CLASS = 'ApproverInitiativeEmbedding';

const DEFAULT_TIMEOUT_MS = 20000;
const DEFAULT_HASH_DIM = 256;
const DEFAULT_CHUNK_SIZE = 900;
const DEFAULT_CHUNK_OVERLAP = 120;
const DEFAULT_RULE_GROUNDING_CHUNKS = 4;
const DEFAULT_RULE_GROUNDING_HISTORY = 0;
const DEFAULT_RULE_GROUNDING_MAX_DISTANCE = 0.28;
const DEFAULT_RULE_HISTORY_MAX_DISTANCE = 0.24;
const DEFAULT_RULE_GROUNDING_MIN_KEYWORD_HITS = 1;
const DEFAULT_EMBEDDING_TIMEOUT_MS = 45000;

const STOPWORDS = new Set([
    'this', 'that', 'with', 'from', 'have', 'will', 'must', 'should', 'could', 'would',
    'about', 'into', 'only', 'when', 'where', 'which', 'what', 'while', 'their', 'there',
    'rule', 'initiative', 'check', 'pass', 'fail', 'true', 'false', 'condition', 'present',
    'criteria', 'name', 'category', 'mandatory', 'status', 'reason', 'requires', 'without',
    'above', 'below', 'under', 'over', 'than', 'then', 'also', 'such', 'been', 'being',
    'into', 'like', 'using', 'used', 'across', 'through', 'between', 'within', 'other',
    'global', 'local', 'department', 'organization', 'sterling', 'financial', 'holdings'
]);

const toBoolean = (value, fallback = false) => {
    if (value === undefined || value === null || value === '') return fallback;
    return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
};

const toPositiveInt = (value, fallback) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.floor(parsed);
};

const readEnvAny = (keys, fallback = '') => {
    for (const key of keys) {
        const value = process.env[key];
        if (typeof value === 'string' && value.trim()) {
            return value.trim();
        }
    }
    return fallback;
};

const truncate = (value, max = 460) => {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (text.length <= max) return text;
    return `${text.slice(0, max - 1)}…`;
};

const normalizeText = (value) => String(value || '').replace(/\r/g, '').trim();

const extractKeywords = (value, max = 14) => {
    const tokens = String(value || '')
        .toLowerCase()
        .match(/[a-z0-9_]+/g) || [];
    const unique = [];

    for (const token of tokens) {
        if (token.length < 4) continue;
        if (STOPWORDS.has(token)) continue;
        if (!unique.includes(token)) unique.push(token);
        if (unique.length >= max) break;
    }

    return unique;
};

const keywordHitCount = (keywords, text) => {
    if (!Array.isArray(keywords) || keywords.length === 0) return 0;
    const haystack = String(text || '').toLowerCase();
    let hits = 0;
    keywords.forEach((keyword) => {
        if (haystack.includes(keyword)) hits += 1;
    });
    return hits;
};

const escapeGraphqlString = (value) => String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, ' ');

const toUuid = (seed) => {
    const hex = crypto.createHash('sha1').update(String(seed)).digest('hex').slice(0, 32);
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
};

class WeaviateVectorService {
    constructor() {
        this.schemaEnsured = false;
        this.embeddingMode = null;
        this.loggedEmbeddingFallback = false;
    }

    getConfig() {
        const host = readEnvAny(['WEAVIATE_HOST']);
        const scheme = readEnvAny(['WEAVIATE_SCHEME'], 'https').toLowerCase();
        const enabled = toBoolean(readEnvAny(['USE_WEAVIATE'], 'false'), false) && Boolean(host);
        const ruleGroundingEnabled = toBoolean(
            readEnvAny(['USE_WEAVIATE_RULE_GROUNDING'], enabled ? 'true' : 'false'),
            enabled
        );
        const initiativeMemoryEnabled = toBoolean(
            readEnvAny(['USE_WEAVIATE_INITIATIVE_MEMORY'], enabled ? 'true' : 'false'),
            enabled
        );

        const apiKey = readEnvAny(['WEAVIATE_API_KEY']);
        const timeoutMs = toPositiveInt(readEnvAny(['WEAVIATE_TIMEOUT_MS']), DEFAULT_TIMEOUT_MS);
        const chunkSize = toPositiveInt(readEnvAny(['WEAVIATE_CHUNK_SIZE']), DEFAULT_CHUNK_SIZE);
        const chunkOverlap = toPositiveInt(readEnvAny(['WEAVIATE_CHUNK_OVERLAP']), DEFAULT_CHUNK_OVERLAP);
        const groundingChunkLimit = toPositiveInt(
            readEnvAny(['WEAVIATE_RULE_GROUNDING_CHUNKS']),
            DEFAULT_RULE_GROUNDING_CHUNKS
        );
        const groundingHistoryLimit = toPositiveInt(
            readEnvAny(['WEAVIATE_RULE_GROUNDING_HISTORY']),
            DEFAULT_RULE_GROUNDING_HISTORY
        );
        const groundingMaxDistanceRaw = Number(readEnvAny(['WEAVIATE_RULE_GROUNDING_MAX_DISTANCE']));
        const historyMaxDistanceRaw = Number(readEnvAny(['WEAVIATE_RULE_HISTORY_MAX_DISTANCE']));
        const groundingMinKeywordHits = toPositiveInt(
            readEnvAny(['WEAVIATE_RULE_GROUNDING_MIN_KEYWORD_HITS']),
            DEFAULT_RULE_GROUNDING_MIN_KEYWORD_HITS
        );

        return {
            enabled,
            ruleGroundingEnabled,
            initiativeMemoryEnabled,
            baseUrl: `${scheme}://${host.replace(/^https?:\/\//i, '').replace(/\/+$/, '')}`,
            headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
            timeoutMs,
            chunkSize,
            chunkOverlap,
            groundingChunkLimit,
            groundingHistoryLimit,
            groundingMaxDistance: Number.isFinite(groundingMaxDistanceRaw)
                ? groundingMaxDistanceRaw
                : DEFAULT_RULE_GROUNDING_MAX_DISTANCE,
            historyMaxDistance: Number.isFinite(historyMaxDistanceRaw)
                ? historyMaxDistanceRaw
                : DEFAULT_RULE_HISTORY_MAX_DISTANCE,
            groundingMinKeywordHits,
            embedding: {
                url: readEnvAny([
                    'AZURE_OPENAI_EMBEDDING_URL',
                    'azure_openai_embedding_url'
                ]),
                model: readEnvAny([
                    'AZURE_OPENAI_EMBEDDING_DEPLOYMENT_NAME',
                    'AZURE_OPENAI_EMBEDDING_MODEL',
                    'azure_openai_embedding_model'
                ]),
                key: readEnvAny([
                    'AZURE_OPENAI_EMBEDDING_API_KEY',
                    'azure_openai_embedding_key',
                    'AZURE_OPENAI_API_KEY'
                ]),
                timeoutMs: toPositiveInt(
                    readEnvAny(['WEAVIATE_EMBEDDING_TIMEOUT_MS']),
                    DEFAULT_EMBEDDING_TIMEOUT_MS
                ),
                hashDim: toPositiveInt(readEnvAny(['WEAVIATE_HASH_EMBEDDING_DIM']), DEFAULT_HASH_DIM),
                allowHashFallback: toBoolean(readEnvAny(['WEAVIATE_ALLOW_HASH_FALLBACK'], 'true'), true)
            }
        };
    }

    isEnabled() {
        return this.getConfig().enabled;
    }

    isRuleGroundingEnabled() {
        const cfg = this.getConfig();
        return cfg.enabled && cfg.ruleGroundingEnabled;
    }

    isInitiativeMemoryEnabled() {
        const cfg = this.getConfig();
        return cfg.enabled && cfg.initiativeMemoryEnabled;
    }

    async request(cfg, method, path, payload = null) {
        const response = await axios({
            method,
            url: `${cfg.baseUrl}${path}`,
            timeout: cfg.timeoutMs,
            headers: {
                ...cfg.headers,
                'Content-Type': 'application/json'
            },
            data: payload === null ? undefined : payload,
            validateStatus: () => true
        });

        if (response.status >= 200 && response.status < 300) {
            return response.data;
        }

        const message = typeof response.data === 'string'
            ? response.data
            : JSON.stringify(response.data || {});
        const error = new Error(`Weaviate ${method.toUpperCase()} ${path} failed: ${response.status} ${message}`);
        error.status = response.status;
        throw error;
    }

    async healthCheck() {
        const cfg = this.getConfig();
        if (!cfg.enabled) return { enabled: false, ok: false, reason: 'USE_WEAVIATE is disabled.' };

        try {
            await this.request(cfg, 'GET', '/v1/.well-known/ready');
            return { enabled: true, ok: true };
        } catch (error) {
            return { enabled: true, ok: false, reason: error.message };
        }
    }

    async ensureClass(cfg, classSchema) {
        try {
            await this.request(cfg, 'GET', `/v1/schema/${classSchema.class}`);
            return false;
        } catch (error) {
            if (error.status !== 404) throw error;
            await this.request(cfg, 'POST', '/v1/schema', classSchema);
            return true;
        }
    }

    async ensureSchema() {
        const cfg = this.getConfig();
        if (!cfg.enabled) return { enabled: false };
        if (this.schemaEnsured) return { enabled: true, ensured: true };

        const classDefs = [
            {
                class: RULE_CLASS,
                description: 'Embeddings for approver rules',
                vectorizer: 'none',
                properties: [
                    { name: 'organizationId', dataType: ['text'] },
                    { name: 'ruleId', dataType: ['text'] },
                    { name: 'name', dataType: ['text'] },
                    { name: 'category', dataType: ['text'] },
                    { name: 'mandatory', dataType: ['boolean'] },
                    { name: 'searchText', dataType: ['text'] },
                    { name: 'updatedAt', dataType: ['date'] }
                ]
            },
            {
                class: INITIATIVE_CHUNK_CLASS,
                description: 'Run-scoped initiative chunks for rule grounding',
                vectorizer: 'none',
                properties: [
                    { name: 'organizationId', dataType: ['text'] },
                    { name: 'runId', dataType: ['text'] },
                    { name: 'chunkIndex', dataType: ['int'] },
                    { name: 'source', dataType: ['text'] },
                    { name: 'text', dataType: ['text'] },
                    { name: 'createdAt', dataType: ['date'] }
                ]
            },
            {
                class: INITIATIVE_MEMORY_CLASS,
                description: 'Historical initiative embeddings for similar-case retrieval',
                vectorizer: 'none',
                properties: [
                    { name: 'organizationId', dataType: ['text'] },
                    { name: 'projectId', dataType: ['text'] },
                    { name: 'name', dataType: ['text'] },
                    { name: 'approvalStatus', dataType: ['text'] },
                    { name: 'workflowStage', dataType: ['text'] },
                    { name: 'tier', dataType: ['int'] },
                    { name: 'priorityScore', dataType: ['number'] },
                    { name: 'summary', dataType: ['text'] },
                    { name: 'initiativeText', dataType: ['text'] },
                    { name: 'updatedAt', dataType: ['date'] }
                ]
            }
        ];

        for (const classDef of classDefs) {
            await this.ensureClass(cfg, classDef);
        }

        this.schemaEnsured = true;
        return { enabled: true, ensured: true };
    }

    hashEmbedding(text, dim) {
        const vector = new Array(dim).fill(0);
        const tokens = String(text || '').toLowerCase().match(/[a-z0-9_]+/g) || [];
        if (tokens.length === 0) return vector;

        tokens.forEach((token) => {
            const digest = crypto.createHash('sha1').update(token).digest();
            const idx = digest.readUInt32BE(0) % dim;
            const sign = digest[4] % 2 === 0 ? 1 : -1;
            vector[idx] += sign * (1 + (token.length % 3));
        });

        const norm = Math.sqrt(vector.reduce((sum, value) => sum + (value * value), 0)) || 1;
        return vector.map((value) => Number((value / norm).toFixed(8)));
    }

    async embedText(text) {
        const cfg = this.getConfig();
        const normalizedText = truncate(normalizeText(text), 7000);

        const hashFallback = () => ({
            vector: this.hashEmbedding(normalizedText, cfg.embedding.hashDim),
            source: 'hash'
        });

        const hasEmbeddingEndpoint = Boolean(cfg.embedding.url) && Boolean(cfg.embedding.key);
        if (!hasEmbeddingEndpoint || this.embeddingMode === 'hash') {
            this.embeddingMode = 'hash';
            return hashFallback();
        }

        try {
            const response = await axios.post(
                cfg.embedding.url,
                { input: normalizedText, model: cfg.embedding.model || undefined },
                {
                    timeout: cfg.embedding.timeoutMs,
                    headers: {
                        'api-key': cfg.embedding.key,
                        'Content-Type': 'application/json'
                    },
                    validateStatus: () => true
                }
            );

            if (response.status < 200 || response.status >= 300) {
                const message = typeof response.data === 'string'
                    ? response.data
                    : JSON.stringify(response.data || {});
                throw new Error(`Embedding request failed ${response.status}: ${message}`);
            }

            const vector = response.data?.data?.[0]?.embedding;
            if (!Array.isArray(vector) || vector.length === 0) {
                throw new Error('Embedding response did not contain a vector.');
            }

            this.embeddingMode = 'azure';
            return {
                vector: vector.map((value) => Number(value)),
                source: 'azure'
            };
        } catch (error) {
            if (!cfg.embedding.allowHashFallback) {
                throw error;
            }
            this.embeddingMode = 'hash';
            if (!this.loggedEmbeddingFallback) {
                this.loggedEmbeddingFallback = true;
                console.warn(`Weaviate embedding fallback enabled (hash vectors): ${error.message}`);
            }
            return hashFallback();
        }
    }

    splitIntoChunks(text, chunkSize, chunkOverlap) {
        const clean = normalizeText(text);
        if (!clean) return [];

        const blocks = clean
            .split(/\n{2,}/)
            .map((block) => block.trim())
            .filter(Boolean);

        const chunks = [];
        let current = '';

        const flush = () => {
            const next = current.trim();
            if (next) chunks.push(next);
            current = '';
        };

        blocks.forEach((block) => {
            if (block.length > chunkSize) {
                flush();
                let start = 0;
                while (start < block.length) {
                    const end = Math.min(start + chunkSize, block.length);
                    chunks.push(block.slice(start, end).trim());
                    if (end >= block.length) break;
                    start = Math.max(0, end - chunkOverlap);
                }
                return;
            }

            const candidate = current ? `${current}\n\n${block}` : block;
            if (candidate.length > chunkSize) {
                flush();
                current = block;
            } else {
                current = candidate;
            }
        });

        flush();
        return chunks.filter(Boolean);
    }

    ruleSearchText(rule) {
        const effects = Array.isArray(rule?.effects)
            ? rule.effects.map((effect) => {
                const type = String(effect?.type || '').toUpperCase();
                if (!type) return null;
                return `${type} ${JSON.stringify(effect?.params || {})}`;
            }).filter(Boolean).join('; ')
            : '';

        return [
            `Rule Name: ${rule?.name || ''}`,
            `Category: ${rule?.category || ''}`,
            `Mandatory: ${rule?.isMandatory === true ? 'true' : 'false'}`,
            `Description: ${rule?.description || ''}`,
            `Criteria: ${rule?.criteria || ''}`,
            `Effects: ${effects}`
        ].join('\n');
    }

    async upsertObject(cfg, className, objectId, properties, vector) {
        try {
            await this.request(cfg, 'POST', '/v1/objects', {
                class: className,
                id: objectId,
                properties,
                vector
            });
            return;
        } catch (error) {
            const msg = String(error.message || '').toLowerCase();
            const existsConflict = error.status === 422 || msg.includes('already exists');
            if (!existsConflict) throw error;
        }

        await this.request(cfg, 'PUT', `/v1/objects/${className}/${objectId}`, {
            class: className,
            id: objectId,
            properties,
            vector
        });
    }

    async indexRules({ organizationId, rules }) {
        const cfg = this.getConfig();
        if (!cfg.enabled) return { enabled: false, indexedRules: 0 };
        await this.ensureSchema();

        const sourceRules = Array.isArray(rules) ? rules : [];
        const vectorsByRuleId = {};
        let indexedRules = 0;
        let embeddingSource = 'hash';

        for (const rule of sourceRules) {
            const ruleId = String(rule?._id || '');
            if (!ruleId) continue;

            const searchText = this.ruleSearchText(rule);
            const embedding = await this.embedText(searchText);
            embeddingSource = embedding.source;

            const objectId = toUuid(`rule:${organizationId}:${ruleId}`);
            const properties = {
                organizationId: String(organizationId),
                ruleId,
                name: rule?.name || '',
                category: String(rule?.category || ''),
                mandatory: rule?.isMandatory === true,
                searchText,
                updatedAt: new Date().toISOString()
            };

            await this.upsertObject(cfg, RULE_CLASS, objectId, properties, embedding.vector);
            vectorsByRuleId[ruleId] = embedding.vector;
            indexedRules += 1;
        }

        return {
            enabled: true,
            indexedRules,
            embeddingSource,
            vectorsByRuleId
        };
    }

    async indexInitiativeContext({ organizationId, runId, initiativeContext }) {
        const cfg = this.getConfig();
        if (!cfg.enabled) return { enabled: false, indexedChunks: 0 };
        await this.ensureSchema();

        const chunks = this.splitIntoChunks(initiativeContext, cfg.chunkSize, cfg.chunkOverlap);
        let indexedChunks = 0;
        let embeddingSource = this.embeddingMode || 'hash';

        for (let i = 0; i < chunks.length; i += 1) {
            const chunk = chunks[i];
            const embedding = await this.embedText(chunk);
            embeddingSource = embedding.source;

            const objectId = toUuid(`initiative-chunk:${organizationId}:${runId}:${i}`);
            const properties = {
                organizationId: String(organizationId),
                runId: String(runId),
                chunkIndex: i,
                source: 'initiative_context',
                text: chunk,
                createdAt: new Date().toISOString()
            };

            await this.upsertObject(cfg, INITIATIVE_CHUNK_CLASS, objectId, properties, embedding.vector);
            indexedChunks += 1;
        }

        return {
            enabled: true,
            indexedChunks,
            embeddingSource
        };
    }

    async queryGraphQL(cfg, query) {
        return this.request(cfg, 'POST', '/v1/graphql', { query });
    }

    async searchInitiativeChunks({ organizationId, runId, rule, limit, ruleVector }) {
        const cfg = this.getConfig();
        if (!cfg.enabled || !cfg.ruleGroundingEnabled) return [];
        await this.ensureSchema();

        const queryText = `${rule?.name || ''}\n${rule?.criteria || rule?.description || ''}`;
        const vector = Array.isArray(ruleVector) && ruleVector.length > 0
            ? ruleVector
            : (await this.embedText(queryText)).vector;
        const topK = Math.max(1, limit || cfg.groundingChunkLimit);
        const vectorLiteral = vector.map((n) => Number(n).toFixed(8)).join(',');

        const query = `
        {
          Get {
            ${INITIATIVE_CHUNK_CLASS}(
              limit: ${topK}
              nearVector: { vector: [${vectorLiteral}] }
              where: {
                operator: And
                operands: [
                  { path: ["organizationId"], operator: Equal, valueText: "${escapeGraphqlString(String(organizationId))}" }
                  { path: ["runId"], operator: Equal, valueText: "${escapeGraphqlString(String(runId))}" }
                ]
              }
            ) {
              text
              chunkIndex
              _additional { distance }
            }
          }
        }`;

        const data = await this.queryGraphQL(cfg, query);
        const rows = data?.data?.Get?.[INITIATIVE_CHUNK_CLASS];
        if (!Array.isArray(rows)) return [];

        return rows.map((row) => ({
            text: String(row?.text || ''),
            chunkIndex: Number(row?.chunkIndex ?? 0),
            distance: Number(row?._additional?.distance ?? 1)
        }));
    }

    async searchSimilarInitiatives({ organizationId, rule, limit, ruleVector }) {
        const cfg = this.getConfig();
        if (!cfg.enabled || !cfg.ruleGroundingEnabled) return [];
        await this.ensureSchema();

        const queryText = `${rule?.name || ''}\n${rule?.criteria || rule?.description || ''}`;
        const vector = Array.isArray(ruleVector) && ruleVector.length > 0
            ? ruleVector
            : (await this.embedText(queryText)).vector;
        const topK = Math.max(1, limit || cfg.groundingHistoryLimit);
        const vectorLiteral = vector.map((n) => Number(n).toFixed(8)).join(',');

        const query = `
        {
          Get {
            ${INITIATIVE_MEMORY_CLASS}(
              limit: ${topK}
              nearVector: { vector: [${vectorLiteral}] }
              where: {
                path: ["organizationId"]
                operator: Equal
                valueText: "${escapeGraphqlString(String(organizationId))}"
              }
            ) {
              name
              approvalStatus
              workflowStage
              tier
              priorityScore
              summary
              _additional { distance }
            }
          }
        }`;

        const data = await this.queryGraphQL(cfg, query);
        const rows = data?.data?.Get?.[INITIATIVE_MEMORY_CLASS];
        if (!Array.isArray(rows)) return [];

        return rows.map((row) => ({
            name: String(row?.name || ''),
            approvalStatus: String(row?.approvalStatus || ''),
            workflowStage: String(row?.workflowStage || ''),
            tier: Number(row?.tier ?? 0),
            priorityScore: Number(row?.priorityScore ?? 0),
            summary: String(row?.summary || ''),
            distance: Number(row?._additional?.distance ?? 1)
        }));
    }

    async buildRuleGroundingContext({ organizationId, runId, rule, ruleVector }) {
        if (!this.isRuleGroundingEnabled()) {
            return {
                enabled: false,
                context: '',
                chunkCount: 0,
                historyCount: 0
            };
        }

        const cfg = this.getConfig();
        const ruleText = `${rule?.name || ''}\n${rule?.criteria || rule?.description || ''}`;
        const keywords = extractKeywords(ruleText);

        const [chunks, history] = await Promise.all([
            this.searchInitiativeChunks({ organizationId, runId, rule, ruleVector }),
            this.searchSimilarInitiatives({ organizationId, rule, ruleVector })
        ]);

        const filteredChunks = chunks
            .map((item) => ({
                ...item,
                keywordHits: keywordHitCount(keywords, item.text)
            }))
            .filter((item) =>
                item.distance <= cfg.groundingMaxDistance ||
                item.keywordHits >= cfg.groundingMinKeywordHits
            )
            .sort((a, b) => {
                if (a.distance !== b.distance) return a.distance - b.distance;
                return b.keywordHits - a.keywordHits;
            })
            .slice(0, cfg.groundingChunkLimit);

        const filteredHistory = (cfg.groundingHistoryLimit > 0 ? history : [])
            .filter((item) => item.distance <= cfg.historyMaxDistance)
            .slice(0, cfg.groundingHistoryLimit);

        const lines = [];
        if (filteredChunks.length > 0) {
            lines.push('Top matched initiative evidence (same initiative, highest confidence excerpts):');
            filteredChunks.forEach((item, idx) => {
                lines.push(
                    `${idx + 1}. chunk=${item.chunkIndex}, distance=${item.distance.toFixed(4)}, keywordHits=${item.keywordHits} -> ${truncate(item.text, 420)}`
                );
            });
        }

        if (filteredHistory.length > 0) {
            lines.push('Similar prior initiatives (for consistency, not as hard constraints):');
            filteredHistory.forEach((item, idx) => {
                lines.push(
                    `${idx + 1}. ${item.name} | status=${item.approvalStatus} | tier=${item.tier} | score=${item.priorityScore.toFixed(2)} | ${truncate(item.summary, 240)}`
                );
            });
        }

        return {
            enabled: true,
            context: lines.join('\n'),
            chunkCount: filteredChunks.length,
            historyCount: filteredHistory.length
        };
    }

    async upsertInitiativeMemory({
        organizationId,
        projectId,
        name,
        initiativeContext,
        summary,
        approvalStatus,
        workflowStage,
        tier,
        priorityScore
    }) {
        const cfg = this.getConfig();
        if (!cfg.enabled || !cfg.initiativeMemoryEnabled) return { enabled: false, indexed: false };
        await this.ensureSchema();

        const initiativeText = normalizeText(initiativeContext);
        const memoryText = [
            `Initiative: ${name || ''}`,
            initiativeText,
            `Summary: ${summary || ''}`
        ].join('\n\n');

        const embedding = await this.embedText(memoryText);
        const objectId = toUuid(`initiative-memory:${organizationId}:${projectId}`);

        await this.upsertObject(cfg, INITIATIVE_MEMORY_CLASS, objectId, {
            organizationId: String(organizationId),
            projectId: String(projectId),
            name: name || '',
            approvalStatus: approvalStatus || '',
            workflowStage: workflowStage || '',
            tier: Number(tier || 0),
            priorityScore: Number(priorityScore || 0),
            summary: summary || '',
            initiativeText: truncate(initiativeText, 8000),
            updatedAt: new Date().toISOString()
        }, embedding.vector);

        return {
            enabled: true,
            indexed: true,
            embeddingSource: embedding.source
        };
    }
}

module.exports = new WeaviateVectorService();
