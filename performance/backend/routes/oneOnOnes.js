const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const OneOnOne = require('../models/OneOnOne');
const User = require('../models/User');
const { requireAuth, requireManager } = require('../middleware/rbac');
const { requireOrganization, tenantFilter, getActorId } = require('../services/tenantPolicy');
const multer = require('multer');

const MEETING_STATUSES = new Set(['scheduled', 'in_progress', 'completed', 'cancelled', 'rescheduled', 'no_show']);
const MEETING_TYPES = new Set(['weekly', 'biweekly', 'monthly', 'adhoc', 'performance_review', 'career_discussion']);
const MEETING_FORMATS = new Set(['video', 'audio', 'chat', 'in_person']);
const ACTION_STATUSES = new Set(['pending', 'in_progress', 'completed', 'cancelled']);
const ACTION_ASSIGNEES = new Set(['manager', 'employee']);
const ACTION_CATEGORIES = new Set(['task', 'development', 'follow_up', 'blocker_resolution', 'career', 'other']);
const PRIORITIES = new Set(['high', 'medium', 'low']);
const MANAGER_UPDATE_FIELDS = new Set([
  'title', 'scheduledDate', 'duration', 'meetingType', 'meetingFormat', 'location',
  'recurring', 'sharedNotes', 'privateManagerNotes'
]);
const EMPLOYEE_UPDATE_FIELDS = new Set(['sharedNotes', 'employeeNotes']);

function cleanText(value, maxLength = 5000) {
  return String(value == null ? '' : value).trim().slice(0, maxLength);
}

function boundedLimit(value, fallback, maximum = 100) {
  const parsed = Number.parseInt(value, 10);
  return Math.max(1, Math.min(maximum, Number.isFinite(parsed) ? parsed : fallback));
}

function validDate(value, { future = false } = {}) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  if (future && date <= new Date()) return null;
  return date;
}

function safeDuration(value, fallback = 30) {
  const duration = Number(value == null ? fallback : value);
  return Number.isFinite(duration) && duration >= 15 && duration <= 480
    ? Math.round(duration)
    : null;
}

function meetingAccess(req, meeting) {
  const actorId = getActorId(req);
  return {
    actorId,
    isManager: Boolean(actorId && String(meeting.managerId) === actorId),
    isEmployee: Boolean(actorId && String(meeting.employeeId) === actorId),
    isHrAdmin: req.userRole === 'hr_admin'
  };
}

function serializeMeeting(req, meeting, { stripConversation = false } = {}) {
  const access = meetingAccess(req, meeting);
  const value = typeof meeting.toObject === 'function' ? meeting.toObject() : { ...meeting };
  if (!access.isManager && !access.isHrAdmin) {
    delete value.privateManagerNotes;
    if (value.managerScoring && !value.managerScoring.isVisible) delete value.managerScoring;
  }
  if (!access.isEmployee && !access.isHrAdmin) delete value.employeeNotes;
  if (stripConversation) {
    if (value.transcript) delete value.transcript.content;
    delete value.chatThread;
  }
  return value;
}

function isDirectReport(req, employeeId) {
  const target = String(employeeId || '');
  return Boolean(target) && (req.directReports || []).map(String).includes(target);
}

async function resolveEmployeeInfo(req, employeeId, supplied = {}) {
  const id = String(employeeId);
  const filters = [{ idpSub: id }];
  if (mongoose.isValidObjectId(id)) filters.push({ _id: id });
  const user = await User.findOne({ $or: filters }).select('email profile').lean();
  const claimCandidates = [];
  const sessionUser = req.session?.user || {};
  for (const team of sessionUser.idpTeams || sessionUser.teams || sessionUser.userinfo?.teams || []) {
    for (const member of team.members || []) {
      const memberId = member?.userId || member?.id || member?.sub;
      if (String(memberId || '') === id) claimCandidates.push(member);
    }
  }
  const claim = claimCandidates[0] || {};
  return {
    name: cleanText(
      user?.profile?.displayName
        || [user?.profile?.firstName, user?.profile?.lastName].filter(Boolean).join(' ')
        || claim.name
        || supplied.name
        || 'Team Member',
      160
    ),
    // Do not trust an arbitrary client-provided calendar destination. An email
    // is used only when it came from the local identity cache or signed claims.
    email: cleanText(user?.email || claim.email, 320),
    avatar: cleanText(user?.profile?.avatar || claim.avatar || supplied.avatar, 1000),
    title: cleanText(user?.profile?.title || claim.title || claim.jobTitle || supplied.title, 160)
  };
}

function participantRecipients(meeting) {
  return [
    {
      userId: String(meeting.managerId),
      name: meeting.managerInfo?.name,
      email: meeting.managerInfo?.email,
      channels: meeting.managerInfo?.email ? ['in_app', 'email'] : ['in_app']
    },
    {
      userId: String(meeting.employeeId),
      name: meeting.employeeInfo?.name,
      email: meeting.employeeInfo?.email,
      channels: meeting.employeeInfo?.email ? ['in_app', 'email'] : ['in_app']
    }
  ];
}

function meetingDeepLink(meeting, actionItemId = null) {
  const query = new URLSearchParams({ meeting: String(meeting._id) });
  if (actionItemId) query.set('actionItem', String(actionItemId));
  return `/one-on-ones?${query.toString()}`;
}

async function recordOneOnOneEvent(meeting, eventType, actor, {
  recipients = participantRecipients(meeting),
  dueAt = null,
  aggregateType = 'one_on_one',
  aggregateId = String(meeting._id),
  eventId = null,
  deepLink = meetingDeepLink(meeting)
} = {}) {
  try {
    const { recordEvent } = require('../services/outboxService');
    await recordEvent({
      eventId: eventId || undefined,
      eventType,
      organizationId: meeting.organizationId,
      aggregateType,
      aggregateId,
      actor,
      recipients,
      payload: {
        deepLink,
        ...(dueAt ? { dueAt } : {})
      }
    });
  } catch (error) {
    console.warn('1:1 event was not recorded:', error.message);
  }
}

