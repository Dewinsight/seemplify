const express = require('express');
const Recognition = require('../models/Recognition');
const User = require('../models/User');
const { requirePermission } = require('../middleware/rbac');
const { getActorId, tenantFilter } = require('../services/tenantPolicy');

const router = express.Router();

function text(value, max = 3000) {
  return String(value || '').trim().slice(0, max);
}

function currentUser(req) {
  const user = req.session?.user || {};
  return { userId: getActorId(req), name: text(user.name || user.displayName, 240), email: text(user.email, 320) };
}

async function recordEvent(input) {
  try {
    await require('../services/outboxService').recordEvent(input);
  } catch (error) {
    console.warn('Recognition event was not recorded:', error.message);
  }
}

router.get('/', async (req, res) => {
  try {
    const actorId = getActorId(req);
    const view = String(req.query.view || 'feed');
    const query = tenantFilter(req, { status: 'active' });
    if (view === 'received') query['recipient.userId'] = actorId;
    else if (view === 'sent') query['sender.userId'] = actorId;
    else {
      query.$or = [
        { visibility: 'public' },
        { 'recipient.userId': actorId },
        { 'sender.userId': actorId },
        ...((req.currentTeam?.id || req.currentTeam?._id) ? [{ visibility: 'team', 'recipient.teamId': String(req.currentTeam.id || req.currentTeam._id) }] : [])
      ];
    }
    const data = await Recognition.find(query).sort({ createdAt: -1 }).limit(200).lean();
    return res.json({ success: true, data, count: data.length });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || 'Failed to load recognition' });
  }
});

router.post('/', requirePermission('recognition:create'), async (req, res) => {
  try {
    const sender = currentUser(req);
    const recipient = {
      userId: text(req.body.recipient?.userId || req.body.recipientId, 240),
      name: text(req.body.recipient?.name, 240),
      email: text(req.body.recipient?.email, 320),
      teamId: text(req.body.recipient?.teamId, 240),
      teamName: text(req.body.recipient?.teamName, 240)
    };
    const message = text(req.body.message);
    if (!recipient.userId || !message) return res.status(400).json({ success: false, error: 'Recipient and message are required' });
    if (recipient.userId === sender.userId) return res.status(400).json({ success: false, error: 'Recognition must be sent to another person' });
    const organizationMembership = await User.findOne({
      isActive: { $ne: false },
      $and: [
        { $or: [{ idpSub: recipient.userId }, { _id: /^[a-f\d]{24}$/i.test(recipient.userId) ? recipient.userId : undefined }].filter(item => Object.values(item)[0] !== undefined) },
        { $or: [{ 'idpTeams.organizationId': req.organizationId }, { organizationMemberships: { $elemMatch: { organization: req.organizationId, isActive: true } } }] }
      ]
    }).select('idpSub email profile idpTeams').lean();
    if (!organizationMembership) return res.status(400).json({ success: false, error: 'Choose a colleague in the active organization' });
    recipient.userId = String(organizationMembership.idpSub || organizationMembership._id);
    if (recipient.userId === sender.userId) return res.status(400).json({ success: false, error: 'Recognition must be sent to another person' });
    recipient.name = organizationMembership.profile?.displayName || [organizationMembership.profile?.firstName, organizationMembership.profile?.lastName].filter(Boolean).join(' ') || recipient.name;
    recipient.email = organizationMembership.email || recipient.email;
    const recipientTeam = (organizationMembership.idpTeams || []).find(team => String(team.organizationId) === req.organizationId);
    recipient.teamId = recipientTeam?.id || recipient.teamId;
    recipient.teamName = recipientTeam?.name || recipient.teamName;
    const visibility = ['public', 'team', 'private'].includes(req.body.visibility) ? req.body.visibility : 'team';
    if (visibility === 'team' && !recipient.teamId) return res.status(400).json({ success: false, error: 'Team visibility requires the recipient team' });
    const recognition = await Recognition.create({
      organizationId: req.organizationId,
      sender,
      recipient,
      companyValue: text(req.body.companyValue, 160),
      message,
      visibility,
      contextType: ['general', 'goal', 'project'].includes(req.body.contextType) ? req.body.contextType : 'general',
      contextLabel: text(req.body.contextLabel, 240),
      relatedGoalId: req.body.relatedGoalId || undefined,
      projectId: req.body.projectId || undefined,
      audit: [{ action: 'created', actorId: sender.userId }]
    });
    await recordEvent({
      organizationId: req.organizationId,
      type: 'recognition.received',
      aggregateType: 'Recognition',
      aggregateId: String(recognition._id),
      actorId: sender.userId,
      recipients: [{ userId: recipient.userId }],
      data: { deepLink: `/recognition?recognition=${recognition._id}` }
    });
    return res.status(201).json({ success: true, data: recognition });
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message || 'Failed to send recognition' });
  }
});

router.post('/:id/acknowledge', async (req, res) => {
  try {
    const recognition = await Recognition.findOne(tenantFilter(req, { _id: req.params.id, status: 'active' }));
    if (!recognition) return res.status(404).json({ success: false, error: 'Recognition not found' });
    if (recognition.recipient.userId !== getActorId(req)) return res.status(403).json({ success: false, error: 'Only the recipient can acknowledge this recognition' });
    if (!recognition.acknowledgedAt) {
      recognition.acknowledgedAt = new Date();
      recognition.audit.push({ action: 'acknowledged', actorId: getActorId(req) });
      await recognition.save();
    }
    return res.json({ success: true, data: recognition });
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message || 'Failed to acknowledge recognition' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const recognition = await Recognition.findOne(tenantFilter(req, { _id: req.params.id, status: 'active' }));
    if (!recognition) return res.status(404).json({ success: false, error: 'Recognition not found' });
    if (recognition.sender.userId !== getActorId(req) && req.userRole !== 'hr_admin') return res.status(403).json({ success: false, error: 'Access denied' });
    recognition.status = 'withdrawn';
    recognition.audit.push({ action: 'withdrawn', actorId: getActorId(req), details: { reason: text(req.body?.reason, 1000) } });
    await recognition.save();
    return res.json({ success: true, data: recognition });
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message || 'Failed to withdraw recognition' });
  }
});

module.exports = router;
