const TRIAL_URL = 'https://auth.seemplifyai.com/signup'
const DEMO_URL = 'https://auth.seemplifyai.com/book-demo'
const AUTH_ASSET_ROOT = 'https://auth.seemplifyai.com/images/campaigns'
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
  featureTitle,
  featureItems,
  ctaTitle = 'Try it with your team for seven days',
  ctaBody = 'Start a free seven-day trial. No long rollout and no commitment required.',
  secondaryLabel = 'Book a demo',
  secondaryUrl = DEMO_URL,
  quote = ''
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
      title: 'A better way to run the work',
      body: 'Bring the work around your people into one connected place, with clearer handoffs and less repeated admin.'
    },
    {
      id: `${slug}-features`,
      type: 'features',
      title: featureTitle,
      body: 'Start with the workflows your team needs today, then keep the same identity, context, and controls as you grow.',
      items: featureItems
    }
  ]

  if (quote) {
    blocks.push({
      id: `${slug}-quote`,
      type: 'quote',
      body: quote,
      attribution: 'Built for modern people teams'
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
    featureTitle: 'One operating system from first conversation to lasting growth',
    featureItems: [
      'Recruiting, onboarding, employee records, and approvals',
      'Time, leave, payroll, learning, and performance',
      'Workspace, automations, AI assistance, and employee experience'
    ],
    quote: 'Less switching. Fewer handoffs. A clearer working day for everyone.'
  }),
  createMarketingTemplate({
    name: 'Recruiter',
    slug: 'product-recruiter',
    description: 'AI-assisted recruiting, candidate experience, interviews, and hiring operations.',
    tags: ['recruiting', 'talent', 'interviews', 'ai'],
    eyebrow: 'Seemplify Recruiter',
    title: 'Move from promising candidate to confident hire—without the admin drag.',
    body: 'Keep sourcing, applications, interviews, feedback, offers, and onboarding handoffs in one focused hiring workflow.',
    imageUrl: `${MARKETING_ASSET_ROOT}/recruiter.png`,
    imageAlt: 'Seemplify Recruiter candidate pipeline',
    featureTitle: 'A hiring flow your whole team can follow',
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
    featureTitle: 'From input to approved payroll, without spreadsheet chasing',
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
    imageUrl: `${MARKETING_ASSET_ROOT}/leave-management.png`,
    imageAlt: 'Seemplify Leave Management request and approval screen',
    featureTitle: 'Everyone sees the right answer at the right time',
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
    imageUrl: `${MARKETING_ASSET_ROOT}/time-attendance.png`,
    imageAlt: 'Seemplify Time and Attendance dashboard',
    featureTitle: 'Accurate time without constant follow-up',
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
    imageUrl: `${AUTH_ASSET_ROOT}/people-journey-gloss.jpg`,
    imageAlt: 'A connected career journey from joining to learning and growth',
    featureTitle: 'A complete performance story—not a once-a-year form',
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
    imageUrl: `${MARKETING_ASSET_ROOT}/learning.png`,
    imageAlt: 'Seemplify Learning course library',
    featureTitle: 'Learning that belongs inside the employee journey',
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
    imageUrl: `${AUTH_ASSET_ROOT}/seemplify-platform-gloss.jpg`,
    imageAlt: 'Connected workspaces and people workflows',
    featureTitle: 'One connected place for the work around the work',
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
    imageUrl: `${AUTH_ASSET_ROOT}/seemplify-platform-gloss.jpg`,
    imageAlt: 'A connected operating system with automated paths between teams',
    featureTitle: 'Automation designed for real operational accountability',
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
    imageUrl: `${MARKETING_ASSET_ROOT}/experience-management.png`,
    imageAlt: 'Seemplify Experience Management insights workspace',
    featureTitle: 'From listening to coordinated action',
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
    imageUrl: `${AUTH_ASSET_ROOT}/seemplify-platform-gloss.jpg`,
    imageAlt: 'Connected approval stages around a central operating system',
    featureTitle: 'Governance that helps good work move',
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
    imageUrl: `${AUTH_ASSET_ROOT}/seemplify-platform-gloss.jpg`,
    imageAlt: 'People and connected knowledge spaces around one platform',
    featureTitle: 'Useful assistance grounded in how your organization works',
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
    imageUrl: `${AUTH_ASSET_ROOT}/people-journey-gloss.jpg`,
    imageAlt: 'A connected journey of people meeting, learning, and growing',
    featureTitle: 'Community with a real place in the people journey',
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
    featureTitle: 'What changes when the operating layer is connected',
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
    featureTitle: 'A practical walkthrough, shaped around your priorities',
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
    featureTitle: 'Designed to make the next action obvious',
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
