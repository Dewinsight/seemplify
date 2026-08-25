/**
 * Canonical Seemplify permission catalogue.
 *
 * Permission identifiers deliberately preserve the tokens already enforced by
 * each product. The IdP is the authority that assigns them; products remain
 * responsible for resource-level checks such as "is this a direct report?".
 */

export const ACCESS_CONTROL_SCHEMA_VERSION = 3

const permission = (id, label, scope, description = '', options = {}) => ({
  id,
  label,
  scope,
  description,
  sensitive: options.sensitive === true,
  delegable: options.delegable === true || (options.delegable !== false && scope !== 'platform')
})

const product = (appId, name, permissions, options = {}) => ({
  appId,
  name,
  category: options.category || 'product',
  permissions
})

export const PRODUCT_PERMISSION_CATALOG = Object.freeze([
  product('identity', 'Identity & organization', [
    permission('organization.view', 'View organization', 'organization'),
    permission('organization.manage', 'Manage organization settings', 'organization'),
    permission('organization.delete', 'Delete organization', 'organization', '', { sensitive: true, delegable: false }),
    permission('owner.transfer', 'Transfer ownership', 'organization', '', { sensitive: true, delegable: false }),
    permission('members.view', 'View members', 'organization'),
    permission('members.invite', 'Invite members', 'organization'),
    permission('members.manage', 'Manage member profiles', 'organization'),
    permission('members.remove', 'Remove members', 'organization', '', { sensitive: true }),
    permission('roles.assign', 'Assign roles', 'organization', '', { sensitive: true }),
    permission('access.read', 'View roles and permissions', 'organization'),
    permission('access.manage', 'Manage roles and permissions', 'organization', '', { sensitive: true }),
    permission('apps.assign', 'Assign product access', 'organization'),
    permission('departments.manage', 'Manage departments', 'organization'),
    permission('teams.manage', 'Manage teams', 'organization'),
    permission('teams.manage.assigned', 'Manage assigned teams', 'team'),
    permission('locations.manage', 'Manage locations', 'organization'),
    permission('invitations.manage', 'Manage invitations', 'organization'),
    permission('notifications.read', 'View organization notifications', 'organization'),
    permission('notifications.send', 'Send organization notifications', 'organization'),
    permission('notifications.send.assigned', 'Send notifications to assigned teams', 'team'),
    permission('onboarding.read', 'View onboarding workflows', 'organization'),
    permission('onboarding.manage', 'Manage onboarding workflows', 'organization'),
    permission('onboarding.assign', 'Assign onboarding workflows', 'organization'),
    permission('subscriptions.view', 'View subscription', 'organization'),
    permission('subscriptions.request', 'Request plan changes', 'organization'),
    permission('audit.read', 'View access audit history', 'organization')
  ], { category: 'platform' }),

  product('smarthr', 'Recruiter', [
    permission('view_jobs', 'View jobs', 'organization'),
    permission('manage_jobs', 'Create and manage jobs', 'organization'),
    permission('view_candidates', 'View candidates', 'organization'),
    permission('manage_candidates', 'Manage candidates', 'organization'),
    permission('manage_interviews', 'Schedule and manage interviews', 'organization'),
    permission('submit_interview_feedback', 'Submit interview feedback', 'self'),
    permission('view_analytics', 'View recruitment analytics', 'organization'),
    permission('manage_users', 'Manage recruiter users', 'organization'),
    permission('manage_settings', 'Manage recruiter settings', 'organization'),
    permission('manage_billing', 'Manage recruiter billing', 'organization', '', { sensitive: true }),
    permission('manage_licenses', 'Manage recruiter licences and credits', 'organization', '', { sensitive: true })
  ], { category: 'hr' }),

  product('leave-management', 'Leave Management', [
    permission('view_own_leaves', 'View own leave', 'self'),
    permission('request_leaves', 'Request leave', 'self'),
    permission('view_team_leaves', 'View team leave', 'team'),
    permission('view_direct_reports_leaves', 'View direct reports leave', 'reports'),
    permission('approve_leaves', 'Approve or reject leave', 'reports'),
    permission('approve_all_leaves', 'Approve or reject any organization leave', 'organization'),
    permission('view_all_leaves', 'View all leave', 'organization'),
    permission('manage_leaves', 'Manage leave records and balances', 'organization'),
    permission('manage_policies', 'Manage leave policies', 'organization'),
    permission('view_analytics', 'View leave analytics', 'organization')
  ], { category: 'hr' }),

  product('performance-management', 'Performance Management', [
    permission('okr:view:own', 'View own goals', 'self'),
    permission('okr:create:own', 'Create own goals', 'self'),
    permission('okr:edit:own', 'Edit own goals', 'self'),
    permission('okr:submit:own', 'Submit own goals', 'self'),
    permission('okr:acknowledge:own', 'Acknowledge assigned goals', 'self'),
    permission('okr:request_change:own', 'Request goal changes', 'self'),
    permission('okr:checkin:own', 'Check in on own goals', 'self'),
    permission('okr:align', 'Align goals', 'self'),
    permission('okr:view:team', 'View team goals', 'team'),
    permission('okr:view:department', 'View department goals', 'department'),
    permission('okr:create:team', 'Create team goals', 'team'),
    permission('okr:view:direct_reports', 'View direct report goals', 'reports'),
    permission('okr:review:direct_reports', 'Review direct report goals', 'reports'),
    permission('okr:checkin:direct_reports', 'Check in on direct report goals', 'reports'),
    permission('okr:assign:direct_reports', 'Assign direct report goals', 'reports'),
    permission('okr:decide:direct_reports', 'Approve direct report goals', 'reports'),
    permission('okr:bulk_assign', 'Bulk assign goals', 'reports'),
    permission('okr:edit:all', 'Edit any organization goal', 'organization'),
    permission('okr:decide:all', 'Decide any organization goal', 'organization'),
    permission('okr:checkin:all', 'Check in on any organization goal', 'organization'),
    permission('okr:view:all', 'View all goals', 'organization'),
    permission('okr:view:organization', 'View organization goals', 'organization'),
    permission('okr:create:organization', 'Create organization goals', 'organization'),
    permission('goal:create:self', 'Create own goal', 'self'),
    permission('goal:assign:direct_reports', 'Assign goals to direct reports', 'reports'),
    permission('goal:assign:department', 'Assign department goals', 'department'),
    permission('goal:assign:organization', 'Assign organization goals', 'organization'),
    permission('goal:assign:all', 'Assign goals to any organization member', 'organization'),
    permission('goal_period:view', 'View goal periods', 'organization'),
    permission('goal_period:manage', 'Manage goal periods', 'organization'),
    permission('review:view:own', 'View own reviews', 'self'),
    permission('review:self_assess', 'Complete self assessment', 'self'),
    permission('review:view:direct_reports', 'View direct report reviews', 'reports'),
    permission('review:conduct:direct_reports', 'Conduct direct report reviews', 'reports'),
    permission('review:view:all', 'View all reviews', 'organization'),
    permission('review:calibrate', 'Run calibration', 'organization'),
    permission('review_cycle:view', 'View review cycles', 'organization'),
    permission('review_cycle:create', 'Create review cycles', 'organization'),
    permission('review_cycle:manage', 'Manage review cycles', 'organization'),
    permission('feedback:view:received', 'View received feedback', 'self'),
    permission('feedback:view:sent', 'View sent feedback', 'self'),
    permission('feedback:send', 'Send feedback', 'self'),
    permission('feedback:request', 'Request feedback', 'self'),
    permission('feedback:view:direct_reports', 'View direct report feedback', 'reports'),
    permission('feedback:view:all', 'View all feedback', 'organization'),
    permission('support_plan:view:own', 'View own support plan', 'self'),
    permission('support_plan:manage:direct_reports', 'Manage direct report support plans', 'reports'),
    permission('support_plan:review:hr', 'Review support plans as HR', 'organization'),
    permission('recognition:create', 'Create recognition', 'organization'),
    permission('recognition:moderate', 'Moderate recognition', 'organization'),
    permission('project_feedback:request', 'Request project feedback', 'reports'),
    permission('manager_practice:view:team', 'View team manager practice', 'team'),
    permission('manager_practice:view:organization', 'View organization manager practice', 'organization'),
    permission('talent_review:view:team', 'View team talent review', 'team'),
    permission('talent_review:manage:team', 'Manage team talent review', 'team'),
    permission('talent_review:manage:organization', 'Manage organization talent review', 'organization'),
    permission('succession:manage', 'Manage succession planning', 'organization'),
    permission('analytics:view:own', 'View own analytics', 'self'),
    permission('analytics:view:team', 'View team analytics', 'team'),
    permission('analytics:view:direct_reports', 'View direct report analytics', 'reports'),
    permission('analytics:view:organization', 'View organization analytics', 'organization'),
    permission('analytics:export', 'Export performance analytics', 'organization'),
    permission('team:view:own', 'View own team', 'self'),
    permission('team:view:members', 'View team members', 'team'),
    permission('team:view:all', 'View all teams', 'organization'),
    permission('user:view:direct_reports', 'View direct report profiles', 'reports'),
    permission('user:view:all', 'View all user profiles', 'organization'),
    permission('admin:settings', 'Manage performance settings', 'organization'),
    permission('admin:reports', 'Manage performance reports', 'organization')
  ], { category: 'hr' }),

  product('payroll-management', 'Payroll', [
    permission('payslip:view:own', 'View own payslips', 'self'),
    permission('payslip:download:own', 'Download own payslips', 'self'),
    permission('payslip:view:team_summary', 'View team pay summary', 'team', '', { sensitive: true }),
    permission('payslip:view:team_full', 'View full team payslips', 'reports', '', { sensitive: true }),
    permission('payslip:view:all', 'View all payslips', 'organization', '', { sensitive: true }),
    permission('compensation:view:own', 'View own compensation', 'self', '', { sensitive: true }),
    permission('compensation:view:team_summary', 'View team compensation summary', 'team', '', { sensitive: true }),
    permission('compensation:view:team_full', 'View full team compensation', 'reports', '', { sensitive: true }),
    permission('compensation:manage:own', 'Manage direct compensation requests', 'self', '', { sensitive: true }),
    permission('compensation:manage:team', 'Manage team compensation', 'reports', '', { sensitive: true }),
    permission('compensation:manage:all', 'Manage all compensation', 'organization', '', { sensitive: true }),
    permission('bonus:request:team', 'Request team bonuses', 'team'),
    permission('bonus:approve:team', 'Approve team bonuses', 'reports', '', { sensitive: true }),
    permission('bonus:view:all', 'View all bonuses', 'organization', '', { sensitive: true }),
    permission('salary:propose:team', 'Propose team salary changes', 'reports', '', { sensitive: true }),
    permission('salary:approve:team', 'Approve salary changes', 'organization', '', { sensitive: true }),
    permission('salary:view:all', 'View all salaries', 'organization', '', { sensitive: true }),
    permission('overtime:request:team', 'Request team overtime', 'reports'),
    permission('overtime:approve:team', 'Approve overtime', 'organization'),
    permission('payrollrun:view', 'View payroll runs', 'organization', '', { sensitive: true }),
    permission('payrollrun:manage', 'Create and edit payroll runs', 'organization', '', { sensitive: true }),
    permission('payrollrun:execute', 'Execute payroll runs', 'organization', '', { sensitive: true }),
    permission('payrollrun:approve', 'Approve payroll runs', 'organization', '', { sensitive: true }),
    permission('tax:configure', 'Configure tax', 'organization', '', { sensitive: true }),
    permission('tax:view:all', 'View tax records', 'organization', '', { sensitive: true }),
    permission('salarygrade:view', 'View salary grades', 'organization', '', { sensitive: true }),
    permission('salarygrade:manage', 'Manage salary grades', 'organization', '', { sensitive: true }),
    permission('salarygrade:delete', 'Delete salary grades', 'organization', '', { sensitive: true }),
    permission('report:view:team', 'View team payroll reports', 'reports', '', { sensitive: true }),
    permission('report:view:all', 'View all payroll reports', 'organization', '', { sensitive: true }),
    permission('report:export', 'Export payroll reports', 'organization', '', { sensitive: true }),
    permission('admin:settings', 'Manage payroll settings', 'organization', '', { sensitive: true }),
    permission('admin:reports', 'Manage payroll reports', 'organization', '', { sensitive: true })
  ], { category: 'hr' }),

  product('time-attendance', 'Time & Attendance', [
    permission('employee.view', 'View own attendance', 'self'),
    permission('corrections.request', 'Request attendance corrections', 'self'),
    permission('management.view', 'Open attendance management', 'organization'),
    permission('team.view', 'View team attendance', 'team'),
    permission('timesheets.approve', 'Approve timesheets', 'reports'),
    permission('corrections.review', 'Review corrections', 'reports'),
    permission('reports.view', 'View attendance reports', 'organization'),
    permission('policy.view', 'View attendance policies', 'organization'),
    permission('policy.manage', 'Manage attendance policies', 'organization'),
    permission('access.manage', 'Manage attendance access', 'organization', '', { sensitive: true })
  ], { category: 'hr' }),

  product('lms', 'Simple LMS', [
    permission('view_courses', 'View courses', 'organization'),
    permission('enroll_courses', 'Enrol in courses', 'self'),
    permission('view_lessons', 'View lessons', 'self'),
    permission('submit_assignments', 'Submit assignments', 'self'),
    permission('take_quizzes', 'Take quizzes', 'self'),
    permission('view_certificates', 'View certificates', 'self'),
    permission('view_own_progress', 'View own progress', 'self'),
    permission('participate_discussions', 'Participate in discussions', 'organization'),
    permission('view_batches', 'View batches', 'organization'),
    permission('view_live_classes', 'View live classes', 'organization'),
    permission('create_courses', 'Create courses', 'organization'),
    permission('create_chapters', 'Create course chapters', 'organization'),
    permission('create_lessons', 'Create lessons', 'organization'),
    permission('create_quizzes', 'Create quizzes', 'organization'),
    permission('create_assignments', 'Create assignments', 'organization'),
    permission('edit_own_courses', 'Edit own courses', 'self'),
    permission('delete_own_courses', 'Delete own courses', 'self'),
    permission('edit_any_course', 'Edit any course', 'organization'),
    permission('delete_any_course', 'Delete any course', 'organization'),
    permission('publish_courses', 'Publish courses', 'organization'),
    permission('unpublish_courses', 'Unpublish courses', 'organization'),
    permission('manage_course_content', 'Manage course content', 'organization'),
    permission('manage_batches', 'Manage batches', 'organization'),
    permission('create_batches', 'Create batches', 'organization'),
    permission('edit_batches', 'Edit batches', 'organization'),
    permission('delete_batches', 'Delete batches', 'organization'),
    permission('manage_batch_enrollments', 'Manage batch enrolments', 'organization'),
    permission('manage_enrollments', 'Manage enrolments', 'organization'),
    permission('view_enrollments', 'View enrolments', 'organization'),
    permission('manage_live_classes', 'Manage live classes', 'organization'),
    permission('manage_certifications', 'Manage certifications', 'organization'),
    permission('manage_lms_settings', 'Manage LMS settings', 'organization'),
    permission('view_analytics', 'View LMS analytics', 'organization'),
    permission('view_all_analytics', 'View all LMS analytics', 'organization'),
    permission('export_data', 'Export LMS data', 'organization'),
    permission('import_data', 'Import LMS data', 'organization'),
    permission('moderate_discussions', 'Moderate discussions', 'organization'),
    permission('manage_user_roles', 'Manage LMS roles', 'organization', '', { sensitive: true }),
    permission('grade_assignments', 'Grade assignments', 'organization'),
    permission('evaluate_quizzes', 'Evaluate quizzes', 'organization'),
    permission('view_student_progress', 'View student progress', 'organization'),
    permission('send_announcements', 'Send learning announcements', 'organization'),
    permission('manage_evaluator_schedule', 'Manage evaluator schedule', 'organization'),
    permission('view_evaluation_schedule', 'View evaluation schedule', 'organization'),
    permission('view_student_submissions', 'View student submissions', 'organization'),
    permission('grade_final_evaluations', 'Grade final evaluations', 'organization'),
    permission('evaluate_certifications', 'Evaluate certifications', 'organization'),
    permission('issue_certificates', 'Issue certificates', 'organization'),
    permission('revoke_certificates', 'Revoke certificates', 'organization')
  ], { category: 'learning' }),

  product('seemplify-learning', 'Learning', [
    permission('workspace.access', 'Open learning workspace', 'self'),
    permission('courses.learn', 'Take courses', 'self'),
    permission('courses.create', 'Create courses', 'organization'),
    permission('courses.manage', 'Manage all courses', 'organization'),
    permission('learners.manage', 'Manage learners', 'organization'),
    permission('partners.view', 'View partner workspace', 'organization'),
    permission('partners.manage', 'Manage learning partners', 'organization'),
    permission('sales.manage', 'Manage channel sales', 'organization'),
    permission('platform.manage', 'Manage Learning platform', 'platform', '', { sensitive: true })
  ], { category: 'learning' }),

  product('openwebui', 'AI Assistant', [
    permission('chat.use', 'Use AI chat', 'self'),
    permission('models.use', 'Use approved models', 'self'),
    permission('knowledge.read', 'Use shared knowledge', 'organization'),
    permission('knowledge.manage', 'Manage shared knowledge', 'organization'),
    permission('models.manage', 'Manage models', 'organization'),
    permission('users.manage', 'Manage AI Assistant users', 'organization'),
    permission('settings.manage', 'Manage AI Assistant settings', 'organization')
  ], { category: 'ai' }),

  product('outline', 'Outline Docs', [
    permission('documents.read', 'Read documents', 'organization'),
    permission('documents.create', 'Create documents', 'organization'),
    permission('documents.edit', 'Edit documents', 'organization'),
    permission('documents.delete', 'Delete documents', 'organization'),
    permission('collections.manage', 'Manage collections', 'organization'),
    permission('sharing.manage', 'Manage document sharing', 'organization'),
    permission('users.manage', 'Manage Outline users', 'organization'),
    permission('settings.manage', 'Manage Outline settings', 'organization')
  ], { category: 'productivity' }),

  product('messaging', 'Workspace', [
    permission('workspace.access', 'Open Workspace', 'self'),
    permission('messages.read', 'Read messages', 'organization'),
    permission('messages.write', 'Send messages', 'organization'),
    permission('messages.manage', 'Moderate messages', 'organization'),
    permission('channels.read', 'View channels', 'organization'),
    permission('channels.create', 'Create channels', 'organization'),
    permission('channels.manage', 'Manage channels', 'organization'),
    permission('calls.read', 'View calls and recordings', 'organization'),
    permission('calls.join', 'Join calls', 'organization'),
    permission('calls.start', 'Start calls', 'organization'),
    permission('calls.manage', 'Manage calls', 'organization'),
    permission('files.read', 'Download Workspace files', 'organization'),
    permission('files.upload', 'Upload files', 'organization'),
    permission('files.manage', 'Delete and govern files', 'organization'),
    permission('documents.read', 'Read notes', 'organization'),
    permission('documents.create', 'Create notes', 'organization'),
    permission('documents.edit', 'Edit notes', 'organization'),
    permission('documents.delete', 'Delete notes', 'organization'),
    permission('documents.share', 'Share notes', 'organization'),
    permission('pages.read', 'Read pages', 'organization'),
    permission('pages.create', 'Create pages', 'organization'),
    permission('pages.edit', 'Edit pages', 'organization'),
    permission('pages.delete', 'Delete pages', 'organization'),
    permission('pages.share', 'Share pages', 'organization'),
    permission('boards.read', 'View boards and work items', 'organization'),
    permission('boards.create', 'Create boards', 'organization'),
    permission('boards.edit', 'Edit boards and work items', 'organization'),
    permission('boards.delete', 'Delete boards and work items', 'organization'),
    permission('boards.manage', 'Manage board configuration', 'organization'),
    permission('databases.read', 'View Workspace databases', 'organization'),
    permission('databases.manage', 'Manage Workspace databases', 'organization'),
    permission('calendar.read', 'View calendar', 'organization'),
    permission('calendar.manage', 'Manage calendar events', 'organization'),
    permission('mail.read', 'Read connected mail', 'self', '', { sensitive: true }),
    permission('mail.send', 'Send connected mail', 'self', '', { sensitive: true }),
    permission('mail.manage_connections', 'Manage mail connections', 'self', '', { sensitive: true }),
    permission('ai.use', 'Use Workspace AI', 'self'),
    permission('search.use', 'Search Workspace', 'organization'),
    permission('analytics.read', 'View Workspace analytics', 'organization'),
    permission('notifications.read', 'View Workspace notifications', 'self'),
    permission('notifications.manage', 'Manage notification policy', 'organization'),
    permission('members.view', 'View Workspace members', 'organization'),
    permission('members.manage', 'Manage Workspace members', 'organization'),
    permission('external_collaboration.read', 'View external collaboration', 'organization'),
    permission('external_collaboration.manage', 'Manage external collaboration', 'organization', '', { sensitive: true }),
    permission('governance.read', 'View Workspace governance', 'organization'),
    permission('governance.manage', 'Manage Workspace governance', 'organization', '', { sensitive: true }),
    permission('security.read', 'View enterprise security', 'organization', '', { sensitive: true }),
    permission('security.manage', 'Manage enterprise security', 'organization', '', { sensitive: true }),
    permission('webhooks.manage', 'Manage Workspace webhooks', 'organization', '', { sensitive: true }),
    permission('beta.read', 'View beta roadmap', 'organization'),
    permission('beta.vote', 'Vote on beta roadmap', 'organization'),
    permission('beta.manage', 'Manage beta roadmap', 'organization'),
    permission('settings.read', 'View Workspace settings', 'organization'),
    permission('settings.manage', 'Manage Workspace settings', 'organization')
  ], { category: 'collaboration' }),

  product('community', 'Community', [
    permission('community.access', 'Open Community', 'self'),
    permission('posts.read', 'Read posts', 'organization'),
    permission('posts.create', 'Create posts', 'organization'),
    permission('posts.manage:own', 'Manage own posts', 'self'),
    permission('posts.moderate', 'Moderate posts', 'organization'),
    permission('comments.create', 'Comment on posts', 'organization'),
    permission('comments.manage:own', 'Manage own comments', 'self'),
    permission('reactions.use', 'React to community content', 'organization'),
    permission('channels.read', 'Read community channels', 'organization'),
    permission('channels.write', 'Post in community channels', 'organization'),
    permission('channels.manage', 'Manage community channels', 'organization'),
    permission('direct_messages.read', 'Read Community direct messages', 'self'),
    permission('direct_messages.write', 'Send Community direct messages', 'self'),
    permission('forums.read', 'Read forums', 'organization'),
    permission('forums.create', 'Create forum topics and replies', 'organization'),
    permission('forums.moderate', 'Moderate forums', 'organization'),
    permission('articles.read', 'Read Community articles', 'organization'),
    permission('articles.create', 'Create Community articles', 'organization'),
    permission('articles.publish', 'Publish Community articles', 'organization'),
    permission('events.read', 'View Community events', 'organization'),
    permission('events.create', 'Create Community events', 'organization'),
    permission('events.manage', 'Manage Community events', 'organization'),
    permission('events.register', 'Register for Community events', 'self'),
    permission('profiles.read', 'View Community profiles', 'organization'),
    permission('profiles.manage:own', 'Manage own Community profile', 'self'),
    permission('relationships.manage', 'Manage Community relationships', 'self'),
    permission('reports.create', 'Report Community content', 'organization'),
    permission('reports.read', 'View Community reports', 'organization'),
    permission('search.use', 'Search Community', 'organization'),
    permission('members.read', 'View Community members', 'organization'),
    permission('spaces.manage', 'Manage community spaces', 'organization'),
    permission('members.manage', 'Manage community members', 'organization'),
    permission('settings.manage', 'Manage Community settings', 'organization')
  ], { category: 'collaboration' }),

  product('automation-hub', 'Automations', [
    permission('automations.read', 'View automations', 'organization'),
    permission('automations.create', 'Create automations', 'organization'),
    permission('automations.edit', 'Edit automations', 'organization'),
    permission('automations.delete', 'Delete automations', 'organization'),
    permission('automations.run', 'Run automations', 'organization'),
    permission('executions.read', 'View execution history', 'organization'),
    permission('executions.manage', 'Manage executions', 'organization'),
    permission('connections.read', 'View connections', 'organization', '', { sensitive: true }),
    permission('connections.manage', 'Manage connections', 'organization', '', { sensitive: true }),
    permission('settings.manage', 'Manage Automation settings', 'organization')
  ], { category: 'automation' }),

  product('experience-management', 'Experience Management', [
    permission('users.read', 'View users', 'platform'),
    permission('users.create', 'Create users', 'platform'),
    permission('users.manage', 'Manage users', 'platform'),
    permission('roles.read', 'View roles', 'platform'),
    permission('roles.manage', 'Manage roles', 'platform', '', { sensitive: true }),
    permission('spaces.read', 'View spaces', 'organization'),
    permission('spaces.manage', 'Manage spaces', 'organization'),
    permission('subscriptions.read', 'View subscriptions', 'platform'),
    permission('subscriptions.manage', 'Manage subscriptions', 'platform', '', { sensitive: true }),
    permission('analytics.read', 'View analytics', 'organization'),
    permission('ai_defaults.read', 'View AI defaults', 'platform'),
    permission('ai_defaults.manage', 'Manage AI defaults', 'platform', '', { sensitive: true }),
    permission('journey_templates.read', 'View journey templates', 'organization'),
    permission('journey_templates.manage', 'Manage journey templates', 'organization'),
    permission('journey_rollout.read', 'View journey rollout', 'organization'),
    permission('journey_rollout.manage', 'Manage journey rollout', 'organization'),
    permission('jobs.read', 'View global AI jobs', 'platform'),
    permission('activity.read', 'View activity', 'organization'),
    permission('audit.read', 'View audit log', 'organization'),
    permission('journeys.read', 'Read journeys', 'organization'),
    permission('journeys.comment', 'Comment on journeys', 'organization'),
    permission('journeys.watch', 'Watch journeys', 'organization'),
    permission('journeys.edit', 'Edit journeys', 'organization'),
    permission('journeys.manage_portfolio', 'Manage journey portfolio', 'organization'),
    permission('journeys.request_review', 'Request journey review', 'organization'),
    permission('journeys.review', 'Review journeys', 'organization'),
    permission('journeys.publish', 'Publish journeys', 'organization'),
    permission('journeys.manage_roles', 'Manage journey roles', 'organization', '', { sensitive: true }),
    permission('journeys.manage_shares', 'Manage journey sharing', 'organization', '', { sensitive: true }),
    permission('journeys.manage_views', 'Manage saved journey views', 'organization'),
    permission('journeys.view_activity', 'View journey activity', 'organization'),
    permission('journeys.export', 'Export journeys', 'organization')
  ], { category: 'experience' }),

  product('approver', 'Approver', [
    permission('projects.submit', 'Submit initiatives', 'organization'),
    permission('projects.review.coe', 'Run Centre of Excellence review', 'department'),
    permission('projects.review.governance', 'Run governance review', 'organization'),
    permission('projects.review.executive', 'Run executive review', 'organization'),
    permission('projects.override', 'Override initiative decisions', 'organization', '', { sensitive: true }),
    permission('dashboard.review', 'View review dashboard', 'organization'),
    permission('scoring.manage', 'Manage scoring', 'organization'),
    permission('rules.manage', 'Manage organization rules', 'organization'),
    permission('rules.manage.system', 'Manage system rules', 'platform', '', { sensitive: true }),
    permission('roles.manage', 'Manage Approver roles', 'organization', '', { sensitive: true }),
    permission('workflow.manage', 'Manage approval workflow', 'organization', '', { sensitive: true })
  ], { category: 'governance' })
])

