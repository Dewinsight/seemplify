const express = require('express');
const PerformanceProject = require('../models/PerformanceProject');
const FeedbackRequest = require('../models/FeedbackRequest');
const User = require('../models/User');
const { requirePermission } = require('../middleware/rbac');
const { getActorId, tenantFilter } = require('../services/tenantPolicy');

const router = express.Router();

function text(value, max = 3000) {
  return String(value || '').trim().slice(0, max);
}

function member(value = {}) {
  return { userId: text(value.userId || value.id, 240), name: text(value.name, 240), email: text(value.email, 320), role: text(value.role, 160) };
}

function isMember(project, userId) {
  return [...(project.leads || []), ...(project.participants || [])].some(person => person.userId === String(userId));
}

function isLead(project, userId) {
  return (project.leads || []).some(person => person.userId === String(userId));
}

async function resolveOrganizationMembers(organizationId, people) {
  const ids = [...new Set(people.map(person => String(person.userId || '')).filter(Boolean))];
  if (!ids.length) return [];
  const objectIds = ids.filter(id => /^[a-f\d]{24}$/i.test(id));
  const users = await User.find({
    isActive: { $ne: false },
    $and: [
      { $or: [{ idpSub: { $in: ids } }, ...(objectIds.length ? [{ _id: { $in: objectIds } }] : [])] },
      { $or: [{ 'idpTeams.organizationId': organizationId }, { organizationMemberships: { $elemMatch: { organization: organizationId, isActive: true } } }] }
    ]
  }).select('idpSub email profile idpTeams').lean();
  if (users.length !== ids.length) {
    const error = new Error('Every project participant must belong to the active organization');
    error.statusCode = 400;
    throw error;
  }
  return users.map(user => {
    const supplied = people.find(person => [String(user._id), String(user.idpSub || '')].includes(String(person.userId)));
    return {
      userId: String(user.idpSub || user._id),
      name: user.profile?.displayName || [user.profile?.firstName, user.profile?.lastName].filter(Boolean).join(' ') || supplied?.name,
      email: user.email || supplied?.email,
      role: supplied?.role
    };
  });
}

async function recordEvent(input) {
  try { await require('../services/outboxService').recordEvent(input); } catch (error) {
    console.warn('Project-feedback event was not recorded:', error.message);
  }
}

router.get('/', async (req, res) => {
  try {
    const query = tenantFilter(req);
    if (req.userRole !== 'hr_admin') {
      const actorId = getActorId(req);
      query.$or = [{ 'leads.userId': actorId }, { 'participants.userId': actorId }];
    }
    if (req.query.state) query.state = String(req.query.state);
    const data = await PerformanceProject.find(query).sort({ startDate: -1 }).limit(200).lean();
    return res.json({ success: true, data, count: data.length });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || 'Failed to load projects' });
  }
});

router.post('/', requirePermission('project_feedback:request'), async (req, res) => {
  try {
    const actorId = getActorId(req);
    const requestedLeads = (Array.isArray(req.body.leads) ? req.body.leads : []).map(member).filter(item => item.userId && item.userId !== actorId);
    const leads = await resolveOrganizationMembers(req.organizationId, requestedLeads);
    if (!leads.some(item => item.userId === actorId)) leads.push(member({ userId: actorId, name: req.session.user?.name, email: req.session.user?.email, role: 'Project lead' }));
    const participants = await resolveOrganizationMembers(req.organizationId, (Array.isArray(req.body.participants) ? req.body.participants : []).map(member).filter(item => item.userId));
    const project = await PerformanceProject.create({
      organizationId: req.organizationId,
      name: text(req.body.name, 240),
      description: text(req.body.description),
      externalReference: text(req.body.externalReference, 240),
      leads,
      participants,
      startDate: req.body.startDate,
      endDate: req.body.endDate || undefined,
      state: req.body.state === 'active' ? 'active' : 'draft',
      feedbackWindow: req.body.feedbackWindow,
      createdBy: actorId,
      audit: [{ action: 'created', actorId }]
    });
    return res.status(201).json({ success: true, data: project });
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message || 'Failed to create project' });
  }
});

