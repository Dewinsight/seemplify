// Run after liveJourneyServer.js. Uses real HTTP routes and persisted disposable data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = 'http://127.0.0.1:5014';
const actors = ['employee', 'team_lead', 'manager', 'hr_manager', 'admin', 'owner', 'department_head', 'teamless'];
const hr = new Set(['hr_manager', 'admin', 'owner']);
const manager = new Set(['team_lead', 'manager', 'department_head', ...hr]);
const results = [];
const stamp = Date.now();
const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString();
async function api(actor, method, route, body, expected = 200) {
  const response = await fetch(`${base}/api/${route}`, { method, headers: {
    ...(actor ? { 'x-acceptance-actor': actor } : {}), 'Content-Type': 'application/json'
  }, ...(body ? { body: JSON.stringify(body) } : {}) });
  let payload;
  try { payload = await response.json(); } catch { payload = {}; }
  results.push({ actor: actor || 'anonymous', method, route, status: response.status, expected });
  assert.equal(response.status, expected, `${actor} ${method} ${route}: ${JSON.stringify(payload)}`);
  return payload.data ?? payload;
}
async function journey(name, run) {
  try { await run(); console.log(`PASS ${name}`); }
  catch (error) { results.push({ journey: name, failure: error.message }); console.error(`FAIL ${name}: ${error.message}`); }
}
async function main() {
  const health = await (await fetch(`${base}/__test/health`)).json();
  assert.equal(health.ready, true, 'Refuse to run against any non-fixture service');
  const common = ['auth/me', 'dashboard/summary', 'user/context', 'user/organizations', 'user/teams', 'user/direct-reports',
    'user/search?q=Acceptance', 'okrs', 'goal-periods', 'goal-periods/current', 'goal-periods/upcoming', 'appraisals/my', 'appraisals/cycles', 'appraisals/cycle-templates', 'appraisals/colleague-roster',
    'feedback', 'feedback/received', 'feedback/sent', 'feedback/requests', 'one-on-ones', 'one-on-ones/upcoming', 'check-ins',
    'development-plans', 'learning/records', 'support-plans', 'recognition', 'performance-projects', 'analytics/dashboard',
    'actions', 'actions/counts', 'notifications', 'notifications/counts', 'notifications/preferences'];
  const managerOnly = ['appraisals/team', 'learning/team', 'manager-insights/practices', 'talent/reviews', 'talent/signals', 'analytics/performance', 'reports/team-performance'];
  const hrOnly = ['appraisals/organization', 'appraisals/admin/analytics', 'calibration', 'reports/org-summary', 'reports/okr-trends', 'reports/feedback-analytics', 'organization-features', 'talent/succession-plans'];
  for (const actor of actors) await journey(`${actor}: feature reads and permission boundaries`, async () => {
    for (const route of common) await api(actor, 'GET', route);
    for (const route of managerOnly) await api(actor, 'GET', route, null, manager.has(actor) ? 200 : 403);
    for (const route of hrOnly) await api(actor, 'GET', route, null, hr.has(actor) ? 200 : 403);
  });
  await journey('anonymous cannot read protected feature data', async () => {
    for (const route of ['recognition', 'okrs', 'appraisals/my', 'check-ins', 'support-plans', 'talent/reviews', 'notifications']) await api(null, 'GET', route, null, 401);
  });
  const period = await api('hr_manager', 'POST', 'goal-periods', { name: `Acceptance ${stamp}`, code: `ACCEPT-${stamp}`, startDate: day(-2), endDate: day(60), status: 'open', settings: { requiresManagerApproval: false } }, 201);
  const goalBody = (title, type = 'individual') => ({ title, type, periodId: period._id, objectives: [{ title, keyResults: [{ title: 'Verified outcome', metricType: 'number', startValue: 0, targetValue: 10 }] }] });
  for (const actor of actors) await journey(`${actor}: personal goals, recognition, feedback and check-ins persist`, async () => {
    const goal = await api(actor, 'POST', 'okrs', goalBody(`Acceptance ${actor} ${stamp}`), 201);
    assert.equal((await api(actor, 'GET', `okrs/${goal._id}`)).title, goal.title);
    await api('foreign', 'GET', `okrs/${goal._id}`, null, 404);
    const recipients = await api(actor, 'GET', 'user/search?q=peer');
    const recipient = recipients.find((person) => person.id === 'acceptance-peer');
    assert.ok(recipient, 'Actual colleague picker must return the peer');
    const recognition = await api(actor, 'POST', 'recognition', { recipient, message: `Acceptance appreciation ${actor} ${stamp}`, visibility: 'private' }, 201);
    await api('peer', 'POST', `recognition/${recognition._id}/acknowledge`);
    assert.ok((await api('peer', 'GET', 'recognition?view=received')).some((item) => item._id === recognition._id && item.acknowledgedAt));
    await api('foreign', 'POST', `recognition/${recognition._id}/acknowledge`, null, 404);
    await api(actor, 'DELETE', `recognition/${recognition._id}`);
    const feedback = await api(actor, 'POST', 'feedback', { receiverId: 'acceptance-peer', content: `Acceptance feedback ${actor} ${stamp}`, type: 'praise', visibility: 'private' }, 201);
    assert.ok((await api('peer', 'GET', 'feedback/received')).some((item) => item._id === feedback._id));
    const checkIn = await api(actor, 'POST', 'check-ins', { periodStart: day(-1), periodEnd: day(0), wins: ['Verified an acceptance task'], priorities: ['Next task'], linkedGoalIds: [goal._id] }, 201);
    await api(actor, 'PATCH', `check-ins/${checkIn._id}`, { blockers: ['A synthetic test blocker'] });
    await api(actor, 'POST', `check-ins/${checkIn._id}/submit`);
    await api(actor, 'PATCH', `check-ins/${checkIn._id}`, { wins: ['Attempted late change'] }, 409);
    await api('foreign', 'GET', `check-ins?employeeId=acceptance-${actor}`, null, 403);
    await api(actor, 'POST', 'okrs', goalBody(`Organization ${actor} ${stamp}`, 'organization'), hr.has(actor) ? 201 : 403);
  });
  for (const actor of ['manager', 'team_lead', 'department_head']) await journey(`${actor}: schedule meeting, development plan and project feedback`, async () => {
    const meeting = await api(actor, 'POST', 'one-on-ones', { employeeId: 'acceptance-employee', scheduledDate: day(2), title: `Acceptance meeting ${actor}`, createCalendarEvent: false }, 201);
    await api('employee', 'GET', `one-on-ones/${meeting._id}`);
    await api('employee', 'POST', `one-on-ones/${meeting._id}/agenda`, { topic: 'Synthetic progress review' });
    await api('foreign', 'GET', `one-on-ones/${meeting._id}`, null, 404);
    const action = await api(actor, 'POST', `one-on-ones/${meeting._id}/action-items`, { description: 'Complete synthetic follow-up', assignedTo: 'employee', dueDate: day(3) });
    await api('employee', 'PUT', `one-on-ones/${meeting._id}/action-items/${action._id}`, { status: 'completed', notes: 'Synthetic follow-up completed' });
    await api('employee', 'POST', `one-on-ones/${meeting._id}/complete`, {}, 403);
    await api(actor, 'POST', `one-on-ones/${meeting._id}/complete`, { sharedNotes: 'Synthetic shared summary', privateManagerNotes: 'Synthetic manager-only note' });
    const employeeMeeting = await api('employee', 'GET', `one-on-ones/${meeting._id}`);
    assert.equal(employeeMeeting.status, 'completed');
    assert.ok(!JSON.stringify(employeeMeeting).includes('Synthetic manager-only note'));
    await api('employee', 'POST', `one-on-ones/${meeting._id}/feedback`, { meetingQuality: 4, managerRating: 4, helpful: true, suggestions: 'Continue the structured discussion' });
    const plan = await api(actor, 'POST', 'development-plans', { userId: 'acceptance-employee', title: `Acceptance development ${actor}`, startDate: day(0), targetDate: day(30),
      skillDevelopment: [{ skillName: 'Planning', currentLevel: 'beginner', targetLevel: 'intermediate' }], learningActivities: [{ title: 'Practice planning', type: 'other' }] }, 201);
    await api(actor, 'POST', `development-plans/${plan._id}/activate`);
    await api('employee', 'GET', `development-plans/${plan._id}`);
    await api('foreign', 'GET', `development-plans/${plan._id}`, null, 404);
    await api('employee', 'POST', `development-plans/${plan._id}/check-in`, { notes: 'Practiced the synthetic planning task', progressUpdate: 75 });
    await api('employee', 'PUT', `development-plans/${plan._id}/skills/0`, { progress: 100, currentLevel: 'intermediate' });
    await api('employee', 'PUT', `development-plans/${plan._id}/activities/0`, { status: 'completed', evidence: 'Synthetic practice outcome' });
    await api('employee', 'POST', `development-plans/${plan._id}/complete`, {}, 403);
    await api(actor, 'POST', `development-plans/${plan._id}/complete`, {});
    assert.equal((await api('employee', 'GET', `development-plans/${plan._id}`)).status, 'completed');
    const project = await api(actor, 'POST', 'performance-projects', { name: `Acceptance project ${actor}`, startDate: day(0), state: 'active', participants: [{ userId: 'acceptance-employee' }, { userId: 'acceptance-peer' }] }, 201);
    const projectRequest = await api(actor, 'POST', `performance-projects/${project._id}/feedback-requests`, { subjectId: 'acceptance-employee', reviewerId: 'acceptance-peer', dueDate: day(7), questions: ['What helped delivery?'] }, 201);
    await api('peer', 'POST', `feedback/requests/${projectRequest._id}/decision`, { decision: 'accept' });
    const projectFeedback = await api('peer', 'POST', 'feedback', { requestId: projectRequest._id, receiverId: 'acceptance-employee', content: 'Synthetic project planning helped delivery.', type: 'praise' }, 201);
    assert.equal(projectFeedback.contextType, 'project');
    await api('employee', 'GET', `feedback/${projectFeedback._id}`);
    await api('peer', 'POST', 'feedback', { requestId: projectRequest._id, receiverId: 'acceptance-employee', content: 'Duplicate synthetic response', type: 'praise' }, 409);
  });
  for (const actor of ['manager', 'team_lead', 'department_head', 'hr_manager', 'admin', 'owner']) await journey(`${actor}: launch through final published appraisal and employee acknowledgement`, async () => {
    const templates = await api(actor, 'GET', 'appraisals/cycle-templates');
    const template = templates.find(item => item.id === 'balanced_performance' || item.templateId === 'balanced_performance') || templates[0];
    assert.ok(template?.design, 'A built-in appraisal design must be available');
    const created = await api(actor, 'POST', 'appraisals/cycles', { name: `Acceptance lifecycle ${actor} ${stamp}`, periodStart: day(-90), periodEnd: day(-1),
      workflowDefinition: template.design, settings: { enableAiAssist: false, requireOkrAlignment: false, requireDocumentUpload: false },
      launchNow: true, employees: [{ userId: 'acceptance-employee' }], responseDeadlines: { selfAssessmentDue: day(7), managerReviewDue: day(14) } }, 201);
    assert.equal(created.launchSummary.launched, 1);
    const appraisal = (await api('employee', 'GET', 'appraisals/my')).find(item => String(item.cycleId?._id || item.cycleId) === created.cycle._id);
    assert.ok(appraisal?._id, 'Launched appraisal must appear in employee history');
    const id = appraisal._id;
    await api('foreign', 'GET', `appraisals/${id}`, null, 404);
    await api('employee', 'GET', `appraisals/${id}/report`, null, 409);
    const responses = (respondent) => template.design.sections.flatMap(section => (section.questions || []).filter(() => section.respondent === respondent || section.respondent === 'both').map(question => ({
      sectionId: section.id, questionId: question.id, value: ['rating', 'number'].includes(question.responseType) ? 4 : question.responseType === 'boolean' ? true : question.responseType === 'multi_select' ? [question.options[0]?.value || question.options[0]] : question.responseType === 'single_select' ? question.options[0]?.value || question.options[0] : 'Synthetic acceptance evidence: documented the delivery outcome and applied learning to the next project.'
    })));
    await api('employee', 'PUT', `appraisals/${id}/custom-responses`, { respondentRole: 'employee', submit: true, responses: responses('employee') });
    await api('employee', 'POST', `appraisals/${id}/self-assessment`, { submit: true, selfAssessment: { overallSummary: {
      achievements: 'Delivered a synthetic project with a documented measurable result.', challenges: 'Resolved a synthetic dependency through early planning.',
      learnings: 'Learned a structured discovery method and applied it to delivery.', improvements: 'Improve early risk communication for the next project.', goals: 'Complete the next synthetic milestone with documented evidence.' }, overallSelfRating: 4 } });
    await api('manager', 'POST', `appraisals/${id}/manager-review/start`);
    await api('manager', 'PUT', `appraisals/${id}/custom-responses`, { respondentRole: 'manager', submit: true, responses: responses('manager') });
    await api('manager', 'POST', `appraisals/${id}/manager-review`, { submit: true, managerReview: { overallManagerRating: 4, overallSummary: { strengths: 'Synthetic evidence shows consistent delivery.', areasForImprovement: 'Continue early risk updates.' } } });
    await api('manager', 'PUT', `appraisals/${id}/discussion`, { markCompleted: true, notes: { strengths: 'Discussed synthetic delivery evidence.', nextSteps: 'Continue structured planning.' } });
    await api('manager', 'POST', `appraisals/${id}/finalize`, { finalRating: 4, justification: 'Synthetic acceptance outcome supported by documented delivery evidence.' });
    const report = await api('employee', 'GET', `appraisals/${id}/report`);
    assert.equal(report.finalRating.overall, 4);
    assert.ok(!JSON.stringify(report).includes('auditTrail'), 'Published report must exclude internal audit records');
    await api('employee', 'POST', `appraisals/${id}/acknowledge`);
    assert.equal((await api('employee', 'GET', `appraisals/${id}`)).status, 'employee_acknowledged');
  });
  await journey('support plan manager HR employee handoffs and progress', async () => {
    const plan = await api('manager', 'POST', 'support-plans', { employee: { userId: 'acceptance-employee' }, title: 'Synthetic delivery support', planType: 'formal_improvement',
      summary: 'A synthetic plan to verify measurable expectations and manager support.', concerns: [{ description: 'A synthetic deadline was missed.', expectedStandard: 'Raise risks two days early.' }],
      objectives: [{ title: 'Raise risks early', measure: 'Weekly review record', target: 'Every material risk raised two days early', dueDate: day(30) }],
      supportCommitments: [{ description: 'Weekly priority review with manager', ownerType: 'manager', dueDate: day(30) }], milestones: [{ title: 'Midpoint review', dueDate: day(15) }], reviewDates: [day(15)] }, 201);
    await api('employee', 'GET', `support-plans/${plan._id}`, null, 403);
    await api('manager', 'POST', `support-plans/${plan._id}/submit-for-hr-review`, {});
    await api('hr_manager', 'POST', `support-plans/${plan._id}/hr-decision`, { decision: 'approve', comment: 'Synthetic measurable plan reviewed.' });
    await api('employee', 'POST', `support-plans/${plan._id}/employee-response`, { acknowledgement: 'acknowledged', comment: 'Synthetic acknowledgement.' });
    await api('employee', 'POST', `support-plans/${plan._id}/check-ins`, { update: 'Raised the synthetic delivery risk early.', progress: 50 }, 201);
    await api('foreign', 'GET', `support-plans/${plan._id}`, null, 404);
  });
  const failures = results.filter((item) => item.failure || (item.expected && item.status !== item.expected));
  const output = path.resolve(__dirname, '../../tmp/live-api-proof.json');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify({ environment: 'disposable MongoDB with production indexes and real app.js', at: new Date().toISOString(), requests: results.filter((item) => item.method).length, failures: failures.length, results }, null, 2));
  console.log(JSON.stringify({ requests: results.filter((item) => item.method).length, failures: failures.length, proof: output }));
  if (failures.length) process.exitCode = 1;
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
