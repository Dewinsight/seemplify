const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const express = require('express');
const request = require('supertest');
const User = require('../models/User');
const DevelopmentPlan = require('../models/DevelopmentPlan');
const LearningRecord = require('../models/LearningRecord');
const { upsertLearningRecordFromEvent } = require('../services/learningRecordService');
const learningRoutes = require('../routes/learning');

let mongo;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});

afterEach(async () => {
  await Promise.all(Object.values(mongoose.connection.collections).map((collection) => collection.deleteMany({})));
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

test('Learning progress is tenant-scoped, linked to an IdP user, and updates development plans', async () => {
  const user = await User.create({
    email: 'learner@example.com',
    idpSub: 'idp-user-1',
    currentOrganizationId: 'org-1',
    organizationMemberships: [{ organization: 'org-1', role: 'employee' }]
  });
  const plan = await DevelopmentPlan.create({
    userId: 'idp-user-1',
    managerId: 'manager-1',
    organizationId: 'org-1',
    title: 'Leadership growth',
    startDate: new Date('2026-01-01'),
    targetDate: new Date('2026-12-31'),
    learningActivities: [{
      title: 'Leadership essentials',
      type: 'course',
      source: 'seemplify_learning',
      provider: 'Seemplify Learning',
      learningCourseId: 'course-1',
      learningEnrollmentId: 'enrollment-1',
      status: 'not_started'
    }],
    skillDevelopment: [{
      skillName: 'leadership',
      currentLevel: 'beginner',
      targetLevel: 'intermediate',
      category: 'leadership',
      progress: 0
    }]
  });
  const occurredAt = '2026-08-12T09:00:00.000Z';
  const record = await upsertLearningRecordFromEvent('learning.enrollment.completed', {
    organizationId: 'org-1',
    subjectId: 'idp-user-1',
    enrollmentId: 'enrollment-1',
    courseId: 'course-1',
    courseTitle: 'Leadership essentials',
    courseUrl: 'https://learning.seemplifyai.com/simple-lms/learn/enrollment-1',
    courseTags: ['leadership'],
    status: 'completed',
    progressPercent: 100,
    completedAt: occurredAt,
    lastActivityAt: occurredAt,
    learnerEmail: 'learner@example.com'
  }, {
    eventId: 'event-1',
    organizationId: 'org-1',
    subjectId: 'idp-user-1',
    occurredAt
  });

  expect(record.organizationId).toBe('org-1');
  expect(record.performanceUserId).toBe(String(user._id));
  expect(await LearningRecord.countDocuments({ organizationId: 'org-2' })).toBe(0);

  const updatedPlan = await DevelopmentPlan.findById(plan._id);
  expect(updatedPlan.learningActivities[0].status).toBe('completed');
  expect(updatedPlan.learningActivities[0].progressPercent).toBe(100);
  expect(updatedPlan.skillDevelopment[0].progress).toBe(100);
});

test('an older Learning delivery cannot regress newer completion data', async () => {
  const base = {
    organizationId: 'org-1',
    subjectId: 'idp-user-1',
    enrollmentId: 'enrollment-1',
    courseId: 'course-1',
    courseTitle: 'Secure operations'
  };
  await upsertLearningRecordFromEvent('learning.enrollment.completed', {
    ...base,
    status: 'completed',
    progressPercent: 100,
    lastActivityAt: '2026-08-12T10:00:00.000Z'
  }, { eventId: 'event-new', organizationId: 'org-1', occurredAt: '2026-08-12T10:00:00.000Z' });
  await upsertLearningRecordFromEvent('learning.enrollment.progressed', {
    ...base,
    status: 'in_progress',
    progressPercent: 30,
    lastActivityAt: '2026-08-12T09:00:00.000Z'
  }, { eventId: 'event-old', organizationId: 'org-1', occurredAt: '2026-08-12T09:00:00.000Z' });

  const record = await LearningRecord.findOne({ organizationId: 'org-1', enrollmentId: 'enrollment-1' });
  expect(record.status).toBe('completed');
  expect(record.progressPercent).toBe(100);
  expect(record.lastEventId).toBe('event-new');
});

test('manager and employee transcript APIs enforce organization and reporting scope', async () => {
  await LearningRecord.create([
    {
      organizationId: 'org-1',
      subjectId: 'member-1',
      enrollmentId: 'enrollment-member',
      courseId: 'course-1',
      courseTitle: 'Coaching fundamentals',
      learnerName: 'Jordan Lee',
      status: 'in_progress',
      progressPercent: 75
    },
    {
      organizationId: 'org-2',
      subjectId: 'member-1',
      enrollmentId: 'enrollment-other-tenant',
      courseId: 'course-2',
      courseTitle: 'Other tenant course',
      learnerName: 'Jordan Lee',
      status: 'completed',
      progressPercent: 100
    }
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.organizationId = 'org-1';
    req.userRole = 'line_manager';
    req.directReports = ['member-1'];
    req.session = { user: { id: 'manager-1', sub: 'manager-1' } };
    next();
  });
  app.use('/learning', learningRoutes);

  const teamResponse = await request(app).get('/learning/team').expect(200);
  expect(teamResponse.body.data.totalLearners).toBe(1);
  expect(teamResponse.body.data.learners[0].name).toBe('Jordan Lee');
  const recordResponse = await request(app).get('/learning/records?employeeId=member-1').expect(200);
  expect(recordResponse.body.data.records).toHaveLength(1);
  expect(recordResponse.body.data.records[0].courseTitle).toBe('Coaching fundamentals');
});
