'use strict';
const { DomainError, cleanObject } = require('../../contracts/competency');
const { BUILT_IN_TEMPLATES, validateDesign, cloneBuiltInTemplate } = require('../appraisalCycleDesignService');
const fail = message => { throw new DomainError(422, 'INVALID_CYCLE_SETUP', message); };
function setup(input = {}) {
  const reviewMode = input.reviewMode === undefined ? 'competency' : input.reviewMode;
  if (!['regular', 'competency', 'combined'].includes(reviewMode)) fail('Choose regular appraisal, role competency, or combined review.');
  const cadence = input.cadence === undefined ? { type: 'one_time' } : input.cadence;
  cleanObject(cadence, ['type', 'frequency']);
  if (!['one_time', 'periodic'].includes(cadence.type)) fail('Choose one-time or periodic assessment.');
  if (cadence.type === 'periodic' && !['monthly', 'quarterly', 'semi_annual', 'annual'].includes(cadence.frequency)) fail('Choose how often the review repeats.');
  if (cadence.type === 'one_time' && cadence.frequency) fail('One-time reviews do not repeat.');
  const regularTemplateId = input.regularTemplateId || 'balanced_performance';
  if (!BUILT_IN_TEMPLATES.some(template => template.id === regularTemplateId)) fail('Choose a published regular appraisal template.');
  let workflowDefinition = input.workflowDefinition || null;
  if (workflowDefinition) { const checked = validateDesign(workflowDefinition); if (checked.errors.length) fail(checked.errors[0]); workflowDefinition = checked.design; }
  if (input.includeApprovedGoals !== undefined && typeof input.includeApprovedGoals !== 'boolean') fail('Choose whether to include approved goals.');
  return { reviewMode, cadence: { type: cadence.type, ...(cadence.type === 'periodic' ? { frequency: cadence.frequency } : {}) }, regularTemplateId, workflowDefinition, includeApprovedGoals: input.includeApprovedGoals === true };
}
function regularWorkflow(cycle) {
  const config = setup(cycle);
  const design = JSON.parse(JSON.stringify(config.workflowDefinition || cloneBuiltInTemplate(config.regularTemplateId).design));
  if (config.includeApprovedGoals) return design;
  const sections = design.sections.filter(section => section.type !== 'goals');
  const scored = sections.filter(section => section.scored), total = scored.reduce((sum, section) => sum + section.weight, 0);
  if (!scored.length || total <= 0) fail('Choose positively weighted non-goal questions, or include approved goals.');
  design.sections = sections.map(section => section.scored ? { ...section, weight: section.weight * 100 / total } : section);
  design.scoring = { goalsWeight: 0, competenciesWeight: design.sections.find(section => section.type === 'competencies')?.weight || 0 };
  design.stages.goalSetting = { enabled: false };
  return design;
}
function canUse(ctx, cycle) {
  return cycle.configurationScope !== 'managed_teams' || ctx.organizationWide || cycle.createdBy?.userId === ctx.actor.userId;
}
function assertUse(ctx, cycle) {
  if (!canUse(ctx, cycle)) throw new DomainError(403, 'CYCLE_SCOPE_DENIED', 'This cycle belongs to another manager. Choose an organisation cycle or one you created.');
}
function assertManage(ctx, cycle) {
  if (!ctx.organizationWide && (ctx.directory.scope !== 'managed_teams' || cycle.createdBy?.userId !== ctx.actor.userId || cycle.configurationScope !== 'managed_teams')) {
    throw new DomainError(403, 'CYCLE_MANAGEMENT_DENIED', 'You can change only the team cycles you created. An administrator manages organisation cycles.');
  }
}
function assertCreate(ctx) {
  if (!ctx.organizationWide && ctx.directory?.scope !== 'managed_teams') throw new DomainError(403, 'CYCLE_MANAGEMENT_DENIED', 'A manager or administrator must configure this cycle.');
}
function scopeFilter(ctx) {
  return ctx.organizationWide ? {} : { $or: [{ configurationScope: { $ne: 'managed_teams' } }, { 'createdBy.userId': ctx.actor.userId }] };
}
function periodFor(cycle, period, now = new Date()) {
  cleanObject(period || {}, ['start', 'end']);
  const start = period?.start, end = period?.end;
  const valid = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  if (!valid(start) || !valid(end) || start > end || end >= now.toISOString().slice(0, 10)) fail('Choose a completed review period with valid start and end dates.');
  const config = setup(cycle);
  if (config.cadence.type === 'one_time' && (start !== cycle.period.start?.slice(0, 10) || end !== cycle.period.end?.slice(0, 10))) fail('This one-time cycle uses its configured review period.');
  // Periodic cycles advance in complete calendar-month intervals from the
  // published anchor. Dates are computed independently to avoid month-end drift.
  if (config.cadence.type === 'periodic') {
    const months = { monthly: 1, quarterly: 3, semi_annual: 6, annual: 12 }[config.cadence.frequency];
    const anchor = new Date(cycle.period.start), date = new Date(start);
    const delta = (date.getUTCFullYear() - anchor.getUTCFullYear()) * 12 + date.getUTCMonth() - anchor.getUTCMonth();
    const advance = (value, offset) => { const source = new Date(value); const target = new Date(Date.UTC(source.getUTCFullYear(), source.getUTCMonth() + offset, 1)); const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate(); target.setUTCDate(Math.min(source.getUTCDate(), last)); return target.toISOString().slice(0, 10); };
    if (delta < 0 || delta % months || start !== advance(cycle.period.start, delta) || end !== advance(cycle.period.end, delta)) fail('Choose a complete scheduled period, starting from the published first period.');
  }
  return { start, end, key: `${start}:${end}` };
}
async function assertFeature(ctx, cycle) {
  if (setup(cycle).reviewMode !== 'regular' && ctx.req && (await require('../organizationFeatureService').getOrganizationFeatureState(ctx.organizationId)).features.competencyAssessments !== true) throw new DomainError(403, 'COMPETENCY_DISABLED', 'An administrator must enable competency assessments before using role-based cycles.');
}
module.exports = { regularWorkflow, assertFeature, setup, canUse, assertUse, assertManage, assertCreate, scopeFilter, periodFor };
