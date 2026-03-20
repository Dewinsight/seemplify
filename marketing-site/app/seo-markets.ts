export type SeoFaq = {
  question: string
  answer: string
}

export type SeoMarket = {
  slug: string
  country: string
  headline: string
  description: string
  intro: string
  cities: string[]
  industries: string[]
  highlights: string[]
  faqs: SeoFaq[]
}

export const broaderEnglishSpeakingAfricanCountries = [
  'Nigeria',
  'Ghana',
  'Kenya',
  'South Africa',
  'Uganda',
  'Tanzania',
  'Rwanda',
  'Zambia',
  'Zimbabwe',
  'Botswana',
  'Namibia',
  'Malawi',
  'Liberia',
  'Sierra Leone',
  'The Gambia',
  'Mauritius',
] as const

export const primaryMarkets: SeoMarket[] = [
  {
    slug: 'nigeria',
    country: 'Nigeria',
    headline: 'HR software for Nigeria',
    description:
      'Manage recruiting, onboarding, leave, performance, employee records, and HR workflows for teams in Lagos, Abuja, Port Harcourt, and across Nigeria.',
    intro:
      'Seemplify gives Nigerian HR teams one operating system for hiring, approvals, employee records, and performance management across multiple branches and remote teams.',
    cities: ['Lagos', 'Abuja', 'Port Harcourt'],
    industries: ['Fintech', 'Professional services', 'Healthcare', 'Logistics'],
    highlights: [
      'Replace spreadsheets and scattered chats with one HR command center for your Nigerian workforce.',
      'Standardize approvals, onboarding, and people operations across headquarters, branches, and distributed teams.',
      'Give leaders shared visibility into recruiting pipelines, leave requests, performance cycles, and employee activity.',
    ],
    faqs: [
      {
        question: 'Is Seemplify suitable for fast-growing teams in Nigeria?',
        answer:
          'Yes. Seemplify is designed for companies that need a more structured HR operating model than spreadsheets can provide, without slowing down hiring or internal approvals.',
      },
      {
        question: 'Can Nigerian teams use Seemplify across multiple offices?',
        answer:
          'Yes. Teams can manage people operations across Lagos, Abuja, Port Harcourt, and remote locations with shared workflows, records, and audit trails.',
      },
      {
        question: 'What HR workflows can Seemplify help automate in Nigeria?',
        answer:
          'Common workflows include recruiting coordination, digital onboarding, leave approvals, performance reviews, employee record management, and operational reporting.',
      },
    ],
  },
  {
    slug: 'ghana',
    country: 'Ghana',
    headline: 'HR software for Ghana',
    description:
      'Centralize hiring, onboarding, leave, performance, and employee operations for teams in Accra, Kumasi, Takoradi, and across Ghana.',
    intro:
      'Seemplify helps HR leaders in Ghana move faster with configurable workflows, cleaner employee data, and better visibility into every stage of the employee lifecycle.',
    cities: ['Accra', 'Kumasi', 'Takoradi'],
    industries: ['Financial services', 'Education', 'Retail', 'Professional services'],
    highlights: [
      'Run HR processes in one place instead of splitting work across email, spreadsheets, and separate tools.',
      'Give managers and HR teams in Ghana a shared workflow for hiring, approvals, employee updates, and performance tracking.',
      'Create a more consistent employee experience from offer stage to onboarding, reviews, and retention planning.',
    ],
    faqs: [
      {
        question: 'Why use dedicated HR software in Ghana instead of manual processes?',
        answer:
          'Dedicated HR software reduces delays, improves record accuracy, and gives teams a repeatable process for recruiting, onboarding, leave, and performance management.',
      },
      {
        question: 'Can Seemplify support Ghana-based companies with distributed teams?',
        answer:
          'Yes. Seemplify works well for organizations operating across Accra and other regions that need shared visibility and auditable HR workflows.',
      },
      {
        question: 'Does Seemplify help with employee lifecycle management in Ghana?',
        answer:
          'Yes. The platform supports the full employee lifecycle, including hiring, onboarding, performance, employee data management, and internal HR operations.',
      },
    ],
  },
  {
    slug: 'kenya',
    country: 'Kenya',
    headline: 'HR software for Kenya',
    description:
      'Streamline recruitment, onboarding, leave, performance, and people operations for teams in Nairobi, Mombasa, Kisumu, and across Kenya.',
    intro:
      'Seemplify gives Kenyan companies a unified HR platform for coordinating recruiting, employee administration, approvals, and performance management at scale.',
    cities: ['Nairobi', 'Mombasa', 'Kisumu'],
    industries: ['Technology', 'NGOs', 'Healthcare', 'Business services'],
    highlights: [
      'Keep hiring and onboarding organized as teams scale across offices, business units, and remote workers.',
      'Use workflow automation to reduce HR turnaround time while keeping every action visible and auditable.',
      'Give leaders in Kenya a single view of their people operations instead of fragmented spreadsheets and manual follow-up.',
    ],
    faqs: [
      {
        question: 'Is Seemplify a good fit for growing companies in Kenya?',
        answer:
          'Yes. Seemplify is a strong fit for Kenyan companies that want to professionalize people operations without adding unnecessary process friction.',
      },
      {
        question: 'Can Seemplify help HR teams in Nairobi and across Kenya collaborate better?',
        answer:
          'Yes. The platform helps central HR teams, department heads, and managers work from the same workflow and employee data layer.',
      },
      {
        question: 'What can Kenyan HR teams manage inside Seemplify?',
        answer:
          'Teams can manage recruiting workflows, digital onboarding, employee records, leave approvals, performance cycles, and operational reporting.',
      },
    ],
  },
  {
    slug: 'south-africa',
    country: 'South Africa',
    headline: 'HR software for South Africa',
    description:
      'Unify recruiting, onboarding, leave, performance, and employee operations for teams in Johannesburg, Cape Town, Durban, and across South Africa.',
    intro:
      'Seemplify helps South African organizations run more consistent people operations with shared workflows, better visibility, and faster decision-making across teams.',
    cities: ['Johannesburg', 'Cape Town', 'Durban'],
    industries: ['Professional services', 'Retail', 'Manufacturing', 'Technology'],
    highlights: [
      'Bring HR, managers, and leadership into one operating surface for hiring, onboarding, employee updates, and performance management.',
      'Improve speed and control with workflow automation that keeps approvals, policy steps, and records in sync.',
      'Support multi-office and hybrid teams in South Africa with centralized people operations and clear accountability.',
    ],
    faqs: [
      {
        question: 'Can Seemplify support multi-location teams in South Africa?',
        answer:
          'Yes. Seemplify is well suited to organizations that need shared HR workflows across Johannesburg, Cape Town, Durban, and hybrid teams.',
      },
      {
        question: 'What HR processes can South African companies centralize in Seemplify?',
        answer:
          'Companies can centralize hiring coordination, onboarding, employee records, leave workflows, performance management, and HR reporting.',
      },
      {
        question: 'Who is Seemplify for in South Africa?',
        answer:
          'Seemplify is built for growth-stage companies, established businesses, and regional teams that want a more modern HR operating model.',
      },
    ],
  },
]

