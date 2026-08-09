const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const okrRoutes = require('../routes/okrs');
const webhookRoutes = require('../routes/webhooks');
const feedbackRoutes = require('../routes/feedback');
const bulkRoutes = require('../routes/bulk');
const appraisalRoutes = require('../routes/appraisals');
const reviewRoutes = require('../routes/reviews');
const GoalPeriod = require('../models/GoalPeriod');
const OKR = require('../models/OKR');
const Feedback = require('../models/Feedback');
const FeedbackRequest = require('../models/FeedbackRequest');
const Appraisal = require('../models/Appraisal');
const AppraisalCycle = require('../models/AppraisalCycle');
const AppraisalDocument = require('../models/AppraisalDocument');
const ReviewCycle = require('../models/ReviewCycle');
const { PerformanceReview } = require('../models/PerformanceReview');
const DomainEvent = require('../models/DomainEvent');
const Notification = require('../models/Notification');
const NotificationDelivery = require('../models/NotificationDelivery');
const ScheduledReminder = require('../models/ScheduledReminder');
const { buildGoalSnapshots } = require('../services/appraisalGoalSnapshotService');
const { publishDomainEvent, recordEvent } = require('../services/outboxService');
const { runNotificationWorkerOnce } = require('../services/notificationWorker');
const {
  processReminder,
  scheduleReminderSequence
} = require('../services/reminderScheduler');

const ORG_A = 'org-a';
const ORG_B = 'org-b';
const EMPLOYEE = 'employee-1';
const MANAGER = 'manager-1';

let mongo;
let app;
let period;

function sessionUser(actor, organizationId) {
  const organization = {
    id: organizationId,
    role: actor === 'hr' ? 'hr_manager' : 'employee'
  };
  if (actor === 'manager') {
    return {
      id: MANAGER,
      sub: MANAGER,
      name: 'Manager One',
      email: 'manager@example.com',
      currentOrganization: organization,
      organizations: [organization],
      idpTeams: [{
        id: 'team-a',
        name: 'Team A',
        organizationId,
        role: 'line_manager',
        isManager: true,
        directReports: [EMPLOYEE]
      }]
    };
  }
  if (actor === 'hr') {
    return {
      id: 'hr-1',
      sub: 'hr-1',
      name: 'HR One',
      email: 'hr@example.com',
      currentOrganization: organization,
      organizations: [organization]
    };
  }
  return {
    id: EMPLOYEE,
    sub: EMPLOYEE,
    name: 'Employee One',
    email: 'employee@example.com',
    currentOrganization: organization,
    organizations: [organization],
    idpTeams: [{
      id: 'team-a',
      name: 'Team A',
      organizationId,
      role: 'member',
      managerId: MANAGER,
      managerName: 'Manager One',
      managerEmail: 'manager@example.com'
    }]
  };
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use((req, res, next) => {
    const actor = String(req.get('x-test-actor') || 'employee');
    const organizationId = String(req.get('x-test-organization') || ORG_A);
    const user = sessionUser(actor, organizationId);
    const requestedUserId = String(req.get('x-test-user') || '').trim();
    if (requestedUserId) {
      user.id = requestedUserId;
      user.sub = requestedUserId;
      user.name = `Test ${requestedUserId}`;
      user.email = `${requestedUserId}@example.com`;
    }
    req.session = { user, currentOrganizationId: organizationId };
    req.currentOrganization = user.currentOrganization;
    next();
  });
  app.use('/api/okrs', okrRoutes);
  app.use('/api/webhooks', webhookRoutes);
  app.use('/api/feedback', feedbackRoutes);
  app.use('/api/bulk', bulkRoutes);
  app.use('/api/appraisals', appraisalRoutes);
  app.use('/api/reviews', reviewRoutes);
});