async function scheduleMeetingLifecycle(meeting, eventType, actor) {
  const dueAt = new Date(meeting.scheduledDate);
  const recipients = participantRecipients(meeting);
  const eventId = `one_on_one:${meeting._id}:${eventType}:${dueAt.toISOString()}`;
  await recordOneOnOneEvent(meeting, eventType, actor, { recipients, dueAt, eventId });
  try {
    const { scheduleReminderSequence } = require('../services/reminderScheduler');
    await scheduleReminderSequence({
      organizationId: meeting.organizationId,
      eventType,
      target: { type: 'one_on_one', id: String(meeting._id) },
      recipients,
      dueAt,
      notification: {
        category: 'one_on_one',
        title: eventType === 'one_on_one.rescheduled' ? '1:1 meeting rescheduled' : '1:1 meeting scheduled',
        message: 'A 1:1 meeting is ready to prepare for.',
        deepLink: meetingDeepLink(meeting),
        priority: 'normal',
        action: { kind: 'review', label: 'Prepare for meeting' }
      }
    });
  } catch (error) {
    console.warn('1:1 reminders were not scheduled:', error.message);
  }
}

async function cancelMeetingLifecycle(meeting, reason) {
  try {
    const { cancelRemindersForTarget } = require('../services/reminderScheduler');
    await cancelRemindersForTarget({
      organizationId: meeting.organizationId,
      targetType: 'one_on_one',
      targetId: String(meeting._id),
      reason
    });
  } catch (error) {
    console.warn('1:1 reminders were not cancelled:', error.message);
  }
}

function actionItemIdentity(meeting, item) {
  const itemId = String(item.id || item._id);
  return {
    itemId,
    targetId: `${meeting._id}:${itemId}`,
    recipient: item.assignedTo === 'manager'
      ? participantRecipients(meeting)[0]
      : participantRecipients(meeting)[1]
  };
}

async function synchronizeActionItemLifecycle(meeting, item, actor, { emitCompletion = true } = {}) {
  const { itemId, targetId, recipient } = actionItemIdentity(meeting, item);
  const terminal = ['completed', 'cancelled'].includes(item.status) || !item.dueDate;
  if (terminal) {
    try {
      const { cancelRemindersForTarget } = require('../services/reminderScheduler');
      await cancelRemindersForTarget({
        organizationId: meeting.organizationId,
        targetType: 'one_on_one_action_item',
        targetId,
        userId: recipient.userId,
        reason: item.status === 'completed' ? 'action_item_completed' : 'action_item_not_due'
      });
    } catch (error) {
      console.warn('1:1 action reminder was not cancelled:', error.message);
    }
    if (item.status === 'completed' && emitCompletion) {
      await recordOneOnOneEvent(meeting, 'one_on_one.action_item_completed', actor, {
        aggregateType: 'one_on_one_action_item',
        aggregateId: targetId,
        eventId: `one_on_one:${meeting._id}:action:${itemId}:completed:${new Date(item.completedAt || meeting.updatedAt).toISOString()}`,
        deepLink: meetingDeepLink(meeting, itemId)
      });
    }
    return;
  }

  const dueAt = new Date(item.dueDate);
  if (Number.isNaN(dueAt.getTime())) return;
  const eventId = `one_on_one:${meeting._id}:action:${itemId}:due:${dueAt.toISOString()}`;
  await recordOneOnOneEvent(meeting, 'one_on_one.action_item_due', actor, {
    recipients: [recipient],
    dueAt,
    aggregateType: 'one_on_one_action_item',
    aggregateId: targetId,
    eventId,
    deepLink: meetingDeepLink(meeting, itemId)
  });
  try {
    const { scheduleReminderSequence } = require('../services/reminderScheduler');
    await scheduleReminderSequence({
      organizationId: meeting.organizationId,
      eventType: 'one_on_one.action_item_due',
      target: { type: 'one_on_one_action_item', id: targetId },
      recipient,
      dueAt,
      notification: {
        category: 'one_on_one',
        title: '1:1 action item due',
        message: 'An action agreed in a 1:1 meeting needs attention.',
        deepLink: meetingDeepLink(meeting, itemId),
        priority: item.priority === 'high' ? 'high' : 'normal',
        action: { kind: 'complete', label: 'Open action item' }
      }
    });
  } catch (error) {
    console.warn('1:1 action reminders were not scheduled:', error.message);
  }
}

// Lazy load services to avoid startup errors if not configured
let nylasService = null;
let meetingAnalysisService = null;

const getNylasService = () => {
  if (!nylasService) {
    try {
      nylasService = require('../services/nylasService');
    } catch (e) {
      console.warn('Nylas service not available:', e.message);
    }
  }
  return nylasService;
};

const getMeetingAnalysisService = () => {
  if (!meetingAnalysisService) {
    try {
      meetingAnalysisService = require('../services/meetingAnalysisService');
    } catch (e) {
      console.warn('Meeting analysis service not available:', e.message);
    }
  }
  return meetingAnalysisService;
};

function calendarParticipants(meeting) {
  return [
    { email: meeting.managerInfo?.email, name: meeting.managerInfo?.name },
    { email: meeting.employeeInfo?.email, name: meeting.employeeInfo?.name }
  ].filter(participant => participant.email);
}

async function synchronizeCalendarMeeting(meeting) {
  const nylas = getNylasService();
  if (!nylas || !meeting.nylas?.eventId || !meeting.nylas?.grantId) return;

  try {
    const endTime = new Date(new Date(meeting.scheduledDate).getTime() + meeting.duration * 60 * 1000);
    await nylas.updateCalendarEvent(meeting.nylas.grantId, meeting.nylas.eventId, {
      title: meeting.title,
      description: '1:1 meeting',
      startTime: meeting.scheduledDate,
      endTime,
      location: meeting.location,
      participants: calendarParticipants(meeting)
    });
    meeting.nylas.syncStatus = 'synced';
    meeting.nylas.lastSyncAt = new Date();
  } catch (error) {
    console.error('Failed to synchronize 1:1 calendar event:', error.message);
    meeting.nylas.syncStatus = 'failed';
  }
  await meeting.save();
}

async function cancelCalendarMeeting(meeting) {
  const nylas = getNylasService();
  if (!nylas || !meeting.nylas?.eventId || !meeting.nylas?.grantId) return;

  try {
    await nylas.deleteCalendarEvent(meeting.nylas.grantId, meeting.nylas.eventId);
    meeting.nylas.syncStatus = 'synced';
    meeting.nylas.lastSyncAt = new Date();
  } catch (error) {
    console.error('Failed to cancel 1:1 calendar event:', error.message);
    meeting.nylas.syncStatus = 'failed';
  }
  await meeting.save();
}

