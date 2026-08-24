const TRIAL_URL = 'https://auth.seemplifyai.com/signup'
const DEMO_URL = 'https://auth.seemplifyai.com/book-demo'
const AUTH_ASSET_ROOT = 'https://auth.seemplifyai.com/images/campaigns'
const MARKETING_IMAGE_ROOT = 'https://seemplifyai.com/images'
const MARKETING_ASSET_ROOT = 'https://seemplifyai.com/images/product-showcases'

const DEFAULT_THEME = Object.freeze({
  background: '#0f0e13',
  surface: '#fffdfa',
  surfaceSoft: '#f5f2ec',
  accent: '#7047eb',
  accentSecondary: '#a982ff',
  heading: '#191816',
  text: '#4f4b45',
  muted: '#716b63',
  footer: '#18161f'
})

function createMarketingTemplate({
  name,
  slug,
  category = 'product_marketing',
  description,
  tags,
  subject = '',
  previewText = '',
  eyebrow,
  title,
  body,
  imageUrl,
  imageAlt,
  storyTitle,
  storyBody,
  detailImageUrl,
  detailImageAlt,
  detailCaption,
  featureTitle,
  featureBody = 'Start with the workflows your team needs today, then keep the same identity, context, and controls as you grow.',
  featureItems,
  ctaTitle = 'Try it with your team for seven days',
  ctaBody = 'Start a free seven-day trial. No long rollout and no commitment required.',
  secondaryLabel = 'Book a demo',
  secondaryUrl = DEMO_URL,
  quote = '',
  quoteAttribution = 'Built for modern people teams'
}) {
  const blocks = [
    {
      id: `${slug}-hero`,
      type: 'hero',
      eyebrow,
      title,
      body,
      imageUrl,
      imageAlt,
      ctaLabel: 'Start free 7-day trial',
      ctaUrl: TRIAL_URL,
      secondaryLabel,
      secondaryUrl
    },
    {
      id: `${slug}-opening`,
      type: 'text',
      title: storyTitle || `See how ${name} changes the working day`,
      body: storyBody || 'Bring the full journey into view, keep every handoff accountable, and give people a simpler next step.'
    }
  ]

  if (detailImageUrl) {
    blocks.push({
      id: `${slug}-product-view`,
      type: 'image',
      imageUrl: detailImageUrl,
      imageAlt: detailImageAlt || imageAlt,
      caption: detailCaption || `A closer look at the ${name} experience.`
    })
  }

  blocks.push({
    id: `${slug}-features`,
    type: 'features',
    title: featureTitle,
    body: featureBody,
    items: featureItems
  })

  if (quote) {
    blocks.push({
      id: `${slug}-quote`,
      type: 'quote',
      body: quote,
      attribution: quoteAttribution
    })
  }

  blocks.push(
    {
      id: `${slug}-cta`,
      type: 'cta',
      title: ctaTitle,
      body: ctaBody,
      ctaLabel: 'Start free 7-day trial',
      ctaUrl: TRIAL_URL
    },
    {
      id: `${slug}-footer`,
      type: 'footer',
      body: 'You are receiving this because your details were provided for Seemplify product updates. {{ unsubscribe }}'
    }
  )

  return {
    name,
    slug,
    category,
    description,
    tags,
    systemTemplate: true,
    designMode: 'visual',
    subject: subject || `{{ contact.FIRSTNAME }}, see what ${name} can do`,
    previewText: previewText || description,
    design: {
      version: 2,
      theme: { ...DEFAULT_THEME },
      motion: 'subtle',
      blocks
    }
  }
}

