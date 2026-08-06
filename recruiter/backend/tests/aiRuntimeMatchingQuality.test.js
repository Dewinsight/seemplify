const assert = require('node:assert/strict');
const test = require('node:test');

const { GPTAnalysisCache, GPTAnalysisService } = require('../services/gptAnalysisService');

const candidates = [
  { _id: 'candidate-a', name: 'Alex A', skills: ['TypeScript'], score: 0.8 },
  { _id: 'candidate-b', name: 'Blair B', skills: ['Kubernetes'], score: 0.7 }
];

function analysis(candidateId, candidateName) {
  return {
    candidate_id: candidateId,
    candidate_name: candidateName,
    skill_match_percentage: 80,
    experience_fit: 8,
    technical_strengths: ['Grounded strength'],
    skill_gaps: [],
    transferable_skills: [],
    cultural_alignment: 7,
    growth_potential: 8,
    interview_focus: ['Probe production evidence'],
    contextual_explanation: 'The supplied experience supports this assessment without adding unsupported facts.',
    confidence_score: 8
  };
}

test('matching prompt supplies stable candidate IDs and preserves source skill order', () => {
  const service = new GPTAnalysisService();
  const originalSkills = ['Kubernetes', 'TypeScript'];
  const cache = new GPTAnalysisCache();
  cache.hashSkills(originalSkills);
  assert.deepEqual(originalSkills, ['Kubernetes', 'TypeScript']);

  const prompt = service.buildBatchAnalysisPrompt({ title: 'Platform Engineer', skills: originalSkills }, candidates);
  assert.match(prompt, /Candidate ID: candidate-a/);
  assert.match(prompt, /Candidate ID: candidate-b/);
  assert.match(prompt, /copy the exact Candidate ID supplied above/);
});

test('matching rejects missing, invented, and duplicate candidate identifiers', () => {
  const service = new GPTAnalysisService();
  assert.throws(
    () => service.validateCandidateAlignment({ analysis: [analysis('invented', 'Alex A'), analysis('candidate-b', 'Blair B')] }, candidates),
    /do not exactly match/i
  );
  assert.throws(
    () => service.validateCandidateAlignment({ analysis: [analysis('candidate-a', 'Alex A'), analysis('candidate-a', 'Blair B')] }, candidates),
    /do not exactly match/i
  );
});

test('matching maps model results by exact ID regardless of response order', () => {
  const service = new GPTAnalysisService();
  const payload = { analysis: [analysis('candidate-b', 'Blair B'), analysis('candidate-a', 'Alex A')] };
  service.validateCandidateAlignment(payload, candidates);
  const formatted = service.formatBatchAnalysisResponse(payload, candidates);
  assert.deepEqual(new Set(formatted.map((item) => String(item.candidate._id))), new Set(['candidate-a', 'candidate-b']));
  assert.equal(formatted.find((item) => item.candidate._id === 'candidate-a').gptAnalysis.explanation, payload.analysis[1].contextual_explanation);
});
