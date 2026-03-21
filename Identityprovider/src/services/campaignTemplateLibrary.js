function createTemplate({
  name,
  slug,
  category,
  description,
  tags,
  eyebrow,
  title,
  body,
  featureTitle,
  featureItems,
  ctaTitle,
  ctaBody
}) {
  return {
    name,
    slug,
    category,
    description,
    tags,
    systemTemplate: true,
    designMode: 'visual',
    previewText: 'Run simple, run smart with Seemplify.',
    design: {
      version: 1,
      theme: {
        background: '#f4f1ff',
        surface: '#ffffff',
        accent: '#6d28d9',
      accentSecondary: '#a855f7',
        heading: '#1f1637',
        text: '#3f3656',
        muted: '#6d6485',
        footer: '#221934'
      },
      blocks: [
        {
          id: `${slug}-hero`,
          type: 'hero',
          eyebrow,
          title,
          body,
          ctaLabel: 'Start free trial',
          ctaUrl: 'https://auth.seemplifyai.com/signup',
          secondaryLabel: 'Book a demo',
          secondaryUrl: 'https://auth.seemplifyai.com/book-demo'
        },
        {
          id: `${slug}-opening`,
          type: 'text',
          title: 'Why teams switch',
          body: '{{ contact.CUSTOM_OPENING }}'
        },
        {
          id: `${slug}-features`,
          type: 'features',
          title: featureTitle,
          body: '{{ contact.CUSTOM_BENEFITS }}',
          items: featureItems
        },
        {
          id: `${slug}-cta`,
          type: 'cta',
          title: ctaTitle,
          body: ctaBody,
          ctaLabel: 'Start free trial',
          ctaUrl: 'https://auth.seemplifyai.com/signup'
        },
        {
          id: `${slug}-footer`,
          type: 'footer',
          body: 'You are receiving this email because your details were shared for Seemplify product updates. {{ unsubscribe }}'
        }
      ]
    }
  }
}

export const SYSTEM_CAMPAIGN_TEMPLATES = [
  createTemplate({
    name: 'Product Launch',
    slug: 'product-launch',
    category: 'product_launch',
    description: 'Product announcement template for platform launches and major releases.',
    tags: ['launch', 'announcement', 'product'],
    eyebrow: 'Seemplify Launch',
    title: 'One platform for recruiting, onboarding, approvals, payroll, and performance.',
    body: 'Replace fragmented HR operations with one operating system your team can actually run every day.',
    featureTitle: 'Built for teams that want fewer handoffs and clearer operations',
    featureItems: [
      'Recruiting and onboarding in one handoff',
      'Payroll, approvals, and employee records in one place',
      'Faster visibility for HR and operations leads'
    ],
    ctaTitle: 'Ready to see it in your workflow?',
    ctaBody: 'Start a free trial and see how Seemplify reduces admin drag across your HR stack.'
  }),
  createTemplate({
    name: 'Nurture Sequence',
    slug: 'nurture-sequence',
    category: 'nurture',
    description: 'Mid-funnel nurture email for HR and people operations buyers.',
    tags: ['nurture', 'mid-funnel', 'people-ops'],
    eyebrow: 'Seemplify Workflow',
    title: 'Simplify people operations without stitching together five different tools.',
    body: 'Seemplify helps HR teams move from scattered approvals and manual admin to one dependable operating system.',
    featureTitle: 'What this changes for your team',
    featureItems: [
      'Cleaner recruiting to onboarding handoff',
      'Less manual follow-up and spreadsheet work',
      'Real-time visibility across approvals and employee admin'
    ],
    ctaTitle: 'Try the full workflow',
    ctaBody: 'Start a free trial to see how Seemplify consolidates the operational layer of HR.'
  }),
  createTemplate({
    name: 'Demo Invite',
    slug: 'demo-invite',
    category: 'demo_webinar',
    description: 'Invitation template for demos, webinars, and guided walkthroughs.',
    tags: ['demo', 'webinar', 'invite'],
    eyebrow: 'Seemplify Demo',
    title: 'See how Seemplify runs hiring, onboarding, and operations from one command layer.',
    body: 'If your team is losing time across manual approvals, disconnected records, and slow coordination, this is for you.',
    featureTitle: 'What teams usually want to validate first',
    featureItems: [
      'End-to-end hiring and onboarding flow',
      'Operational control for approvals and records',
      'Visibility for leaders without extra admin work'
    ],
    ctaTitle: 'Start with a free trial or book a walkthrough',
    ctaBody: 'Start a free trial now, or reply to this email if you want a guided walkthrough with the Seemplify team.'
  }),
  createTemplate({
    name: 'Newsletter Update',
    slug: 'newsletter-update',
    category: 'newsletter_update',
    description: 'General update template for newsletters and product updates.',
    tags: ['newsletter', 'update', 'product'],
    eyebrow: 'Seemplify Update',
    title: 'Keep your HR operation clear, fast, and audit-ready.',
    body: 'Seemplify helps teams stay ahead of hiring, employee admin, approvals, and performance without layering new complexity on top.',
    featureTitle: 'What teams get out of the box',
    featureItems: [
      'Structured workflows for daily HR operations',
      'Shared visibility across managers, HR, and operations',
      'A cleaner system for growth without adding admin debt'
    ],
    ctaTitle: 'Want to test it with your own process?',
    ctaBody: 'Start a free trial and adapt Seemplify to the way your team already works.'
  })
]

export function getSystemCampaignTemplates() {
  return SYSTEM_CAMPAIGN_TEMPLATES.map((template) => JSON.parse(JSON.stringify(template)))
}

export function getSystemCampaignTemplate(slug) {
  const match = SYSTEM_CAMPAIGN_TEMPLATES.find((template) => template.slug === slug)
  return match ? JSON.parse(JSON.stringify(match)) : null
}
