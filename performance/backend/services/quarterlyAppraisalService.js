const AppraisalCycle = require('../models/AppraisalCycle');
const User = require('../models/User');
const { cloneBuiltInTemplate, normalizeDesign, templateSnapshot } = require('./appraisalCycleDesignService');

function quarterDefaults(organizationId, year, quarter) {
  const start = new Date(Date.UTC(year, (quarter - 1) * 3, 1));
  const end = new Date(Date.UTC(year, quarter * 3, 0, 23, 59, 59, 999));
  const opening = new Date(Date.UTC(year, quarter * 3, 1));
  const days = (count) => new Date(opening.getTime() + count * 86400000);
  const template = cloneBuiltInTemplate();
  return { organizationId, defaultQuarterKey: `${year}-Q${quarter}`, name: `Q${quarter} ${year} performance review`,
    description: 'Quarterly review of completed work. HR can edit the questions and dates. Reviews start when a colleague selects participants.',
    cycleType: 'quarterly', scope: { type: 'organization', targetIds: [] }, periodStart: start, periodEnd: end,
    workflowDefinition: normalizeDesign(template.design), sourceTemplate: templateSnapshot(template),
    responseDeadlines: { selfAssessmentDue: days(7), managerReviewDue: days(14) },
    phases: { selfAssessment: { startDate: opening, endDate: days(7) }, managerReview: { startDate: opening, endDate: days(14) } },
    createdBy: { userId: 'system-quarterly', name: 'Seemplify' }, status: 'draft' };
}

async function ensureQuarterlyCycles(organizationId, now = new Date()) {
  if (!organizationId) return;
  const year = now.getUTCFullYear();
  // Include the previous Q4 for reviews conducted at the beginning of the year.
  const periods = [[year - 1, 4], ...[1, 2, 3, 4].map((quarter) => [year, quarter])];
  for (const [periodYear, quarter] of periods) {
    const defaults = quarterDefaults(String(organizationId), periodYear, quarter);
    try {
      await AppraisalCycle.updateOne({ organizationId: String(organizationId), defaultQuarterKey: defaults.defaultQuarterKey },
        { $setOnInsert: defaults }, { upsert: true, setDefaultsOnInsert: true });
    } catch (error) { if (error.code !== 11000) throw error; }
  }
}

async function seedAllOrganizations() {
  const organizations = new Set([
    ...await User.distinct('currentOrganizationId'),
    ...await User.distinct('idpTeams.organizationId'),
    ...await User.distinct('organizationMemberships.organization'),
    ...await AppraisalCycle.distinct('organizationId')
  ].filter(Boolean).map(String));
  for (const organizationId of organizations) await ensureQuarterlyCycles(organizationId);
}

function startQuarterlyCycleScheduler() {
  const run = () => seedAllOrganizations().catch((error) => console.error('Quarterly cycle setup failed:', error.message));
  void run();
  return require('node-cron').schedule('15 0 * * *', run, { timezone: 'UTC', noOverlap: true });
}

module.exports = { quarterDefaults, ensureQuarterlyCycles, seedAllOrganizations, startQuarterlyCycleScheduler };