router.patch('/:id', requirePermission('project_feedback:request'), async (req, res) => {
  try {
    const project = await PerformanceProject.findOne(tenantFilter(req, { _id: req.params.id }));
    if (!project) return res.status(404).json({ success: false, error: 'Project not found' });
    if (req.userRole !== 'hr_admin' && !isLead(project, getActorId(req))) return res.status(403).json({ success: false, error: 'Only a project lead can update this project' });
    ['name', 'description', 'externalReference'].forEach(field => { if (req.body[field] !== undefined) project[field] = text(req.body[field], field === 'description' ? 3000 : 240); });
    if (Array.isArray(req.body.leads)) {
      const requestedLeads = req.body.leads.map(member).filter(item => item.userId);
      const actorLead = project.leads.find(person => person.userId === getActorId(req));
      project.leads = await resolveOrganizationMembers(req.organizationId, requestedLeads.filter(person => person.userId !== getActorId(req)));
      if (actorLead && !project.leads.some(person => person.userId === actorLead.userId)) project.leads.push(actorLead);
    }
    if (Array.isArray(req.body.participants)) project.participants = await resolveOrganizationMembers(req.organizationId, req.body.participants.map(member).filter(item => item.userId));
    if (req.body.state && ['draft', 'active', 'closed'].includes(req.body.state)) project.state = req.body.state;
    if (req.body.feedbackWindow) project.feedbackWindow = req.body.feedbackWindow;
    project.audit.push({ action: 'updated', actorId: getActorId(req) });
    await project.save();
    return res.json({ success: true, data: project });
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message || 'Failed to update project' });
  }
});

router.post('/:id/feedback-requests', requirePermission('project_feedback:request'), async (req, res) => {
  try {
    const project = await PerformanceProject.findOne(tenantFilter(req, { _id: req.params.id }));
    if (!project) return res.status(404).json({ success: false, error: 'Project not found' });
    const actorId = getActorId(req);
    if (req.userRole !== 'hr_admin' && !isLead(project, actorId)) return res.status(403).json({ success: false, error: 'Only a project lead can request project feedback' });
    if (project.state !== 'active') return res.status(409).json({ success: false, error: 'Project feedback is available only for active projects' });
    const subjectId = text(req.body.subjectId, 240);
    const reviewerId = text(req.body.reviewerId, 240);
    if (!isMember(project, subjectId) || !isMember(project, reviewerId)) return res.status(400).json({ success: false, error: 'Subject and reviewer must both be project members' });
    if (subjectId === reviewerId) return res.status(400).json({ success: false, error: 'Reviewer must be another project member' });
    const dueDate = new Date(req.body.dueDate);
    if (Number.isNaN(dueDate.getTime()) || dueDate <= new Date()) return res.status(400).json({ success: false, error: 'Choose a future due date' });
    const lookup = new Map([...(project.leads || []), ...(project.participants || [])].map(person => [person.userId, person]));
    const request = await FeedbackRequest.create({
      organizationId: req.organizationId,
      requesterId: actorId,
      subjectId,
      reviewerId,
      requesterInfo: { name: req.session.user?.name, email: req.session.user?.email },
      subjectInfo: lookup.get(subjectId),
      reviewerInfo: lookup.get(reviewerId),
      contextType: 'project',
      contextLabel: project.name,
      projectId: project._id,
      questions: (Array.isArray(req.body.questions) ? req.body.questions : []).map(item => text(item, 500)).filter(Boolean).slice(0, 20),
      dueDate,
      visibility: ['private', 'manager-only'].includes(req.body.visibility) ? req.body.visibility : 'private',
      anonymity: ['named', 'confidential'].includes(req.body.anonymity) ? req.body.anonymity : 'named',
      createdBy: actorId
    });
    await recordEvent({
      organizationId: req.organizationId,
      type: 'project_feedback.requested',
      aggregateType: 'FeedbackRequest',
      aggregateId: String(request._id),
      actorId,
      recipients: [{ userId: reviewerId }],
      data: { dueAt: dueDate, deepLink: `/feedback?request=${request._id}` }
    });
    return res.status(201).json({ success: true, data: request });
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message || 'Failed to request project feedback' });
  }
});

module.exports = router;