// Configure multer for transcript uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['text/plain', 'text/vtt', 'application/json'];
    if (allowedTypes.includes(file.mimetype) || file.originalname.match(/\.(txt|vtt|json|srt)$/)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type for transcript'));
    }
  }
});

// Every 1:1 route requires an authenticated tenant context. Param loading is
// deliberately tenant-scoped so a valid ID from another organization is never
// distinguishable from a missing record.
router.use(requireAuth, requireOrganization);
router.param('id', async (req, res, next, id) => {
  try {
    if (!mongoose.isValidObjectId(id)) {
      return res.status(404).json({ success: false, error: 'Meeting not found' });
    }
    const meeting = await OneOnOne.findOne(tenantFilter(req, { _id: id }));
    if (!meeting) return res.status(404).json({ success: false, error: 'Meeting not found' });
    const access = meetingAccess(req, meeting);
    if (!access.isManager && !access.isEmployee && !access.isHrAdmin) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }
    req.oneOnOne = meeting;
    req.oneOnOneAccess = access;
    return next();
  } catch (error) {
    return next(error);
  }
});

/**
 * GET /api/one-on-ones - List 1:1 meetings
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    const userId = getActorId(req);
    const { status, upcoming, past, format, withUser, limit = 50 } = req.query;

    if (status && !MEETING_STATUSES.has(String(status))) {
      return res.status(400).json({ success: false, error: 'Invalid meeting status' });
    }
    if (format && !MEETING_FORMATS.has(String(format))) {
      return res.status(400).json({ success: false, error: 'Invalid meeting format' });
    }

    let query = {
      organizationId: req.organizationId,
      $or: [{ managerId: userId }, { employeeId: userId }]
    };

    if (status) query.status = status;
    if (format) query.meetingFormat = format;

    if (withUser) {
      const otherUserId = cleanText(withUser, 240);
      query.$or = [
        { managerId: userId, employeeId: otherUserId },
        { managerId: otherUserId, employeeId: userId }
      ];
    }

    const now = new Date();
    if (upcoming === 'true') {
      query.scheduledDate = { $gte: now };
    } else if (past === 'true') {
      query.scheduledDate = { $lt: now };
    }

    const meetings = await OneOnOne.find(query)
      .sort({ scheduledDate: upcoming === 'true' ? 1 : -1 })
      .limit(boundedLimit(limit, 50))
      .select('-transcript.content -chatThread -privateManagerNotes');

    res.json({
      success: true,
      data: meetings.map(meeting => serializeMeeting(req, meeting, { stripConversation: true })),
      count: meetings.length
    });
  } catch (error) {
    console.error('Error fetching 1:1 meetings:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch meetings' });
  }
});

/**
 * GET /api/one-on-ones/upcoming - Get upcoming meetings
 */
router.get('/upcoming', requireAuth, async (req, res) => {
  try {
    const userId = getActorId(req);
    const { role = 'any', limit = 10 } = req.query;
    if (!['any', 'manager', 'employee'].includes(String(role))) {
      return res.status(400).json({ success: false, error: 'Invalid participant role' });
    }

    const query = tenantFilter(req, {
      scheduledDate: { $gte: new Date() },
      status: { $in: ['scheduled', 'rescheduled'] }
    });
    if (role === 'manager') query.managerId = userId;
    else if (role === 'employee') query.employeeId = userId;
    else query.$or = [{ managerId: userId }, { employeeId: userId }];

    const meetings = await OneOnOne.find(query)
      .sort({ scheduledDate: 1 })
      .limit(boundedLimit(limit, 10))
      .select('-transcript.content -chatThread');

    res.json({
      success: true,
      data: meetings.map(meeting => serializeMeeting(req, meeting, { stripConversation: true }))
    });
  } catch (error) {
    console.error('Error fetching upcoming meetings:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch upcoming meetings' });
  }
});

/**
 * GET /api/one-on-ones/with/:userId - Get meetings with specific person
 */
router.get('/with/:userId', requireAuth, async (req, res) => {
  try {
    const currentUserId = getActorId(req);
    const otherUserId = cleanText(req.params.userId, 240);
    const { limit = 20, includeHistory = false } = req.query;

    const meetings = await OneOnOne.find({
      organizationId: req.organizationId,
      $or: [
        { managerId: currentUserId, employeeId: otherUserId },
        { managerId: otherUserId, employeeId: currentUserId }
      ]
    })
      .sort({ scheduledDate: -1 })
      .limit(boundedLimit(limit, 20))
      .select(includeHistory === 'true' ? '' : '-transcript.content -chatThread');

    let trends = null;
    const analysisService = getMeetingAnalysisService();
    if (includeHistory === 'true' && meetings.length >= 2 && analysisService) {
      trends = analysisService.calculateBasicTrends(meetings);
    }

    res.json({
      success: true,
      data: meetings.map(meeting => serializeMeeting(req, meeting, {
        stripConversation: includeHistory !== 'true'
      })),
      trends
    });
  } catch (error) {
    console.error('Error fetching meetings:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch meetings' });
  }
});

/**
 * GET /api/one-on-ones/:id - Get specific meeting
 */
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const meeting = req.oneOnOne;
    const { isManager, isEmployee, isHrAdmin: isHRAdmin } = req.oneOnOneAccess;

    const response = meeting.toObject();
    if (!isManager && !isHRAdmin) {
      delete response.privateManagerNotes;
      if (response.managerScoring && !response.managerScoring.isVisible) {
        delete response.managerScoring;
      }
    }
    if (!isEmployee && !isHRAdmin) {
      delete response.employeeNotes;
    }

    res.json({ success: true, data: response });
  } catch (error) {
    console.error('Error fetching meeting:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch meeting' });
  }
});

/**
 * POST /api/one-on-ones - Create new 1:1 meeting
 */