export const SYSTEM_CAMPAIGN_TEMPLATES = [
  createMarketingTemplate({
    name: 'Welcome to Seemplify',
    slug: 'welcome-to-seemplify',
    category: 'product_launch',
    description: 'Flagship platform overview for new prospects and customer re-introductions.',
    tags: ['welcome', 'platform', 'overview', 'free-trial'],
    eyebrow: 'Welcome to Seemplify',
    title: 'Every people workflow. One beautifully connected place.',
    body: 'Recruit, onboard, pay, support, develop, and understand your people without stitching together a maze of disconnected tools.',
    imageUrl: `${AUTH_ASSET_ROOT}/seemplify-platform-gloss.jpg`,
    imageAlt: 'A connected people-operations system bringing many workforce workflows together',
    storyTitle: 'One journey, from first hello to lasting growth',
    storyBody: 'A candidate becomes a colleague, their records and access arrive with them, and every later workflow shares the same identity and context. That is what connected people operations should feel like.',
    detailImageUrl: `${MARKETING_IMAGE_ROOT}/seemplify-people-journey-illustration.webp`,
    detailImageAlt: 'The Seemplify employee journey connecting recruitment, onboarding, payroll, learning, and growth',
    detailCaption: 'The full people journey stays connected instead of being rebuilt in every tool.',
    featureTitle: 'One operating system from first conversation to lasting growth',
    featureBody: 'Start with the problem that matters most now. Add more workflows without adding another identity silo or another brittle handoff.',
    featureItems: [
      'Recruiting, onboarding, employee records, and approvals',
      'Time, leave, payroll, learning, and performance',
      'Workspace, automations, AI assistance, and employee experience'
    ],
    quote: 'Less switching. Fewer handoffs. A clearer working day for everyone.'
  }),
  createMarketingTemplate({
    name: 'Core HR & Onboarding',
    slug: 'product-core-hr',
    description: 'Employee records, onboarding, documents, organization context, and lifecycle administration.',
    tags: ['core-hr', 'onboarding', 'employee-records', 'documents'],
    eyebrow: 'Seemplify Core HR',
    title: 'Give every employee one clear, trusted home from day one.',
    body: 'Move new starters from accepted offer to productive colleague with the right records, documents, tasks, access, and organization context already in place.',
    imageUrl: `${AUTH_ASSET_ROOT}/people-journey-gloss.jpg`,
    imageAlt: 'A connected employee journey from onboarding through learning and career growth',
    storyTitle: 'Onboarding should feel like a welcome—not a document chase',
    storyBody: 'Create one dependable employee record, coordinate every owner, and give the new starter a clear path through the work that makes their first days successful.',
    detailImageUrl: `${MARKETING_ASSET_ROOT}/core-hr-onboarding.png`,
    detailImageAlt: 'Seemplify Core HR onboarding workspace showing employee progress and assigned tasks',
    detailCaption: 'A real Seemplify onboarding journey with owners, progress, documents, and next steps in view.',
    featureTitle: 'The trusted foundation for every people workflow',
    featureBody: 'Keep the employee record accurate once, then let payroll, leave, performance, learning, and approvals use the same source of truth.',
    featureItems: [
      'Structured onboarding journeys with clear owners and progress',
      'Employee records, documents, teams, roles, and lifecycle changes',
      'One identity and organization context across the platform'
    ],
    quote: 'A strong first day begins before the employee has to ask where anything lives.'
  }),
  createMarketingTemplate({
    name: 'Recruiter',
    slug: 'product-recruiter',
    description: 'AI-assisted recruiting, candidate experience, interviews, and hiring operations.',
    tags: ['recruiting', 'talent', 'interviews', 'ai'],
    eyebrow: 'Seemplify Recruiter',
    title: 'Move from promising candidate to confident hire—without the admin drag.',
    body: 'Keep sourcing, applications, interviews, feedback, offers, and onboarding handoffs in one focused hiring workflow.',
    imageUrl: `${AUTH_ASSET_ROOT}/recruiter-workflow-gloss-v2.jpg`,
    imageAlt: 'A complete recruiting journey from role intake and screening through interview, decision, and onboarding',
    storyTitle: 'Every hiring decision keeps its context',
    storyBody: 'The role, candidate evidence, interview plan, scorecards, team feedback, and final decision travel together—so the next person in the process never starts from an empty inbox.',
    detailImageUrl: `${MARKETING_ASSET_ROOT}/recruiter-candidate-interview.png`,
    detailImageAlt: 'Seemplify Recruiter candidate interview workspace with structured role-aware questions',
    detailCaption: 'A real structured interview in Seemplify, keeping the conversation and evaluation together.',
    featureTitle: 'A hiring flow your whole team can follow',
    featureBody: 'Give recruiters speed, interviewers useful structure, and hiring managers a decision trail they can trust.',
    featureItems: [
      'Structured candidate pipelines and collaborative review',
      'AI-assisted interviews and role-aware evaluation',
      'A clean handoff from offer to onboarding'
    ]
  }),
  createMarketingTemplate({
    name: 'Payroll',
    slug: 'product-payroll',
    description: 'Payroll processing, compensation, approvals, payslips, and reporting.',
    tags: ['payroll', 'compensation', 'payslips', 'finance'],
    eyebrow: 'Seemplify Payroll',
    title: 'Run payroll with calm, confidence, and a complete audit trail.',
    body: 'Bring employee data, pay inputs, approvals, calculations, payslips, and reporting into one controlled payroll flow.',
    imageUrl: `${AUTH_ASSET_ROOT}/payroll-gloss.jpg`,
    imageAlt: 'A precise connected payroll operation represented in glass and metal',
    storyTitle: 'See every input before it becomes a payment',
    storyBody: 'Employee changes, approved time, leave, compensation, and payroll adjustments arrive in one reviewable run. Finance and HR can resolve exceptions before approval—not after payday.',
    detailImageUrl: `${MARKETING_ASSET_ROOT}/payroll.png`,
    detailImageAlt: 'Seemplify Payroll workspace showing payroll totals, employee entries, and run status',
    detailCaption: 'A real payroll run in Seemplify with totals, employee inputs, status, and review context visible.',
    featureTitle: 'From input to approved payroll, without spreadsheet chasing',
    featureBody: 'Keep preparation, review, approval, employee delivery, and reporting in one controlled flow with a dependable audit trail.',
    featureItems: [
      'Structured pay runs with review and approval checkpoints',
      'Clear employee payslips and compensation records',
      'Reliable payroll visibility for HR and finance'
    ],
    ctaTitle: 'See your next payroll run in Seemplify'
  }),
  createMarketingTemplate({
    name: 'Leave Management',
    slug: 'product-leave-management',
    description: 'Leave requests, balances, approvals, calendars, and policy visibility.',
    tags: ['leave', 'absence', 'approvals', 'calendar'],
    eyebrow: 'Seemplify Leave',
    title: 'Make time off easy to request, fair to approve, and simple to understand.',
    body: 'Give employees clear balances while managers get the context they need to approve confidently.',
    imageUrl: `${AUTH_ASSET_ROOT}/leave-planning-gloss-v2.jpg`,
    imageAlt: 'A leave journey showing request, entitlement balance, team coverage, manager review, and approval',
    storyTitle: 'A request is only simple when the context is already there',
    storyBody: 'Employees see what they can take. Managers see policy, entitlement, the team calendar, and coverage before deciding. Everyone can see what happens next.',
    detailImageUrl: `${MARKETING_ASSET_ROOT}/leave-management.png`,
    detailImageAlt: 'Seemplify Leave Management workspace showing balances, request status, and absence calendar',
    detailCaption: 'The live Seemplify leave experience puts balances, requests, and team context in one view.',
    featureTitle: 'Everyone sees the right answer at the right time',
    featureBody: 'Make the routine request genuinely self-service while keeping policy, coverage, approvals, and records dependable.',
    featureItems: [
      'Employee self-service requests and live balances',
      'Manager approvals with calendar and team context',
      'Consistent policy, entitlement, and audit records'
    ]
  }),
  createMarketingTemplate({
    name: 'Time & Attendance',
    slug: 'product-time-attendance',
    description: 'Clocking, shifts, timesheets, approvals, and attendance visibility.',
    tags: ['time', 'attendance', 'timesheets', 'shifts'],
    eyebrow: 'Seemplify Time & Attendance',
    title: 'Turn every working hour into a clear, approved record.',
    body: 'Help teams clock accurately, resolve exceptions quickly, and move approved time into payroll without rework.',
    imageUrl: `${AUTH_ASSET_ROOT}/time-attendance-gloss-v2.jpg`,
    imageAlt: 'A time and attendance journey from location-aware clock-in through roster, exception review, approval, and payroll handoff',
    storyTitle: 'From the first clock-in to a payroll-ready record',
    storyBody: 'Capture time where work happens, compare it with the planned shift, surface only the exceptions that need attention, and send approved hours forward without re-keying them.',
    detailImageUrl: `${MARKETING_ASSET_ROOT}/time-attendance.png`,
    detailImageAlt: 'Seemplify Time and Attendance workspace showing tracked hours, attendance status, and timesheet context',
    detailCaption: 'A real Seemplify attendance view for quickly understanding hours, status, and exceptions.',
    featureTitle: 'Accurate time without constant follow-up',
    featureBody: 'Give employees a clear record, managers a focused exception queue, and payroll a dependable approved input.',
    featureItems: [
      'Clock-in, location, shifts, and attendance exceptions',
      'Employee timesheets and manager approvals',
      'A dependable handoff from time to payroll'
    ]
  }),
  createMarketingTemplate({
    name: 'Performance Management',
    slug: 'product-performance',
    description: 'Goals, reviews, feedback, development, and performance cycles.',
    tags: ['performance', 'goals', 'reviews', 'feedback'],
    eyebrow: 'Seemplify Performance',
    title: 'Make goals visible, feedback useful, and growth part of the work.',
    body: 'Run fair, structured performance cycles without losing the everyday conversations that help people improve.',
    imageUrl: `${AUTH_ASSET_ROOT}/performance-growth-gloss-v2.jpg`,
    imageAlt: 'A performance journey showing aligned goals, manager check-in, continuous feedback, calibration, and career progression',
    storyTitle: 'Performance becomes useful between review cycles',
    storyBody: 'Goals give the work direction, regular check-ins keep progress honest, and feedback becomes evidence for a fair review and a practical development plan.',
    detailImageUrl: `${MARKETING_ASSET_ROOT}/performance-goal-setting-wide.png`,
    detailImageAlt: 'Seemplify Performance goal-setting workspace showing aligned objectives, measures, owners, and progress',
    detailCaption: 'A real goal in Seemplify connects the objective, measures, ownership, and progress in one place.',
    featureTitle: 'A complete performance story—not a once-a-year form',
    featureBody: 'Connect the everyday evidence to the structured cycle so employees understand expectations and managers make fairer decisions.',
    featureItems: [
      'Aligned goals and visible progress',
      'Continuous feedback and structured review cycles',
      'Development actions that connect to learning'
    ]
  }),
  createMarketingTemplate({
    name: 'Learning',
    slug: 'product-learning',
    description: 'Internal learning, courses, certifications, and staff development.',
    tags: ['learning', 'courses', 'skills', 'certification'],
    eyebrow: 'Seemplify Learning',
    title: 'Give every employee a clear path to learn, practise, and progress.',
    body: 'Create role-relevant learning journeys, track participation, and connect development to the rest of the employee experience.',
    imageUrl: `${AUTH_ASSET_ROOT}/learning-growth-gloss-v2.jpg`,
    imageAlt: 'A learning journey from role profile through course library, cohort learning, practice, certification, and career progression',
    storyTitle: 'Make development visible all the way to capability',
    storyBody: 'Start with what the role needs, assign the right learning, combine guided teaching with practice, and preserve evidence of completion for the next performance and career conversation.',
    detailImageUrl: `${MARKETING_ASSET_ROOT}/learning-lesson.png`,
    detailImageAlt: 'Seemplify Learning lesson experience with course content, progress, and navigation',
    detailCaption: 'A real Seemplify lesson gives employees a focused route through content, activity, and progress.',
    featureTitle: 'Learning that belongs inside the employee journey',
    featureBody: 'Build structured programs without separating learning evidence from the employee, their role, or their development goals.',
    featureItems: [
      'Courses, cohorts, assignments, and certifications',
      'Role-aware learning paths and visible progress',
      'Development evidence that supports performance conversations'
    ]
  }),
  createMarketingTemplate({
    name: 'Workspace',
    slug: 'product-workspace',
    description: 'Messages, boards, notes, pages, meetings, and AI in one team workspace.',
    tags: ['workspace', 'collaboration', 'messages', 'meetings'],
    eyebrow: 'Seemplify Workspace',
    title: 'Keep conversations, decisions, pages, and work moving together.',
    body: 'Bring the daily coordination layer closer to the people data and workflows your team already relies on.',
    imageUrl: `${AUTH_ASSET_ROOT}/workspace-collaboration-gloss-v2.jpg`,
    imageAlt: 'One team workspace combining messages, shared pages, meetings, assigned work, and contextual assistance',
    storyTitle: 'Keep the conversation beside the decision it creates',
    storyBody: 'A message can become a page, a meeting can end with owned actions, and contextual assistance can help without losing the people, decisions, or source material around the work.',
    detailImageUrl: `${MARKETING_IMAGE_ROOT}/seemplify-distributed-work-illustration.webp`,
    detailImageAlt: 'A distributed team collaborating across shared digital work and communication',
    detailCaption: 'Workspace is designed for the real mix of focused, remote, live, and asynchronous work.',
    featureTitle: 'One connected place for the work around the work',
    featureBody: 'Reduce the distance between conversation and action while keeping everyday collaboration connected to the people operation.',
    featureItems: [
      'Messages, channels, pages, notes, boards, and meetings',
      'AI assistance with the right workspace context',
      'Fewer jumps between conversation and action'
    ]
  }),
  createMarketingTemplate({
    name: 'Automations',
    slug: 'product-automations',
    description: 'Governed workflows across Seemplify and connected external tools.',
    tags: ['automation', 'workflow', 'integrations', 'operations'],
    eyebrow: 'Seemplify Automations',
    title: 'Let routine work move itself—without giving up control.',
    body: 'Connect triggers, decisions, approvals, notifications, and external tools in workflows your team can understand and govern.',
    imageUrl: `${AUTH_ASSET_ROOT}/automations-governed-flow-gloss-v2.jpg`,
    imageAlt: 'A governed automation from business trigger through decision branch, human approval, action, notification, and recovered exception',
    storyTitle: 'Automate the routine. Make the judgement visible.',
    storyBody: 'Every run follows a readable path: the trigger arrives, conditions route it, a person steps in where judgement matters, actions execute, and exceptions retain a safe recovery route.',
    detailImageUrl: `${AUTH_ASSET_ROOT}/seemplify-platform-gloss.jpg`,
    detailImageAlt: 'Seemplify products connected through one shared operating layer',
    detailCaption: 'Automations can carry context across Seemplify instead of recreating brittle integrations between isolated tools.',
    featureTitle: 'Automation designed for real operational accountability',
    featureBody: 'Move work faster without hiding ownership, granting uncontrolled access, or turning failures into a detective exercise.',
    featureItems: [
      'Human approvals where judgement matters',
      'Reliable triggers and actions across Seemplify',
      'Clear run history, ownership, and recovery paths'
    ]
  }),
  createMarketingTemplate({
    name: 'Experience Management',
    slug: 'product-experience-management',
    description: 'Research, listening, surveys, journeys, insights, and action.',
    tags: ['experience', 'surveys', 'research', 'insights'],
    eyebrow: 'Seemplify Experience',
    title: 'Turn what people tell you into evidence, action, and visible change.',
    body: 'Listen across key moments, understand the journey, and help teams close the loop instead of collecting feedback that goes nowhere.',
    imageUrl: `${AUTH_ASSET_ROOT}/experience-listening-gloss-v2.jpg`,
    imageAlt: 'A closed feedback loop from surveys and conversations through theme synthesis, owned action, and visible improvement',
    storyTitle: 'Listening only matters when someone owns what happens next',
    storyBody: 'Bring surveys, conversations, journey evidence, and research together; find the meaningful themes; assign the work; and show participants that their feedback changed something.',
    detailImageUrl: `${MARKETING_ASSET_ROOT}/experience-management.png`,
    detailImageAlt: 'Seemplify Experience Management workspace showing listening evidence, journeys, themes, and action status',
    detailCaption: 'The live Seemplify Experience workspace connects evidence, insight, and accountable action.',
    featureTitle: 'From listening to coordinated action',
    featureBody: 'Replace isolated survey scores with an evidence trail that helps teams understand moments, decide priorities, and close the loop.',
    featureItems: [
      'Surveys, research, journeys, and evidence in one place',
      'Clear themes and accountable follow-up actions',
      'Experience insight connected to the wider people operation'
    ]
  }),
  createMarketingTemplate({
    name: 'Approver',
    slug: 'product-approver',
    description: 'Govern AI initiatives, policies, reviews, risks, and executive approvals.',
    tags: ['governance', 'approvals', 'ai', 'risk'],
    eyebrow: 'Seemplify Approver',
    title: 'Move important decisions forward with evidence, ownership, and control.',
    body: 'Give AI initiatives and high-stakes approvals a structured path from proposal to review, decision, and audit trail.',
    imageUrl: `${AUTH_ASSET_ROOT}/approver-governance-gloss-v2.jpg`,
    imageAlt: 'A governed decision journey separating evidence, policy, financial impact, and risk before expert review and authorized approval',
    storyTitle: 'Make the basis of the decision as clear as the decision itself',
    storyBody: 'The proposal, evidence, policy fit, impact, risk, expert views, and final authority sit inside one review path—creating momentum without sacrificing scrutiny.',
    detailImageUrl: `${MARKETING_IMAGE_ROOT}/leaders-reviewing.png`,
    detailImageAlt: 'Leaders reviewing evidence together before making a high-stakes decision',
    detailCaption: 'Approver gives expert reviewers and accountable decision owners one shared evidence space.',
    featureTitle: 'Governance that helps good work move',
    featureBody: 'Give teams a repeatable route through complex decisions and preserve the complete record required for accountability.',
    featureItems: [
      'Structured submissions, reviews, and decision authority',
      'Policy, evidence, risk, and approval history together',
      'Clear accountability without email-chain confusion'
    ]
  }),
  createMarketingTemplate({
    name: 'AI Assistant & Knowledge',
    slug: 'product-ai-knowledge',
    description: 'Context-aware AI assistance and shared organizational knowledge.',
    tags: ['ai', 'knowledge', 'assistant', 'documents'],
    eyebrow: 'Seemplify AI & Knowledge',
    title: 'Give teams faster answers without losing the context behind them.',
    body: 'Bring AI assistance and shared knowledge closer to daily workflows, with access that follows the organization and the user.',
    imageUrl: `${AUTH_ASSET_ROOT}/ai-knowledge-gloss-v2.jpg`,
    imageAlt: 'A trusted knowledge journey from curated sources and identity-aware access through relevant evidence to a grounded answer and completed action',
    storyTitle: 'An answer is only useful when you can trust where it came from',
    storyBody: 'Seemplify respects the user and organization context, retrieves the sources they are allowed to use, keeps the evidence visible, and helps them take the next practical action.',
    detailImageUrl: `${MARKETING_IMAGE_ROOT}/seemplify-people-operations-hero.png`,
    detailImageAlt: 'The Seemplify people operations platform bringing trusted information and work into one connected environment',
    detailCaption: 'Assistance is most useful when it lives beside the trusted people data, policies, and workflows it supports.',
    featureTitle: 'Useful assistance grounded in how your organization works',
    featureBody: 'Help people move faster without flattening permissions, losing source context, or creating a second disconnected knowledge silo.',
    featureItems: [
      'A shared assistant entry point across the platform',
      'Team documentation and institutional knowledge',
      'Identity-aware access and consistent organization context'
    ]
  }),
  createMarketingTemplate({
    name: 'Community',
    slug: 'product-community',
    description: 'Public conversations, communities, articles, events, and connections.',
    tags: ['community', 'events', 'articles', 'connections'],
    eyebrow: 'Seemplify Community',
    title: 'Create a place where people can share, learn, and stay connected.',
    body: 'Bring conversations, articles, events, and professional connections into a community experience linked to the wider platform.',
    imageUrl: `${AUTH_ASSET_ROOT}/community-connection-gloss-v2.jpg`,
    imageAlt: 'A professional community connecting thoughtful conversations, publishing, live events, learning meetups, relationships, and daily team work',
    storyTitle: 'Build belonging around something people can actually do together',
    storyBody: 'Members can join useful conversations, publish what they know, meet around events and learning, form professional connections, and carry the best ideas back into their work.',
    detailImageUrl: `${MARKETING_IMAGE_ROOT}/seemplify-team-culture.png`,
    detailImageAlt: 'A diverse team learning and connecting in a welcoming Seemplify community environment',
    detailCaption: 'Community is designed to turn participation into relationships, learning, and a stronger working culture.',
    featureTitle: 'Community with a real place in the people journey',
    featureBody: 'Give public participation and professional connection a meaningful bridge into learning, development, and the daily work experience.',
    featureItems: [
      'Conversations, articles, events, and connections',
      'A welcoming public experience with protected identity',
      'A bridge between learning, work, and professional growth'
    ]
  }),
  createMarketingTemplate({
    name: 'Nurture Sequence',
    slug: 'nurture-sequence',
    category: 'nurture',
    description: 'A polished mid-funnel message for people and operations leaders.',
    tags: ['nurture', 'mid-funnel', 'people-ops'],
    eyebrow: 'A simpler operating day',
    title: 'You do not need five disconnected tools to run one people operation.',
    body: 'Seemplify brings the handoffs between hiring, employee admin, approvals, payroll, learning, and performance into one dependable platform.',
    imageUrl: `${AUTH_ASSET_ROOT}/seemplify-platform-gloss.jpg`,
    imageAlt: 'Connected people operations brought into one system',
    storyTitle: 'The real cost lives between the tools',
    storyBody: 'Repeated data entry, incomplete context, approval chasing, access mismatches, and manual reporting are symptoms of disconnected handoffs. Seemplify makes those handoffs part of the product.',
    detailImageUrl: `${MARKETING_IMAGE_ROOT}/seemplify-people-operations-hero.png`,
    detailImageAlt: 'Seemplify connecting the everyday people operation across one platform',
    detailCaption: 'One operating layer keeps identity, employee context, and next actions connected across the journey.',
    featureTitle: 'What changes when the operating layer is connected',
    featureBody: 'The benefit is not another isolated feature. It is the admin that disappears when one workflow already understands the last one.',
    featureItems: [
      'Less manual follow-up and spreadsheet work',
      'Cleaner handoffs between teams and systems',
      'Better visibility without another reporting project'
    ]
  }),
  createMarketingTemplate({
    name: 'Demo Invitation',
    slug: 'demo-invite',
    category: 'demo_webinar',
    description: 'Invitation for demos, webinars, and guided product walkthroughs.',
    tags: ['demo', 'webinar', 'invite'],
    eyebrow: 'See Seemplify in action',
    title: 'Bring one real people workflow. We will show you the simpler version.',
    body: 'Join a focused walkthrough of the parts that matter to your team, from recruiting and onboarding to payroll, performance, or employee experience.',
    imageUrl: `${AUTH_ASSET_ROOT}/people-journey-gloss.jpg`,
    imageAlt: 'A guided journey across connected people workflows',
    storyTitle: 'Bring the workflow that causes the most friction',
    storyBody: 'We will follow the real people, decisions, approvals, and handoffs involved—then show how the same journey works when identity, context, and ownership stay connected.',
    detailImageUrl: `${MARKETING_ASSET_ROOT}/recruiter-ai-interview-setup.png`,
    detailImageAlt: 'A Seemplify guided workflow configuring a structured AI-assisted interview',
    detailCaption: 'The walkthrough uses real Seemplify workflows and screens, shaped around the scenario your team wants to validate.',
    featureTitle: 'A practical walkthrough, shaped around your priorities',
    featureBody: 'Skip the generic feature tour. Focus the session on the workflow, integration, controls, and outcome your team needs to understand.',
    featureItems: [
      'Choose the workflows you want to validate',
      'See the handoffs between products, not isolated demos',
      'Leave with a clear seven-day trial path'
    ],
    ctaTitle: 'Choose a walkthrough—or explore it yourself',
    secondaryLabel: 'Book your walkthrough'
  }),
  createMarketingTemplate({
    name: 'Product Update',
    slug: 'newsletter-update',
    category: 'newsletter_update',
    description: 'Platform news, feature launches, and customer update template.',
    tags: ['newsletter', 'update', 'product'],
    eyebrow: 'What is new in Seemplify',
    title: 'Fresh improvements for a clearer, faster people operation.',
    body: 'Share product updates with enough context to understand the change, see the value, and try the improved workflow.',
    imageUrl: `${AUTH_ASSET_ROOT}/seemplify-platform-gloss.jpg`,
    imageAlt: 'A connected people platform with new paths and capabilities',
    storyTitle: 'Show the change in the context of the work',
    storyBody: 'Explain the moment that improved, show the real experience, make the benefit concrete, and give the reader one direct next step to try it.',
    detailImageUrl: `${MARKETING_ASSET_ROOT}/experience-survey-builder.png`,
    detailImageAlt: 'A detailed Seemplify product screen demonstrating an improved survey-building workflow',
    detailCaption: 'Use a real product view so customers can recognize what changed before they open the app.',
    featureTitle: 'Designed to make the next action obvious',
    featureBody: 'A strong product update connects the new capability to the customer problem, shows the interface, and makes adoption feel low effort.',
    featureItems: [
      'Clear feature summaries in plain language',
      'Real product imagery and practical examples',
      'A direct path to try the update for seven days'
    ]
  })
]

export function getSystemCampaignTemplates() {
  return SYSTEM_CAMPAIGN_TEMPLATES.map((template) => JSON.parse(JSON.stringify(template)))
}

export function getSystemCampaignTemplate(slug) {
  const match = SYSTEM_CAMPAIGN_TEMPLATES.find((template) => template.slug === slug)
  return match ? JSON.parse(JSON.stringify(match)) : null
}
