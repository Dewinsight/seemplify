const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const axios = require('axios');
const { MongoMemoryServer } = require('mongodb-memory-server');
const notificationRoutes = require('../routes/notifications');
const DomainEvent = require('../models/DomainEvent');
const NotificationPreference = require('../models/NotificationPreference');
const NotificationDelivery = require('../models/NotificationDelivery');
const { publishDomainEvent } = require('../services/outboxService');
const {
  buildImmediateChatMessage,
  runNotificationWorkerOnce
} = require('../services/notificationWorker');
const zulipService = require('../services/zulipService');

const ORG_A = 'chat-org-a';
const ORG_B = 'chat-org-b';
const USER_ID = 'chat-user-1';

let mongo;
let app;
const originalEnvironment = {
  FRONTEND_URL: process.env.FRONTEND_URL,
  NODE_ENV: process.env.NODE_ENV,
  ZULIP_BASE_URL: process.env.ZULIP_BASE_URL,
  ZULIP_BOT_EMAIL: process.env.ZULIP_BOT_EMAIL,
  ZULIP_BOT_API_KEY: process.env.ZULIP_BOT_API_KEY,
  ZULIP_REQUEST_TIMEOUT_MS: process.env.ZULIP_REQUEST_TIMEOUT_MS
};

function restoreEnvironment() {
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function eventFor(organizationId, eventId, overrides = {}) {
  return {
    eventId,
    eventType: 'appraisal.self_assessment_due',
    organizationId,
    aggregate: { type: 'appraisal', id: `appraisal-${organizationId}` },
    recipients: [{
      userId: USER_ID,
      // The chat worker must ignore this event-supplied destination and use
      // the authenticated user's tenant-scoped preference destination.
      email: 'untrusted-event-address@example.com',
      channels: ['in_app', 'email', 'chat']
    }],
    notification: {
      category: 'appraisal',
      title: 'Sensitive custom title with rating 1/5',
      message: 'Secret manager comment and private feedback must never leave the app.',
      deepLink: `/appraisals/appraisal-${organizationId}`,
      action: { kind: 'complete', label: 'Open self-assessment' }
    },
    metadata: { comment: 'another secret', rating: 1 },
    ...overrides
  };
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const organizationId = String(req.get('x-test-organization') || ORG_A);
    const user = {
      id: USER_ID,
      sub: USER_ID,
      name: 'Chat User',
      email: 'chat-user@example.com',
      currentOrganization: { id: organizationId, role: 'employee' },
      organizations: [{ id: organizationId, role: 'employee' }]
    };
    req.session = { user, currentOrganizationId: organizationId };
    req.currentOrganization = user.currentOrganization;
    next();
  });
  app.use('/api/notifications', notificationRoutes);
});

beforeEach(async () => {
  await mongoose.connection.db.dropDatabase();
  process.env.NODE_ENV = 'test';
  process.env.FRONTEND_URL = 'https://performance.example.com';
  process.env.ZULIP_BASE_URL = 'https://chat.example.com';
  process.env.ZULIP_BOT_EMAIL = 'performance-bot@example.com';
  process.env.ZULIP_BOT_API_KEY = 'test-api-key';
  delete process.env.ZULIP_REQUEST_TIMEOUT_MS;
});

