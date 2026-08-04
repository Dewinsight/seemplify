const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const manager = fs.readFileSync(path.join(__dirname, 'manage.ps1'), 'utf8');
const experienceManager = fs.readFileSync(path.join(__dirname, '..', '..', 'experience-management', 'scripts', 'manage.ps1'), 'utf8');
const postgresE2e = fs.readFileSync(path.join(__dirname, '..', '..', 'experience-management', 'scripts', 'test-postgres-e2e.mjs'), 'utf8');
const postgresMigrationTest = fs.readFileSync(path.join(__dirname, '..', '..', 'experience-management', 'scripts', 'test-postgres-runtime-migration.mjs'), 'utf8');
const packageManifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
const packageLock = JSON.parse(fs.readFileSync(path.join(__dirname, 'package-lock.json'), 'utf8'));

test('manager owns only labelled loopback containers with pinned digests', () => {
  assert.match(manager, /ai\.seemplify\.owner=local-knowledge/);
  for (const port of [8529, 11541, 11542, 11543]) assert.match(manager, new RegExp(`127\\.0\\.0\\.1:${port}:`));
  assert.doesNotMatch(manager, /cloudflare/i);
  assert.match(manager, /arangod --vector-index/);
  assert.doesNotMatch(manager, /source=\$SecretsDir,target=\/run\/secrets/);
  assert.match(manager, /arangodb@sha256:bf5eabc0/);
  assert.match(manager, /text-embeddings-inference@sha256:8aeb9721/);
  assert.match(manager, /docling-serve-cpu@sha256:cc207e1e/);
  assert.equal((manager.match(/source=\$\(Join-Path \$DataRoot 'models'\),target=\/data/g) || []).length, 2);
  assert.doesNotMatch(manager, /models\\qwen3-embedding-4b|models\\bge-reranker-v2-m3/i);
});