router.post('/', requireManager, async (req, res) => {
  try {
    const managerId = getActorId(req);
    const managerName = cleanText(req.session.user.name || req.session.user.email || 'Manager', 160);
    const managerEmail = cleanText(req.session.user.email, 320);

    const {
      employeeId,
      employeeInfo,
      scheduledDate,
      duration = 30,
      meetingType = 'weekly',
      meetingFormat = 'video',
      title,
      location,
      agendaItems,
      recurring,
      createCalendarEvent = true
    } = req.body;

    if (!employeeId || !scheduledDate) {
      return res.status(400).json({ success: false, error: 'Employee and date required' });
    }
    if (String(employeeId) === managerId || !isDirectReport(req, employeeId)) {
      return res.status(403).json({
        success: false,
        error: '1:1 meetings can only be scheduled with your direct reports',
        code: 'NOT_DIRECT_REPORT'
      });
    }

    const safeScheduledDate = validDate(scheduledDate, { future: true });
    const safeMeetingDuration = safeDuration(duration);
    if (!safeScheduledDate) {
      return res.status(400).json({ success: false, error: 'Meeting date must be in the future' });
    }
    if (!safeMeetingDuration) {
      return res.status(400).json({ success: false, error: 'Duration must be between 15 and 480 minutes' });
    }
    if (!MEETING_TYPES.has(String(meetingType)) || !MEETING_FORMATS.has(String(meetingFormat))) {
      return res.status(400).json({ success: false, error: 'Invalid meeting type or format' });
    }

    const resolvedEmployee = await resolveEmployeeInfo(req, employeeId, employeeInfo);
    const safeAgendaItems = Array.isArray(agendaItems)
      ? agendaItems.slice(0, 50).map(item => ({
        topic: cleanText(item?.topic, 300),
        description: cleanText(item?.description, 2000),
        addedBy: 'manager',
        priority: PRIORITIES.has(item?.priority) ? item.priority : 'medium'
      })).filter(item => item.topic)
      : [];
    const safeRecurring = recurring && typeof recurring === 'object'
      ? {
        isRecurring: Boolean(recurring.isRecurring),
        ...(MEETING_TYPES.has(recurring.frequency) && ['weekly', 'biweekly', 'monthly'].includes(recurring.frequency)
          ? { frequency: recurring.frequency }
          : {}),
        ...(Number.isInteger(recurring.dayOfWeek) && recurring.dayOfWeek >= 0 && recurring.dayOfWeek <= 6
          ? { dayOfWeek: recurring.dayOfWeek }
          : {}),
        time: cleanText(recurring.time, 20),
        timezone: cleanText(recurring.timezone, 100)
      }
      : undefined;

    const meeting = new OneOnOne({
      managerId,
      managerInfo: { name: managerName, email: managerEmail },
      employeeId: String(employeeId),
      employeeInfo: resolvedEmployee,
      organizationId: req.organizationId,
      title: cleanText(title || `1:1 with ${resolvedEmployee.name}`, 300),
      scheduledDate: safeScheduledDate,
      duration: safeMeetingDuration,
      meetingType,
      meetingFormat,
      location: meetingFormat === 'in_person' ? cleanText(location, 500) : 'Virtual',
      agendaItems: safeAgendaItems,
      recurring: safeRecurring,
      createdBy: managerId
    });

    await meeting.save();

    // Create calendar event with Nylas if configured
    const nylas = getNylasService();
    if (createCalendarEvent !== false && resolvedEmployee.email && nylas?.isNylasConfigured()) {
      try {
        const grantId = req.session.user.nylasGrantId;
        if (grantId) {
          const endTime = new Date(safeScheduledDate.getTime() + safeMeetingDuration * 60 * 1000);

          const calendarEvent = await nylas.createCalendarEvent(grantId, {
            title: meeting.title,
            description: '1:1 meeting',
            startTime: safeScheduledDate,
            endTime,
            location: meeting.location,
            participants: calendarParticipants(meeting),
            conferencing: meetingFormat === 'video',
            metadata: { meetingId: meeting._id.toString() }
          });

          meeting.nylas = {
            eventId: calendarEvent.eventId,
            calendarId: calendarEvent.calendarId,
            conferenceUrl: calendarEvent.conferenceUrl,
            conferenceProvider: 'google_meet',
            htmlLink: calendarEvent.htmlLink,
            grantId,
            syncStatus: 'synced',
            lastSyncAt: new Date()
          };
        }
      } catch (nylasError) {
        console.error('Nylas calendar event creation failed:', nylasError);
        meeting.nylas = { syncStatus: 'failed' };
      }
    }

    // Generate preparation suggestions
    const analysisService = getMeetingAnalysisService();
    if (analysisService) {
      try {
        const prepSuggestions = await analysisService.generateMeetingPrep({
          employeeRole: resolvedEmployee.title,
          meetingType
        });
        meeting.prepSuggestions = { ...prepSuggestions, generatedAt: new Date() };
      } catch (prepError) {
        console.error('Prep suggestions generation failed:', prepError);
      }
    }

    await meeting.save();
    await scheduleMeetingLifecycle(meeting, 'one_on_one.scheduled', req.session.user);

    res.status(201).json({
      success: true,
      data: meeting,
      message: '1:1 meeting scheduled successfully'
    });
  } catch (error) {
    console.error('Error creating meeting:', error);
    res.status(500).json({ success: false, error: 'Failed to create meeting' });
  }
});