export const localizedMarkets: SeoMarket[] = [
  ...primaryMarkets,
  {
    slug: 'united-kingdom',
    country: 'United Kingdom',
    headline: 'HR software for the United Kingdom',
    description:
      'Support recruiting, onboarding, leave, performance, employee records, and HR operations for teams in London, Manchester, Birmingham, and across the United Kingdom.',
    intro:
      'Seemplify helps UK teams run structured people operations with cleaner workflows, clearer visibility, and one operating system for hiring, approvals, employee administration, and performance.',
    cities: ['London', 'Manchester', 'Birmingham'],
    industries: ['Technology', 'Professional services', 'Healthcare', 'Education'],
    highlights: [
      'Unify HR workflows across offices, hybrid teams, and fast-growing departments in the UK.',
      'Give managers and HR teams one system for approvals, onboarding, employee records, and performance management.',
      'Replace fragmented tools with a more consistent operating model for people operations.',
    ],
    faqs: [
      {
        question: 'Is Seemplify suitable for UK-based teams?',
        answer:
          'Yes. Seemplify is a strong fit for UK teams that want more structure and visibility across recruiting, onboarding, employee operations, and performance workflows.',
      },
      {
        question: 'Can Seemplify support hybrid and multi-office teams in the UK?',
        answer:
          'Yes. Seemplify helps HR teams coordinate workflows across London, Manchester, Birmingham, and distributed teams using one shared operating layer.',
      },
      {
        question: 'What HR processes can teams in the UK manage in Seemplify?',
        answer:
          'Teams can manage recruiting coordination, onboarding, employee records, leave approvals, performance cycles, and operational reporting in one platform.',
      },
    ],
  },
]

