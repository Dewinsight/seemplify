'use strict';
const { loadPerformanceDirectory } = require('../performanceDirectoryService');
const { resolveOrganizationId } = require('../tenantPolicy');
const { DomainError, hash } = require('../../contracts/competency');
const Audit = require('../../models/CompetencyAuditEvent');
const Operation = require('../../models/CompetencyOperation');
const ACTIONS = Object.freeze(['role.manage', 'framework.manage', 'cycle.manage', 'assessment.launch', 'assessment.view', 'assessment.edit', 'assessment.finalise', 'assessment.reopen', 'assessment.exception', 'evidence.view', 'evidence.create', 'evidence.delete', 'report.view', 'report.export', 'report.cohort', 'audit.view', 'ai.use', 'retention.manage'].map(value => `competency.${value}`));
const fullAction = value => value.startsWith('competency.') ? value : `competency.${value}`;
function hasAction(ctx, permission) { return ctx.permissions.has(fullAction(permission)); }
function requireAction(ctx, permission) {
  const name = fullAction(permission);
  if (!hasAction(ctx, name)) { const error = new DomainError(403, 'ACTION_DENIED', 'You do not have permission to perform this action.'); error.permission = name; throw error; }
}
async function context(req) {
  if (req.competencyContext) return req.competencyContext;
  const user = req.session?.user;
  if (!user) throw new DomainError(401, 'SIGN_IN_REQUIRED', 'Sign in to continue.');
  const organizationId = String(resolveOrganizationId(req) || '');
  const organization = (user.organizations || user.idpOrganizations || user.userinfo?.organizations || []).find(org => String(org.id || org._id) === organizationId);
  const actorId = String(user.sub || user.idpSub || user.id || '');
  if (!organizationId || !organization || organization.isActive === false || !actorId) throw new DomainError(403, 'ORGANIZATION_DENIED', 'Choose an active organisation you belong to.');
  const grants = (organization.authorization?.permissionsByApp || organization.appPermissions)?.['performance-management'];
  if (!Array.isArray(grants)) throw new DomainError(503, 'PERMISSIONS_REFRESH_REQUIRED', 'Sign in again to refresh your assessment permissions.');
  let directory;
  try { directory = await loadPerformanceDirectory(req); }
  catch (error) { throw new DomainError(error.status || 503, 'DIRECTORY_UNAVAILABLE', error.message || 'We could not refresh people and teams. Try again.'); }
  if (!directory || String(directory.organizationId) !== organizationId || !directory.members?.some(member => String(member.userId) === actorId)) throw new DomainError(503, 'DIRECTORY_UNAVAILABLE', 'We could not verify your current organisation membership. Try again.');
  const member = directory.members.find(person => String(person.userId) === actorId);
  if (directory.scope === 'managed_teams') req.directReports = directory.members.filter(person => String(person.userId) !== actorId).map(person => String(person.userId));
  const ctx = { organizationId, actor: { userId: actorId, name: member.name || user.name || 'Reviewer' }, user, directory, req, permissions: new Set(grants.filter(grant => ACTIONS.includes(grant))), organizationWide: directory.scope === 'organization' && ['owner', 'admin', 'hr_manager'].includes(directory.organizationRole), capabilities: {} };
  ctx.capabilities = Object.fromEntries(Object.entries({ roleManage: 'role.manage', frameworkManage: 'framework.manage', cycleManage: 'cycle.manage', assessmentLaunch: 'assessment.launch', assessmentEdit: 'assessment.edit', assessmentFinalise: 'assessment.finalise', assessmentReopen: 'assessment.reopen', assessmentException: 'assessment.exception', reportView: 'report.view', reportExport: 'report.export', cohortReport: 'report.cohort', auditView: 'audit.view', aiUse: 'ai.use', retentionManage: 'retention.manage' }).map(([key, action]) => [key, hasAction(ctx, action)]));
  req.competencyContext = ctx;
  return ctx;
}
async function refreshContext(req) {
  const previous = await context(req);
  const token = req.session?.user?.accessToken;
  if (!token) throw new DomainError(401, 'SIGN_IN_REQUIRED', 'Sign in again before continuing AI processing.');
  let claims;
  try { claims = await require('../../config/oidc').getUserInfo(token); }
  catch { throw new DomainError(503, 'AUTHORITY_REFRESH_FAILED', 'We could not verify your current permissions. The AI draft was not published.'); }
  if (String(claims?.sub || '') !== previous.actor.userId || !Array.isArray(claims.organizations)) throw new DomainError(403, 'AUTHORITY_CHANGED', 'Your access changed while this analysis was running.');
  const { sanitizePerformancePrincipal, toOrganizationId } = require('../performanceOrganizationAccess');
  const principal = sanitizePerformancePrincipal({ ...req.session.user, ...claims, organizations: claims.organizations, teams: claims.teams || [], userinfo: claims, accessToken: token }, previous.organizationId);
  if (toOrganizationId(principal.currentOrganization) !== previous.organizationId) throw new DomainError(403, 'ORGANIZATION_DENIED', 'You no longer have access to this organisation.');
  // Use a separate server-only request view. Never reuse a request's cached
  // directory or overwrite another browser request's selected organisation.
  const freshRequest = { ...req, session: { ...req.session, user: principal, currentOrganizationId: previous.organizationId }, currentOrganization: principal.currentOrganization, competencyContext: undefined, _performanceDirectory: undefined, _forcePerformanceDirectoryRefresh: true };
  const fresh = await context(freshRequest);
  if (fresh.actor.userId !== previous.actor.userId || fresh.organizationId !== previous.organizationId) throw new DomainError(403, 'AUTHORITY_CHANGED', 'Your access changed while this analysis was running.');
  return fresh;
}
function assertParticipant(ctx, participantId) {
  const member = ctx.directory.members.find(person => String(person.userId) === String(participantId));
  if (!member) throw new DomainError(404, 'PARTICIPANT_NOT_FOUND', 'This person is not available in your current scope.');
  return member;
}
function canAccessAssessment(ctx, assessment, permission = 'assessment.view') {
  if (!assessment || String(assessment.organizationId) !== ctx.organizationId || !hasAction(ctx, permission)) return false;
  if (ctx.organizationWide) return true;
  const participantId = String(assessment.participant?.userId || assessment.participantId || '');
  const self = participantId === ctx.actor.userId;
  const reviewer = ctx.directory.reviewers?.find(person => String(person.userId) === ctx.actor.userId);
  const currentParticipant = ctx.directory.members.find(person => String(person.userId) === participantId);
  const targetTeams = currentParticipant?.teamIds || currentParticipant?.teams?.map(team => String(team.id || team.teamId)) || [];
  const currentlyEligible = Boolean(currentParticipant && reviewer && (reviewer.organizationWide || reviewer.eligibleTeamIds?.some(teamId => targetTeams.map(String).includes(String(teamId)))));
  const assigned = currentlyEligible && (assessment.assessorIds || assessment.assessors?.map(person => person.userId) || []).map(String).includes(ctx.actor.userId);
  // Linked reviews follow the reviewer explicitly chosen for the ordinary
  // appraisal. Team authority alone must not expose another assessor's draft.
  const managed = !assessment.appraisalId && currentlyEligible && ctx.directory.scope === 'managed_teams' && ctx.directory.members.some(person => String(person.userId) === participantId);
  const action = fullAction(permission);
  if (['competency.assessment.view', 'competency.evidence.view', 'competency.report.view', 'competency.report.export'].includes(action)) return self || assigned || managed;
  if (['competency.evidence.create', 'competency.evidence.delete'].includes(action) && self) return true;
  return assigned || managed;
}
function assertAssessment(ctx, assessment, permission = 'assessment.view') {
  if (!assessment || String(assessment.organizationId) !== ctx.organizationId) throw new DomainError(404, 'ASSESSMENT_NOT_FOUND', 'This assessment is unavailable.');
  requireAction(ctx, permission);
  if (!canAccessAssessment(ctx, assessment, permission)) { const error = new DomainError(403, 'ASSESSMENT_DENIED', 'This assessment is outside your permitted scope.'); error.permission = fullAction(permission); throw error; }
  return assessment;
}
async function audit(ctx, action, resourceType, resourceId, details = {}) {
  const safe = {};
  for (const key of ['permission', 'code', 'beforeHash', 'afterHash', 'revision', 'versionId', 'resultVersion', 'reason', 'requestId', 'sourceId']) {
    if (details[key] !== undefined) safe[key] = typeof details[key] === 'string' ? details[key].slice(0, key === 'reason' ? 2000 : 240) : details[key];
  }
  return Audit.create({ organizationId: ctx.organizationId, actor: ctx.actor, action, resourceType, resourceId: resourceId ? String(resourceId) : null, details: safe });
}
async function operation(ctx, action, key, payload, work) {
  if (typeof key !== 'string' || !/^[a-zA-Z0-9_.:-]{8,150}$/.test(key)) throw new DomainError(428, 'REQUEST_KEY_REQUIRED', 'Retry this action from its original form.');
  const scope = { organizationId: ctx.organizationId, actorId: ctx.actor.userId, action, key };
  const requestHash = hash(payload);
  let entry;
  try { entry = await Operation.create({ ...scope, requestHash, leaseUntil: new Date(Date.now() + 120000), expiresAt: new Date(Date.now() + 7 * 86400000) }); }
  catch (error) {
    if (error.code !== 11000) throw error;
    for (let attempt = 0; attempt < 15; attempt++) {
      const prior = await Operation.findOne(scope).lean();
      if (!prior || prior.requestHash !== requestHash) throw new DomainError(409, 'REQUEST_KEY_CONFLICT', 'This request key was used for different changes.');
      if (prior.status === 'complete') return prior.result;
      if (prior.status === 'pending' && prior.leaseUntil && new Date(prior.leaseUntil).getTime() < Date.now()) throw new DomainError(409, 'OPERATION_RECOVERY_REQUIRED', 'This request was interrupted. Check the existing result before starting another action; an administrator can reconcile this request.');
      if (prior.status === 'failed') {
        entry = await Operation.findOneAndUpdate({ ...scope, status: 'failed' }, { $set: { status: 'pending', leaseUntil: new Date(Date.now() + 120000) } }, { new: true });
        if (entry) break;
      }
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    if (!entry) throw new DomainError(409, 'OPERATION_IN_PROGRESS', 'This action is still being completed. Please check its result before retrying.');
  }
  try {
    const result = await work();
    await Operation.updateOne({ _id: entry._id, status: 'pending' }, { $set: { status: 'complete', result }, $unset: { leaseUntil: 1 } });
    return result;
  } catch (error) {
    // A server failure may follow a successful domain write. Never replay an
    // unknown effect automatically with a new generic operation lease.
    const uncertain = !(error instanceof DomainError) || error.status >= 500;
    await Operation.updateOne({ _id: entry._id }, uncertain ? { $set: { status: 'pending', leaseUntil: new Date(0) } } : { $set: { status: 'failed' }, $unset: { leaseUntil: 1 } });
    throw error;
  }
}
module.exports = { ACTIONS, context, refreshContext, hasAction, requireAction, assertParticipant, canAccessAssessment, assertAssessment, audit, operation };