// Built-in organization roles receive every organization-delegable permission,
// never platform-only controls. A global IdP super administrator can still
// create a deliberate global role containing platform permissions.
const all = (appId) => ({
  appId,
  permissions: (PRODUCT_PERMISSION_CATALOG.find((entry) => entry.appId === appId)?.permissions || [])
    .filter((entry) => entry.delegable !== false)
    .map((entry) => entry.id)
})
const grant = (appId, permissions) => ({ appId, permissions })
const allExcept = (appId, excludedPermissions = []) => {
  const excluded = new Set(excludedPermissions)
  const row = all(appId)
  return grant(appId, row.permissions.filter((permissionId) => !excluded.has(permissionId)))
}

// Ordinary organization members receive every delegable product capability by
// default. Only product administration, cross-person sensitive controls, and
// policy/security operations are held back. New catalogue entries therefore
// reach members automatically unless they are deliberately classified here.
export const MEMBER_RESTRICTED_PERMISSION_EXCLUSIONS = Object.freeze({
  identity: [
    'organization.manage', 'members.invite', 'members.manage', 'members.remove',
    'roles.assign', 'access.manage', 'apps.assign', 'departments.manage', 'teams.manage',
    'locations.manage', 'invitations.manage', 'notifications.send', 'onboarding.manage',
    'onboarding.assign', 'subscriptions.request', 'audit.read'
  ],
  smarthr: ['manage_users', 'manage_settings', 'manage_billing', 'manage_licenses'],
  'performance-management': ['goal_period:manage', 'review_cycle:create', 'review_cycle:manage', 'admin:settings', 'admin:reports'],
  'payroll-management': [
    'payslip:view:all', 'compensation:manage:all', 'bonus:view:all', 'salary:approve:team',
    'salary:view:all', 'overtime:approve:team', 'payrollrun:view', 'payrollrun:manage',
    'payrollrun:execute', 'payrollrun:approve', 'tax:configure', 'tax:view:all',
    'salarygrade:view', 'salarygrade:manage', 'salarygrade:delete', 'report:view:all',
    'report:export', 'admin:settings', 'admin:reports'
  ],
  'time-attendance': ['policy.manage', 'access.manage'],
  lms: ['manage_lms_settings', 'manage_user_roles'],
  'seemplify-learning': ['sales.manage'],
  openwebui: ['users.manage', 'settings.manage'],
  outline: ['users.manage', 'settings.manage'],
  messaging: [
    'messages.manage', 'channels.manage', 'calls.manage', 'files.manage', 'boards.manage',
    'notifications.manage', 'members.manage', 'external_collaboration.manage',
    'governance.manage', 'security.read', 'security.manage', 'webhooks.manage',
    'beta.manage', 'settings.manage'
  ],
  community: [
    'posts.moderate', 'channels.manage', 'forums.moderate', 'events.manage',
    'reports.read', 'spaces.manage', 'members.manage', 'settings.manage'
  ],
  'automation-hub': ['settings.manage'],
  'experience-management': ['audit.read', 'journeys.manage_roles'],
  approver: ['projects.override', 'scoring.manage', 'rules.manage', 'roles.manage', 'workflow.manage']
})