test('TEI log persistence is disabled and readers redact nested secrets', () => {
  assert.equal((manager.match(/--log-driver','none'/g) || []).length, 2);
  assert.match(manager, /Raw TEI logs are disabled/);
  assert.match(manager, /Some\\\(/);
});

test('secret generation remains compatible with Windows PowerShell 5.1', () => {
  assert.doesNotMatch(manager, /RandomNumberGenerator\]::Fill/);
  assert.match(manager, /RandomNumberGenerator\]::Create\(\)/);
  assert.match(manager, /\.GetBytes\(\$bytes\)/);
  assert.match(manager, /\.Dispose\(\)/);
  assert.match(manager, /foreach \(\$key in @\(\$state\.Keys\)\)/);
});

test('sh command payloads survive Windows PowerShell 5.1 native argument marshalling', () => {
  assert.doesNotMatch(manager, /"\$\(cat \/run\/secrets\//);
  assert.equal((manager.match(/\$\(cat \/run\/secrets\//g) || []).length, 4);
});

test('manager exposes lifecycle and default-off autostart without destructive removal', () => {
  for (const action of ['start','graceful-stop','restart','force-stop','enable-auto-start','disable-auto-start','load','unload','reconcile','logs','bootstrap']) {
    assert.ok(manager.includes(`'${action}'`));
  }
  assert.match(manager, /autoStart=\$false/);
  assert.doesNotMatch(manager, /docker\.exe\s+(rm|volume rm|system prune)/i);
  assert.match(manager, /D:\\SeemplifyKnowledge/);
  assert.match(manager, /service-secret/);
  assert.match(manager, /DependencyReadySeconds = 1200/);
  assert.match(manager, /\[bool\]\$status\.ready/);
  assert.match(manager, /client\.cjs'\) shutdown/);
  assert.match(manager, /WaitForExit\(35000\)/);
  assert.match(manager, /modelCache=\[ordered\]/);
  assert.match(manager, /models--Qwen--Qwen3-Embedding-4B/);
  assert.match(manager, /models--BAAI--bge-reranker-v2-m3/);
});

test('all launchers reuse the runtime root mounted by an owned shared container', () => {
  for (const source of [manager, experienceManager]) {
    assert.match(source, /SEEMPLIFY_KNOWLEDGE_RUNTIME_DIR/);
    assert.match(source, /seemplify-knowledge-arango/);
    assert.match(source, /ai\.seemplify\.owner/);
    assert.match(source, /\/run\/secrets\/arango-root/);
    assert.match(source, /Split-Path -Parent \$secretsRoot/);
  }
  assert.match(manager, /\$env:SEEMPLIFY_KNOWLEDGE_RUNTIME_DIR = \$RuntimeDir/);
  assert.match(experienceManager, /\$env:SEEMPLIFY_KNOWLEDGE_RUNTIME_DIR = \$KnowledgeRuntimeDir/);
  assert.match(manager, /runtimeRoot=\$RuntimeDir/);
});

test('GTE dependency is exact, checked read-only, and installed only when configured', () => {
  assert.equal(packageManifest.dependencies['@huggingface/transformers'], '4.2.0');
  assert.equal(packageLock.packages[''].dependencies['@huggingface/transformers'], '4.2.0');
  assert.equal(packageLock.packages['node_modules/@huggingface/transformers'].version, '4.2.0');
  assert.match(manager, /function Get-GteDependencyStatus/);
  assert.match(manager, /npm\.cmd/);
  assert.match(manager, /ci --omit=dev --no-audit --no-fund/);
  assert.match(manager, /if \(\$embeddingConfiguration\.gteRequired\) \{ \[void\]\(Ensure-GteDependencies\) \}/);
  assert.doesNotMatch(manager, /Get-Status[\s\S]{0,800}Ensure-GteDependencies/);
});

test('CPU GTE is the default while the explicit Qwen rollback path remains bounded', () => {
  for (const source of [manager, experienceManager]) {
    assert.match(source, /EXPERIENCE_EMBEDDING_PROVIDER/);
    assert.match(source, /EXPERIENCE_EMBEDDING_DUAL_WRITE/);
    assert.match(source, /EXPERIENCE_EMBEDDING_ROLLOUT_PERCENT/);
    assert.match(source, /EXPERIENCE_EMBEDDING_SHADOW_PERCENT/);
    assert.match(source, /EXPERIENCE_EMBEDDING_FORCE_QWEN/);
    assert.match(source, /EXPERIENCE_QWEN_ROLLBACK_RETAINED/);
    assert.match(source, /if \(\[string\]::IsNullOrWhiteSpace\(\$provider\)\) \{ \$provider = 'gte-node' \}/);
    assert.match(source, /\$provider = 'qwen-tei'[\s\S]{0,180}\$dualWrite = \$false[\s\S]{0,180}\$rolloutPercent = 0[\s\S]{0,180}\$shadowPercent = 0/);
    assert.match(source, /\$defaultRolloutPercent = if \(\$provider -eq 'gte-node'\) \{ 100 \} else \{ 0 \}/);
    assert.match(source, /\$provider -eq 'gte-node' -and \$qwenRollbackRetained -and -not \$dualWrite/);
    assert.match(source, /\$provider -eq 'gte-node' -and -not \$qwenRollbackRetained -and \$dualWrite/);
    assert.match(source, /EXPERIENCE_VECTOR_INDEX_VERSION/);
    assert.match(source, /gte-modernbert-v1/);
  }
  assert.match(manager, /Get-IntegerEnvironment 'EXPERIENCE_EMBEDDING_CONCURRENCY' 8 1 8/);
  assert.match(manager, /if \(\$embeddingConfiguration\.qwenRequired\) \{ Start-Embedding \}/);
  assert.equal((manager.match(/Start-Reranker/g) || []).length >= 3, true, 'BGE lifecycle must remain present');
});

test('signed status surfaces migration, GTE, queue, backfill, provider, and resource telemetry', () => {
  assert.match(manager, /Get-SignedRuntimeStatus/);
  assert.match(manager, /signedRuntimeStatusAvailable/);
  for (const field of ['gte=', 'migration=', 'backfill=', 'queue=', 'providers=', 'resources=']) {
    assert.ok(manager.includes(field), `missing operational field ${field}`);
  }
  assert.match(manager, /gteRequired=\$gteRequired/);
  assert.match(manager, /forceQwenRollback=\$forceQwen/);
  assert.match(manager, /models\\transformers|Join-Path \$modelRoot 'transformers'/);
});

test('managed PostgreSQL runtime and isolated harnesses target additive schema eleven', () => {
  assert.match(experienceManager, /\$PostgresRuntimeSchemaVersion = 11/);
  assert.match(experienceManager, /postgres-runtime-schema-v11-started/);
  assert.match(postgresE2e, /POSTGRES_RUNTIME_SCHEMA_VERSION: '11'/);
  assert.match(postgresE2e, /'--target-version', '10'/);
  assert.match(postgresMigrationTest, /'--target-version', '11'/);
  assert.match(postgresMigrationTest, /0003_knowledge_embedding_profiles\.sql/);
  assert.match(postgresMigrationTest, /0004_experience_assistant\.sql/);
  assert.match(postgresMigrationTest, /0012_intentional_failure\.sql/);
  assert.match(postgresMigrationTest, /knowledge_backfill_runs/);
  assert.match(postgresMigrationTest, /assistant_runs/);
  assert.match(postgresMigrationTest, /0010_deep_corpus_analysis\.sql/);
  assert.match(postgresMigrationTest, /0011_bounded_active_request_indexes\.sql/);
});
