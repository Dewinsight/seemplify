const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { AQL } = require('./aql.cjs');
const { CONFIG } = require('./config.cjs');
const { ArangoClient, BENCHMARK_CLEANUP_CONFIRMATION, createKnowledgeRuntime, embeddingProfiles } = require('./runtime.cjs');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function publicProfile(profile) {
  return Object.fromEntries(['provider', 'model', 'revision', 'dtype', 'dimensions', 'vectorIndexVersion']
    .map((key) => [key, profile[key]]));
}

function readSecrets(directory) {
  const names = ['arango-app', 'arango-provisioner', 'chatgpt-gateway', 'tei-api', 'docling-api'];
  return Object.fromEntries(names.map((name) => [name, fs.readFileSync(path.join(directory, name), 'utf8').trim()]));
}

async function runLiveMigrationSmoke({ secretsDirectory = process.env.SEEMPLIFY_KNOWLEDGE_SECRETS_DIR } = {}) {
  if (!process.argv.includes('--live')) throw new Error('Pass --live to run the reserved-tenant Qwen-to-GTE migration smoke.');
  if (!secretsDirectory || !fs.existsSync(secretsDirectory)) throw new Error('SEEMPLIFY_KNOWLEDGE_SECRETS_DIR must point to the existing local knowledge secrets directory.');
  const token = crypto.randomBytes(16).toString('hex');
  const spaceId = `knowledge-live-benchmark-${token}`;
  const stagedFile = path.join(CONFIG.paths.staging, `${spaceId}.md`);
  const profiles = embeddingProfiles(CONFIG);
  const source = [
    '# Lagos service recovery study',
    'Respondents in Lagos reported that acknowledgement within five minutes and resolution within two hours restored confidence.',
    'The verified satisfaction score after recovery was 92 percent. This evidence is synthetic and contains no personal data.',
  ].join('\n\n');
  const report = { schemaVersion: 1, test: 'qwen-to-gte-live-smoke', at: new Date().toISOString(), success: false, backfill: null, legacyProfileGuard: null, failedRevisionGuard: null, qwen: null, gte: null, overlapAt5: null, cleanup: null };
  let runtime;
  try {
    fs.mkdirSync(CONFIG.paths.staging, { recursive: true });
    fs.writeFileSync(stagedFile, source, { encoding: 'utf8', mode: 0o600 });
    const secrets = readSecrets(secretsDirectory);
    runtime = createKnowledgeRuntime({
      secrets,
      extractGraph: async () => ({ windows: 0, entities: [], claims: [], relations: [] }),
    });
    await runtime.start();
    const knowledgeBaseId = `migration_base_${token}`;
    const documentId = `migration_document_${token}`;
    const sourceSha256 = sha256(fs.readFileSync(stagedFile));
    const indexed = await runtime.index({
      jobId: `migration_index_${token}`,
      spaceId,
      knowledgeBase: {
        id: knowledgeBaseId, indexVersion: 1,
        embeddingModel: profiles['qwen-tei'].model, embeddingDimension: profiles['qwen-tei'].dimensions,
        embeddingProfile: profiles['qwen-tei'], targetEmbeddingProfiles: [profiles['qwen-tei']],
        chunkerVersion: 'migration-live-smoke-v1',
      },
      document: {
        id: documentId, sourcePath: stagedFile, originalName: 'synthetic-migration-smoke.md', mimeType: 'text/markdown',
        sizeBytes: fs.statSync(stagedFile).size, sha256: sourceSha256, metadata: { synthetic: true },
      },
    });
    if (indexed.metrics?.embeddingProfiles?.some((profile) => profile.provider === 'gte-node')) throw new Error('Qwen-only setup unexpectedly wrote GTE before backfill.');
    const arango = new ArangoClient({
      baseUrl: `http://${CONFIG.host}:${CONFIG.ports.arango}`,
      username: CONFIG.database.appUser,
      password: secrets['arango-app'],
    });
    await arango.query(runtime.tenantDatabaseName(spaceId), `
      FOR chunk IN chunks
        FILTER chunk.spaceId == @spaceId
        UPDATE chunk WITH {
          sourceSha256: null,
          embeddingProvider: null,
          embeddingModel: null,
          embeddingRevision: null,
          embeddingDtype: null,
          embeddingDimensions: null,
          vectorIndexVersion: null,
          receiptKey: null,
          operationId: null
        } IN chunks
    `, { spaceId });
    const backfillInput = {
      jobId: `migration_backfill_${token}`, spaceId, knowledgeBaseId, documentId,
      sourceIndexVersion: 1, sourceSha256, sourceChunkerVersion: 'migration-live-smoke-v1',
      sourceEmbeddingProfile: publicProfile(profiles['qwen-tei']), embeddingProfile: publicProfile(profiles['gte-node']),
      afterKey: '', batchSize: 32,
    };
    const updateDocumentModel = (embeddingModel) => arango.query(runtime.tenantDatabaseName(spaceId), `
      FOR document IN documents
        FILTER document.spaceId == @spaceId
        FILTER document.knowledgeBaseId == @knowledgeBaseId
        FILTER document.documentId == @documentId
        FILTER document.indexVersion == 1
        UPDATE document WITH { embeddingModel: @embeddingModel } IN documents
    `, { spaceId, knowledgeBaseId, documentId, embeddingModel });
    await updateDocumentModel('synthetic/wrong-legacy-model');
    let invalidLegacyRejected = false;
    try {
      await runtime.backfill({ ...backfillInput, jobId: `migration_invalid_legacy_${token}` });
    } catch (error) {
      invalidLegacyRejected = error?.code === 'BACKFILL_SOURCE_INVALID';
    }
    if (!invalidLegacyRejected) throw new Error('An untagged legacy vector with the wrong source-document model was accepted.');
    report.legacyProfileGuard = { wrongSourceModelRejected: true };
    await updateDocumentModel(profiles['qwen-tei'].model);
    const backfill = await runtime.backfill(backfillInput);
    if (!backfill.complete || backfill.written < 1 || !backfill.attestation?.signature) {
      throw new Error(`The real GTE backfill did not complete with a signed attestation: ${JSON.stringify({ processed: backfill.processed, written: backfill.written, remaining: backfill.remaining, complete: backfill.complete })}`);
    }
    report.backfill = {
      processed: backfill.processed, written: backfill.written, remaining: backfill.remaining,
      complete: backfill.complete, provider: backfill.provider,
      legacyQwenFixture: true,
      coverage: backfill.coverage,
      attestationHash: backfill.attestation.payloadSha256,
    };
    const failedOperationId = `migration_failed_revision_${token}`;
    const provisioner = new ArangoClient({
      baseUrl: `http://${CONFIG.host}:${CONFIG.ports.arango}`,
      username: CONFIG.database.provisionerUser,
      password: secrets['arango-provisioner'],
    });
    const failingApp = {
      authorization: arango.authorization,
      request: (...arguments_) => arango.request(...arguments_),
      query: async (database, query, variables) => {
        if (query === AQL.upsertReceipt && variables?.receipt?.operationId === failedOperationId) {
          throw Object.assign(new Error('Synthetic failure before revision publication.'), { code: 'SYNTHETIC_COMMIT_FAILURE' });
        }
        return arango.query(database, query, variables);
      },
    };
    const failingRuntime = createKnowledgeRuntime({
      secrets, appClient: failingApp, provisionerClient: provisioner,
      extractGraph: async () => ({ windows: 0, entities: [], claims: [], relations: [] }),
    });
    let failedRevisionRejected = false;
    try {
      await failingRuntime.index({
        jobId: failedOperationId, spaceId,
        knowledgeBase: {
          id: knowledgeBaseId, indexVersion: 2,
          embeddingModel: profiles['qwen-tei'].model, embeddingDimension: profiles['qwen-tei'].dimensions,
          embeddingProfile: profiles['qwen-tei'], targetEmbeddingProfiles: [profiles['qwen-tei']],
          chunkerVersion: 'migration-live-smoke-v1',
        },
        document: {
          id: documentId, sourcePath: stagedFile, originalName: 'synthetic-migration-smoke.md', mimeType: 'text/markdown',
          sizeBytes: fs.statSync(stagedFile).size, sha256: sourceSha256, metadata: { synthetic: true },
        },
      });
    } catch (error) {
      failedRevisionRejected = error?.code === 'SYNTHETIC_COMMIT_FAILURE';
    } finally {
      await failingRuntime.close({ timeoutMs: 30_000, force: true });
    }
    if (!failedRevisionRejected) throw new Error('The synthetic unpublished revision was not rejected.');
    report.failedRevisionGuard = { unpublishedRevision: 2, rejected: true };
    const queryHash = sha256('What recovery timing and satisfaction score were reported?');
    const retrieve = async (profile, suffix, evaluation) => runtime.retrieve({
      requestId: `migration_retrieve_${suffix}_${token}`,
      spaceId,
      knowledgeBases: [{ id: knowledgeBaseId, indexVersion: 2, embeddingProfile: profile }],
      embeddingProfile: profile,
      evaluation,
      query: 'What recovery timing and satisfaction score were reported?',
      topK: 5,
      graphDepth: 0,
    });
    const qwen = await retrieve(profiles['qwen-tei'], 'qwen', false);
    const gte = await retrieve(profiles['gte-node'], 'gte', true);
    const summarize = (result) => ({
      provider: result.metrics?.embeddingProfile?.provider,
      durationMs: result.metrics?.durationMs,
      embeddingMs: result.metrics?.timings?.embeddingMs,
      rerankerMs: result.metrics?.timings?.rerankerMs,
      citationCount: result.citations?.length || 0,
      topKeys: (result.citations || []).map((citation) => sha256(citation.sourceRef)).slice(0, 5),
      grounded: (result.citations || []).some((citation) => /five minutes|two hours|92 percent/i.test(citation.excerpt || '')),
    });
    report.queryHash = queryHash;
    report.qwen = summarize(qwen);
    report.gte = summarize(gte);
    report.overlapAt5 = report.gte.topKeys.filter((key) => report.qwen.topKeys.includes(key)).length / Math.max(1, Math.min(5, report.qwen.topKeys.length));
    if (report.qwen.provider !== 'qwen-tei' || report.gte.provider !== 'gte-node') throw new Error('The smoke mixed or misreported embedding providers.');
    if (!report.qwen.grounded || !report.gte.grounded) throw new Error('One provider failed to retrieve the synthetic expected evidence.');
    report.success = true;
  } finally {
    if (runtime) {
      try {
        report.cleanup = await runtime.cleanupTestTenant({ source: 'knowledge-live-benchmark', spaceId, confirmation: BENCHMARK_CLEANUP_CONFIRMATION });
      } finally {
        await runtime.close({ timeoutMs: 30_000, force: true });
      }
    }
    fs.rmSync(stagedFile, { force: true });
    report.stagedFileRemoved = !fs.existsSync(stagedFile);
  }
  const reportDirectory = path.join(CONFIG.paths.runtime, 'benchmarks');
  fs.mkdirSync(reportDirectory, { recursive: true });
  report.reportFile = path.join(reportDirectory, `migration-live-smoke-${new Date().toISOString().replace(/[:.]/gu, '-')}.json`);
  fs.writeFileSync(report.reportFile, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report;
}

if (require.main === module) {
  runLiveMigrationSmoke().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { runLiveMigrationSmoke };