const memberGrants = PRODUCT_PERMISSION_CATALOG.map((entry) => allExcept(
  entry.appId,
  MEMBER_RESTRICTED_PERMISSION_EXCLUSIONS[entry.appId] || []
))

const managerGrants = [
  grant('identity', ['teams.manage.assigned', 'notifications.send.assigned']),
  grant('leave-management', ['view_team_leaves', 'view_direct_reports_leaves', 'approve_leaves']),
  grant('performance-management', [
    'okr:view:team', 'okr:create:team', 'okr:view:direct_reports', 'okr:review:direct_reports',
    'okr:checkin:direct_reports', 'okr:assign:direct_reports', 'okr:decide:direct_reports', 'okr:bulk_assign',
    'goal:assign:direct_reports', 'review:view:direct_reports', 'review:conduct:direct_reports',
    'feedback:view:direct_reports', 'support_plan:manage:direct_reports', 'project_feedback:request',
    'manager_practice:view:team', 'talent_review:view:team', 'talent_review:manage:team',
    'analytics:view:team', 'analytics:view:direct_reports', 'team:view:members', 'user:view:direct_reports'
  ]),
  grant('payroll-management', [
    'payslip:view:team_summary', 'payslip:view:team_full', 'compensation:view:team_summary',
    'compensation:view:team_full', 'compensation:manage:own', 'compensation:manage:team',
    'bonus:request:team', 'bonus:approve:team', 'salary:propose:team', 'overtime:request:team',
    'payrollrun:view', 'salarygrade:view', 'report:view:team'
  ]),
  grant('time-attendance', ['management.view', 'team.view', 'timesheets.approve', 'corrections.review']),
  grant('approver', ['projects.review.coe', 'dashboard.review'])
]