/**
 * PUT /api/one-on-ones/:id - Update meeting
 */
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const meeting = req.oneOnOne;
    const { isManager, isEmployee, isHrAdmin } = req.oneOnOneAccess;
    const allowedFields = new Set([
      ...(isManager || isHrAdmin ? MANAGER_UPDATE_FIELDS : []),
      ...(isEmployee ? EMPLOYEE_UPDATE_FIELDS : [])
    ]);
    const updates = Object.fromEntries(
      Object.entries(req.body || {}).filter(([key]) => allowedFields.has(key))
    );
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, error: 'No permitted meeting fields supplied' });
    }

    const calendarFields = new Set(['title', 'scheduledDate', 'duration', 'meetingFormat', 'location']);
    const calendarChanged = Object.keys(updates).some(key => calendarFields.has(key));
    let scheduleChanged = false;

    if (updates.scheduledDate !== undefined) {
      if (['completed', 'cancelled', 'no_show'].includes(meeting.status)) {
        return res.status(409).json({ success: false, error: 'A closed meeting cannot be rescheduled' });
      }
      const scheduledDate = validDate(updates.scheduledDate, { future: true });
      if (!scheduledDate) {
        return res.status(400).json({ success: false, error: 'Meeting date must be in the future' });
      }
      scheduleChanged = scheduledDate.getTime() !== new Date(meeting.scheduledDate).getTime();
      meeting.scheduledDate = scheduledDate;
    }
    if (updates.duration !== undefined) {
      const duration = safeDuration(updates.duration);
      if (!duration) {
        return res.status(400).json({ success: false, error: 'Duration must be between 15 and 480 minutes' });
      }
      meeting.duration = duration;
    }
    if (updates.meetingType !== undefined) {
      if (!MEETING_TYPES.has(String(updates.meetingType))) {
        return res.status(400).json({ success: false, error: 'Invalid meeting type' });
      }
      meeting.meetingType = updates.meetingType;
    }
    if (updates.meetingFormat !== undefined) {
      if (!MEETING_FORMATS.has(String(updates.meetingFormat))) {
        return res.status(400).json({ success: false, error: 'Invalid meeting format' });
      }
      meeting.meetingFormat = updates.meetingFormat;
    }
    if (updates.title !== undefined) meeting.title = cleanText(updates.title, 300) || '1:1 Meeting';
    if (updates.location !== undefined) meeting.location = cleanText(updates.location, 500);
    if (updates.sharedNotes !== undefined) meeting.sharedNotes = cleanText(updates.sharedNotes, 20000);
    if (updates.privateManagerNotes !== undefined) meeting.privateManagerNotes = cleanText(updates.privateManagerNotes, 20000);
    if (updates.employeeNotes !== undefined) meeting.employeeNotes = cleanText(updates.employeeNotes, 20000);
    if (updates.recurring !== undefined && updates.recurring && typeof updates.recurring === 'object') {
      const recurring = updates.recurring;
      meeting.recurring = {
        isRecurring: Boolean(recurring.isRecurring),
        ...(['weekly', 'biweekly', 'monthly'].includes(recurring.frequency) ? { frequency: recurring.frequency } : {}),
        ...(Number.isInteger(recurring.dayOfWeek) && recurring.dayOfWeek >= 0 && recurring.dayOfWeek <= 6
          ? { dayOfWeek: recurring.dayOfWeek }
          : {}),
        time: cleanText(recurring.time, 20),
        timezone: cleanText(recurring.timezone, 100)
      };
    }
    if (scheduleChanged && ['scheduled', 'rescheduled'].includes(meeting.status)) {
      meeting.status = 'rescheduled';
    }
    await meeting.save();
    if (calendarChanged) await synchronizeCalendarMeeting(meeting);
    if (scheduleChanged) {
      await scheduleMeetingLifecycle(meeting, 'one_on_one.rescheduled', req.session.user);
    }
    res.json({ success: true, data: meeting });
  } catch (error) {
    console.error('Error updating meeting:', error);
    res.status(500).json({ success: false, error: 'Failed to update meeting' });
  }
});

/**
 * POST /api/one-on-ones/:id/chat - Add chat message (for chat-based meetings)
 */
router.post('/:id/chat', requireAuth, async (req, res) => {
  try {
    const meeting = req.oneOnOne;
    const userId = getActorId(req);
    const { isManager, isEmployee } = req.oneOnOneAccess;

    if (!isManager && !isEmployee) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const { content, messageType = 'text' } = req.body;

    if (!cleanText(content, 10000)) {
      return res.status(400).json({ success: false, error: 'Message content required' });
    }
    if (!['text', 'action_item', 'mood_check', 'summary'].includes(messageType)) {
      return res.status(400).json({ success: false, error: 'Invalid message type' });
    }

    const sender = isManager ? 'manager' : 'employee';
    const senderInfo = {
      userId,
      name: cleanText(req.session.user.name, 160),
      avatar: cleanText(req.session.user.avatar, 1000)
    };

    await meeting.addChatMessage(sender, cleanText(content, 10000), messageType, senderInfo);

    if (meeting.status === 'scheduled') {
      meeting.status = 'in_progress';
      meeting.actualStartTime = meeting.actualStartTime || new Date();
      await meeting.save();
    }

    res.json({
      success: true,
      data: meeting.chatThread[meeting.chatThread.length - 1]
    });
  } catch (error) {
    console.error('Error adding chat message:', error);
    res.status(500).json({ success: false, error: 'Failed to add message' });
  }
});

/**
 * POST /api/one-on-ones/:id/chat/ai-assist - Get AI assistant response
 */
router.post('/:id/chat/ai-assist', requireAuth, async (req, res) => {
  try {
    const meeting = req.oneOnOne;
    if (!req.oneOnOneAccess.isManager && !req.oneOnOneAccess.isEmployee) {
      return res.status(403).json({ success: false, error: 'Only meeting participants can use AI assistance' });
    }

    const { context } = req.body;
    const analysisService = getMeetingAnalysisService();

    if (!analysisService) {
      return res.status(503).json({ success: false, error: 'AI service not available' });
    }

    const recentMessages = meeting.chatThread.slice(-10).map(m => ({
      role: m.sender,
      content: m.content
    }));

    const aiResponse = await analysisService.generateMeetingPrep({
      ...context,
      recentDiscussion: recentMessages
    });

    await meeting.addChatMessage('ai_assistant', aiResponse.suggestedTopics?.[0] || 'How can I help?', 'suggestion', {
      name: 'AI Assistant'
    });

    res.json({
      success: true,
      data: {
        message: meeting.chatThread[meeting.chatThread.length - 1],
        suggestions: aiResponse
      }
    });
  } catch (error) {
    console.error('Error getting AI assistance:', error);
    res.status(500).json({ success: false, error: 'Failed to get AI assistance' });
  }
});

/**
 * POST /api/one-on-ones/:id/transcript - Upload transcript
 */
