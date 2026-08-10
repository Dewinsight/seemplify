export type ProductVisualKind =
  | 'recruiter'
  | 'core-hr'
  | 'leave'
  | 'performance'
  | 'time'
  | 'payroll'
  | 'experience'
  | 'learning'

export type ProductPageData = {
  slug: string
  name: string
  navigationName: string
  status?: 'Beta' | 'New'
  title: string
  summary: string
  audience: string
  visual: ProductVisualKind
  visualLabel: string
  boundary: {
    title: string
    description: string
  }
  capabilities: Array<{
    title: string
    description: string
  }>
  workflow: Array<{
    title: string
    description: string
  }>
  connections: Array<{
    product: string
    href: string
    description: string
  }>
}

export const productPages: ProductPageData[] = [
  {
    slug: 'recruiter',
    name: 'Recruiter',
    navigationName: 'Recruiter',
    title: 'Move from an open role to a documented hiring decision.',
    summary:
      'Create roles, receive applications, organise candidate records, schedule interviews and keep feedback together. Optional AI tools can assist with CV analysis, role content and evidence-led matching while recruiters retain the decision.',
    audience: 'For recruiting teams, hiring managers and interviewers',
    visual: 'recruiter',
    visualLabel: 'A hiring workflow moving from an open role through candidate review and interviews to a decision',
    boundary: {
      title: 'AI supports review; it does not make the hiring decision.',
      description:
        'AI activities run only when configured for the workspace and may use ChatGPT or a Local runtime. Matching and generated content remain inputs for a recruiter to verify against the source record.',
    },
    capabilities: [
      {
        title: 'Roles and public applications',
        description: 'Create and publish job records, define requirements and screening questions, and receive applications against the correct role.',
      },
      {
        title: 'Candidate records and lists',
        description: 'Keep candidate details, documents, notes and list membership attached to the person recruiters are reviewing.',
      },
      {
        title: 'Bulk CV processing',
        description: 'Upload multiple CVs, follow each processing stage, review failures and retry work without losing the original file record.',
      },
      {
        title: 'Pipeline and shortlists',
        description: 'Move candidates through configured stages, maintain shortlists and carry out batch pipeline actions with a visible history.',
      },
      {
        title: 'Interviews, AI Interview and feedback',
        description: 'Schedule live interviews or invite candidates into a guided AI Interview, then keep transcripts and structured feedback alongside the job and candidate.',
      },
      {
        title: 'Recruiting assistance',
        description: 'When enabled, prepare job descriptions, interview questions, CV analysis and matching evidence inside the recruiting workflow.',
      },
    ],
    workflow: [
      { title: 'Define the role', description: 'Record the job, requirements, screening questions and interview stages.' },
      { title: 'Build the candidate set', description: 'Receive applications or add candidates and CVs directly.' },
      { title: 'Review the evidence', description: 'Use records, screening responses and optional AI analysis to support the review.' },
      { title: 'Interview and decide', description: 'Schedule conversations, gather feedback and document the outcome.' },
    ],
    connections: [
      { product: 'Core HR & onboarding', href: '/products/core-hr-onboarding', description: 'Carry the selected person into a structured people transition.' },
      { product: 'Performance', href: '/products/performance', description: 'Keep role and team context available after the person joins.' },
      { product: 'Experience Management', href: '/products/experience-management', description: 'Collect candidate or onboarding feedback through a bounded survey.' },
    ],
  },
  {
    slug: 'core-hr-onboarding',
    name: 'Core HR & onboarding',
    navigationName: 'Core HR & onboarding',
    title: 'Give every person the right organisational context from day one.',
    summary:
      'Maintain organisation membership, team hierarchy and workspace roles through the shared identity layer, then coordinate onboarding, exit or retirement tasks and documents through structured people transitions.',
    audience: 'For people teams, organisation administrators and managers',
    visual: 'core-hr',
    visualLabel: 'An employee moving from invitation through team assignment, onboarding work and workspace access',
    boundary: {
      title: 'Focused on identity, organisation and people transitions.',
      description:
        'This workspace covers membership, teams, roles and transition tasks and documents. It does not claim to replace specialist benefits administration or every form of HR master-data system.',
    },
    capabilities: [
      {
        title: 'Organisation membership',
        description: 'Invite and manage members within the correct organisation and keep membership status visible.',
      },
      {
        title: 'Teams and hierarchy',
        description: 'Create teams and sub-teams, assign departments, and derive manager context from team roles.',
      },
      {
        title: 'Role-aware access',
        description: 'Apply organisation and team roles so enabled Seemplify workspaces receive consistent access context.',
      },
      {
        title: 'Onboarding workflows',
        description: 'Create onboarding records with assigned tasks, due dates, owners and visible progress.',
      },
      {
        title: 'Documents and forms',
        description: 'Route transition documents and forms for completion, download or signing within the assigned process.',
      },
      {
        title: 'Lifecycle transitions',
        description: 'Track onboarding, exit and retirement as distinct processes without mixing their work items.',
      },
    ],
    workflow: [
      { title: 'Add the person', description: 'Invite or activate the organisation member in the shared identity layer.' },
      { title: 'Place them in context', description: 'Assign the department, team and appropriate team role.' },
      { title: 'Run the transition', description: 'Assign tasks, forms and documents with owners and due dates.' },
      { title: 'Open the right workspaces', description: 'Use the same membership and role context across enabled applications.' },
    ],
    connections: [
      { product: 'Recruiter', href: '/products/recruiter', description: 'Start an onboarding transition from a documented hiring outcome.' },
      { product: 'Leave Management', href: '/products/leave', description: 'Use organisation and manager context when routing leave requests.' },
      { product: 'Time & Attendance', href: '/products/time-attendance', description: 'Use the same employee and team context for schedules and approvals.' },
    ],
  },
  {
    slug: 'leave',
    name: 'Leave Management',
    navigationName: 'Leave',
    title: 'Make time-off requests clear for employees and managers.',
    summary:
      'Configure leave policies and holidays, show balances, route requests through the organisation hierarchy and keep every approval, rejection or cancellation in the record.',
    audience: 'For employees, managers and people operations teams',
    visual: 'leave',
    visualLabel: 'A leave request checked against balance and policy before a manager decision and calendar update',
    boundary: {
      title: 'Your organisation remains responsible for its leave policy.',
      description:
        'Entitlements, working days, holidays, accrual and carry-over settings are configurable. They must be reviewed against the employment rules that apply to each workforce.',
    },
    capabilities: [
      { title: 'Requests and balances', description: 'Let employees request time off against an available balance and see the current request state.' },
      { title: 'Policy controls', description: 'Configure leave types, working days, notice periods, carry-over, accrual and approval requirements.' },
      { title: 'Hierarchy-based routing', description: 'Assign the appropriate approver from team and organisation context, with a fallback route when needed.' },
      { title: 'Decision history', description: 'Record approvals, rejection reasons and cancellations, including who acted and when.' },
      { title: 'Calendar and holidays', description: 'Show approved leave in a shared calendar and maintain organisation holiday dates.' },
      { title: 'Workflow notifications', description: 'Notify approvers and requesters about submissions and decisions when notification settings are enabled.' },
    ],
    workflow: [
      { title: 'Request', description: 'Choose the leave type and dates and provide the required context.' },
      { title: 'Validate', description: 'Check policy, balance and overlapping requests before the request is created.' },
      { title: 'Review', description: 'Route the request to the manager or organisation role allowed to decide.' },
      { title: 'Update', description: 'Record the decision, adjust the balance and share the approved dates with attendance.' },
    ],
    connections: [
      { product: 'Core HR & onboarding', href: '/products/core-hr-onboarding', description: 'Use team hierarchy and role context to identify approval ownership.' },
      { product: 'Time & Attendance', href: '/products/time-attendance', description: 'Bring approved leave and holiday dates into attendance calculations.' },
      { product: 'Payroll', href: '/products/payroll', description: 'Keep reviewed absence context available to payroll preparation.' },
    ],
  },
  {
    slug: 'performance',
    name: 'Performance Management',
    navigationName: 'Performance',
    status: 'Beta',
    title: 'Keep goals, feedback and review decisions in the same cycle.',
    summary:
      'Set OKRs, run check-ins and one-to-ones, collect feedback, coordinate appraisal cycles and preserve the discussion from self-assessment through manager review and calibration.',
    audience: 'For employees, managers and performance administrators',
    visual: 'performance',
    visualLabel: 'A performance cycle linking goals, check-ins, appraisal review and calibration',
    boundary: {
      title: 'Ratings and people decisions stay human-controlled.',
      description:
        'Optional AI activities can assist with OKR drafts, review writing and analysis when an approved runtime is available. Managers and reviewers remain responsible for the source evidence, rating and final action.',
    },
    capabilities: [
      { title: 'OKRs and alignment', description: 'Create objectives and key results, organise goal periods and view alignment across team work.' },
      { title: 'Check-ins and one-to-ones', description: 'Keep recurring manager conversations and updates connected to the employee record.' },
      { title: 'Feedback', description: 'Request and record feedback, then keep it available to the people authorised to use it.' },
      { title: 'Appraisal cycles', description: 'Coordinate goal setting, self-assessment, manager review, discussion and final review stages.' },
      { title: 'Calibration and reporting', description: 'Support calibration work and review reports without changing the underlying assessment history.' },
      { title: 'Development plans', description: 'Turn agreed development actions into a plan that can be revisited after the review.' },
    ],
    workflow: [
      { title: 'Align expectations', description: 'Set goals, measures and the period in which they will be reviewed.' },
      { title: 'Keep evidence current', description: 'Use check-ins, feedback and one-to-ones throughout the period.' },
      { title: 'Run the appraisal', description: 'Complete the configured self, manager and discussion stages.' },
      { title: 'Calibrate and follow through', description: 'Review outcomes and carry development actions into the next cycle.' },
    ],
    connections: [
      { product: 'Core HR & onboarding', href: '/products/core-hr-onboarding', description: 'Use the current team and reporting context for performance work.' },
      { product: 'Time & Attendance', href: '/products/time-attendance', description: 'Reference approved attendance summaries as context, not as an automatic rating input.' },
      { product: 'Learning', href: '/products/learning', description: 'Connect development needs with structured learning opportunities.' },
    ],
  },
  {
    slug: 'time-attendance',
    name: 'Time & Attendance',
    navigationName: 'Time & Attendance',
    status: 'New',
    title: 'Turn daily time records into reviewable, protected timesheets.',
    summary:
      'Support clock-ins, breaks, schedules and manual corrections; calculate timesheets under versioned rule packs; route exceptions and approvals; and transfer approved time to payroll with an audit trail.',
    audience: 'For employees, managers, schedulers and payroll teams',
    visual: 'time',
    visualLabel: 'A time record moving from clock activity to rule calculation, exception review, approval and payroll transfer',
    boundary: {
      title: 'Geofencing validates a submitted clock location; it is not background tracking.',
      description:
        'The application does not use biometric identity or claim that application presence proves productive work. Presence evidence cannot independently determine pay, discipline, timesheet approval or a performance rating.',
    },
    capabilities: [
      { title: 'Clock and break records', description: 'Record clock-in, clock-out, break start and break end events with a live view of the current state.' },
      { title: 'Schedules and rule packs', description: 'Apply dated schedules and versioned rules to daily, weekly or longer timesheet periods.' },
      { title: 'Geofenced clocking', description: 'When enabled, validate a clock location against configured workplaces in warning or enforced mode.' },
      { title: 'Exceptions and corrections', description: 'Surface incomplete or conflicting records and create audited adjustments for protected periods.' },
      { title: 'Layered approvals', description: 'Submit, recall, approve, reject or request revision through configured approval levels and delegations.' },
      { title: 'Reports and reminders', description: 'Review attendance, overtime, lateness and geofence exceptions and send workflow reminders when configured.' },
    ],
    workflow: [
      { title: 'Capture', description: 'Record clock events, schedules, leave and manual entries with their source.' },
      { title: 'Calculate', description: 'Apply the effective rule pack and preserve the policy snapshot used.' },
      { title: 'Resolve', description: 'Review missing entries, exceptions and required correction versions.' },
      { title: 'Approve and transfer', description: 'Lock the approved version and queue the payroll handoff with an idempotent reference.' },
    ],
    connections: [
      { product: 'Leave Management', href: '/products/leave', description: 'Include approved leave and public holidays in the period calculation.' },
      { product: 'Payroll', href: '/products/payroll', description: 'Send only approved, versioned time summaries into payroll preparation.' },
      { product: 'Performance', href: '/products/performance', description: 'Share bounded attendance summaries as context without converting them into ratings.' },
    ],
  },
  {
    slug: 'payroll',
    name: 'Payroll',
    navigationName: 'Payroll',
    status: 'Beta',
    title: 'Prepare and review payroll with readiness gates in view.',
    summary:
      'Set up employee pay details, salary grades and compensation requests, calculate draft runs, inspect exceptions, route approvals and produce payslips, reports and export-ready records.',
    audience: 'For payroll administrators, finance reviewers and employees',
    visual: 'payroll',
    visualLabel: 'A payroll run moving from employee readiness through calculation, exception review and approval to payslips and exports',
    boundary: {
      title: 'Statutory readiness is jurisdiction-specific and fail-closed.',
      description:
        'A payroll run must not be treated as legally ready unless the applicable jurisdiction pack and its review gates are enabled. Unsupported jurisdictions remain blocked from statutory-calculation-ready payroll until a pack passes the published legal and test gates; manual data entry does not certify a pack.',
    },
    capabilities: [
      { title: 'Employee readiness', description: 'Identify missing employee, compensation, bank or tax setup before a run is treated as ready.' },
      { title: 'Salary grades and compensation', description: 'Maintain salary structures and route overtime, reimbursement, bonus or correction requests for review.' },
      { title: 'Draft pay runs', description: 'Prepare a period calculation and keep runs with errors in a pending-review state.' },
      { title: 'Exceptions and approvals', description: 'Inspect calculation issues and route the run through the organisation approval workflow.' },
      { title: 'Payslips and employee access', description: 'Create draft and final payslip records that employees can review through their workspace.' },
      { title: 'Reports and exports', description: 'Prepare payroll reports and downstream export records after review and approval.' },
    ],
    workflow: [
      { title: 'Check readiness', description: 'Confirm employee setup, period inputs and enabled jurisdiction coverage.' },
      { title: 'Calculate a draft', description: 'Prepare gross-to-net records and preserve the inputs used for the run.' },
      { title: 'Review exceptions', description: 'Resolve calculation and employee-readiness issues before approval.' },
      { title: 'Approve and release', description: 'Complete the review gates, then prepare payslips, reports and exports.' },
    ],
    connections: [
      { product: 'Time & Attendance', href: '/products/time-attendance', description: 'Receive approved, versioned regular and overtime summaries.' },
      { product: 'Leave Management', href: '/products/leave', description: 'Use reviewed absence context when preparing the period.' },
      { product: 'Core HR & onboarding', href: '/products/core-hr-onboarding', description: 'Identify employees whose organisation or onboarding setup is incomplete.' },
    ],
  },
  {
    slug: 'experience-management',
    name: 'Experience Management',
    navigationName: 'Experience Management',
    title: 'Turn bounded feedback into evidence people can act on.',
    summary:
      'Design surveys, collect responses through controlled channels, analyse experience measures and response patterns, map journeys and track follow-up work without losing the source evidence.',
    audience: 'For employee-experience, customer-experience and research teams',
    visual: 'experience',
    visualLabel: 'A feedback programme moving from survey design and collection through analysis to a reviewed follow-up action',
    boundary: {
      title: 'Analysis is limited to the data you provide or authorise.',
      description:
        'Social intelligence operates on imported or authorised sources. AI summaries, journey suggestions and reply drafts must remain traceable to supplied evidence and are reviewed by a person; the assistant does not post replies or send mail automatically.',
    },
    capabilities: [
      { title: 'Survey design', description: 'Build multi-page surveys with varied question types, validation, display rules and branch logic.' },
      { title: 'Collection channels', description: 'Publish web, QR, email, API, manual-entry or kiosk collectors and track invitation delivery.' },
      { title: 'Response analysis', description: 'Review individual and aggregate responses, NPS, CSAT, CES, trends, drop-off and key-driver correlations.' },
      { title: 'Evidence-led AI work', description: 'When configured, support sentiment, themes, translation, reports and questions over bounded response evidence.' },
      { title: 'Journey mapping', description: 'Organise stages, touchpoints, actions, emotion, friction, measures and opportunities in a reviewable journey map.' },
      { title: 'Follow-up work', description: 'Create service-recovery tickets and keep a history of saved intelligence reports and reviewed draft actions.' },
    ],
    workflow: [
      { title: 'Define the question', description: 'Choose the programme purpose, audience, measures and survey structure.' },
      { title: 'Collect responses', description: 'Publish only the channels and invitations approved for the programme.' },
      { title: 'Analyse evidence', description: 'Review measures, patterns, response detail and optional evidence-grounded AI outputs.' },
      { title: 'Close the loop', description: 'Assign recovery or improvement work and keep the action tied to the original evidence.' },
    ],
    connections: [
      { product: 'Recruiter', href: '/products/recruiter', description: 'Collect candidate and hiring-manager feedback around the recruiting journey.' },
      { product: 'Core HR & onboarding', href: '/products/core-hr-onboarding', description: 'Run onboarding or exit listening programmes around a defined transition.' },
      { product: 'Performance', href: '/products/performance', description: 'Keep engagement evidence separate from formal ratings while informing people programmes.' },
    ],
  },
  {
    slug: 'learning',
    name: 'Learning',
    navigationName: 'Learning',
    title: 'Give development work a clear learning structure.',
    summary:
      'Organise courses into chapters and lessons, group learners into batches, support live classes, quizzes and assignments, and recognise completed learning with certificates.',
    audience: 'For learning teams, instructors, managers and learners',
    visual: 'learning',
    visualLabel: 'A learning path progressing through chapters, lessons and an assessment to course completion',
    boundary: {
      title: 'Completion records show activity in the learning workspace.',
      description:
        'Course completion and certificates reflect the configured learning requirements. They do not by themselves establish an external professional licence or regulatory qualification.',
    },
    capabilities: [
      { title: 'Structured courses', description: 'Organise learning into courses, chapters and lessons so content retains its intended sequence.' },
      { title: 'Learner batches', description: 'Group learners by course and duration and make the relevant learning plan visible to the cohort.' },
      { title: 'Live classes', description: 'Schedule Zoom live classes for a batch and show learners the sessions attached to their course.' },
      { title: 'Quizzes', description: 'Create single-choice, multiple-choice or open-ended questions to check understanding.' },
      { title: 'Assignments', description: 'Accept assignment submissions as PDF or document files for instructor review.' },
      { title: 'Certificates', description: 'Grant a configured certificate when the learner completes the course or batch requirements.' },
    ],
    workflow: [
      { title: 'Build the course', description: 'Create the chapters, lessons, assessment and completion requirements.' },
      { title: 'Enrol the learners', description: 'Place learners in the appropriate course or time-bound batch.' },
      { title: 'Learn and assess', description: 'Work through lessons, live classes, quizzes and assignment submissions.' },
      { title: 'Record completion', description: 'Update progress and issue the configured certificate when requirements are met.' },
    ],
    connections: [
      { product: 'Performance', href: '/products/performance', description: 'Use agreed development needs to inform the learning plan.' },
      { product: 'Core HR & onboarding', href: '/products/core-hr-onboarding', description: 'Use shared identity and organisation context for learner access.' },
      { product: 'Experience Management', href: '/products/experience-management', description: 'Collect structured feedback about a course or learning programme.' },
    ],
  },
]

export const productPageBySlug = Object.fromEntries(
  productPages.map((product) => [product.slug, product]),
) as Record<string, ProductPageData>