// HR managers are organization-wide operational administrators. They receive
// every assigned product's delegable feature permission except the small set
// of ownership, access-policy, commercial, and top-level security controls
// that remain reserved for an organization administrator or owner.
export const HR_MANAGER_TOP_LEVEL_EXCLUSIONS = Object.freeze({
  identity: ['access.manage', 'roles.assign', 'subscriptions.request'],
  smarthr: ['manage_billing', 'manage_licenses'],
  'time-attendance': ['access.manage'],
  lms: ['manage_user_roles'],
  'seemplify-learning': ['sales.manage'],
  messaging: ['security.manage', 'webhooks.manage']
})

const hrManagerGrants = PRODUCT_PERMISSION_CATALOG.map((entry) => allExcept(
  entry.appId,
  HR_MANAGER_TOP_LEVEL_EXCLUSIONS[entry.appId] || []
))

export const DEFAULT_ACCESS_ROLES = Object.freeze([
  {
    key: 'organization_owner',
    name: 'Organization Owner',
    description: 'Full authority across the organization and every assigned product.',
    sourceOrganizationRoles: ['owner'],
    sourceTeamRoles: [],
    grants: [
      ...PRODUCT_PERMISSION_CATALOG.map((entry) => all(entry.appId)),
      grant('identity', ['organization.delete', 'owner.transfer'])
    ],
    denies: [],
    locked: true
  },
  {
    key: 'organization_admin',
    name: 'Organization Admin',
    description: 'Full product administration without ownership transfer or organization deletion.',
    sourceOrganizationRoles: ['admin'],
    sourceTeamRoles: [],
    grants: PRODUCT_PERMISSION_CATALOG.map((entry) => all(entry.appId)),
    denies: [grant('identity', ['organization.delete', 'owner.transfer'])],
    locked: true
  },
  {
    key: 'hr_manager',
    name: 'HR Manager',
    description: 'Near-admin authority across products without ownership, access-policy, commercial, or top-level security controls.',
    sourceOrganizationRoles: ['hr_manager'],
    sourceTeamRoles: [],
    grants: hrManagerGrants,
    denies: [],
    locked: true
  },
  {
    key: 'recruiter',
    name: 'Recruiter',
    description: 'Full non-administrative product access.',
    sourceOrganizationRoles: ['recruiter'],
    sourceTeamRoles: [],
    grants: memberGrants,
    denies: [],
    locked: true
  },
  {
    key: 'interviewer',
    name: 'Interviewer',
    description: 'Full non-administrative product access.',
    sourceOrganizationRoles: ['interviewer'],
    sourceTeamRoles: [],
    grants: memberGrants,
    denies: [],
    locked: true
  },
  {
    key: 'employee',
    name: 'Employee',
    description: 'Full non-administrative product access.',
    sourceOrganizationRoles: ['staff'],
    sourceTeamRoles: [],
    grants: memberGrants,
    denies: [],
    locked: true
  },
  {
    key: 'line_manager',
    name: 'Line Manager',
    description: 'Direct-report and team management permissions in addition to employee access.',
    sourceOrganizationRoles: [],
    sourceTeamRoles: ['line_manager'],
    grants: [...memberGrants, ...managerGrants],
    denies: [],
    locked: true
  },
  {
    key: 'team_lead',
    name: 'Team Lead',
    description: 'Team-scoped review and coordination permissions in addition to employee access.',
    sourceOrganizationRoles: [],
    sourceTeamRoles: ['team_lead'],
    grants: [...memberGrants, ...managerGrants],
    denies: [],
    locked: true
  },
  {
    key: 'department_head',
    name: 'Department Head',
    description: 'Department-scoped management permissions inferred from the IdP department structure.',
    sourceOrganizationRoles: [],
    sourceTeamRoles: ['department_head'],
    grants: [
      ...memberGrants,
      ...managerGrants,
      grant('performance-management', ['okr:view:department', 'goal:assign:department']),
      grant('approver', ['projects.review.coe', 'dashboard.review', 'scoring.manage'])
    ],
    denies: [],
    locked: true
  }
])