beforeEach(async () => {
  await mongoose.connection.db.dropDatabase();
  const now = new Date();
  const startDate = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
  const endDate = new Date(now.getTime() + 150 * 24 * 60 * 60 * 1000);
  period = await GoalPeriod.create({
    organizationId: ORG_A,
    name: 'FY2026 Q4',
    code: 'FY2026-Q4',
    type: 'fiscal_quarter',
    fiscalYear: 2026,
    fiscalQuarter: 4,
    fiscalYearStartMonth: 1,
    startDate,
    endDate,
    planningStartDate: new Date(now.getTime() - 24 * 60 * 60 * 1000),
    planningEndDate: new Date(now.getTime() + 70 * 24 * 60 * 60 * 1000),
    status: 'upcoming',
    timezone: 'Europe/London',
    settings: { allowCheckInsBeforeStart: true }
  });
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

test('employee future goal is approved and snapshotted immutably', async () => {
  const created = await request(app)
    .post('/api/okrs')
    .set('x-test-actor', 'employee')
    .send({
      title: 'Improve customer response time',
      periodId: String(period._id),
      ownerId: EMPLOYEE,
      objectives: [{
        title: 'Respond faster',
        weight: 100,
        keyResults: [{ title: 'Reduce response time', metricType: 'number', startValue: 10, targetValue: 4 }]
      }]
    })
    .expect(201);
  expect(created.body.data.lifecycle.state).toBe('draft');
  expect(created.body.data.scoring.status).toBe('unrated');

  const goalId = created.body.data._id;
  await request(app)
    .post(`/api/okrs/${goalId}/submit`)
    .set('x-test-actor', 'employee')
    .send({})
    .expect(200);
  await request(app)
    .post(`/api/okrs/${goalId}/decision`)
    .set('x-test-actor', 'manager')
    .send({ decision: 'approve' })
    .expect(200);
  await request(app)
    .post(`/api/okrs/${goalId}/check-ins`)
    .set('x-test-actor', 'employee')
    .send({
      idempotencyKey: 'checkin-1',
      summary: 'Response time is improving',
      health: 'on_track',
      keyResultUpdates: [{ objectiveIndex: 0, keyResultIndex: 0, currentValue: 7 }]
    })
    .expect(201);

  const cycle = {
    periodStart: period.startDate,
    periodEnd: period.endDate,
    okrWeight: 40
  };
  const snapshot = await buildGoalSnapshots({ organizationId: ORG_A, employeeId: EMPLOYEE, cycle });
  expect(snapshot.snapshots).toHaveLength(1);
  expect(snapshot.snapshots[0].definition.title).toBe('Improve customer response time');
  expect(snapshot.snapshots[0].achievement.score).toBe(50);

  await OKR.updateOne({ _id: goalId }, { $set: { title: 'Rewritten later' } });
  expect(snapshot.snapshots[0].definition.title).toBe('Improve customer response time');
});

test('manager assignment requires the employee acknowledgement', async () => {
  const response = await request(app)
    .post('/api/okrs')
    .set('x-test-actor', 'manager')
    .send({
      title: 'Deliver quarterly operating report',
      periodId: String(period._id),
      ownerId: EMPLOYEE,
      objectives: [{ title: 'Deliver report', weight: 100, keyResults: [{ title: 'Report delivered', metricType: 'boolean', targetValue: 1 }] }]
    })
    .expect(201);
  expect(response.body.data.lifecycle.state).toBe('pending_acknowledgement');

  const acknowledged = await request(app)
    .post(`/api/okrs/${response.body.data._id}/acknowledge`)
    .set('x-test-actor', 'employee')
    .send({ comment: 'Understood' })
    .expect(200);
  expect(acknowledged.body.data.lifecycle.state).toBe('active');
  expect(acknowledged.body.data.assignment.acknowledgementStatus).toBe('acknowledged');
});

test('tenant-scoped goal lookup does not disclose another organization', async () => {
  const goal = await OKR.create({
    organizationId: ORG_A,
    ownerId: EMPLOYEE,
    type: 'individual',
    period: period.name,
    periodId: period._id,
    title: 'Tenant A goal',
    status: 'active',
    approvalStatus: 'approved',
    lifecycle: { state: 'active' },
    objectives: [{ title: 'Tenant A objective', keyResults: [{ title: 'Done', targetValue: 100 }] }]
  });
  await request(app)
    .get(`/api/okrs/${goal._id}`)
    .set('x-test-actor', 'employee')
    .set('x-test-organization', ORG_B)
    .expect(404);
});

test('durable outbox event ID is idempotent', async () => {
  const event = {
    eventId: 'test:event:1',
    eventType: 'goal.assigned',
    organizationId: ORG_A,
    aggregate: { type: 'goal', id: 'goal-1' },
    actor: { userId: MANAGER },
    recipients: [{ userId: EMPLOYEE }],
    notification: {
      category: 'goal',
      title: 'Goal assigned',
      message: 'A goal is ready to review.',
      deepLink: '/okrs?goal=goal-1',
      action: { kind: 'acknowledge', label: 'Review goal' }
    }
  };
  const first = await publishDomainEvent(event);
  const replay = await publishDomainEvent(event);
  expect(String(replay._id)).toBe(String(first._id));
  expect(await DomainEvent.countDocuments({ eventId: event.eventId })).toBe(1);

  const firstRun = await runNotificationWorkerOnce({
    workerId: 'notification-test-worker',
    eventBatchSize: 10,
    deliveryBatchSize: 10
  });
  expect(firstRun.eventsProcessed).toBe(1);

  const notification = await Notification.findOne({
    organizationId: ORG_A,
    eventId: event.eventId,
    userId: EMPLOYEE
  }).lean();
  expect(notification).toMatchObject({
    eventType: 'goal.assigned',
    isAction: true,
    actionStatus: 'open',
    target: { type: 'goal', id: 'goal-1' }
  });
  expect(await Notification.countDocuments({ eventId: event.eventId, userId: EMPLOYEE })).toBe(1);
  expect(await NotificationDelivery.countDocuments({
    eventId: event.eventId,
    userId: EMPLOYEE,
    channel: 'in_app',
    status: 'delivered'
  })).toBe(1);

  const replayRun = await runNotificationWorkerOnce({
    workerId: 'notification-test-worker-replay',
    eventBatchSize: 10,
    deliveryBatchSize: 10
  });
  expect(replayRun.eventsProcessed).toBe(0);
  expect(await Notification.countDocuments({ eventId: event.eventId, userId: EMPLOYEE })).toBe(1);
  expect(await NotificationDelivery.countDocuments({ eventId: event.eventId, userId: EMPLOYEE })).toBe(3);
});

test('completed reminder target closes its action and pending delivery', async () => {
  const now = new Date();
  const dueAt = new Date(now.getTime() + (10 * 24 * 60 * 60 * 1000));
  const targetId = 'goal-reminder-1';

  await scheduleReminderSequence({
    organizationId: ORG_A,
    eventType: 'goal.acknowledgement_due',
    target: { type: 'goal_assignment', id: targetId },
    recipient: { userId: EMPLOYEE, name: 'Employee One' },
    dueAt,
    now,
    notification: {
      category: 'goal',
      title: 'Goal acknowledgement due',
      message: 'Review and acknowledge the assigned goal.',
      deepLink: `/okrs?goal=${targetId}`,
      action: { kind: 'acknowledge', label: 'Review goal' }
    }
  });
  expect(await ScheduledReminder.countDocuments({
    organizationId: ORG_A,
    'target.type': 'goal_assignment',
    'target.id': targetId,
    status: 'scheduled'
  })).toBe(4);

  await recordEvent({
    eventId: 'test:goal-assignment-action:1',
    eventType: 'goal.assigned',
    organizationId: ORG_A,
    aggregateType: 'goal',
    aggregateId: targetId,
    actor: { userId: MANAGER },
    recipients: [{ userId: EMPLOYEE }],
    payload: { dueAt, deepLink: `/okrs?goal=${targetId}` }
  });
  await runNotificationWorkerOnce({
    workerId: 'action-materialization-worker',
    eventBatchSize: 10,
    deliveryBatchSize: 0
  });

  const action = await Notification.findOne({
    organizationId: ORG_A,
    userId: EMPLOYEE,
    'target.type': 'goal_assignment',
    'target.id': targetId
  });
  expect(action.actionStatus).toBe('open');
  await NotificationDelivery.updateOne(
    { notificationId: action._id, channel: 'email' },
    { $set: { status: 'pending', nextAttemptAt: now } }
  );

  const reminder = await ScheduledReminder.findOne({
    organizationId: ORG_A,
    'target.type': 'goal_assignment',
    'target.id': targetId,
    stage: '7d'
  });
  const result = await processReminder(reminder, { completionResolver: async () => true });
  expect(result).toEqual({ cancelled: true });
  expect(await ScheduledReminder.countDocuments({
    organizationId: ORG_A,
    'target.type': 'goal_assignment',
    'target.id': targetId,
    status: 'cancelled'
  })).toBe(4);

  const completedAction = await Notification.findById(action._id).lean();
  expect(completedAction.actionStatus).toBe('completed');
  expect(completedAction.completedAt).toBeTruthy();
  expect(completedAction.readAt).toBeTruthy();
  const cancelledEmail = await NotificationDelivery.findOne({ notificationId: action._id, channel: 'email' }).lean();
  expect(cancelledEmail.status).toBe('cancelled');
  expect(cancelledEmail.lastError.code).toBe('ACTION_CANCELLED');
});

test('approved and cancelled leave pauses and resumes reminders without changing goal score', async () => {
  const now = new Date();
  const leaveStart = new Date(now.getTime() + (5 * 24 * 60 * 60 * 1000));
  const leaveEnd = new Date(now.getTime() + (15 * 24 * 60 * 60 * 1000));
  const dueAt = new Date(now.getTime() + (14 * 24 * 60 * 60 * 1000));
  const goal = await OKR.create({
    organizationId: ORG_A,
    ownerId: EMPLOYEE,
    type: 'individual',
    period: period.name,
    periodId: period._id,
    title: 'Maintain delivery quality',
    status: 'active',
    approvalStatus: 'approved',
    lifecycle: { state: 'active' },
    objectives: [{
      title: 'Maintain quality',
      keyResults: [{
        title: 'Quality score',
        metricType: 'number',
        startValue: 0,
        targetValue: 100,
        currentValue: 50
      }]
    }]
  });
  const scoreBefore = await OKR.findById(goal._id)
    .select('progress scoring objectives')
    .lean();

  await scheduleReminderSequence({
    organizationId: ORG_A,
    eventType: 'goal.check_in_due',
    target: { type: 'goal_check_in', id: String(goal._id) },
    recipient: { userId: EMPLOYEE },
    dueAt,
    now,
    notification: {
      category: 'goal',
      title: 'Goal check-in due',
      message: 'Add a goal progress update.',
      deepLink: `/okrs?goal=${goal._id}`,
      action: { kind: 'complete', label: 'Check in' }
    }
  });
  const originals = new Map((await ScheduledReminder.find({
    organizationId: ORG_A,
    'target.type': 'goal_check_in',
    'target.id': String(goal._id)
  }).lean()).map((item) => [item.stage, item.scheduledFor.getTime()]));

  await request(app)
    .post('/api/webhooks/suite')
    .set('x-internal-request', 'true')
    .send({
      eventId: 'leave-approved-1',
      event: 'leave.approved',
      organizationId: ORG_A,
      subjectId: EMPLOYEE,
      data: { userId: EMPLOYEE, startAt: leaveStart, endAt: leaveEnd }
    })
    .expect(200);

  const paused = await ScheduledReminder.find({
    organizationId: ORG_A,
    'target.type': 'goal_check_in',
    'target.id': String(goal._id)
  }).lean();
  expect(paused).toHaveLength(4);
  paused.forEach((item) => {
    expect(item.pause.reason).toBe('leave.approved');
    expect(item.pause.pausedAt).toBeTruthy();
    expect(item.pause.originalScheduledFor.getTime()).toBe(originals.get(item.stage));
    expect(item.scheduledFor.getTime()).toBeGreaterThan(leaveEnd.getTime());
  });
  expect(await OKR.findById(goal._id).select('progress scoring objectives').lean()).toEqual(scoreBefore);

  await request(app)
    .post('/api/webhooks/suite')
    .set('x-internal-request', 'true')
    .send({
      eventId: 'leave-cancelled-1',
      event: 'leave.cancelled',
      organizationId: ORG_A,
      subjectId: EMPLOYEE,
      data: { userId: EMPLOYEE }
    })
    .expect(200);

  const resumed = await ScheduledReminder.find({
    organizationId: ORG_A,
    'target.type': 'goal_check_in',
    'target.id': String(goal._id)
  }).lean();
  resumed.forEach((item) => {
    expect(item.pause.reason).toBe('leave.cancelled');
    expect(item.pause.resumedAt).toBeTruthy();
    expect(item.scheduledFor.getTime()).toBe(originals.get(item.stage));
  });
  expect(await OKR.findById(goal._id).select('progress scoring objectives').lean()).toEqual(scoreBefore);
});

test('anonymous 360 feedback stays withheld until five same-tenant responses and is never individual appraisal evidence', async () => {
  const reviewerIds = ['reviewer-1', 'reviewer-2', 'reviewer-3', 'reviewer-4', 'reviewer-5'];
  const dueDate = new Date(Date.now() + (30 * 24 * 60 * 60 * 1000));
  const requested = await request(app)
    .post('/api/feedback/requests')
    .set('x-test-actor', 'manager')
    .send({
      subjectId: EMPLOYEE,
      reviewerIds,
      contextType: '360',
      anonymity: 'anonymous',
      visibility: 'private',
      dueDate,
      questions: ['What should this person keep doing?']
    })
    .expect(201);

  expect(requested.body.count).toBe(5);
  const cohortId = requested.body.data[0].cohortId;
  expect(cohortId).toBeTruthy();
  expect(new Set(requested.body.data.map((item) => item.cohortId))).toEqual(new Set([cohortId]));
  expect(requested.body.data.every((item) => item.minimumCohortSize === 5)).toBe(true);

  const feedbackIds = [];
  for (let index = 0; index < 4; index += 1) {
    const response = await request(app)
      .post('/api/feedback')
      .set('x-test-actor', 'employee')
      .set('x-test-user', reviewerIds[index])
      .send({
        receiverId: EMPLOYEE,
        requestId: requested.body.data[index]._id,
        content: `Anonymous response ${index + 1}`,
        type: 'general'
      })
      .expect(201);
    feedbackIds.push(response.body.data._id);
  }

  expect(await FeedbackRequest.countDocuments({
    organizationId: ORG_A,
    cohortId,
    state: 'fulfilled'
  })).toBe(4);

  // A response carrying the same opaque cohort ID in another tenant must not
  // unlock this tenant's anonymous cohort.
  await Feedback.create({
    organizationId: ORG_B,
    senderId: 'other-tenant-reviewer',
    receiverId: EMPLOYEE,
    content: 'Response from another organization',
    type: 'general',
    visibility: 'private',
    contextType: '360',
    anonymity: 'anonymous',
    cohortId,
    minimumCohortSize: 5
  });

  const withheld = await request(app)
    .get('/api/feedback/received')
    .set('x-test-actor', 'employee')
    .expect(200);
  expect(withheld.body.count).toBe(0);
  expect(withheld.body.data).toEqual([]);

  const hiddenIndividual = await request(app)
    .get(`/api/feedback/${feedbackIds[0]}`)
    .set('x-test-actor', 'employee')
    .expect(404);
  expect(hiddenIndividual.body.error).toMatch(/cohort threshold/i);

  const fifth = await request(app)
    .post('/api/feedback')
    .set('x-test-actor', 'employee')
    .set('x-test-user', reviewerIds[4])
    .send({
      receiverId: EMPLOYEE,
      requestId: requested.body.data[4]._id,
      content: 'Anonymous response 5',
      type: 'general'
    })
    .expect(201);
  feedbackIds.push(fifth.body.data._id);

  expect(await FeedbackRequest.countDocuments({
    organizationId: ORG_A,
    cohortId,
    state: 'fulfilled'
  })).toBe(5);

  const released = await request(app)
    .get('/api/feedback/received')
    .set('x-test-actor', 'employee')
    .expect(200);
  expect(released.body.count).toBe(5);
  expect(released.body.data).toHaveLength(5);
  released.body.data.forEach((item) => {
    expect(item.sender).toBe('Anonymous');
    expect(item.senderId).toBeNull();
  });

  await request(app)
    .get(`/api/feedback/${feedbackIds[0]}`)
    .set('x-test-actor', 'employee')
    .expect(200);

  const appraisalId = new mongoose.Types.ObjectId();
  const evidenceResponse = await request(app)
    .post(`/api/feedback/${feedbackIds[0]}/appraisal-evidence`)
    .set('x-test-actor', 'employee')
    .send({ appraisalId: String(appraisalId), included: true })
    .expect(409);
  expect(evidenceResponse.body.error).toMatch(/anonymous feedback cannot be attached/i);

  const unchanged = await Feedback.findById(feedbackIds[0]).lean();
  expect(unchanged.appraisalEvidence.included).toBe(false);
  expect(unchanged.appraisalEvidence.appraisalId).toBeFalsy();
});

test('appraisal document, chat, assessment, and finalization paths reject a related actor from another tenant', async () => {
  const now = new Date();
  const cycleB = await AppraisalCycle.create({
    organizationId: ORG_B,
    name: 'Tenant B final review',
    periodStart: new Date(now.getTime() - (60 * 24 * 60 * 60 * 1000)),
    periodEnd: new Date(now.getTime() - (5 * 24 * 60 * 60 * 1000)),
    status: 'active',
    currentPhase: 'finalReview',
    phases: {
      selfAssessment: {
        startDate: new Date(now.getTime() - (4 * 24 * 60 * 60 * 1000)),
        endDate: new Date(now.getTime() - (3 * 24 * 60 * 60 * 1000)),
        isCompleted: true
      },
      managerReview: {
        startDate: new Date(now.getTime() - (3 * 24 * 60 * 60 * 1000)),
        endDate: new Date(now.getTime() - (2 * 24 * 60 * 60 * 1000)),
        isCompleted: true
      },
      finalReview: {
        startDate: new Date(now.getTime() - (24 * 60 * 60 * 1000)),
        endDate: new Date(now.getTime() + (7 * 24 * 60 * 60 * 1000)),
        isActive: true
      }
    },
    settings: { enableAiAssist: false, enableChat: true }
  });
  const foreignAppraisal = await Appraisal.create({
    organizationId: ORG_B,
    cycleId: cycleB._id,
    employee: { userId: EMPLOYEE, name: 'Employee One', email: 'employee@example.com' },
    manager: { userId: MANAGER, name: 'Manager One', email: 'manager@example.com' },
    status: 'final_review_pending',
    selfAssessment: {
      submittedAt: new Date(now.getTime() - (3 * 24 * 60 * 60 * 1000)),
      overallSummary: { achievements: 'Tenant B private assessment' },
      overallSelfRating: 3
    },
    managerReview: {
      submittedAt: new Date(now.getTime() - (2 * 24 * 60 * 60 * 1000)),
      overallManagerRating: 3
    },
    chatThread: [{
      sender: { userId: EMPLOYEE, name: 'Employee One', role: 'employee' },
      message: 'Tenant B private chat',
      messageType: 'text',
      createdAt: now
    }]
  });
  const foreignDocument = await AppraisalDocument.create({
    appraisalId: foreignAppraisal._id,
    organizationId: ORG_B,
    fileName: 'tenant-b-private.txt',
    originalName: 'private.txt',
    fileType: 'txt',
    mimeType: 'text/plain',
    fileSize: 20,
    storagePath: 'not-exposed',
    visibility: 'employee_manager',
    uploadedBy: { userId: EMPLOYEE, name: 'Employee One', role: 'employee' }
  });
  foreignAppraisal.documents = [foreignDocument._id];
  await foreignAppraisal.save();

  const myAppraisals = await request(app)
    .get('/api/appraisals/my')
    .set('x-test-actor', 'employee')
    .set('x-test-organization', ORG_A)
    .expect(200);
  expect(myAppraisals.body.data.map((item) => item._id)).not.toContain(String(foreignAppraisal._id));

  await request(app)
    .get(`/api/appraisals/cycles/${cycleB._id}`)
    .set('x-test-actor', 'employee')
    .set('x-test-organization', ORG_A)
    .expect(404);

  await request(app)
    .get(`/api/appraisals/${foreignAppraisal._id}`)
    .set('x-test-actor', 'employee')
    .set('x-test-organization', ORG_A)
    .expect(404);

  await request(app)
    .get(`/api/appraisals/${foreignAppraisal._id}/documents/${foreignDocument._id}`)
    .set('x-test-actor', 'hr')
    .set('x-test-organization', ORG_A)
    .expect(404);

  await request(app)
    .get(`/api/appraisals/${foreignAppraisal._id}/chat`)
    .set('x-test-actor', 'employee')
    .set('x-test-organization', ORG_A)
    .expect(404);

  await request(app)
    .post(`/api/appraisals/${foreignAppraisal._id}/self-assessment`)
    .set('x-test-actor', 'employee')
    .set('x-test-organization', ORG_A)
    .send({
      selfAssessment: {
        overallSummary: { achievements: 'Attempted cross-tenant overwrite' },
        overallSelfRating: 5
      },
      submit: false
    })
    .expect(404);

  await request(app)
    .post(`/api/appraisals/${foreignAppraisal._id}/finalize`)
    .set('x-test-actor', 'manager')
    .set('x-test-organization', ORG_A)
    .send({ finalRating: 3, justification: 'Cross-tenant mutation must be rejected' })
    .expect(404);

  const unchanged = await Appraisal.findById(foreignAppraisal._id).lean();
  expect(unchanged.organizationId).toBe(ORG_B);
  expect(unchanged.status).toBe('final_review_pending');
  expect(unchanged.finalRating?.finalizedAt).toBeFalsy();
  expect(unchanged.selfAssessment.overallSummary.achievements).toBe('Tenant B private assessment');
  expect(unchanged.chatThread).toHaveLength(1);
});

test('AI appraisal suggestions retain evidence and require an audited human decision without changing ratings', async () => {
  const now = new Date();
  const cycle = await AppraisalCycle.create({
    organizationId: ORG_A,
    name: 'AI advisory review cycle',
    periodStart: new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000)),
    periodEnd: new Date(now.getTime() - (24 * 60 * 60 * 1000)),
    status: 'active'
  });
  const appraisal = await Appraisal.create({
    organizationId: ORG_A,
    cycleId: cycle._id,
    employee: { userId: EMPLOYEE, name: 'Employee One', email: 'employee@example.com' },
    manager: { userId: MANAGER, name: 'Manager One', email: 'manager@example.com' },
    status: 'manager_review_pending',
    managerReview: { overallManagerRating: 2 },
    aiSuggestionReviews: [{
      suggestionId: 'ai-suggestion-1',
      suggestionType: 'manager_rating',
      suggestion: { suggestedRating: 4, ratingJustification: 'Evidence-backed advisory result' },
      evidence: { goalSnapshotIds: ['goal-evidence-1'], calculatedScore: { suggestedRating: 3.6 } },
      modelUsed: 'test-model',
      status: 'pending',
      generatedAt: now,
      applied: false
    }]
  });

  const reviewed = await request(app)
    .post(`/api/appraisals/${appraisal._id}/ai-suggestions/ai-suggestion-1/review`)
    .set('x-test-actor', 'manager')
    .send({ decision: 'accept', comment: 'Reviewed against the source evidence' })
    .expect(200);
  expect(reviewed.body.data).toMatchObject({
    suggestionId: 'ai-suggestion-1',
    suggestionType: 'manager_rating',
    status: 'accepted',
    applied: false,
    evidence: { goalSnapshotIds: ['goal-evidence-1'] }
  });

  const persisted = await Appraisal.findById(appraisal._id).lean();
  expect(persisted.managerReview.overallManagerRating).toBe(2);
  expect(persisted.finalRating?.overall).toBeFalsy();
  expect(persisted.aiSuggestionReviews[0].reviewedBy.userId).toBe(MANAGER);
  expect(persisted.auditLog.at(-1)).toMatchObject({
    action: 'ai_suggestion_reviewed',
    details: {
      suggestionId: 'ai-suggestion-1',
      decision: 'accept',
      applied: false
    }
  });

  await request(app)
    .post(`/api/appraisals/${appraisal._id}/ai-suggestions/ai-suggestion-1/review`)
    .set('x-test-actor', 'manager')
    .send({ decision: 'reject', comment: 'Cannot reverse the prior review' })
    .expect(409);
});