afterEach(() => {
  jest.restoreAllMocks();
  restoreEnvironment();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

test('chat preference defaults off, is tenant scoped, and deletes its hidden destination when fully disabled', async () => {
  const initial = await request(app)
    .get('/api/notifications/preferences')
    .expect(200);
  expect(initial.body.data.channels).toMatchObject({ inApp: true, email: false, chat: false });
  expect(initial.body.data.chat?.recipientEmail).toBeUndefined();

  const enabled = await request(app)
    .patch('/api/notifications/preferences')
    .send({ channels: { chat: true } })
    .expect(200);
  expect(enabled.body.data.channels.chat).toBe(true);
  expect(enabled.body.data.chat?.recipientEmail).toBeUndefined();

  let stored = await NotificationPreference.findOne({ organizationId: ORG_A, userId: USER_ID })
    .select('+chat.recipientEmail')
    .lean();
  expect(stored.chat.recipientEmail).toBe('chat-user@example.com');

  const otherTenant = await request(app)
    .get('/api/notifications/preferences')
    .set('x-test-organization', ORG_B)
    .expect(200);
  expect(otherTenant.body.data.channels.chat).toBe(false);
  expect(await NotificationPreference.countDocuments({ organizationId: ORG_B, userId: USER_ID })).toBe(0);

  await request(app)
    .patch('/api/notifications/preferences')
    .send({
      channels: { chat: false },
      eventOverrides: [{ eventType: 'goal.assigned', chat: true }]
    })
    .expect(200);
  stored = await NotificationPreference.findOne({ organizationId: ORG_A, userId: USER_ID })
    .select('+chat.recipientEmail')
    .lean();
  expect(stored.chat.recipientEmail).toBe('chat-user@example.com');

  const disabled = await request(app)
    .patch('/api/notifications/preferences')
    .send({ channels: { chat: false }, eventOverrides: [] })
    .expect(200);
  expect(disabled.body.data.channels.chat).toBe(false);
  expect(disabled.body.data.chat?.recipientEmail).toBeUndefined();
  stored = await NotificationPreference.findOne({ organizationId: ORG_A, userId: USER_ID })
    .select('+chat.recipientEmail')
    .lean();
  expect(stored.chat?.recipientEmail).toBeUndefined();
});

test('durable chat delivery uses the opted-in tenant identity, generic content, retries, and idempotent replay', async () => {
  await request(app)
    .patch('/api/notifications/preferences')
    .send({ channels: { chat: true, email: false } })
    .expect(200);

  const send = jest.spyOn(zulipService, 'sendPrivateMessage')
    .mockResolvedValueOnce({
      success: false,
      error: 'Zulip delivery is temporarily unavailable.',
      code: 'ZULIP_TEMPORARILY_UNAVAILABLE',
      retryable: true
    })
    .mockResolvedValueOnce({ success: true, messageId: 'zulip-42' });

  const event = eventFor(ORG_A, 'chat-event:tenant-a:1');
  await publishDomainEvent(event);
  await runNotificationWorkerOnce({
    workerId: 'chat-worker-materializer',
    eventBatchSize: 10,
    deliveryBatchSize: 10
  });
  await runNotificationWorkerOnce({
    workerId: 'chat-worker-first-attempt',
    now: new Date(Date.now() + 1000),
    eventBatchSize: 0,
    deliveryBatchSize: 10
  });

  let delivery = await NotificationDelivery.findOne({
    organizationId: ORG_A,
    userId: USER_ID,
    eventId: event.eventId,
    channel: 'chat'
  }).lean();
  expect(delivery).toMatchObject({
    destination: 'chat-user@example.com',
    status: 'failed',
    attemptCount: 1,
    idempotencyKey: `${event.eventId}:${USER_ID}:chat`
  });
  expect(delivery.lastError.code).toBe('ZULIP_TEMPORARILY_UNAVAILABLE');

  const firstContent = send.mock.calls[0][1];
  expect(send.mock.calls[0][0]).toBe('chat-user@example.com');
  expect(firstContent).toContain('Self\\-assessment due');
  expect(firstContent).toContain('https://performance.example.com/appraisals/appraisal-chat-org-a');
  expect(firstContent).not.toMatch(/rating|comment|feedback|secret|1\/5/i);

  const retryAt = new Date(new Date(delivery.nextAttemptAt).getTime() + 1);
  await runNotificationWorkerOnce({
    workerId: 'chat-worker-retry',
    now: retryAt,
    eventBatchSize: 0,
    deliveryBatchSize: 10
  });
  delivery = await NotificationDelivery.findById(delivery._id).lean();
  expect(delivery).toMatchObject({ status: 'delivered', attemptCount: 2, providerMessageId: 'zulip-42' });

  const replay = await publishDomainEvent(event);
  expect(replay.eventId).toBe(event.eventId);
  await runNotificationWorkerOnce({
    workerId: 'chat-worker-replay',
    eventBatchSize: 10,
    deliveryBatchSize: 10
  });
  expect(send).toHaveBeenCalledTimes(2);
  expect(await NotificationDelivery.countDocuments({
    organizationId: ORG_A,
    userId: USER_ID,
    eventId: event.eventId,
    channel: 'chat'
  })).toBe(1);

  await publishDomainEvent(eventFor(ORG_B, 'chat-event:tenant-b:1'));
  await runNotificationWorkerOnce({
    workerId: 'chat-worker-other-tenant',
    eventBatchSize: 10,
    deliveryBatchSize: 10
  });
  const disabledOtherTenant = await NotificationDelivery.findOne({
    organizationId: ORG_B,
    userId: USER_ID,
    channel: 'chat'
  }).lean();
  expect(disabledOtherTenant).toMatchObject({ status: 'skipped' });
  expect(disabledOtherTenant.lastError.code).toBe('CHAT_DISABLED');
  expect(send).toHaveBeenCalledTimes(2);
});

test('chat digest defers durably and production chat links require HTTPS', async () => {
  await request(app)
    .patch('/api/notifications/preferences')
    .send({ channels: { chat: true }, digest: { frequency: 'daily', time: '09:00' } })
    .expect(200);
  const event = eventFor(ORG_A, 'chat-event:digest:1');
  await publishDomainEvent(event);
  await runNotificationWorkerOnce({
    workerId: 'chat-digest-materializer',
    eventBatchSize: 10,
    deliveryBatchSize: 0
  });

  const delivery = await NotificationDelivery.findOne({ eventId: event.eventId, channel: 'chat' }).lean();
  expect(delivery).toMatchObject({ status: 'deferred', deliveryMode: 'digest' });
  expect(delivery.digest.frequency).toBe('daily');

  process.env.NODE_ENV = 'production';
  process.env.FRONTEND_URL = 'http://performance.example.com';
  expect(buildImmediateChatMessage({
    eventType: 'goal.assigned',
    title: 'Ignored custom title',
    deepLink: '/okrs?goal=one'
  })).toBe('');
  process.env.FRONTEND_URL = 'https://performance.example.com';
  expect(buildImmediateChatMessage({
    eventType: 'goal.assigned',
    title: 'Ignored custom title',
    deepLink: '/okrs?goal=one'
  })).toContain('https://performance.example.com/okrs?goal=one');
});

test('Zulip transport uses the official direct-message REST form and environment bot credentials', async () => {
  const post = jest.spyOn(axios, 'post').mockResolvedValue({ data: { result: 'success', id: 99 } });
  const result = await zulipService.sendPrivateMessage('chat-user@example.com', 'Generic action title');
  expect(result).toEqual({ success: true, messageId: '99' });
  expect(post).toHaveBeenCalledTimes(1);

  const [endpoint, body, options] = post.mock.calls[0];
  expect(endpoint).toBe('https://chat.example.com/api/v1/messages');
  const form = new URLSearchParams(body);
  expect(form.get('type')).toBe('direct');
  expect(JSON.parse(form.get('to'))).toEqual(['chat-user@example.com']);
  expect(form.get('content')).toBe('Generic action title');
  expect(options.auth).toEqual({ username: 'performance-bot@example.com', password: 'test-api-key' });
  expect(options.headers['Content-Type']).toBe('application/x-www-form-urlencoded');

  process.env.NODE_ENV = 'production';
  process.env.ZULIP_BASE_URL = 'http://chat.example.com';
  expect(zulipService.isConfigured()).toBe(false);
});

test('chat delivery fails closed when Zulip is not configured', async () => {
  await request(app)
    .patch('/api/notifications/preferences')
    .send({ channels: { chat: true } })
    .expect(200);
  delete process.env.ZULIP_BOT_API_KEY;
  const send = jest.spyOn(zulipService, 'sendPrivateMessage');

  const event = eventFor(ORG_A, 'chat-event:unconfigured:1');
  await publishDomainEvent(event);
  await runNotificationWorkerOnce({
    workerId: 'chat-unconfigured-worker',
    eventBatchSize: 10,
    deliveryBatchSize: 10
  });

  const delivery = await NotificationDelivery.findOne({ eventId: event.eventId, channel: 'chat' }).lean();
  expect(delivery).toMatchObject({ status: 'skipped' });
  expect(delivery.lastError.code).toBe('CHAT_NOT_CONFIGURED');
  expect(send).not.toHaveBeenCalled();
  expect(await DomainEvent.countDocuments({ eventId: event.eventId, status: 'processed' })).toBe(1);
});
