import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root=path.resolve(import.meta.dirname,'..','src');
const read=(...parts)=>fs.readFileSync(path.join(root,...parts),'utf8');
const client=read('lib','journeyPredictiveGovernance.ts');const page=read('pages','JourneyPredictiveGovernancePage.tsx');
const app=read('App.tsx');const shell=read('components','AppShell.tsx');const routes=fs.readFileSync(path.resolve(root,'..','..','backend','src','journeyPredictiveGovernanceRoutes.ts'),'utf8');

test('predictive governance is lazy routed behind the approved journey intelligence entitlement',()=>{
  assert.match(app,/const JourneyPredictiveGovernancePage = lazy/u);assert.match(app,/path="\/journey-predictive-governance"/u);
  assert.match(shell,/to: '\/journey-predictive-governance'.*feature: 'journeyActualPaths'/u);assert.match(page,/useSessionFeature\('journeyActualPaths'\)/u);
});
test('tenant-free strict client covers policy, model, drift and evaluation records',()=>{
  for(const call of ['listPredictiveGovernance','approvePredictiveModel','retirePredictiveModel','updatePredictionPolicy','recordDriftEvaluation','evaluatePrediction','listPredictionRuns'])assert.ok(client.includes(call),call);
  assert.ok((client.match(/\.strict\(\)/gu)||[]).length>=10);assert.doesNotMatch(client,/spaceId/u);assert.match(routes,/resolveRequestSpace\(request, user\.id\)/u);
  assert.match(routes,/z\.literal\('governed_fixture'\)/u);assert.doesNotMatch(routes,/approved_deterministic/u);
});
test('the surface is explicit about fixture provenance, abstention and content-safe evidence',()=>{
  for(const phrase of ['No training or live inference','explicitly fixture evidence, never live inference','abstains whenever consent','Raw subjects and feature values are not retained','Read-only: members'])assert.ok(page.includes(phrase),phrase);
  assert.match(page,/reason instanceof ApiError&&reason\.status===409/u);assert.match(page,/overflow-x-auto/u);assert.doesNotMatch(page,/gradient|backdrop-blur|rounded-\[2/iu);
});