test('retired appraisal goal-setting backdoors authenticate and return 410 without mutation', async () => {
  const appraisalId = new mongoose.Types.ObjectId();
  await request(app)
    .post(`/api/appraisals/${appraisalId}/submit-goals-legacy-disabled`)
    .set('x-test-actor', 'employee')
    .send({ okrIds: [new mongoose.Types.ObjectId()] })
    .expect(410);
  await request(app)
    .post(`/api/appraisals/${appraisalId}/approve-goals-legacy-disabled`)
    .set('x-test-actor', 'manager')
    .send({})
    .expect(410);
  await request(app)
    .post(`/api/appraisals/${appraisalId}/reject-goals-legacy-disabled`)
    .set('x-test-actor', 'manager')
    .send({ comments: 'Retired workflow' })
    .expect(410);
  expect(await Appraisal.countDocuments({ _id: appraisalId })).toBe(0);
});

test('legacy bulk writers are gone and direct callers are sent to canonical workflows', async () => {
  const legacyGoalWriter = await request(app)
    .post('/api/bulk/okrs/import')
    .set('x-test-actor', 'hr')
    .send({ okrs: [{ title: 'Bypass lifecycle' }] })
    .expect(410);
  expect(legacyGoalWriter.body.success).toBe(false);
  expect(legacyGoalWriter.body.error).toContain('/api/okrs/bulk-assign');

  const legacyReviewWriter = await request(app)
    .post('/api/bulk/reviews/create')
    .set('x-test-actor', 'hr')
    .send({ employeeIds: [EMPLOYEE] })
    .expect(410);
  expect(legacyReviewWriter.body.success).toBe(false);
  expect(legacyReviewWriter.body.error).toContain('/api/appraisals/cycles/:cycleId/launch');
});