router.post('/:id/transcript', requireAuth, upload.single('transcript'), async (req, res) => {
  try {
    const meeting = req.oneOnOne;
    const { isManager, isHrAdmin } = req.oneOnOneAccess;

    if (!isManager && !isHrAdmin) {
      return res.status(403).json({ success: false, error: 'Only manager can upload transcript' });
    }

    let transcriptContent = '';

    if (req.file) {
      transcriptContent = req.file.buffer.toString('utf-8');
      meeting.transcript.source = 'manual_upload';
    } else if (req.body.content) {
      transcriptContent = req.body.content;
      meeting.transcript.source = req.body.source || 'manual_upload';
    } else {
      return res.status(400).json({ success: false, error: 'Transcript content required' });
    }

    meeting.transcript.content = transcriptContent;
    meeting.transcript.status = 'ready';
    meeting.transcript.processedAt = new Date();

    await meeting.save();

    res.json({
      success: true,
      data: {
        wordCount: meeting.transcript.wordCount,
        status: meeting.transcript.status
      }
    });
  } catch (error) {
    console.error('Error uploading transcript:', error);
    res.status(500).json({ success: false, error: 'Failed to upload transcript' });
  }
});

/**
 * POST /api/one-on-ones/:id/analyze - Trigger AI analysis
 */
router.post('/:id/analyze', requireAuth, async (req, res) => {
  try {
    const meeting = req.oneOnOne;
    if (!req.oneOnOneAccess.isManager && !req.oneOnOneAccess.isHrAdmin) {
      return res.status(403).json({ success: false, error: 'Only the meeting manager can run analysis' });
    }

    const analysisService = getMeetingAnalysisService();
    if (!analysisService) {
      return res.status(503).json({ success: false, error: 'Analysis service not available' });
    }

    let contentToAnalyze = '';

    if (meeting.transcript?.content) {
      contentToAnalyze = meeting.transcript.content;
    } else if (meeting.chatThread?.length > 0) {
      contentToAnalyze = meeting.chatThread.map(msg => {
        const speaker = msg.sender === 'manager' ? 'Manager' : 'Employee';
        return `${speaker}: ${msg.content}`;
      }).join('\n\n');
    } else {
      return res.status(400).json({
        success: false,
        error: 'No content available for analysis'
      });
    }

    const [transcriptAnalysis, employeeScoring, managerScoring, actionItems] = await Promise.all([
      analysisService.analyzeTranscript(contentToAnalyze, {
        meetingType: meeting.meetingType,
        employeeRole: meeting.employeeInfo?.title
      }),
      analysisService.scoreEmployeePerformance(contentToAnalyze),
      analysisService.scoreManagerEffectiveness(contentToAnalyze),
      analysisService.extractActionItems(contentToAnalyze)
    ]);

    meeting.aiAnalysis = {
      summary: transcriptAnalysis.summary,
      keyTopics: transcriptAnalysis.keyTopics?.map(t => ({
        topic: typeof t === 'string' ? t : t.topic,
        description: typeof t === 'string' ? '' : t.description
      })) || [],
      sentiment: {
        overall: transcriptAnalysis.sentiment,
        employeeSentiment: transcriptAnalysis.rawAnalysis?.employeeSentiment,
        managerSentiment: transcriptAnalysis.rawAnalysis?.managerSentiment
      },
      engagementLevel: transcriptAnalysis.engagementLevel,
      concerns: transcriptAnalysis.concerns?.map(c => ({
        issue: typeof c === 'string' ? c : c.issue,
        severity: 'medium',
        recommendation: ''
      })) || [],
      highlights: transcriptAnalysis.highlights || [],
      careerDevelopmentTopics: transcriptAnalysis.careerDevelopment || [],
      blockers: transcriptAnalysis.blockers?.map(b => ({
        description: typeof b === 'string' ? b : b.description,
        suggestedResolution: ''
      })) || [],
      suggestedFollowUps: transcriptAnalysis.rawAnalysis?.suggestedFollowUps || [],
      analyzedAt: new Date(),
      analysisVersion: '1.0'
    };

    meeting.aiScoring = {
      employee: employeeScoring,
      manager: managerScoring
    };

    const firstExtractedActionIndex = meeting.actionItems.length;
    if (actionItems.actionItems?.length > 0) {
      actionItems.actionItems.slice(0, 50).forEach(item => {
        const description = cleanText(item.description || item.task, 2000);
        if (!description) return;
        const dueDate = item.dueDate ? validDate(item.dueDate) : null;
        meeting.actionItems.push({
          description,
          assignedTo: item.assignedTo === 'manager' ? 'manager' : 'employee',
          assignedToName: item.assignedTo === 'manager'
            ? meeting.managerInfo?.name
            : meeting.employeeInfo?.name,
          priority: PRIORITIES.has(item.priority) ? item.priority : 'medium',
          dueDate,
          source: 'ai_extracted'
        });
      });
    }

    await meeting.save();
    const extractedActions = meeting.actionItems.slice(firstExtractedActionIndex);
    await Promise.all(extractedActions.map(item => synchronizeActionItemLifecycle(meeting, item, req.session.user)));

    res.json({
      success: true,
      data: {
        aiAnalysis: meeting.aiAnalysis,
        aiScoring: meeting.aiScoring,
        actionItemsExtracted: actionItems.actionItems?.length || 0
      }
    });
  } catch (error) {
    console.error('Error analyzing meeting:', error);
    res.status(500).json({ success: false, error: 'Failed to analyze meeting' });
  }
});

/**
 * POST /api/one-on-ones/:id/score - Manager scores the employee
 */
router.post('/:id/score', requireManager, async (req, res) => {
  try {
    const meeting = req.oneOnOne;
    if (!req.oneOnOneAccess.isManager && !req.oneOnOneAccess.isHrAdmin) {
      return res.status(403).json({ success: false, error: 'Only meeting manager can score' });
    }

    const {
      overallScore,
      performanceRating,
      dimensions,
      strengths,
      areasForGrowth,
      additionalComments,
      isVisible = false
    } = req.body;

    meeting.managerScoring = {
      overallScore,
      performanceRating,
      dimensions: dimensions || {},
      strengths,
      areasForGrowth,
      additionalComments,
      scoredAt: new Date(),
      isVisible
    };

    await meeting.save();

    res.json({
      success: true,
      data: meeting.managerScoring,
      message: 'Score saved successfully'
    });
  } catch (error) {
    console.error('Error saving score:', error);
    res.status(500).json({ success: false, error: 'Failed to save score' });
  }
});

/**
 * POST /api/one-on-ones/:id/agenda - Add agenda item
 */
