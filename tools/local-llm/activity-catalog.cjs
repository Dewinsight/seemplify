const activityNames = Object.freeze([
  'recruiter.general',
  'candidate.cv_parse', 'candidate.insights',
  'job.description', 'job.requirements', 'job.normalize',
  'matching.analysis', 'matching.report',
  'assistant.chat', 'assistant.tool_selection', 'assistant.memory', 'assistant.title', 'assistant.job_extract',
  'analytics.candidates', 'analytics.jobs', 'analytics.hiring', 'report.analysis',
  'interview.questions', 'interview.bias', 'interview.analysis', 'interview.summary', 'interview.team_feedback',
  'ai_interview.chat.introduction', 'ai_interview.chat.clarification', 'ai_interview.chat.acknowledgement',
  'ai_interview.question_generation', 'ai_interview.cv_parse', 'ai_interview.scoring',
  'performance.general', 'performance.okr', 'performance.review', 'performance.appraisal',
  'performance.meeting', 'performance.calibration', 'performance.development',
  'performance.self_assessment.chat', 'performance.self_assessment.report',
  'performance.self_assessment.coach', 'performance.document.analysis',
  'performance.manager_review.assist', 'performance.review.bias',
  'performance.development_plan.suggest', 'performance.okr.generate',
  'performance.feedback.analyze', 'performance.team.insights',
  'performance.meeting.analysis', 'performance.appraisal.chat',
  'performance.calibration.insights'
]);

const highReasoning = new Set([
  'job.description', 'matching.analysis', 'interview.analysis', 'ai_interview.scoring',
  'performance.review', 'performance.appraisal', 'performance.calibration',
  'performance.self_assessment.report', 'performance.document.analysis',
  'performance.manager_review.assist', 'performance.review.bias',
  'performance.team.insights', 'performance.meeting.analysis',
  'performance.calibration.insights'
]);
const lowReasoning = new Set([
  'assistant.title', 'ai_interview.chat.introduction',
  'ai_interview.chat.clarification', 'ai_interview.chat.acknowledgement'
]);

const ACTIVITY_DEFINITIONS = Object.freeze(Object.fromEntries(activityNames.map((activity) => [activity, {
  reasoningEffort: highReasoning.has(activity) ? 'high' : lowReasoning.has(activity) ? 'low' : 'medium'
}])));

function localProviderLabel(provider, model) {
  const engine = String(provider || '').replace(/^local-/, '');
  const names = { claude: 'Claude Code', codex: 'Codex CLI', ollama: 'Ollama', vllm: 'vLLM' };
  return `${names[engine] || engine || 'Local inference'}: ${String(model || 'selected model')}`;
}

module.exports = { ACTIVITY_DEFINITIONS, localProviderLabel };