test('legacy reviews remain read-only and cannot disclose another tenant', async () => {
  const now = new Date();
  const cycleA = await ReviewCycle.create({
    organizationId: ORG_A,
    title: 'Tenant A historical cycle',
    startDate: new Date(now.getTime() - 10000),
    endDate: new Date(now.getTime() + 10000),
    status: 'active',
    createdBy: 'hr-1'
  });
  const cycleB = await ReviewCycle.create({
    organizationId: ORG_B,
    title: 'Tenant B historical cycle',
    startDate: new Date(now.getTime() - 10000),
    endDate: new Date(now.getTime() + 10000),
    status: 'active',
    createdBy: 'hr-b'
  });
  const reviewA = await PerformanceReview.create({
    cycleId: cycleA._id,
    userId: EMPLOYEE,
    managerId: MANAGER,
    status: 'submitted',
    selfEvaluation: { content: 'Tenant A historical evidence', rating: 3, submittedAt: now }
  });
  const reviewB = await PerformanceReview.create({
    cycleId: cycleB._id,
    userId: EMPLOYEE,
    managerId: MANAGER,
    status: 'submitted',
    selfEvaluation: { content: 'Tenant B private historical evidence', rating: 4, submittedAt: now }
  });

  const list = await request(app)
    .get('/api/reviews')
    .set('x-test-actor', 'employee')
    .set('x-test-organization', ORG_A)
    .expect(200);
  expect(list.body.data.map((item) => item._id)).toEqual([String(reviewA._id)]);

  await request(app)
    .get(`/api/reviews/${reviewB._id}`)
    .set('x-test-actor', 'employee')
    .set('x-test-organization', ORG_A)
    .expect(404);

  const retiredWriter = await request(app)
    .post(`/api/reviews/${reviewA._id}/submit`)
    .set('x-test-actor', 'employee')
    .set('x-test-organization', ORG_A)
    .send({ content: 'Attempted dual write' })
    .expect(410);
  expect(retiredWriter.body.code).toBe('LEGACY_REVIEW_READ_ONLY');
  expect((await PerformanceReview.findById(reviewA._id).lean()).selfEvaluation.content)
    .toBe('Tenant A historical evidence');
});

