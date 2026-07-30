const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const manager = fs.readFileSync(path.join(__dirname, 'manage.ps1'), 'utf8');

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
  assert.match(manager, /modelCache=\[ordered\]/);
  assert.match(manager, /models--Qwen--Qwen3-Embedding-4B/);
  assert.match(manager, /models--BAAI--bge-reranker-v2-m3/);
});