export const homeFaqs: SeoFaq[] = [
  {
    question: 'Does Seemplify support HR teams in Nigeria, Ghana, Kenya, and South Africa?',
    answer:
      'Yes. Seemplify is positioned for teams across Nigeria, Ghana, Kenya, South Africa, and other English-speaking African markets that need one platform for recruiting, onboarding, leave, performance, and people operations.',
  },
  {
    question: 'What type of companies is Seemplify built for in Africa?',
    answer:
      'Seemplify is built for startups, scale-ups, mid-market teams, and enterprise HR departments that want to replace fragmented HR operations with a more structured, auditable platform.',
  },
  {
    question: 'Can Seemplify help multi-country teams in English-speaking Africa?',
    answer:
      'Yes. Seemplify is designed to help HR leaders manage people operations across multiple African markets with shared workflows, cleaner data, and stronger process control.',
  },
  {
    question: 'Which HR workflows can Seemplify improve first?',
    answer:
      'Most teams start with recruiting coordination, onboarding, leave management, employee records, performance reviews, and approval workflows, then expand from there.',
  },
]

export const africaFaqs: SeoFaq[] = [
  {
    question: 'How does Seemplify support teams across multiple African markets?',
    answer:
      'Seemplify gives regional teams one platform for recruiting, onboarding, employee operations, leave, performance management, and internal coordination across multiple African markets.',
  },
  {
    question: 'Which countries does Seemplify target in English-speaking Africa?',
    answer:
      'Seemplify is targeting Nigeria, Ghana, Kenya, South Africa, and broader English-speaking African markets including Uganda, Tanzania, Rwanda, Zambia, Zimbabwe, Botswana, Namibia, Malawi, Liberia, Sierra Leone, The Gambia, and Mauritius.',
  },
  {
    question: 'What problems does Seemplify solve for African HR teams?',
    answer:
      'Seemplify helps reduce fragmented recruiting, inconsistent onboarding, delayed approvals, scattered employee records, and manual performance or leave processes.',
  },
]

export const primaryMarketMap = Object.fromEntries(
  primaryMarkets.map((market) => [market.slug, market]),
) as Record<string, SeoMarket>

export const localizedMarketMap = Object.fromEntries(
  localizedMarkets.map((market) => [market.slug, market]),
) as Record<string, SeoMarket>

export const primaryMarketCountryCodeMap: Record<string, SeoMarket['slug']> = {
  NG: 'nigeria',
  GH: 'ghana',
  KE: 'kenya',
  ZA: 'south-africa',
  GB: 'united-kingdom',
  UK: 'united-kingdom',
}

export function findLocalizedMarketByCountryCode(countryCode?: string | null) {
  const normalizedCountryCode = countryCode?.trim().toUpperCase()

  if (!normalizedCountryCode) {
    return null
  }

  const marketSlug = primaryMarketCountryCodeMap[normalizedCountryCode]

  if (!marketSlug) {
    return null
  }

  return localizedMarketMap[marketSlug] ?? null
}