test('canonical bulk goal mutations and appraisal reminders remain tenant-scoped', async () => {
  const goalA = await OKR.create({
    organizationId: ORG_A,
    ownerId: EMPLOYEE,
    type: 'individual',
    period: period.name,
    periodId: period._id,
    title: 'Tenant A bulk goal',
    status: 'active',
    approvalStatus: 'approved',
    lifecycle: { state: 'active' },
    objectives: [{ title: 'A objective', keyResults: [{ title: 'A result', targetValue: 100 }] }]
  });
  const goalB = await OKR.create({
    organizationId: ORG_B,
    ownerId: 'employee-b',
    type: 'individual',
    period: period.name,
    title: 'Tenant B bulk goal',
    status: 'active',
    approvalStatus: 'approved',
    lifecycle: { state: 'active' },
    objectives: [{ title: 'B objective', keyResults: [{ title: 'B result', targetValue: 100 }] }]
  });

  const statusUpdate = await request(app)
    .put('/api/bulk/okrs/status')
    .set('x-test-actor', 'hr')
    .send({ okrIds: [String(goalA._id), String(goalB._id)], status: 'closed' })
    .expect(200);
  expect(statusUpdate.body.data).toEqual({ matched: 1, modified: 1 });
  expect((await OKR.findById(goalA._id).lean()).lifecycle.state).toBe('closed');
  expect((await OKR.findById(goalB._id).lean()).lifecycle.state).toBe('active');

  const cancellation = await request(app)
    .delete('/api/bulk/okrs')
    .set('x-test-actor', 'hr')
    .send({ okrIds: [String(goalA._id), String(goalB._id)] })
    .expect(200);
  expect(cancellation.body.data).toEqual({ matched: 1, cancelled: 1 });
  expect((await OKR.findById(goalA._id).lean()).lifecycle.state).toBe('cancelled');
  expect((await OKR.findById(goalB._id).lean()).lifecycle.state).toBe('active');

  const now = new Date();
  const periodStart = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
  const periodEnd = new Date(now.getTime() + (30 * 24 * 60 * 60 * 1000));
  const cycleA = await AppraisalCycle.create({
    organizationId: ORG_A,
    name: 'Tenant A review cycle',
    periodStart,
    periodEnd,
    status: 'active'
  });
  const cycleB = await AppraisalCycle.create({
    organizationId: ORG_B,
    name: 'Tenant B review cycle',
    periodStart,
    periodEnd,
    status: 'active'
  });

  const dueAt = new Date(now.getTime() + (7 * 24 * 60 * 60 * 1000));
  const appraisalA = await Appraisal.create({
    organizationId: ORG_A,
    cycleId: cycleA._id,
    employee: { userId: EMPLOYEE, name: 'Employee One', email: 'employee@example.com' },
    manager: { userId: MANAGER, name: 'Manager One', email: 'manager@example.com' },
    status: 'self_assessment_pending',
    deadlines: { selfAssessmentDue: dueAt }
  });
  await Appraisal.create({
    // Deliberately references cycle A to prove organizationId is part of the
    // appraisal query, not just the parent-cycle lookup.
    organizationId: ORG_B,
    cycleId: cycleA._id,
    employee: { userId: 'employee-b', name: 'Employee B', email: 'employee-b@example.com' },
    manager: { userId: 'manager-b', name: 'Manager B', email: 'manager-b@example.com' },
    status: 'self_assessment_pending',
    deadlines: { selfAssessmentDue: dueAt }
  });

  await request(app)
    .post('/api/bulk/reviews/remind')
    .set('x-test-actor', 'hr')
    .set('idempotency-key', 'cross-tenant-cycle-probe')
    .send({ cycleId: String(cycleB._id), reminderType: 'self_review' })
    .expect(404);
  expect(await DomainEvent.countDocuments({ organizationId: ORG_A })).toBe(0);

  const reminder = await request(app)
    .post('/api/bulk/reviews/remind')
    .set('x-test-actor', 'hr')
    .set('idempotency-key', 'tenant-a-self-review-reminder')
    .send({ cycleId: String(cycleA._id), reminderType: 'self_review' })
    .expect(202);
  expect(reminder.body.data).toEqual({ queued: 1, totalFound: 1, failed: 0, errors: [] });

  const events = await DomainEvent.find({ eventType: 'appraisal.self_assessment_due' }).lean();
  expect(events).toHaveLength(1);
  expect(events[0].organizationId).toBe(ORG_A);
  expect(events[0].aggregate.id).toBe(String(appraisalA._id));
  expect(events[0].recipients.map((recipient) => recipient.userId)).toEqual([EMPLOYEE]);

  await request(app)
    .post('/api/bulk/reviews/remind')
    .set('x-test-actor', 'hr')
    .set('idempotency-key', 'tenant-a-self-review-reminder')
    .send({ cycleId: String(cycleA._id), reminderType: 'self_review' })
    .expect(202);
  expect(await DomainEvent.countDocuments({ eventType: 'appraisal.self_assessment_due' })).toBe(1);
});

