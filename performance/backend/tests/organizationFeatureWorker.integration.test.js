const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const DomainEvent = require('../models/DomainEvent');
const Notification = require('../models/Notification');
const NotificationDelivery = require('../models/NotificationDelivery');
const NotificationPreference = require('../models/NotificationPreference');
const OrganizationFeatureConfig = require('../models/OrganizationFeatureConfig');
const notificationService = require('../services/notificationService');
const zulipService = require('../services/zulipService');
const { publishDomainEvent } = require('../services/outboxService');
const {
  processDigestBatch,
  processImmediateDelivery,
  runNotificationWorkerOnce
} = require('../services/notificationWorker');

const ORGANIZATION_ID = 'rollout-worker-org';
const USER_ID = 'rollout-worker-user';

let mongo;

function notificationEvent(eventId) {
  return {
    eventId,
    eventType: 'goal.assigned',
    organizationId: ORGANIZATION_ID,
    aggregate: { type: 'goal', id: `goal-${eventId}` },
    actor: { userId: 'manager-1' },
    recipients: [{
      userId: USER_ID,
      name: 'Employee One',
      email: 'employee@example.test',
      channels: ['in_app', 'email', 'chat']
    }],
    notification: {
      category: 'goal',
      title: 'New goal assigned',
      message: 'You have new performance work to review.',
      deepLink: `/okrs?goal=goal-${eventId}`,
      priority: 'normal',
      isAction: true,
      action: { kind: 'acknowledge', label: 'Review goal' },
      target: { type: 'goal', id: `goal-${eventId}` }
    },
    metadata: {}
  };
}

async function materializeEvent(eventId) {
  await publishDomainEvent(notificationEvent(eventId));
  const result = await runNotificationWorkerOnce({
    workerId: `materialize-${eventId}`,
    eventBatchSize: 5,
    deliveryBatchSize: 0,
    now: new Date(Date.now() + 1000)
  });
  expect(result.eventsProcessed).toBe(1);
  return Notification.findOne({ organizationId: ORGANIZATION_ID, eventId });
}

async function prepareExternalDelivery({ eventId, channel, deliveryMode, leaseOwner }) {
  const update = {
    status: 'processing',
    deliveryMode,
    destination: 'employee@example.test',
    nextAttemptAt: new Date(),
    lease: {
      owner: leaseOwner,
      claimedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000)
    }
  };
  if (deliveryMode === 'digest') {
    update.digest = { frequency: 'daily', bucketKey: 'daily:rollout-test' };
  }
  await NotificationDelivery.updateOne(
    { organizationId: ORGANIZATION_ID, eventId, userId: USER_ID, channel },
    { $set: update, $unset: { skippedAt: '', lastError: '' } }
  );
  return NotificationDelivery.findOne({
    organizationId: ORGANIZATION_ID,
    eventId,
    userId: USER_ID,
    channel
  }).lean();
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});

afterEach(() => {
  jest.restoreAllMocks();
});

beforeEach(async () => {
  await Promise.all([
    DomainEvent.deleteMany({}),
    Notification.deleteMany({}),
    NotificationDelivery.deleteMany({}),
    NotificationPreference.deleteMany({}),
    OrganizationFeatureConfig.deleteMany({})
  ]);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

test('notifications disabled before materialization consume the event without creating user work', async () => {
  await OrganizationFeatureConfig.create({
    organizationId: ORGANIZATION_ID,
    features: { notifications: false }
  });
  const event = await publishDomainEvent(notificationEvent('disabled-before-materialization'));

  const result = await runNotificationWorkerOnce({
    workerId: 'disabled-before-worker',
    eventBatchSize: 5,
    deliveryBatchSize: 5,
    now: new Date(Date.now() + 1000)
  });

  expect(result.eventsProcessed).toBe(1);
  expect(await DomainEvent.findById(event._id).lean()).toMatchObject({ status: 'processed' });
  expect(await Notification.countDocuments({ organizationId: ORGANIZATION_ID })).toBe(0);
  expect(await NotificationDelivery.countDocuments({ organizationId: ORGANIZATION_ID })).toBe(0);
});

test('notifications disabled after materialization skip queued email and chat digest delivery', async () => {
  const eventId = 'disabled-after-materialization';
  await materializeEvent(eventId);
  await NotificationPreference.create({
    organizationId: ORGANIZATION_ID,
    userId: USER_ID,
    channels: { inApp: true, email: true, chat: true },
    chat: { recipientEmail: 'employee@example.test' },
    digest: { frequency: 'daily', time: '09:00', dayOfWeek: 1 },
    timezone: 'UTC'
  });
  const email = await prepareExternalDelivery({
    eventId,
    channel: 'email',
    deliveryMode: 'immediate',
    leaseOwner: 'disabled-email-worker'
  });
  const chat = await prepareExternalDelivery({
    eventId,
    channel: 'chat',
    deliveryMode: 'digest',
    leaseOwner: 'disabled-chat-worker'
  });
  await OrganizationFeatureConfig.create({
    organizationId: ORGANIZATION_ID,
    features: { notifications: false }
  });

  const emailSend = jest.spyOn(notificationService, 'sendEmail').mockResolvedValue({ success: true, messageId: 'email-1' });
  jest.spyOn(notificationService, 'isConfigured').mockReturnValue(true);
  const chatSend = jest.spyOn(zulipService, 'sendPrivateMessage').mockResolvedValue({ success: true, messageId: 'chat-1' });
  jest.spyOn(zulipService, 'isConfigured').mockReturnValue(true);

  await processImmediateDelivery(email, new Date());
  await processDigestBatch([chat], new Date());

  const [skippedEmail, skippedChat] = await Promise.all([
    NotificationDelivery.findById(email._id).lean(),
    NotificationDelivery.findById(chat._id).lean()
  ]);
  expect(skippedEmail).toMatchObject({
    status: 'skipped',
    lastError: { code: 'ORGANIZATION_FEATURE_DISABLED', retryable: false }
  });
  expect(skippedChat).toMatchObject({
    status: 'skipped',
    lastError: { code: 'ORGANIZATION_FEATURE_DISABLED', retryable: false }
  });
  expect(emailSend).not.toHaveBeenCalled();
  expect(chatSend).not.toHaveBeenCalled();
});

test('feature-state lookup failure never sends or permanently skips a claimed delivery', async () => {
  const eventId = 'feature-lookup-failure';
  await materializeEvent(eventId);
  const delivery = await prepareExternalDelivery({
    eventId,
    channel: 'email',
    deliveryMode: 'immediate',
    leaseOwner: 'lookup-failure-worker'
  });
  const emailSend = jest.spyOn(notificationService, 'sendEmail').mockResolvedValue({ success: true, messageId: 'email-2' });
  jest.spyOn(notificationService, 'isConfigured').mockReturnValue(true);
  jest.spyOn(OrganizationFeatureConfig, 'findOne').mockImplementation(() => {
    throw new Error('feature store unavailable');
  });

  await expect(processImmediateDelivery(delivery, new Date())).rejects.toThrow('feature store unavailable');

  const retained = await NotificationDelivery.findById(delivery._id).lean();
  expect(retained.status).toBe('processing');
  expect(retained.lease.owner).toBe('lookup-failure-worker');
  expect(retained.lastError?.code).not.toBe('ORGANIZATION_FEATURE_DISABLED');
  expect(emailSend).not.toHaveBeenCalled();
});