router.post('/:id/agenda', requireAuth, async (req, res) => {
  try {
    const meeting = req.oneOnOne;
    const { isManager, isEmployee } = req.oneOnOneAccess;

    if (!isManager && !isEmployee) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const { topic, description, priority = 'medium' } = req.body;
    if (!cleanText(topic, 300) || !PRIORITIES.has(priority)) {
      return res.status(400).json({ success: false, error: 'Valid agenda topic and priority required' });
    }
    const addedBy = isManager ? 'manager' : 'employee';

    meeting.agendaItems.push({
      topic: cleanText(topic, 300),
      description: cleanText(description, 2000),
      addedBy,
      priority
    });
    await meeting.save();

    res.json({ success: true, data: meeting.agendaItems[meeting.agendaItems.length - 1] });
  } catch (error) {
    console.error('Error adding agenda item:', error);
    res.status(500).json({ success: false, error: 'Failed to add agenda item' });
  }
});

/**
 * POST /api/one-on-ones/:id/action-items - Add action item
 */
router.post('/:id/action-items', requireAuth, async (req, res) => {
  try {
    const meeting = req.oneOnOne;
    if (!req.oneOnOneAccess.isManager && !req.oneOnOneAccess.isEmployee) {
      return res.status(403).json({ success: false, error: 'Only meeting participants can add action items' });
    }

    const { description, assignedTo, category, priority, dueDate } = req.body;
    const safeAssignedTo = assignedTo || 'employee';
    const safeCategory = category || 'task';
    const safePriority = priority || 'medium';
    const safeDueDate = dueDate ? validDate(dueDate) : null;
    if (!cleanText(description, 2000)) {
      return res.status(400).json({ success: false, error: 'Action item description required' });
    }
    if (!ACTION_ASSIGNEES.has(safeAssignedTo) || !ACTION_CATEGORIES.has(safeCategory) || !PRIORITIES.has(safePriority)) {
      return res.status(400).json({ success: false, error: 'Invalid action item assignment, category, or priority' });
    }
    if (dueDate && !safeDueDate) {
      return res.status(400).json({ success: false, error: 'Invalid action item due date' });
    }

    meeting.actionItems.push({
      description: cleanText(description, 2000),
      assignedTo: safeAssignedTo,
      assignedToName: safeAssignedTo === 'manager' ? meeting.managerInfo?.name : meeting.employeeInfo?.name,
      category: safeCategory,
      priority: safePriority,
      dueDate: safeDueDate,
      status: 'pending'
    });

    await meeting.save();
    const item = meeting.actionItems[meeting.actionItems.length - 1];
    await synchronizeActionItemLifecycle(meeting, item, req.session.user);

    res.json({ success: true, data: item });
  } catch (error) {
    console.error('Error adding action item:', error);
    res.status(500).json({ success: false, error: 'Failed to add action item' });
  }
});

/**
 * PUT /api/one-on-ones/:id/action-items/:itemId - Update action item
 */
router.put('/:id/action-items/:itemId', requireAuth, async (req, res) => {
  try {
    const meeting = req.oneOnOne;
    if (!req.oneOnOneAccess.isManager && !req.oneOnOneAccess.isEmployee) {
      return res.status(403).json({ success: false, error: 'Only meeting participants can update action items' });
    }

    const item = meeting.actionItems.find(a => a.id === req.params.itemId || a._id?.toString() === req.params.itemId);

    if (!item) {
      return res.status(404).json({ success: false, error: 'Action item not found' });
    }

    if (req.oneOnOneAccess.isEmployee && item.assignedTo !== 'employee') {
      return res.status(403).json({ success: false, error: 'Employees can only update their own action items' });
    }

    const suppliedFields = ['status', 'notes', 'dueDate'].filter(field =>
      Object.prototype.hasOwnProperty.call(req.body || {}, field)
    );
    if (suppliedFields.length === 0) {
      return res.status(400).json({ success: false, error: 'No permitted action item fields supplied' });
    }
    const { status, notes, dueDate } = req.body;
    const previousStatus = item.status;
    const previousDueAt = item.dueDate ? new Date(item.dueDate).getTime() : null;

    if (status !== undefined) {
      if (!ACTION_STATUSES.has(String(status))) {
        return res.status(400).json({ success: false, error: 'Invalid action item status' });
      }
      item.status = status;
      if (status === 'completed') {
        item.completedAt = new Date();
      } else {
        item.completedAt = undefined;
      }
    }
    if (notes !== undefined) item.notes = cleanText(notes, 5000);
    if (dueDate !== undefined) {
      if (dueDate === null || dueDate === '') item.dueDate = undefined;
      else {
        const safeDueDate = validDate(dueDate);
        if (!safeDueDate) {
          return res.status(400).json({ success: false, error: 'Invalid action item due date' });
        }
        item.dueDate = safeDueDate;
      }
    }

    await meeting.save();
    const currentDueAt = item.dueDate ? new Date(item.dueDate).getTime() : null;
    if (item.status !== previousStatus || currentDueAt !== previousDueAt) {
      await synchronizeActionItemLifecycle(meeting, item, req.session.user, {
        emitCompletion: previousStatus !== 'completed'
      });
    }

    res.json({ success: true, data: item });
  } catch (error) {
    console.error('Error updating action item:', error);
    res.status(500).json({ success: false, error: 'Failed to update action item' });
  }
});

/**
 * POST /api/one-on-ones/:id/complete - Mark meeting as completed
 */
router.post('/:id/complete', requireAuth, async (req, res) => {
  try {
    const meeting = req.oneOnOne;
    if (!req.oneOnOneAccess.isManager && !req.oneOnOneAccess.isHrAdmin) {
      return res.status(403).json({ success: false, error: 'Only manager can complete meeting' });
    }
    if (['cancelled', 'no_show'].includes(meeting.status)) {
      return res.status(409).json({ success: false, error: 'A cancelled meeting cannot be completed' });
    }

    meeting.status = 'completed';
    meeting.completedAt = meeting.completedAt || new Date();
    meeting.actualEndTime = meeting.actualEndTime || new Date();

    const { sharedNotes, privateManagerNotes } = req.body;
    if (sharedNotes !== undefined) meeting.sharedNotes = cleanText(sharedNotes, 20000);
    if (privateManagerNotes !== undefined) meeting.privateManagerNotes = cleanText(privateManagerNotes, 20000);

    await meeting.save();
    await cancelMeetingLifecycle(meeting, 'meeting_completed');
    await recordOneOnOneEvent(meeting, 'one_on_one.completed', req.session.user, {
      eventId: `one_on_one:${meeting._id}:completed`
    });

    res.json({ success: true, data: meeting });
  } catch (error) {
    console.error('Error completing meeting:', error);
    res.status(500).json({ success: false, error: 'Failed to complete meeting' });
  }
});