test('1,000-person canonical appraisal launch snapshots tenant goals and replays idempotently', async () => {
  const now = new Date();
  const cycle = await AppraisalCycle.create({
    organizationId: ORG_A,
    name: '1,000-person idempotent appraisal launch',
    periodStart: new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000)),
    periodEnd: new Date(now.getTime() - (24 * 60 * 60 * 1000)),
    status: 'active',
    scope: { type: 'organization', targetIds: [] }
  });
  await OKR.create({
    organizationId: ORG_A,
    ownerId: 'launch-employee-500',
    type: 'individual',
    period: 'FY2026',
    title: 'Tenant A launch snapshot goal',
    status: 'active',
    approvalStatus: 'approved',
    lifecycle: { state: 'active' },
    objectives: [{
      title: 'Tenant-scoped evidence',
      keyResults: [{ title: 'Evidence captured', targetValue: 100, currentValue: 50 }]
    }]
  });
  await OKR.create({
    organizationId: ORG_B,
    ownerId: 'launch-employee-500',
    type: 'individual',
    period: 'FY2026',
    title: 'Foreign tenant goal must not be snapshotted',
    status: 'active',
    approvalStatus: 'approved',
    lifecycle: { state: 'active' },
    objectives: [{ title: 'Foreign objective', keyResults: [{ title: 'Foreign result', targetValue: 1 }] }]
  });
  const employees = Array.from({ length: 1000 }, (_, index) => ({
    userId: `launch-employee-${index + 1}`,
    name: `Launch Employee ${index + 1}`,
    email: `launch-employee-${index + 1}@example.com`,
    managerId: MANAGER,
    managerName: 'Manager One',
    managerEmail: 'manager@example.com'
  }));
  const payload = {
    employees
  };

  const firstStartedAt = Date.now();
  const first = await request(app)
    .post(`/api/appraisals/cycles/${cycle._id}/launch`)
    .set('x-test-actor', 'hr')
    .send(payload)
    .expect(200);
  const firstMs = Date.now() - firstStartedAt;
  expect(first.body.data).toMatchObject({ launched: 1000, replayed: 0, errors: 0 });
  expect(first.body.data.appraisals).toHaveLength(1000);

  const replayStartedAt = Date.now();
  const replay = await request(app)
    .post(`/api/appraisals/cycles/${cycle._id}/launch`)
    .set('x-test-actor', 'hr')
    .send(payload)
    .expect(200);
  const replayMs = Date.now() - replayStartedAt;
  expect(replay.body.data).toMatchObject({ launched: 0, replayed: 1000, errors: 0 });
  expect(replay.body.data.existingAppraisals).toHaveLength(1000);
  expect(await Appraisal.countDocuments({
    organizationId: ORG_A,
    cycleId: cycle._id
  })).toBe(1000);
  expect(await DomainEvent.countDocuments({
    organizationId: ORG_A,
    eventType: { $in: ['appraisal.cycle_launched', 'appraisal.self_assessment_due'] }
  })).toBe(2000);

  const snapshotAppraisal = await Appraisal.findOne({
    organizationId: ORG_A,
    cycleId: cycle._id,
    'employee.userId': 'launch-employee-500'
  }).lean();
  expect(snapshotAppraisal.goalSnapshots).toHaveLength(1);
  expect(snapshotAppraisal.goalSnapshots[0].definition.title).toBe('Tenant A launch snapshot goal');

  const totalMs = firstMs + replayMs;
  expect(totalMs).toBeLessThan(120000);
  console.info(`[acceptance] 1,000 appraisal launches: create=${firstMs}ms replay=${replayMs}ms total=${totalMs}ms`);
}, 150000);

