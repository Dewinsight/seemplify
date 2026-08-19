const crypto = require('crypto');
const express = require('express');
const Candidate = require('../models/Candidate');
const CandidateAccount = require('../models/CandidateAccount');
const Organization = require('../models/Organization');
const PeopleTransition = require('../models/CandidateOnboarding');
const OnboardingWorkflowItem = require('../models/OnboardingWorkflowItem');
const User = require('../models/User');
const onboardingEmailService = require('../services/onboardingEmailService');
const { initializeDefaultWorkflow } = require('../services/onboardingWorkflowService');

const router = express.Router();

function verify(req, res, next) {
  const secret = process.env.PEOPLE_TRANSITIONS_SERVICE_SECRET
    || process.env.INTERNAL_SERVICE_SECRET
    || process.env.IDP_RECRUITER_SERVICE_SECRET
    || '';
  if (!secret) {
    if (process.env.NODE_ENV === 'production') return res.status(503).json({ error: 'Internal transition authentication is not configured' });
    return next();
  }
  const timestamp = String(req.get('x-service-timestamp') || '');
  const received = String(req.get('x-service-signature') || '').replace(/^sha256=/, '');
  if (!Number.isFinite(Date.parse(timestamp)) || Math.abs(Date.now() - Date.parse(timestamp)) > 300000) return res.status(401).json({ error: 'Expired service request' });
  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${JSON.stringify(req.body || {})}`).digest('hex');
  if (!/^[a-f0-9]{64}$/i.test(received) || !crypto.timingSafeEqual(Buffer.from(received, 'hex'), Buffer.from(expected, 'hex'))) return res.status(401).json({ error: 'Invalid service signature' });
  next();
}

router.use(verify);

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function normalizedMember(body = {}) {
  const member = body.member && typeof body.member === 'object' ? body.member : {};
  return {
    id: String(member.id || body.subjectId || '').trim(),
    email: String(member.email || '').trim().toLowerCase(),
    name: String(member.name || member.email || '').trim(),
    phone: String(member.phone || '').trim(),
    employeeId: String(member.employeeId || '').trim(),
    designation: String(member.designation || '').trim(),
    departmentId: String(member.departmentId || '').trim(),
    departmentName: String(member.departmentName || '').trim(),
    role: String(member.role || 'staff').trim(),
  };
}

async function resolveActor(organization, requestedBy = {}) {
  const memberUserIds = new Set((organization.members || []).map((member) => String(member.user)));
  const requestedSubject = String(requestedBy.subjectId || '').trim();
  const requestedEmail = String(requestedBy.email || '').trim().toLowerCase();
  const requestedUser = requestedSubject
    ? await User.findOne({ idpSubject: requestedSubject }).select('_id email')
    : requestedEmail
      ? await User.findOne({ email: requestedEmail }).select('_id email')
      : null;
  if (requestedUser && memberUserIds.has(String(requestedUser._id))) return requestedUser;
  const owner = await User.findById(organization.owner).select('_id email');
  if (!owner) throw new Error('Recruiter organization owner could not be resolved');
  return owner;
}

function splitName(value = '') {
  const parts = String(value || '').trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts.shift() || 'Employee',
    lastName: parts.join(' ') || 'Member',
  };
}

async function ensureCandidateAndAccount({ organization, member, actor }) {
  const names = splitName(member.name);
  let candidate = await Candidate.findOne({
    organization: organization._id,
    email: member.email,
  });
  if (!candidate) {
    candidate = await Candidate.create({
      organization: organization._id,
      firstName: names.firstName,
      lastName: names.lastName,
      email: member.email,
      phone: member.phone || 'Not provided',
      position: member.designation || 'Employee',
      experience: '0-2',
      education: 'not-provided',
      source: 'Payroll People Transition',
      status: 'Offered',
      createdBy: actor._id,
    });
  }

  let account = await CandidateAccount.findOne({ email: member.email });
  const created = !account;
  if (!account) {
    account = new CandidateAccount({
      email: member.email,
      profile: {
        firstName: candidate.firstName,
        lastName: candidate.lastName,
        phone: member.phone || candidate.phone,
      },
      status: 'invited',
    });
  }
  account.linkCandidate(candidate._id, organization._id);
  await account.save();
  return { candidate, account, created };
}

function transitionAdminDeepLink(transitionId) {
  const frontend = String(process.env.RECRUITER_FRONTEND_URL || process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
  return `${frontend}/people-transitions/${transitionId}`;
}

router.post('/summary', async (req, res) => {
  const idpOrganizationId = String(req.body.idpOrganizationId || '');
  const subjectIds = [...new Set((Array.isArray(req.body.subjectIds) ? req.body.subjectIds : [req.body.subjectId]).filter(Boolean).map(String))].slice(0, 500);
  if (!idpOrganizationId || !subjectIds.length) return res.status(400).json({ error: 'idpOrganizationId and at least one subjectId are required' });
  const organization = await Organization.findOne({ idpOrganizationId }).select('_id').lean();
  if (!organization) return res.json({ organizationFound: false, summaries: [] });
  const transitions = await PeopleTransition.find({
    organization: organization._id,
    $or: [
      { 'subject.idpAccountId': { $in: subjectIds } },
      { 'identityAction.idpAccountId': { $in: subjectIds } },
    ],
  }).sort({ createdAt: -1 }).lean();
  const transitionIds = transitions.map(item => item._id);
  const workflowItems = await OnboardingWorkflowItem.find({ onboarding: { $in: transitionIds } }).select('onboarding type title status dueAt required').lean();
  const byTransition = new Map();
  for (const item of workflowItems) {
    const key = String(item.onboarding); if (!byTransition.has(key)) byTransition.set(key, []); byTransition.get(key).push(item);
  }
  const frontend = String(process.env.RECRUITER_FRONTEND_URL || process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
  const summaries = subjectIds.map(subjectId => {
    const records = transitions.filter(item => (
      item.subject?.idpAccountId === subjectId
      || item.identityAction?.idpAccountId === subjectId
    ));
    const active = records.filter(item => !['completed', 'cancelled'].includes(item.status));
    const items = active.flatMap(item => byTransition.get(String(item._id)) || []);
    const pendingItems = items.filter(item => !['completed', 'skipped'].includes(item.status));
    const latest = records[0];
    return {
      subjectId,
      status: latest?.status || 'not_started',
      processType: latest?.processType || null,
      transitionId: latest?._id || null,
      activeTransitionCount: active.length,
      pendingTaskCount: pendingItems.length,
      pendingDocumentCount: pendingItems.filter(item => item.type === 'document').length,
      pendingSignatureCount: active.reduce((sum, item) => sum + (item.envelopes?.length || 0), 0),
      dueAt: pendingItems.map(item => item.dueAt).filter(Boolean).sort()[0] || null,
      deepLink: latest
        ? `${frontend}/people-transitions/${latest._id}`
        : `${frontend}/people-transitions/tasks?subjectId=${encodeURIComponent(subjectId)}`,
      transitions: records.slice(0, 20).map(item => ({ id: item._id, title: item.title, processType: item.processType, status: item.status, dueAt: item.dueAt, progress: item.progress })),
    };
  });
  res.json({ organizationFound: true, generatedAt: new Date(), summaries });
});

router.post('/members/start', async (req, res) => {
  try {
    const idpOrganizationId = String(req.body?.idpOrganizationId || '').trim();
    const member = normalizedMember(req.body);
    if (!idpOrganizationId || !member.id || !member.email) {
      return res.status(400).json({ error: 'idpOrganizationId, member.id and member.email are required' });
    }

    const organization = await Organization.findOne({ idpOrganizationId });
    if (!organization) return res.status(404).json({ error: 'Recruiter organization is not linked to this Identity organization' });

    const existing = await PeopleTransition.findOne({
      organization: organization._id,
      processType: 'onboarding',
      'subject.idpAccountId': member.id,
      status: { $nin: ['completed', 'cancelled', 'provisioned'] },
    }).sort({ createdAt: -1 });
    if (existing) {
      return res.json({
        created: false,
        transitionId: existing._id,
        status: existing.status,
        deepLink: transitionAdminDeepLink(existing._id),
        candidatePortalUrl: existing.portalInviteUrl || '',
      });
    }

    const actor = await resolveActor(organization, req.body?.requestedBy || {});
    const { candidate, account, created: createdCandidateAccount } = await ensureCandidateAndAccount({
      organization,
      member,
      actor,
    });
    const transition = await PeopleTransition.create({
      organization: organization._id,
      candidate: candidate._id,
      candidateAccount: account._id,
      subject: {
        type: 'idp_member',
        candidateId: candidate._id,
        idpAccountId: member.id,
        email: member.email,
        name: member.name || `${candidate.firstName} ${candidate.lastName}`,
        employeeId: member.employeeId,
        snapshot: member,
      },
      processType: 'onboarding',
      title: `${member.name || member.email} onboarding`,
      dueAt: req.body?.dueAt ? new Date(req.body.dueAt) : undefined,
      startedBy: actor._id,
      identityAction: {
        mode: 'manual',
        action: 'provision',
        status: 'not_ready',
      },
      employment: {
        role: member.role || 'staff',
        departmentId: member.departmentId,
        employeeId: member.employeeId,
        appAccess: { mode: 'all', appIds: [] },
      },
    });

    const transitionPath = `/transitions/${transition._id}`;
    let portalPath = `/login?email=${encodeURIComponent(member.email)}&next=${encodeURIComponent(transitionPath)}`;
    if (createdCandidateAccount) {
      const inviteToken = crypto.randomBytes(32).toString('base64url');
      transition.inviteTokenHash = sha256(inviteToken);
      transition.inviteTokenExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      portalPath = `/signup?token=${encodeURIComponent(inviteToken)}`;
    }
    transition.portalInviteUrl = await onboardingEmailService.sendCandidateInvite({
      candidate,
      organization,
      onboarding: transition,
      portalPath,
    }).catch((emailError) => {
      console.error('Failed to send internally requested onboarding email:', emailError);
      return onboardingEmailService.candidatePortalUrl(portalPath, { organization });
    });
    await transition.save();

    await initializeDefaultWorkflow({
      onboarding: transition,
      candidate,
      userId: actor._id,
    });

    res.status(201).json({
      created: true,
      transitionId: transition._id,
      status: transition.status,
      deepLink: transitionAdminDeepLink(transition._id),
      candidatePortalUrl: transition.portalInviteUrl,
    });
  } catch (error) {
    console.error('Internal member onboarding start failed:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to start member onboarding' });
  }
});

router.post('/members/remind', async (req, res) => {
  try {
    const idpOrganizationId = String(req.body?.idpOrganizationId || '').trim();
    const subjectId = String(req.body?.subjectId || '').trim();
    if (!idpOrganizationId || !subjectId) {
      return res.status(400).json({ error: 'idpOrganizationId and subjectId are required' });
    }
    const organization = await Organization.findOne({ idpOrganizationId });
    if (!organization) return res.status(404).json({ error: 'Recruiter organization is not linked to this Identity organization' });
    const transition = await PeopleTransition.findOne({
      organization: organization._id,
      processType: 'onboarding',
      'subject.idpAccountId': subjectId,
      status: { $nin: ['completed', 'cancelled', 'provisioned'] },
    }).sort({ createdAt: -1 }).populate('candidate');
    if (!transition) return res.status(404).json({ error: 'No active onboarding transition was found for this member' });
    const item = await OnboardingWorkflowItem.findOne({
      onboarding: transition._id,
      ownerType: 'candidate',
      status: { $nin: ['completed', 'skipped'] },
    }).sort({ dueAt: 1, order: 1 });
    await onboardingEmailService.sendWorkflowReminder({
      candidate: transition.candidate || {
        email: transition.subject?.email,
        firstName: splitName(transition.subject?.name).firstName,
        lastName: splitName(transition.subject?.name).lastName,
      },
      organization,
      onboarding: transition,
      item,
    });
    res.json({
      sent: true,
      transitionId: transition._id,
      status: transition.status,
      deepLink: transitionAdminDeepLink(transition._id),
    });
  } catch (error) {
    console.error('Internal member onboarding reminder failed:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to send onboarding reminder' });
  }
});

module.exports = router;
