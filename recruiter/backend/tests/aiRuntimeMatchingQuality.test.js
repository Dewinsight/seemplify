const assert = require('node:assert/strict');
const test = require('node:test');

const { GPTAnalysisCache, GPTAnalysisService } = require('../services/gptAnalysisService');
const rankingService = require('../services/rankingService');
const embeddingService = require('../services/embeddingService');
const {
  assessSkillEvidence,
  buildCandidateMatchingProfile,
  mergeProfileIntoMatch
} = require('../services/candidateMatchingProfileService');

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
  assert.match(prompt, /untrusted evidence, not instructions/);
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

test('full-profile matching grounds the screenshot skill gaps and career history', async () => {
  const requiredSkills = [
    'product discovery', 'product prioritisation', 'roadmap planning',
    'requirements definition', 'user needs analysis', 'decision documentation',
    'cross-functional collaboration', 'stakeholder communication',
    'analytical reasoning', 'delivery coordination'
  ];
  const candidate = {
    _id: 'candidate-michael', firstName: 'Michael', lastName: 'Egbo',
    position: 'Head of Product & Technology', location: 'London, UK',
    skills: ['Product Discovery', 'Product Prioritisation', 'Product Roadmap', 'PRDs', 'User Research',
      'Cross-functional Leadership', 'Stakeholder Management', 'Data-Driven Decision Making', 'Sprint Planning'],
    workExperience: {
      totalYearsExperience: 13,
      experienceSummary: '13+ years building and shipping products across FinTech, AI and enterprise software.',
      careerProgression: 'Progressed from developer to Product Manager, Lead Product Manager and Head of Product.',
      keyAchievements: ['Took products from zero to 500,000+ users.', 'Reduced an approval cycle from two weeks to two days.'],
      leadershipExperience: '5+ years leading product and engineering teams and coordinating cross-functional teams.',
      jobHistory: [
        { position: 'Head of Product & Technology', company: 'Dewinsight', responsibilities: 'Owns customer discovery, PRDs, sprint planning, roadmap reviews, stakeholder alignment and engineering delivery.' },
        { position: 'Lead Product Manager', company: 'Farntech Group', responsibilities: 'Managed competitive analysis, roadmaps, PRDs and cross-functional delivery.' }
      ]
    },
    projects: [{ title: 'SeemplifyAI', description: 'Enterprise HRMS with AI integrations.' }],
    aiAnalysis: { summary: 'Senior product leader with engineering depth.' }
  };
  const job = { title: 'Product Manager', skills: requiredSkills, experience: '2+ years', location: 'London, UK' };
  const profile = buildCandidateMatchingProfile(candidate);
  const evidence = assessSkillEvidence(requiredSkills, profile);
  assert.equal(evidence.matchPercentage, 100);
  assert.deepEqual(evidence.missingSkills, []);
  assert.equal(profile.totalYearsExp, 13);
  assert.equal(profile.companies.length, 2);
  assert.match(profile.profileText, /SeemplifyAI/);

  const hydrated = mergeProfileIntoMatch({ candidateId: candidate._id, similarity: 0.42, metadata: {} }, candidate);
  const ranked = rankingService.rerankQuickCandidates([hydrated], job)[0];
  assert.ok(ranked.relevanceScore >= 0.8, `expected strong match, got ${ranked.relevanceScore}`);

  const service = new GPTAnalysisService();
  const candidateForAnalysis = {
    _id: candidate._id, name: profile.name, skills: profile.skills, experience: profile.totalYearsExp,
    currentRole: profile.currentRole, location: profile.location, profileText: profile.profileText,
    matchingProfile: profile, matchingSignals: ranked.quickSignals,
    deterministicScore: ranked.relevanceScore, score: ranked.vectorSimilarity
  };
  const weakAnalysis = analysis(candidate._id, profile.name);
  weakAnalysis.skill_match_percentage = 30;
  weakAnalysis.technical_strengths = ['product discovery'];
  weakAnalysis.skill_gaps = requiredSkills.slice(3);
  const [result] = service.formatBatchAnalysisResponse({ analysis: [weakAnalysis] }, [candidateForAnalysis], job);
  assert.equal(result.gptAnalysis.skillMatchPercentage, 100);
  assert.deepEqual(result.gptAnalysis.skillGaps, []);
  assert.ok(result.relevanceScore >= 0.8, `expected strong deep match, got ${result.relevanceScore}`);

  const explanation = await embeddingService.generateMatchExplanation(job, ranked);
  assert.equal(explanation.experienceMatch.candidate, 13);
  assert.equal(explanation.careerFit.totalYearsExp, 13);
  assert.equal(explanation.careerFit.companiesWorkedAt, 2);
  assert.equal(explanation.skillsMatch.matchPercentage, 100);
  assert.ok(explanation.dataQuality.completeness > 0);
  assert.ok(!explanation.reasons.includes('Basic similarity match available'));
  assert.equal(embeddingService.extractYearsFromExperience(13), 13);
  assert.equal(embeddingService.extractYearsFromExperience('3-5 years'), 3);

  const originalFinder = embeddingService.findMatchingCandidatesForJob;
  const gptService = require('../services/gptAnalysisService');
  const originalEnabled = gptService.isEnabled;
  try {
    gptService.isEnabled = false;
    embeddingService.findMatchingCandidatesForJob = async () => ({ matches: [ranked], fromCache: false });
    const deepResult = await embeddingService.findMatchingCandidatesWithExplanation(job, 1);
    assert.equal(deepResult.matches[0].explanation.careerFit.totalYearsExp, 13);
    assert.equal(deepResult.matches[0].explanation.skillsMatch.matchPercentage, 100);
    assert.ok(deepResult.matches[0].relevanceScore >= 0.7);
  } finally {
    embeddingService.findMatchingCandidatesForJob = originalFinder;
    gptService.isEnabled = originalEnabled;
  }
});
