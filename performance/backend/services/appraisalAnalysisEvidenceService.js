'use strict';
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const plain = value => value?.toObject ? value.toObject() : value;
const id = value => String(value?._id || value || '');
const meaningful = value => typeof value === 'string' ? Boolean(value.trim()) : typeof value === 'number' || typeof value === 'boolean' ? true
  : Array.isArray(value) ? value.some(meaningful) : value && typeof value === 'object' ? Object.entries(value).some(([key, entry]) => !['_id', 'submittedAt', 'lastSavedAt', 'generatedAt'].includes(key) && meaningful(entry)) : false;
const stableJSON = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const hash = value => crypto.createHash('sha256').update(stableJSON(value)).digest('hex');

async function profileFor(req, appraisal, viewer) {
  const user = req.session.user;
  const request = { userRole: req.userRole, currentOrganization: { id: String(appraisal.organizationId) }, directReports: req.directReports || [], managedTeams: req.managedTeams || [], userTeams: req.userTeams || [],
    session: { currentOrganizationId: String(appraisal.organizationId), user: { id: user.id, sub: user.sub, idpSub: user.idpSub, email: user.email, name: user.name,
      organizations: user.organizations || user.idpOrganizations || user.userinfo?.organizations || [], idpTeams: user.idpTeams || user.teams || user.userinfo?.teams || [] } } };
  const profile = { ...viewer, actorId: String(user.sub || user.idpSub || user.id), request, goalQuery: require('./goalPermissionService').buildGoalVisibilityQuery(req), competency: null };
  try {
    const ctx = await require('./competency/authorizationService').context(req);
    profile.competency = { organizationId: ctx.organizationId, actor: ctx.actor, organizationWide: ctx.organizationWide, permissions: [...ctx.permissions],
      directory: { ...ctx.directory, members: ctx.directory.members.filter(member => [ctx.actor.userId, String(appraisal.employee.userId)].includes(String(member.userId))),
        reviewers: ctx.directory.reviewers?.filter(member => String(member.userId) === ctx.actor.userId) } };
  } catch { /* Missing assessment authority is shown as an evidence gap, never bypassed. */ }
  const member = req._appraisalAccessScope?.directory?.members?.find(member => String(member.userId) === String(appraisal.employee.userId));
  profile.participantTeamIds = member?.teamIds || (String(appraisal.employee.userId) === profile.actorId ? request.session.user.idpTeams.map(team => String(team.id || team.teamId)) : []);
  profile.goalQuery = require('./goalPermissionService').buildGoalVisibilityQuery(req);
  return profile;
}

