'use strict';

/**
 * Stable activity identifiers shared by Performance Management, the Recruiter
 * AI account service, and the hosted inference gateway. They are deliberately
 * product actions rather than route names so a user's override follows the
 * action wherever it is invoked.
 */
const AI_ACTIVITIES = Object.freeze({
  GENERAL: 'performance.general',
  SELF_ASSESSMENT_CHAT: 'performance.self_assessment.chat',
  SELF_ASSESSMENT_REPORT: 'performance.self_assessment.report',
  SELF_ASSESSMENT_COACH: 'performance.self_assessment.coach',
  DOCUMENT_ANALYSIS: 'performance.document.analysis',
  MANAGER_REVIEW_ASSIST: 'performance.manager_review.assist',
  REVIEW_BIAS: 'performance.review.bias',
  DEVELOPMENT_PLAN_SUGGEST: 'performance.development_plan.suggest',
  OKR_GENERATE: 'performance.okr.generate',
  FEEDBACK_ANALYZE: 'performance.feedback.analyze',
  TEAM_INSIGHTS: 'performance.team.insights',
  MEETING_ANALYSIS: 'performance.meeting.analysis',
  APPRAISAL_CHAT: 'performance.appraisal.chat',
  CALIBRATION_INSIGHTS: 'performance.calibration.insights',
  SUPPORT_PLAN_DRAFT: 'performance.support_plan.draft',
  TALENT_EVIDENCE_BRIEF: 'performance.talent.evidence_brief'
});

const ACTIVITY_CATALOG = Object.freeze([
  { id: AI_ACTIVITIES.GENERAL, label: 'Performance general', description: 'Fallback for uncategorized Performance AI actions', defaultEffort: 'low' },
  { id: AI_ACTIVITIES.SELF_ASSESSMENT_CHAT, label: 'Self-assessment conversation', description: 'Guided reflection and follow-up questions', defaultEffort: 'medium' },
  { id: AI_ACTIVITIES.SELF_ASSESSMENT_REPORT, label: 'Self-assessment report', description: 'Report drafting, analysis, and suggested rating', defaultEffort: 'high' },
  { id: AI_ACTIVITIES.SELF_ASSESSMENT_COACH, label: 'Self-assessment writing coach', description: 'Focused suggestions for individual assessment fields', defaultEffort: 'medium' },
  { id: AI_ACTIVITIES.DOCUMENT_ANALYSIS, label: 'Evidence analysis', description: 'Extract appraisal evidence from uploaded documents', defaultEffort: 'high' },
  { id: AI_ACTIVITIES.MANAGER_REVIEW_ASSIST, label: 'Manager review assistant', description: 'Draft and improve manager assessments', defaultEffort: 'high' },
  { id: AI_ACTIVITIES.REVIEW_BIAS, label: 'Bias review', description: 'Check reviews and ratings for potential bias', defaultEffort: 'high' },
  { id: AI_ACTIVITIES.DEVELOPMENT_PLAN_SUGGEST, label: 'Development planning', description: 'Suggest development actions and resources', defaultEffort: 'medium' },
  { id: AI_ACTIVITIES.OKR_GENERATE, label: 'OKR drafting', description: 'Generate measurable objectives and key results', defaultEffort: 'medium' },
  { id: AI_ACTIVITIES.FEEDBACK_ANALYZE, label: 'Feedback analysis', description: 'Analyze sentiment and actionability of feedback', defaultEffort: 'medium' },
  { id: AI_ACTIVITIES.TEAM_INSIGHTS, label: 'Team insights', description: 'Summarize team performance patterns', defaultEffort: 'high' },
  { id: AI_ACTIVITIES.MEETING_ANALYSIS, label: 'One-to-one analysis', description: 'Analyze meetings, trends, and follow-up actions', defaultEffort: 'high' },
  { id: AI_ACTIVITIES.APPRAISAL_CHAT, label: 'Appraisal discussion assistant', description: 'Support appraisal conversations and questions', defaultEffort: 'medium' },
  { id: AI_ACTIVITIES.CALIBRATION_INSIGHTS, label: 'Calibration insights', description: 'Analyze rating distributions and calibration risk', defaultEffort: 'high' },
  { id: AI_ACTIVITIES.SUPPORT_PLAN_DRAFT, label: 'Support-plan drafting', description: 'Draft measurable objectives and support commitments for human review', defaultEffort: 'high' },
  { id: AI_ACTIVITIES.TALENT_EVIDENCE_BRIEF, label: 'Talent evidence brief', description: 'Summarize authorized evidence without making talent or promotion decisions', defaultEffort: 'high' }
]);

function activityDefinition(id) {
  return ACTIVITY_CATALOG.find((activity) => activity.id === id) || null;
}

function performancePreferences(preferences) {
  if (!preferences || typeof preferences !== 'object') return preferences;
  return {
    ...preferences,
    // Account defaults intentionally remain untouched: they belong to the
    // shared connected account and therefore apply in Recruiter as well.
    activities: Array.isArray(preferences.activities)
      ? preferences.activities.filter((item) => (
        (item?.app === 'performance' || String(item?.activity || '').startsWith('performance.'))
          && Boolean(activityDefinition(String(item?.activity || '')))
      ))
      : []
  };
}

module.exports = { AI_ACTIVITIES, ACTIVITY_CATALOG, activityDefinition, performancePreferences };
