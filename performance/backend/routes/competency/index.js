'use strict';
const express = require('express');
const { context, hasAction, requireAction } = require('../../services/competency/authorizationService');
const { handle, send, revision, DomainError } = require('../../contracts/competency');
const { getOrganizationFeatureState } = require('../../services/organizationFeatureService');
const Settings = require('../../services/competency/settingsService');
const Role = require('../../models/CompetencyRole');
const RoleVersion = require('../../models/CompetencyRoleVersion');
const Framework = require('../../models/CompetencyFramework');
const FrameworkVersion = require('../../models/CompetencyFrameworkVersion');
const Strategy = require('../../models/CompetencyStrategyVersion');
const Cycle = require('../../models/CompetencyCycle');
const Audit = require('../../models/CompetencyAuditEvent');
const router = express.Router();
router.get('/bootstrap', handle(async (req, res) => {
  const ctx = await context(req);
  const state = await getOrganizationFeatureState(ctx.organizationId);
  const enabled = state.features.competencyAssessments === true;
  const canConfigure = hasAction(ctx, 'role.manage') || hasAction(ctx, 'framework.manage') || hasAction(ctx, 'cycle.manage');
  const canChoose = canConfigure || hasAction(ctx, 'assessment.launch') || hasAction(ctx, 'report.cohort');
  let roles = [], frameworks = [], strategies = [], cycles = [];
  if (canChoose) {
    const [roleRows, frameworkRows] = await Promise.all([Role.find({ organizationId: ctx.organizationId, archivedAt: null, currentVersionId: { $exists: true } }).lean(), Framework.find({ organizationId: ctx.organizationId, archivedAt: null, currentVersionId: { $exists: true } }).lean()]);
    const [roleVersions, frameworkVersions, strategyVersions, cycleRows] = await Promise.all([
      RoleVersion.find({ organizationId: ctx.organizationId, status: 'published', roleId: { $in: roleRows.map(row => row._id) } }).lean(),
      FrameworkVersion.find({ organizationId: ctx.organizationId, status: 'published', frameworkId: { $in: frameworkRows.map(row => row._id) } }).lean(),
      Strategy.find({ organizationId: ctx.organizationId, status: 'published' }).sort({ version: -1 }).lean(),
      Cycle.find({ organizationId: ctx.organizationId, status: 'published', ...(!enabled ? { reviewMode: 'regular' } : {}), ...require('../../services/competency/cyclePolicy').scopeFilter(ctx) }).sort({ createdAt: -1 }).lean(),
    ]);
    roles = roleVersions.map(row => ({ ...row, id: String(row.roleId), versionId: String(row._id), _id: undefined, organizationId: undefined }));
    frameworks = frameworkVersions.map(row => ({ ...row, id: String(row._id), frameworkId: String(row.frameworkId), versionId: String(row._id), _id: undefined, organizationId: undefined }));
    strategies = strategyVersions.map(row => ({ ...row, id: String(row._id), strategyId: String(row.strategyId), versionId: String(row._id), _id: undefined, organizationId: undefined }));
    cycles = cycleRows.map(row => ({ ...row, id: String(row._id), _id: undefined, organizationId: undefined }));
  }
  send(res, { enabled, canEnable: ctx.organizationWide && canConfigure, capabilities: ctx.capabilities, scope: ctx.directory.scope,
    people: ctx.directory.members.map(person => ({ userId: person.userId, name: person.name, departmentId: person.departmentId, teamIds: person.teamIds || person.teams?.map(team => team.id) || [] })),
    reviewers: ctx.directory.reviewers || [], roles, frameworks, strategies, cycles, settings: await Settings.getSettings(ctx.organizationId) });
}));
router.use(handle(async (req, _res, next) => {
  const ctx = await context(req); const state = await getOrganizationFeatureState(ctx.organizationId);
  if (state.features.competencyAssessments !== true && !/^\/cycles(?:\/[^/]+(?:\/(?:validate|publish|start-appraisals))?)?$/.test(req.path)) throw new DomainError(403, 'COMPETENCY_DISABLED', 'Competency assessments are not enabled. An administrator can enable them from the assessment overview.');
  next();
}));
router.get('/settings', handle(async (req, res) => { const ctx = await context(req); send(res, await Settings.getSettings(ctx.organizationId)); }));
router.patch('/settings', handle(async (req, res) => { const ctx = await context(req); send(res, await Settings.updateSettings(ctx, req.body, revision(req))); }));
router.post('/appraisal-links/validate', handle(async (req, res) => { const ctx = await context(req); send(res, await require('../../services/competency/appraisalBridgeService').validatePlan(ctx, req.body)); }));
router.get('/appraisal-links/:appraisalId', handle(async (req, res) => { const ctx = await context(req); send(res, await require('../../services/competency/appraisalBridgeService').links(ctx, req.params.appraisalId)); }));
router.post('/appraisal-links', handle(async (req, res) => { const ctx = await context(req); send(res, await require('../../services/competency/appraisalBridgeService').link(ctx, req.body, req.get('Idempotency-Key')), 201); }));
router.get('/audit', handle(async (req, res) => {
  const ctx = await context(req); requireAction(ctx, 'audit.view');
  if (!ctx.organizationWide) throw new DomainError(403, 'AUDIT_SCOPE_DENIED', 'Organisation audit history is restricted to HR and administrators.');
  const filter = { organizationId: ctx.organizationId };
  if (typeof req.query.resourceId === 'string' && req.query.resourceId.length <= 100) filter.resourceId = req.query.resourceId;
  send(res, await Audit.find(filter).sort({ createdAt: -1 }).limit(200).select('-__v').lean());
}));
router.use(require('../../services/competency/uploadBudget').createUploadBudget());
router.use(require('./library'));
// Assessment routes are registered before application startup and verified by integration tests.
router.use(require('./assessments'));
module.exports = router;