test('1,000-person goal assignment completes in bounded batches and replays idempotently', async () => {
  const outboxModule = require('../services/outboxService');
  const reminderModule = require('../services/reminderScheduler');
  const eventSpy = jest.spyOn(outboxModule, 'recordEvent').mockResolvedValue(null);
  const reminderSpy = jest.spyOn(reminderModule, 'scheduleReminderSequence').mockResolvedValue([]);
  const assignments = Array.from({ length: 1000 }, (_, index) => ({
    ownerId: `scale-employee-${index + 1}`,
    externalKey: `scale-assignment-${index + 1}`
  }));
  const payload = {
    idempotencyKey: 'acceptance-1000-person-goal-batch',
    periodId: String(period._id),
    template: {
      title: 'Complete annual compliance objective',
      objectives: [{
        title: 'Complete annual compliance objective',
        weight: 100,
        keyResults: [{ title: 'Completion confirmed', metricType: 'boolean', targetValue: 1 }]
      }]
    },
    assignments
  };

  try {
    const firstStartedAt = Date.now();
    const first = await request(app)
      .post('/api/okrs/bulk-assign')
      .set('x-test-actor', 'hr')
      .send(payload)
      .expect(201);
    const firstMs = Date.now() - firstStartedAt;
    expect(first.body.data).toMatchObject({ created: 1000, replayed: 0, failed: 0 });
    expect(first.body.data.goals).toHaveLength(1000);

    const replayStartedAt = Date.now();
    const replay = await request(app)
      .post('/api/okrs/bulk-assign')
      .set('x-test-actor', 'hr')
      .send(payload)
      .expect(200);
    const replayMs = Date.now() - replayStartedAt;
    expect(replay.body.data).toMatchObject({ created: 0, replayed: 1000, failed: 0 });
    expect(replay.body.data.goals).toHaveLength(1000);
    expect(await OKR.countDocuments({
      organizationId: ORG_A,
      'assignment.bulkBatchKey': payload.idempotencyKey
    })).toBe(1000);

    const totalMs = firstMs + replayMs;
    expect(totalMs).toBeLessThan(45000);
    console.info(`[acceptance] 1,000 goal assignments: create=${firstMs}ms replay=${replayMs}ms total=${totalMs}ms`);
    expect(eventSpy).toHaveBeenCalled();
    expect(reminderSpy).toHaveBeenCalled();
  } finally {
    eventSpy.mockRestore();
    reminderSpy.mockRestore();
  }
}, 60000);
