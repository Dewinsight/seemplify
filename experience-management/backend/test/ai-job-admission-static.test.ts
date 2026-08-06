import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');

function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const resolved = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(resolved) : entry.name.endsWith('.ts') ? [resolved] : [];
  });
}

function source(name: string) {
  return fs.readFileSync(path.join(sourceRoot, name), 'utf8');
}

test('production AI producers cannot bypass atomic durable admission', () => {
  const forbidden = ['createAiJobFixture', 'claimNextAiJobFixture'];
  for (const file of sourceFiles(sourceRoot)) {
    if (path.basename(file) === 'database.ts') continue;
    const contents = fs.readFileSync(file, 'utf8');
    for (const symbol of forbidden) {
      assert.equal(contents.includes(symbol), false, `${path.relative(sourceRoot, file)} must not use ${symbol}`);
    }
    if (path.basename(file) !== 'aiJobAdmission.ts') {
      assert.equal(contents.includes('insertUnadmittedAiJobRecord'), false,
        `${path.relative(sourceRoot, file)} must not insert an unadmitted AI job`);
    }
  }

  for (const producer of ['app.ts', 'assistant.ts', 'deepAnalysis.ts', 'intelligence.ts', 'xIntegration.ts']) {
    assert.match(source(producer), /createAdmittedAiJob/u, `${producer} must use atomic durable admission`);
  }
  assert.match(source('aiJobs.ts'), /claimNextAdmittedAiJob/u);
  assert.match(source('aiJobs.ts'), /reserveAiJobRetryAttempt/u);
  assert.match(source('aiJobRetry.ts'), /reserveAiJobRetryAttempt/u);
  assert.match(source('intelligence.ts'), /reserveAiJobRetryAttempt/u);
});

test('quota-denied worker claims share terminal artifact bookkeeping and publication with other failures', () => {
  const worker = source('aiJobs.ts');
  assert.match(worker, /if \(claim\.denied\) \{\s*failJobAndLinkedArtifacts\(claim\.job,/u);
  assert.match(worker, /failJobAndLinkedArtifacts\(job, message, stage\)/u);
  assert.match(worker, /failIntelligenceArtifact\(job\.kind, job\.input, message, job\.spaceId\)/u);
  assert.match(worker, /failDeepAnalysisJob\(job, message\)/u);
  assert.match(worker, /failAssistantRun\(runId, job\.spaceId, message\)/u);
  assert.match(worker, /publishJobState\(failed, job\.spaceId\)/u);
});