export function getProductPermissionCatalog(appId) {
  return PRODUCT_PERMISSION_CATALOG.find((entry) => entry.appId === appId) || null
}

export function getKnownAppIds() {
  return PRODUCT_PERMISSION_CATALOG.map((entry) => entry.appId)
}

export function getKnownPermissionIds(appId) {
  return (getProductPermissionCatalog(appId)?.permissions || []).map((entry) => entry.id)
}

export function getDefaultRolePermissions(sourceRole, appId = 'identity') {
  const matchingRoles = DEFAULT_ACCESS_ROLES.filter((role) => (
    (role.sourceOrganizationRoles || []).includes(sourceRole) ||
    (role.sourceTeamRoles || []).includes(sourceRole)
  ))
  if (matchingRoles.length === 0) return null

  const permissions = new Set()
  for (const role of matchingRoles) {
    for (const row of role.grants || []) {
      if (row.appId !== appId) continue
      for (const permissionId of row.permissions || []) permissions.add(permissionId)
    }
    for (const row of role.denies || []) {
      if (row.appId !== appId) continue
      for (const permissionId of row.permissions || []) permissions.delete(permissionId)
    }
  }
  return Array.from(permissions).sort()
}

export function getPermissionDefinition(appId, permissionId) {
  return getProductPermissionCatalog(appId)?.permissions.find((entry) => entry.id === permissionId) || null
}
