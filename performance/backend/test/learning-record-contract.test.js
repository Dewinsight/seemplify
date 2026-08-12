const assert = require('node:assert/strict');
const test = require('node:test');
const DevelopmentPlan = require('../models/DevelopmentPlan');
const {
  activityStatus,
  isLearningEvent,
  validateLearningEvent
} = require('../services/learningRecordService');

test('Learning integration accepts only the declared enrollment events', () => {
  assert.equal(isLearningEvent('learning.enrollment.completed'), true);
  assert.equal(isLearningEvent('learning.enrollment.snapshot'), true);
  assert.equal(isLearningEvent('learning.course.deleted'), false);
  assert.equal(isLearningEvent('leave.approved'), false);
});

test('Learning event tenant identity must match the signed envelope', () => {
  assert.throws(() => validateLearningEvent('learning.enrollment.progressed', {
    organizationId: 'org-b',
    subjectId: 'user-1',
    enrollmentId: 'enrollment-1',
    courseId: 'course-1',
    courseTitle: 'Leadership essentials'
  }, { organizationId: 'org-a' }), /does not match/);
});

test('synced Learning activities retain their source identity and progress', () => {
  const plan = new DevelopmentPlan({
    userId: 'user-1',
    managerId: 'manager-1',
    organizationId: 'org-1',
    title: 'Leadership growth',
    startDate: new Date('2026-01-01'),
    targetDate: new Date('2026-12-31'),
    learningActivities: [{
      title: 'Leadership essentials',
      type: 'course',
      status: 'in_progress',
      source: 'seemplify_learning',
      provider: 'Seemplify Learning',
      learningCourseId: 'course-1',
      learningEnrollmentId: 'enrollment-1',
      progressPercent: 65
    }]
  });
  assert.equal(plan.validateSync(), undefined);
  assert.equal(plan.learningActivities[0].source, 'seemplify_learning');
  assert.equal(plan.learningActivities[0].progressPercent, 65);
  assert.equal(activityStatus({ status: 'completed', progressPercent: 100 }), 'completed');
});
