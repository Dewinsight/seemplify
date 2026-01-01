/**
 * Data Seeding Script for Performance Management
 * Run with: node scripts/seedData.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const OKR = require('../models/OKR');
const { PerformanceReview } = require('../models/PerformanceReview');
const ReviewCycle = require('../models/ReviewCycle');
const Feedback = require('../models/Feedback');
const OneOnOne = require('../models/OneOnOne');
const DevelopmentPlan = require('../models/DevelopmentPlan');
const User = require('../models/User');

// Sample user IDs (would come from IdP in production)
const SAMPLE_USERS = {
  hrAdmin: {
    id: 'hr-admin-001',
    email: 'hr.admin@smarthr.com',
    name: 'Sarah HR'
  },
  manager1: {
    id: 'manager-001',
    email: 'john.manager@smarthr.com',
    name: 'John Smith'
  },
  manager2: {
    id: 'manager-002',
    email: 'jane.lead@smarthr.com',
    name: 'Jane Lead'
  },
  employee1: {
    id: 'employee-001',
    email: 'alice.dev@smarthr.com',
    name: 'Alice Developer'
  },
  employee2: {
    id: 'employee-002',
    email: 'bob.eng@smarthr.com',
    name: 'Bob Engineer'
  },
  employee3: {
    id: 'employee-003',
    email: 'carol.design@smarthr.com',
    name: 'Carol Designer'
  }
};

const ORG_ID = 'smarthr-org-001';
const TEAM_ID = 'engineering-team-001';

async function seedDatabase() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected!\n');

    // Clear existing data (optional - comment out to preserve data)
    console.log('Clearing existing data...');
    await Promise.all([
      OKR.deleteMany({}),
      PerformanceReview.deleteMany({}),
      ReviewCycle.deleteMany({}),
      Feedback.deleteMany({}),
      OneOnOne.deleteMany({}),
      DevelopmentPlan.deleteMany({})
    ]);
    console.log('Data cleared.\n');

    // 1. Create Users
    console.log('Creating users...');
    for (const [key, userData] of Object.entries(SAMPLE_USERS)) {
      await User.findOneAndUpdate(
        { email: userData.email },
        {
          email: userData.email,
          profile: {
            displayName: userData.name,
            firstName: userData.name.split(' ')[0],
            lastName: userData.name.split(' ')[1]
          },
          idpTeams: [{
            id: TEAM_ID,
            name: 'Engineering',
            role: key.includes('manager') ? 'line_manager' : key.includes('hr') ? 'line_manager' : 'member',
            isManager: key.includes('manager') || key.includes('hr'),
            organizationId: ORG_ID,
            organizationName: 'SmartHR Demo'
          }],
          organizationMemberships: [{
            organizationId: ORG_ID,
            organizationName: 'SmartHR Demo',
            role: key.includes('hr') ? 'admin' : 'member'
          }]
        },
        { upsert: true, new: true }
      );
    }
    console.log(`Created ${Object.keys(SAMPLE_USERS).length} users.\n`);

    // 2. Create Review Cycle
    console.log('Creating review cycle...');
    const reviewCycle = await ReviewCycle.create({
      title: 'Q4 2024 Performance Review',
      description: 'Quarterly performance review for all employees',
      organizationId: ORG_ID,
      type: 'manager-only',
      startDate: new Date('2024-10-01'),
      endDate: new Date('2024-12-31'),
      phases: {
        selfReviewStart: new Date('2024-12-01'),
        selfReviewEnd: new Date('2024-12-15'),
        managerReviewStart: new Date('2024-12-10'),
        managerReviewEnd: new Date('2024-12-25')
      },
      status: 'active',
      settings: {
        requireSelfReview: true,
        ratingScale: 5,
        includeOKRProgress: true,
        includeFeedbackSummary: true
      },
      questions: [
        { category: 'achievements', question: 'What were your key achievements this quarter?', type: 'text' },
        { category: 'challenges', question: 'What challenges did you face and how did you overcome them?', type: 'text' },
        { category: 'goals', question: 'How well did you achieve your goals?', type: 'rating' },
        { category: 'development', question: 'What skills would you like to develop?', type: 'text' }
      ],
      createdBy: SAMPLE_USERS.hrAdmin.id
    });
    console.log(`Created review cycle: ${reviewCycle.title}\n`);

    // 3. Create OKRs
    console.log('Creating OKRs...');
    const okrs = [];

    // Employee 1 OKRs
    okrs.push(await OKR.create({
      type: 'individual',
      ownerId: SAMPLE_USERS.employee1.id,
      organizationId: ORG_ID,
      teamId: TEAM_ID,
      period: 'Q4 2024',
      status: 'active',
      progress: 65,
      objectives: [{
        title: 'Improve API Performance',
        description: 'Optimize backend APIs to reduce response time',
        keyResults: [
          { title: 'Reduce average API response time to <200ms', metricType: 'number', startValue: 500, targetValue: 200, currentValue: 280 },
          { title: 'Implement caching for 80% of endpoints', metricType: 'percentage', startValue: 0, targetValue: 80, currentValue: 60 },
          { title: 'Achieve 99.9% uptime', metricType: 'percentage', startValue: 99, targetValue: 99.9, currentValue: 99.5 }
        ]
      }]
    }));

    okrs.push(await OKR.create({
      type: 'individual',
      ownerId: SAMPLE_USERS.employee1.id,
      organizationId: ORG_ID,
      period: 'Q4 2024',
      status: 'active',
      progress: 40,
      objectives: [{
        title: 'Learn New Technologies',
        description: 'Expand technical skills to support team goals',
        keyResults: [
          { title: 'Complete AWS Solutions Architect certification', metricType: 'boolean', startValue: 0, targetValue: 1, currentValue: 0 },
          { title: 'Implement 2 features using Kubernetes', metricType: 'number', startValue: 0, targetValue: 2, currentValue: 1 }
        ]
      }]
    }));

    // Employee 2 OKRs
    okrs.push(await OKR.create({
      type: 'individual',
      ownerId: SAMPLE_USERS.employee2.id,
      organizationId: ORG_ID,
      period: 'Q4 2024',
      status: 'active',
      progress: 80,
      objectives: [{
        title: 'Enhance Testing Coverage',
        description: 'Improve code quality through comprehensive testing',
        keyResults: [
          { title: 'Increase unit test coverage to 85%', metricType: 'percentage', startValue: 60, targetValue: 85, currentValue: 78 },
          { title: 'Implement E2E tests for 10 critical flows', metricType: 'number', startValue: 2, targetValue: 10, currentValue: 8 },
          { title: 'Reduce bug escape rate by 50%', metricType: 'percentage', startValue: 0, targetValue: 50, currentValue: 45 }
        ]
      }]
    }));

    // Team OKR
    okrs.push(await OKR.create({
      type: 'team',
      ownerId: SAMPLE_USERS.manager1.id,
      organizationId: ORG_ID,
      teamId: TEAM_ID,
      period: 'Q4 2024',
      status: 'active',
      progress: 55,
      objectives: [{
        title: 'Ship New Product Features',
        description: 'Deliver key features for the product roadmap',
        keyResults: [
          { title: 'Launch 3 major features', metricType: 'number', startValue: 0, targetValue: 3, currentValue: 2 },
          { title: 'Achieve NPS score of 40+', metricType: 'number', startValue: 25, targetValue: 40, currentValue: 35 },
          { title: 'Reduce customer reported bugs by 30%', metricType: 'percentage', startValue: 0, targetValue: 30, currentValue: 20 }
        ]
      }]
    }));
    console.log(`Created ${okrs.length} OKRs.\n`);

    // 4. Create Performance Reviews
    console.log('Creating performance reviews...');
    const reviews = [];

    // Completed review
    reviews.push(await PerformanceReview.create({
      cycleId: reviewCycle._id,
      userId: SAMPLE_USERS.employee1.id,
      managerId: SAMPLE_USERS.manager1.id,
      organizationId: ORG_ID,
      status: 'completed',
      selfEvaluation: {
        content: 'This quarter I focused on improving API performance and made significant progress. I reduced response times by 40% and implemented caching across most endpoints.',
        rating: 4,
        submittedAt: new Date('2024-12-10')
      },
      managerEvaluation: {
        content: 'Alice has done excellent work on the API optimization project. Her technical skills are strong and she collaborates well with the team.',
        rating: 4,
        submittedAt: new Date('2024-12-20'),
        aiSummary: 'Strong performer with excellent technical skills. Key achievements in API optimization. Recommended for continued technical leadership opportunities.'
      }
    }));

    // In-progress review
    reviews.push(await PerformanceReview.create({
      cycleId: reviewCycle._id,
      userId: SAMPLE_USERS.employee2.id,
      managerId: SAMPLE_USERS.manager1.id,
      organizationId: ORG_ID,
      status: 'submitted',
      selfEvaluation: {
        content: 'I have been focusing on improving our test coverage and quality processes. Made good progress on unit tests and E2E automation.',
        rating: 4,
        submittedAt: new Date('2024-12-12')
      }
    }));

    // Draft review
    reviews.push(await PerformanceReview.create({
      cycleId: reviewCycle._id,
      userId: SAMPLE_USERS.employee3.id,
      managerId: SAMPLE_USERS.manager2.id,
      organizationId: ORG_ID,
      status: 'draft'
    }));
    console.log(`Created ${reviews.length} reviews.\n`);

    // 5. Create Feedback
    console.log('Creating feedback...');
    const feedbacks = [];

    feedbacks.push(await Feedback.create({
      senderId: SAMPLE_USERS.manager1.id,
      receiverId: SAMPLE_USERS.employee1.id,
      organizationId: ORG_ID,
      type: 'praise',
      content: 'Great job on the API optimization project! The performance improvements have been noticed by the whole team.',
      visibility: 'public'
    }));

    feedbacks.push(await Feedback.create({
      senderId: SAMPLE_USERS.employee2.id,
      receiverId: SAMPLE_USERS.employee1.id,
      organizationId: ORG_ID,
      type: 'praise',
      content: 'Thanks for helping me debug that tricky caching issue. Your expertise really saved me hours of work!',
      visibility: 'public'
    }));

    feedbacks.push(await Feedback.create({
      senderId: SAMPLE_USERS.manager1.id,
      receiverId: SAMPLE_USERS.employee2.id,
      organizationId: ORG_ID,
      type: 'coaching',
      content: 'The test coverage work is going well. Consider also documenting the testing patterns so others can follow them.',
      visibility: 'manager-only'
    }));

    feedbacks.push(await Feedback.create({
      senderId: SAMPLE_USERS.employee1.id,
      receiverId: SAMPLE_USERS.employee3.id,
      organizationId: ORG_ID,
      type: 'praise',
      content: 'The new UI designs look amazing! Users are going to love the updated dashboard.',
      visibility: 'public'
    }));
    console.log(`Created ${feedbacks.length} feedback items.\n`);

    // 6. Create 1:1 Meetings
    console.log('Creating 1:1 meetings...');
    const meetings = [];

    // Past meeting
    meetings.push(await OneOnOne.create({
      managerId: SAMPLE_USERS.manager1.id,
      employeeId: SAMPLE_USERS.employee1.id,
      organizationId: ORG_ID,
      scheduledDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      duration: 30,
      status: 'completed',
      meetingType: 'weekly',
      location: 'Virtual - Zoom',
      agendaItems: [
        { topic: 'API project status', addedBy: 'manager', discussed: true, notes: 'On track for completion' },
        { topic: 'Learning goals', addedBy: 'employee', discussed: true, notes: 'AWS certification in progress' }
      ],
      sharedNotes: 'Discussed API project progress. Alice is on track. Planning to complete AWS cert by end of quarter.',
      actionItems: [
        { description: 'Schedule AWS exam', assignedTo: 'employee', dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), status: 'in_progress' },
        { description: 'Review API documentation', assignedTo: 'manager', dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), status: 'completed' }
      ],
      employeeMood: { score: 4, comment: 'Feeling productive', recordedAt: new Date() },
      completedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    }));

    // Upcoming meeting
    meetings.push(await OneOnOne.create({
      managerId: SAMPLE_USERS.manager1.id,
      employeeId: SAMPLE_USERS.employee1.id,
      organizationId: ORG_ID,
      scheduledDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
      duration: 30,
      status: 'scheduled',
      meetingType: 'weekly',
      location: 'Virtual - Zoom',
      agendaItems: [
        { topic: 'Q4 review prep', addedBy: 'manager', discussed: false },
        { topic: 'Career development discussion', addedBy: 'employee', discussed: false }
      ],
      recurring: {
        isRecurring: true,
        frequency: 'weekly',
        dayOfWeek: 3,
        time: '10:00'
      }
    }));

    meetings.push(await OneOnOne.create({
      managerId: SAMPLE_USERS.manager1.id,
      employeeId: SAMPLE_USERS.employee2.id,
      organizationId: ORG_ID,
      scheduledDate: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000),
      duration: 30,
      status: 'scheduled',
      meetingType: 'weekly',
      location: 'Conference Room A'
    }));
    console.log(`Created ${meetings.length} 1:1 meetings.\n`);

    // 7. Create Development Plan
    console.log('Creating development plans...');
    const devPlan = await DevelopmentPlan.create({
      userId: SAMPLE_USERS.employee1.id,
      managerId: SAMPLE_USERS.manager1.id,
      organizationId: ORG_ID,
      title: 'Senior Engineer Growth Plan',
      description: 'Development plan to grow from Mid-level to Senior Engineer',
      startDate: new Date('2024-10-01'),
      targetDate: new Date('2025-06-30'),
      status: 'active',
      careerGoals: [
        { title: 'Become Senior Engineer', description: 'Achieve senior level technical skills and leadership', targetRole: 'Senior Software Engineer', timeframe: '9 months', progress: 40 },
        { title: 'Technical Leadership', description: 'Lead technical design for major projects', timeframe: '6 months', progress: 30 }
      ],
      skillDevelopment: [
        { skillName: 'System Design', currentLevel: 'intermediate', targetLevel: 'advanced', category: 'technical', progress: 50, 
          resources: [
            { type: 'course', name: 'System Design Interview Course', url: 'https://example.com', completed: true },
            { type: 'book', name: 'Designing Data-Intensive Applications', completed: false }
          ]
        },
        { skillName: 'Cloud Architecture', currentLevel: 'intermediate', targetLevel: 'advanced', category: 'technical', progress: 35,
          resources: [
            { type: 'certification', name: 'AWS Solutions Architect', completed: false }
          ]
        },
        { skillName: 'Technical Communication', currentLevel: 'beginner', targetLevel: 'intermediate', category: 'soft_skills', progress: 25 }
      ],
      learningActivities: [
        { title: 'Complete AWS Certification', type: 'certification', dueDate: new Date('2024-12-31'), status: 'in_progress' },
        { title: 'Lead code review sessions', type: 'stretch_assignment', dueDate: new Date('2025-02-28'), status: 'not_started' },
        { title: 'Present at team tech talks', type: 'training', dueDate: new Date('2025-01-15'), status: 'not_started' }
      ],
      mentoring: {
        hasMentor: true,
        mentorName: 'Sarah Senior',
        mentorRole: 'Principal Engineer',
        focusAreas: ['System Design', 'Career Growth'],
        meetingFrequency: 'bi-weekly'
      },
      checkIns: [
        { date: new Date('2024-11-01'), notes: 'Good progress on system design skills', progressUpdate: 30, addedBy: 'manager' },
        { date: new Date('2024-12-01'), notes: 'AWS certification scheduled for end of month', progressUpdate: 40, addedBy: 'employee' }
      ],
      approvedByManager: {
        approved: true,
        approvedAt: new Date('2024-10-05'),
        comments: 'Great plan, let\'s execute!'
      }
    });
    console.log(`Created ${1} development plan.\n`);

    console.log('='.repeat(50));
    console.log('Data seeding completed successfully!');
    console.log('='.repeat(50));
    console.log('\nSummary:');
    console.log(`- Users: ${Object.keys(SAMPLE_USERS).length}`);
    console.log(`- Review Cycles: 1`);
    console.log(`- OKRs: ${okrs.length}`);
    console.log(`- Performance Reviews: ${reviews.length}`);
    console.log(`- Feedback Items: ${feedbacks.length}`);
    console.log(`- 1:1 Meetings: ${meetings.length}`);
    console.log(`- Development Plans: 1`);
    console.log('\nTest credentials:');
    console.log('- HR Admin: hr.admin@smarthr.com');
    console.log('- Manager: john.manager@smarthr.com');
    console.log('- Employee: alice.dev@smarthr.com');

  } catch (error) {
    console.error('Error seeding database:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\nDisconnected from MongoDB.');
  }
}

// Run the script
seedDatabase();