/**
 * POST /api/one-on-ones/:id/mood - Record employee mood
 */
router.post('/:id/mood', requireAuth, async (req, res) => {
  try {
    const meeting = req.oneOnOne;
    if (!req.oneOnOneAccess.isEmployee) {
      return res.status(403).json({ success: false, error: 'Only employee can record mood' });
    }

    const { score, label, comment, factors } = req.body;

    meeting.employeeMood = {
      score,
      label,
      comment,
      factors: factors || [],
      recordedAt: new Date()
    };

    await meeting.save();

    res.json({ success: true, data: meeting.employeeMood });
  } catch (error) {
    console.error('Error recording mood:', error);
    res.status(500).json({ success: false, error: 'Failed to record mood' });
  }
});

/**
 * POST /api/one-on-ones/:id/feedback - Employee feedback
 */
router.post('/:id/feedback', requireAuth, async (req, res) => {
  try {
    const meeting = req.oneOnOne;
    if (!req.oneOnOneAccess.isEmployee) {
      return res.status(403).json({ success: false, error: 'Only employee can submit feedback' });
    }

    const { meetingQuality, managerRating, helpful, suggestions } = req.body;

    meeting.employeeFeedback = {
      meetingQuality,
      managerRating,
      helpful,
      suggestions,
      submittedAt: new Date()
    };

    await meeting.save();

    res.json({ success: true, message: 'Feedback submitted successfully' });
  } catch (error) {
    console.error('Error submitting feedback:', error);
    res.status(500).json({ success: false, error: 'Failed to submit feedback' });
  }
});

/**
 * GET /api/one-on-ones/:id/trends - Get meeting trends
 */
router.get('/:id/trends', requireAuth, async (req, res) => {
  try {
    const meeting = req.oneOnOne;
    const history = await OneOnOne.find({
      organizationId: req.organizationId,
      managerId: meeting.managerId,
      employeeId: meeting.employeeId,
      status: 'completed'
    })
      .sort({ scheduledDate: -1 })
      .limit(10)
      .select('scheduledDate aiScoring.employee.overallScore managerScoring.overallScore employeeMood aiAnalysis.keyTopics');

    const analysisService = getMeetingAnalysisService();
    const trends = analysisService ? await analysisService.analyzeTrends(history) : { trend: 'analysis_unavailable' };

    res.json({
      success: true,
      data: { trends, meetingsAnalyzed: history.length }
    });
  } catch (error) {
    console.error('Error getting trends:', error);
    res.status(500).json({ success: false, error: 'Failed to get trends' });
  }
});

/**
 * POST /api/one-on-ones/:id/prep - Generate prep suggestions
 */
router.post('/:id/prep', requireAuth, async (req, res) => {
  try {
    const meeting = req.oneOnOne;
    if (!req.oneOnOneAccess.isManager && !req.oneOnOneAccess.isEmployee) {
      return res.status(403).json({ success: false, error: 'Only meeting participants can generate preparation' });
    }

    const analysisService = getMeetingAnalysisService();
    if (!analysisService) {
      return res.status(503).json({ success: false, error: 'Analysis service not available' });
    }

    const previousMeetings = await OneOnOne.find({
      organizationId: req.organizationId,
      managerId: meeting.managerId,
      employeeId: meeting.employeeId,
      status: 'completed'
    })
      .sort({ scheduledDate: -1 })
      .limit(3)
      .select('aiAnalysis.keyTopics actionItems employeeMood');

    const prepSuggestions = await analysisService.generateMeetingPrep({
      employeeRole: meeting.employeeInfo?.title,
      lastMeetingDate: previousMeetings[0]?.scheduledDate,
      previousTopics: previousMeetings.flatMap(m => m.aiAnalysis?.keyTopics?.map(t => t.topic || t) || []).slice(0, 5)
    });

    meeting.prepSuggestions = { ...prepSuggestions, generatedAt: new Date() };
    await meeting.save();
    const actorId = getActorId(req);
    const actorRecipient = participantRecipients(meeting).find(recipient => recipient.userId === actorId);
    await recordOneOnOneEvent(meeting, 'one_on_one.prep_ready', req.session.user, {
      recipients: actorRecipient ? [actorRecipient] : [],
      eventId: `one_on_one:${meeting._id}:prep:${actorId}:${meeting.prepSuggestions.generatedAt.toISOString()}`
    });

    res.json({ success: true, data: meeting.prepSuggestions });
  } catch (error) {
    console.error('Error generating prep:', error);
    res.status(500).json({ success: false, error: 'Failed to generate prep suggestions' });
  }
});

/**
 * DELETE /api/one-on-ones/:id - Cancel meeting
 */
router.delete('/:id', requireManager, async (req, res) => {
  try {
    const meeting = req.oneOnOne;
    if (!req.oneOnOneAccess.isManager && !req.oneOnOneAccess.isHrAdmin) {
      return res.status(403).json({ success: false, error: 'Only meeting creator can cancel' });
    }

    const shouldCancelCalendar = meeting.status !== 'cancelled' || meeting.nylas?.syncStatus === 'failed';
    meeting.status = 'cancelled';
    await meeting.save();
    await cancelMeetingLifecycle(meeting, 'meeting_cancelled');
    if (shouldCancelCalendar) await cancelCalendarMeeting(meeting);
    await recordOneOnOneEvent(meeting, 'one_on_one.cancelled', req.session.user, {
      eventId: `one_on_one:${meeting._id}:cancelled`
    });

    res.json({ success: true, message: 'Meeting cancelled' });
  } catch (error) {
    console.error('Error cancelling meeting:', error);
    res.status(500).json({ success: false, error: 'Failed to cancel meeting' });
  }
});

module.exports = router;




