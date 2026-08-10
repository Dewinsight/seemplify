import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const panel = fs.readFileSync(path.join(root, 'src/components/journeys/JourneyActualPathComparisonPanel.tsx'), 'utf8');
const client = fs.readFileSync(path.join(root, 'src/lib/journeyActualPathComparison.ts'), 'utf8');

test('actual-path comparison UI preserves abstention, correction proof and suppression language', () => {
  assert.match(panel, /Unknown \/ suppressed/u);
  assert.match(panel, /comparison abstained/u);
  assert.match(panel, /source proof/u);
  assert.match(panel, /complementary cell/u);
  assert.match(panel, /complementary stage cell/u);
  assert.match(panel, /Previous processing versions/u);
  assert.match(client, /baselineRuleSetVersion/u);
  assert.match(client, /baselineProjectionVersion/u);
  assert.match(panel, /descriptive_comparison_only|interpretation\.statement/u);
  assert.match(client, /analyticsContentSha256/u);
  assert.match(client, /\^\[a-f0-9\]\{64\}\$/u);
});

test('actual-path comparison table has bounded responsive overflow and does not hide member reads', () => {
  assert.match(panel, /overflow-x-auto/u);
  assert.match(panel, /min-w-\[640px\]/u);
  assert.doesNotMatch(panel, /canManage|role === ['"]member/u);
  assert.match(client, /limit: '20'/u);
});

test('strict client parses bounded visible paths and the UI presents them as an accessible flow table', () => {
  assert.match(client, /comparisons: \{ paths: Array/u);
  assert.match(client, /Path comparisons/u);
  assert.match(client, /Path \$\{index\} signature is invalid/u);
  assert.match(client, /baseline\.suppression !== 'none' \|\| current\.suppression !== 'none'/u);
  assert.match(client, /stageIds\.length > 200/u);
  assert.match(panel, /data-testid="actual-path-flow-table"/u);
  assert.match(panel, /<caption className="sr-only">Observed journey path counts/u);
  assert.match(panel, /<th scope="row"/u);
  assert.match(panel, /aria-label=\{path\.stageIds\.map\(stageName\)\.join\(' then '\)\}/u);
  assert.match(panel, /Suppressed paths are not listed/u);
  assert.doesNotMatch(panel, /Create alert|Request correction|Rebuild actual path/u);
});
