import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { insightResult } from '../src/aiSchemas.js';

const aiJobsSource = fs.readFileSync(new URL('../src/aiJobs.ts', import.meta.url), 'utf8');

const goldenInsight = {
  executiveSummary: 'Onboarding instructions are the clearest source of avoidable effort.', healthScore: 58,
  keyFindings: [{ title: 'Instructions create effort', detail: 'Respondents cannot identify the first setup step.', evidence: ['The setup instructions were difficult to follow.'], impact: 'high' }],
  themes: [{ name: 'Onboarding clarity', frequency: 1, sentiment: 'negative', evidence: ['The setup instructions were difficult to follow.'] }],
  drivers: [{ name: 'Instruction clarity', direction: 'negative', strength: 0.82, explanation: 'The completed response directly identifies unclear setup guidance.' }],
  risks: [{ title: 'Early abandonment', detail: 'Unclear setup may prevent activation.', evidence: ['The setup instructions were difficult to follow.'], impact: 'high' }],
  opportunities: [{ title: 'Clarify the first milestone', detail: 'Give customers one explicit first step.', evidence: ['The setup instructions were difficult to follow.'], impact: 'high' }],
  recommendations: [{ action: 'Rewrite and usability-test the first setup step', owner: 'Onboarding product manager', priority: 'now', rationale: 'It addresses the only evidenced friction directly.' }],
  forecast: { direction: 'insufficient_data', confidence: 0.2, explanation: 'One completed response cannot establish a trend.' }
} as const;

test('survey intelligence harness accepts decision-ready structured analysis', () => {
  const parsed = insightResult.parse(goldenInsight);
  assert.equal(parsed.recommendations[0].priority, 'now');
  assert.equal(parsed.forecast.direction, 'insufficient_data');
  assert.ok(parsed.keyFindings[0].evidence.length > 0);
});

test('survey intelligence harness rejects translation leakage', () => {
  const frenchTranslation = { language: 'French', title: 'Enquête client', description: 'Votre avis', thankYouMessage: 'Merci', questions: [] };
  assert.equal(insightResult.safeParse(frenchTranslation).success, false);
  assert.match(aiJobsSource, /This is analysis, never translation/);
  assert.match(aiJobsSource, /insertInsight\(survey\.id, 'ai_insights', result\.output(?:, job\.id)?\)/);
  assert.match(aiJobsSource, /insertInsight\(survey\.id, 'research_answer'/);
  assert.match(aiJobsSource, /savedInsightId: saved\.id/);
});