async function collect(appraisal, profile = { shared: true }) {
  if (appraisal?.toObject) appraisal = appraisal.toObject({ depopulate: true });
  const org = String(appraisal.organizationId), appraisalId = appraisal._id;
  const cycle = await require('../models/AppraisalCycle').findOne({ _id: appraisal.cycleId?._id || appraisal.cycleId, organizationId: org }).lean();
  const shared = profile.shared === true;
  const published = ['completed', 'employee_acknowledged'].includes(appraisal.status);
  const canReview = !shared && profile.canManage;
  const docsVisibility = ['employee_manager', 'all_reviewers', ...(!shared && profile.isEmployee ? ['employee_only'] : []), ...(!shared && profile.isHR ? ['hr_only'] : [])];
  const [documents, meetings, roles] = await Promise.all([
    require('../models/AppraisalDocument').find({ organizationId: org, appraisalId, _id: { $in: appraisal.documents || [] }, status: 'active', visibility: { $in: docsVisibility } }).select('originalName category textExtraction').sort({ _id: 1 }).lean(),
    require('../models/OneOnOne').find({ organizationId: org, appraisalId, status: { $ne: 'cancelled' } }).sort({ scheduledDate: 1, _id: 1 }).lean(),
    require('../models/CompetencyAssessment').find({ organizationId: org, appraisalId: String(appraisalId) }).sort({ _id: 1 }).lean()
  ]);
  const sources = [], gaps = [], add = (category, sourceId, title, value, state = 'saved') => {
    const text = typeof value === 'string' ? value : stableJSON(value);
    if (text && text !== 'null' && text !== '[]') sources.push({ id: `${category}:${sourceId}`, category, title, state, text });
  };
  const snapshot = plain(appraisal.cycleConfigurationSnapshot) || {};
  add('review', String(appraisalId), 'Appraisal context and preserved review design', { employee: appraisal.employee?.name, jobTitle: appraisal.employee?.jobTitle, periodStart: snapshot.periodStart || cycle?.periodStart,
    periodEnd: snapshot.periodEnd || cycle?.periodEnd, cycle: snapshot.cycleName || cycle?.name, phase: shared && published ? 'finalised' : appraisal.status, design: snapshot.workflowDefinition || cycle?.workflowDefinition,
    workflow: snapshot.appraisalFlow, reviewMode: snapshot.reviewMode, cadence: snapshot.cadence, assessmentCycleId: snapshot.assessmentCycleId,
    occurrenceKey: snapshot.occurrenceKey, finalRating: published ? plain(appraisal.finalRating) : undefined });
  const humanFields = (value, names) => Object.fromEntries(names.map(name => [name, plain(value?.[name])]).filter(([, value]) => value !== undefined));
  const self = humanFields(appraisal.selfAssessment, ['submittedAt', 'overallSummary', 'competencyRatings', 'okrAssessment', 'overallSelfRating']);
  const manager = humanFields(appraisal.managerReview, ['submittedAt', 'overallSummary', 'competencyRatings', 'okrAssessment', 'overallManagerRating']);
  if ((!shared || appraisal.selfAssessment?.submittedAt) && meaningful(self)) add('employee_assessment', 'self', 'Employee reflection, ratings and OKR answers', self, appraisal.selfAssessment?.submittedAt ? 'submitted' : 'draft');
  if ((canReview || published) && meaningful(manager)) add('manager_review', 'reviewer', 'Manager review, ratings, comments and goal verification', manager, appraisal.managerReview?.submittedAt ? 'submitted' : 'draft');
  for (const response of appraisal.customResponses || []) {
    if (shared && !response.submittedAt) continue;
    if (!shared && !canReview && response.respondentRole === 'manager' && !published) continue;
    const section = snapshot.workflowDefinition?.sections?.find(section => section.id === response.sectionId);
    const question = section?.questions?.find(question => question.id === response.questionId);
    add('review_answers', `${response.sectionId}:${response.questionId}:${response.respondentRole}`, question?.prompt || 'Configured review question', { section: section?.title, respondent: response.respondentRole, answer: response.value }, response.submittedAt ? 'submitted' : 'draft');
  }
  const conversationAllowed = !shared || Boolean(appraisal.selfAssessment?.submittedAt);
  const visibleDocumentIds = new Set(documents.map(document => id(document)));
  if (conversationAllowed) {
    for (const [index, message] of (appraisal.chatThread || []).entries()) {
      // Reviewer suggestions and calibration notes are not part of the employee conversation.
      if (message.phase === 'calibration' || message.messageType === 'suggestion') continue;
      if (message.linkedDocumentId && !visibleDocumentIds.has(id(message.linkedDocumentId))) continue;
      if ((message.attachments || []).some(attachment => attachment.documentId && !visibleDocumentIds.has(id(attachment.documentId)))) continue;
      add('ai_conversation', String(message.messageId || index), `Appraisal discussion · ${message.sender?.role || 'participant'}`, { speaker: message.sender?.role, phase: message.phase, question: message.questionRef, message: message.message,
        savedReportDraft: message.messageType === 'report_draft' ? message.structuredData : undefined,
        aiGenerated: message.aiContext?.isAiGenerated === true || message.sender?.role === 'ai' }, 'conversation');
    }
    // The exact discussion above is the source. Its AI-extracted copy is not
    // counted again as independent evidence or allowed to replace that discussion.
  }
  for (const document of documents) {
    if (document.category === 'cv') {
      const text = document.textExtraction?.extractedText;
      if (document.textExtraction?.status === 'completed' && typeof text === 'string' && text.trim()) {
        add('cv', `appraisal-document:${id(document)}`, document.originalName, { text, kind: 'file' }, 'ready');
      } else {
        gaps.push(`CV text unavailable: ${document.originalName}. File processing must complete with readable text before it can inform analysis.`);
      }
      continue;
    }
    add('documents', id(document), document.originalName, { category: document.category, text: document.textExtraction?.extractedText || '', extractionState: document.textExtraction?.status }, document.textExtraction?.status === 'completed' ? 'ready' : 'pending');
    if (document.textExtraction?.status !== 'completed') gaps.push(`Text extraction pending: ${document.originalName}`);
  }
  for (const meeting of meetings) {
    const safe = require('./meetingCallService').publicMeeting(meeting);
    add('meetings', id(meeting), meeting.title, { date: meeting.scheduledDate, status: meeting.status, transcript: safe.transcript || null, transcriptSource: meeting.transcript?.source, agreedNotes: safe.notes, aiMeetingNotes: safe.summary }, safe.transcript ? 'transcript_ready' : 'transcript_missing');
    if (!safe.transcript) gaps.push(`Transcript unavailable: ${meeting.title}`);
  }
  for (const goal of appraisal.goalSnapshots || []) add('personal_okrs', `frozen:${id(goal.sourceGoalId)}`, goal.definition?.title || 'Frozen personal OKR', { definition: goal.definition, achievement: goal.achievement, period: goal.period, alignment: goal.alignment, cutoffAt: goal.cutoffAt }, 'frozen_scoring_evidence');
  const goalIds = (appraisal.goalSnapshots || []).flatMap(goal => [goal.sourceGoalId, goal.alignment?.parentOKRId]).filter(Boolean);
  const periods = await require('../models/GoalPeriod').find({ organizationId: org, startDate: { $lte: snapshot.periodEnd || cycle?.periodEnd || new Date() }, endDate: { $gte: snapshot.periodStart || cycle?.periodStart || new Date() } }).select('_id').lean();
  const teams = profile.competency?.directory?.members?.find(member => String(member.userId) === String(appraisal.employee?.userId))?.teamIds || profile.participantTeamIds || [];
  const visibility = shared ? { organizationId: org, $or: [{ ownerId: String(appraisal.employee?.userId) }, { type: { $in: ['team', 'department', 'organization'] }, _id: { $in: goalIds.filter(value => mongoose.isValidObjectId(value)) } }] } : profile.goalQuery;
  if (visibility) {
    const query = { $and: [visibility, { organizationId: org, status: { $nin: ['cancelled', 'rejected'] } }, { $or: [
      { _id: { $in: goalIds.filter(value => mongoose.isValidObjectId(value)) } },
      { periodId: { $in: periods.map(period => period._id) }, $or: [{ ownerId: String(appraisal.employee?.userId) }, { type: 'team', 'teamHierarchy.teamId': { $in: teams } }, { type: 'organization' }] }
    ] }] };
    const goals = await require('../models/OKR').find(query).sort({ _id: 1 }).lean();
    const seen = new Set(goals.map(goal => id(goal)));
    // Resolve only explicitly aligned ancestors, with the same access policy at every hop.
    for (let depth = 0; depth < 8; depth++) {
      const parents = goals.map(goal => goal.alignment?.parentOKRId).filter(value => value && !seen.has(id(value)));
      if (!parents.length) break;
      const ancestors = await require('../models/OKR').find({ $and: [visibility, { organizationId: org, _id: { $in: parents }, type: { $in: ['team', 'department', 'organization'] } }] }).lean();
      if (!ancestors.length) break;
      for (const goal of ancestors) { seen.add(id(goal)); goals.push(goal); }
    }
    for (const goal of goals) add(goal.type === 'individual' ? 'personal_okrs' : 'aligned_okrs', `live:${id(goal)}`, goal.title || 'Aligned goal', { type: goal.type, period: goal.period, objectives: goal.objectives,
      approvalStatus: goal.approvalStatus, status: goal.status, progress: goal.progress, team: goal.teamHierarchy?.teamName, alignment: goal.alignment,
      scoringEligibility: goal.scoringEligibility, note: 'Live alignment context. Preserved appraisal snapshots remain the source for the official rating.' }, 'live_context');
  }
  let ctx = null;
  if (profile.competency) ctx = { ...profile.competency, permissions: new Set(profile.competency.permissions), req: profile.request };
  for (const role of roles) {
    const auth = require('./competency/authorizationService');
    const roleResults = require('./appraisalRoleResultService');
    const publishedResult = roleResults.resolve(appraisal, role);
    const allowed = shared ? Boolean(publishedResult) : ctx && auth.canAccessAssessment(ctx, role, 'evidence.view');
    if (!allowed) { gaps.push('Linked role assessment/CV access could not be verified for this view.'); continue; }
    const isAssessor = !shared && auth.isCurrentAssessor(ctx, role);
    add('role_assessment', id(role), role.definitionSnapshot?.role?.name || 'Role expectations', {
      role: role.definitionSnapshot?.role, criteria: role.definitionSnapshot?.criteria,
      result: publishedResult ? roleResults.summary(role, publishedResult) : null,
      reviewerFindings: isAssessor && !published ? role.items : undefined
    }, publishedResult ? 'published' : role.status);
    const evidence = await require('../models/CompetencyEvidence').find({ organizationId: org, assessmentId: id(role), status: 'ready' }).sort({ _id: 1 }).lean();
    for (const entry of evidence) {
      if (published && publishedResult) {
        const reference = publishedResult.evidenceReferences?.find(item => String(item.id) === id(entry));
        // Later draft additions and changed/private-at-publication evidence do
        // not become sources for an earlier published appraisal result.
        if (!reference || (shared && reference.visibility !== 'participant')) continue;
        if (reference.sha256 !== entry.sha256) { gaps.push('Some published role evidence has changed since finalisation and is excluded.'); continue; }
      }
      const visible = shared ? entry.visibility === 'participant' : require('./competency/assessmentService').visible(ctx, role, entry)
        && (isAssessor || entry.createdBy?.userId === ctx.actor.userId || role.status === 'published' || (entry.documentType === 'cv' && role.participant.userId === ctx.actor.userId));
      if (!visible) continue;
      if (entry.retention?.expiresAt && new Date(entry.retention.expiresAt) <= new Date()) { gaps.push('Some role evidence is no longer retained.'); continue; }
      if (entry.source?.oralSessionId) {
        if (!ctx) { gaps.push('Linked oral evidence requires verified assessment-purpose access.'); continue; }
        const current = await require('./competency/callEvidencePolicy').current(ctx, role, entry);
        if (current.status !== 'ready') { gaps.push('Some oral evidence is unavailable or its source permission was withdrawn.'); continue; }
      }
      add(entry.documentType === 'cv' ? 'cv' : 'role_evidence', id(entry), entry.originalName || entry.title || 'Assessment evidence', { text: entry.text, kind: entry.kind, criteria: entry.criterionIds }, 'ready');
    }
  }
  if (!sources.some(source => source.category === 'cv')) gaps.push('No accessible, processed CV is attached to this appraisal or its linked role assessment.');
  sources.sort((left, right) => left.category.localeCompare(right.category) || left.id.localeCompare(right.id));
  const prefixes = { review: 'CONTEXT', employee_assessment: 'SELF', manager_review: 'REVIEWER', review_answers: 'ANSWER', ai_conversation: 'CHAT', documents: 'DOC', meetings: 'MEETING', personal_okrs: 'OKR', aligned_okrs: 'ALIGN', cv: 'CV', role_assessment: 'ROLE', role_evidence: 'EVIDENCE' };
  const referenceCounts = {};
  for (const source of sources) { referenceCounts[source.category] = (referenceCounts[source.category] || 0) + 1; source.ref = `${prefixes[source.category]}${referenceCounts[source.category]}`; }
  const maxChars = 700000, total = sources.reduce((sum, source) => sum + source.text.length, 0), fair = Math.max(1, Math.floor(maxChars / Math.max(sources.length, 1)));
  const manifest = sources.map(source => ({ id: source.id, ref: source.ref, category: source.category, title: source.title, state: source.state, sha256: hash(source.text),
    characters: source.text.length, includedCharacters: total <= maxChars ? source.text.length : Math.min(source.text.length, fair) }));
  const text = sources.map((source, index) => `[${source.ref}] ${source.title} (${source.state})\n${source.text.slice(0, manifest[index].includedCharacters)}${manifest[index].includedCharacters < source.text.length ? '\n[Excerpt; additional source text is not included.]' : ''}`).join('\n\n');
  const counts = Object.fromEntries([...new Set(sources.map(source => source.category))].map(category => [category, sources.filter(source => source.category === category).length]));
  const presentation = require('./appraisalAssessmentPresentation');
  return { sourceHash: hash({ sources, gaps, visibility: { shared, actor: profile.actorId, canManage: profile.canManage, isHR: profile.isHR } }), text,
    analytics: presentation.build(sources, snapshot.ratingScale || cycle?.ratingScale), sourcePreviews: presentation.previews(sources),
    coverage: { counts, sources: manifest, gaps: [...new Set(gaps)], excerpted: manifest.filter(source => source.includedCharacters < source.characters).length, phase: shared && published ? 'finalised' : appraisal.status } };
}
function retainedSnapshot(previous, current) {
  const available = new Map((current?.sources || []).map(source => [source.id, source]));
  return Boolean(previous?.sources?.length) && previous.sources.every(source => {
    const fresh = available.get(source.id);
    return fresh && fresh.sha256 === source.sha256 && fresh.ref === source.ref;
  });
}
module.exports = { profileFor, collect, hash, retainedSnapshot };
