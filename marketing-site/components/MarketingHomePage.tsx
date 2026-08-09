import type { LucideIcon } from 'lucide-react'
import {
  ArrowRight,
  BarChart3,
  BrainCircuit,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  Clock3,
  GraduationCap,
  KeyRound,
  MapPin,
  MessageSquareText,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  Target,
  UsersRound,
  WalletCards,
} from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { absoluteUrl, getSiteConfig, idpUrl } from '@/app/site-config'
import { homeFaqs, primaryMarkets } from '@/app/seo-markets'
import { BookDemoButton } from '@/components/BookDemoModal'
import JsonLd from '@/components/JsonLd'
import MarketingFooter from '@/components/MarketingFooter'
import MarketingHeader from '@/components/MarketingHeader'

type SuiteApp = {
  name: string
  description: string
  icon: LucideIcon
  status?: 'Beta' | 'New'
}

const suiteApps: SuiteApp[] = [
  {
    name: 'Recruiter',
    description: 'Source, screen and interview candidates, analyse CVs and keep every hiring decision in one place.',
    icon: BriefcaseBusiness,
  },
  {
    name: 'Core HR & onboarding',
    description: 'Manage people, teams, branches, role access, documents and structured onboarding journeys.',
    icon: UsersRound,
  },
  {
    name: 'Leave Management',
    description: 'Give employees a clear request flow while managers keep policies, balances and approvals in view.',
    icon: CalendarDays,
  },
  {
    name: 'Performance Management',
    description: 'Run OKRs, review cycles, feedback and manager actions with the right organisational context.',
    icon: Target,
    status: 'Beta',
  },
  {
    name: 'Time & Attendance',
    description: 'Track clock-ins, breaks, geofenced attendance, timesheets, exceptions, approvals and reports.',
    icon: Clock3,
    status: 'New',
  },
  {
    name: 'Payroll',
    description: 'Prepare pay runs, salaries, adjustments, approvals, reports and exports with jurisdiction-aware controls.',
    icon: WalletCards,
    status: 'Beta',
  },
  {
    name: 'Experience Management',
    description: 'Bring research, listening, journeys and evidence together to understand the employee experience.',
    icon: BarChart3,
  },
  {
    name: 'Learning',
    description: 'Assign courses, track development and keep training connected to the people and teams it supports.',
    icon: GraduationCap,
  },
]

const aiCapabilities = [
  {
    icon: ScanSearch,
    title: 'CV understanding and matching',
    description: 'Turn uploaded CVs into structured candidate profiles, then compare people against the role with explainable evidence.',
  },
  {
    icon: Sparkles,
    title: 'Job and interview content',
    description: 'Draft job descriptions, requirements and interview questions inside the workflow where they will be used.',
  },
  {
    icon: MessageSquareText,
    title: 'Recruiter assistant',
    description: 'Ask questions about jobs and candidates, then move directly to the record or action that needs attention.',
  },
]

const journeySteps = [
  ['01', 'Hire', 'Move from application and CV analysis to a documented hiring decision.'],
  ['02', 'Welcome', 'Carry the person into team setup, access, documents and onboarding.'],
  ['03', 'Support', 'Manage leave, attendance, goals, feedback and development.'],
  ['04', 'Pay', 'Prepare pay runs with review gates, reports and jurisdiction coverage made visible.'],
] as const

function getHomeStructuredData(config: ReturnType<typeof getSiteConfig>, hostname: string) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        name: config.name,
        url: config.url,
        logo: absoluteUrl(config.ogImage, hostname),
        email: config.contactEmail,
      },
      {
        '@type': 'WebSite',
        name: config.name,
        url: config.url,
        description: config.description,
      },
      {
        '@type': 'SoftwareApplication',
        name: config.name,
        applicationCategory: 'BusinessApplication',
        applicationSubCategory: 'AI-powered people operations software',
        operatingSystem: 'Web',
        url: config.url,
        description: config.description,
        featureList: [
          'AI-assisted recruiting and CV analysis',
          'Employee onboarding and organisation management',
          'Leave management',
          'Performance management',
          'Time and attendance',
          'Payroll operations',
          'Experience management',
          'Learning management',
        ],
      },
      {
        '@type': 'FAQPage',
        mainEntity: homeFaqs.map((faq) => ({
          '@type': 'Question',
          name: faq.question,
          acceptedAnswer: { '@type': 'Answer', text: faq.answer },
        })),
      },
    ],
  }
}

function AiWorkflowGraphic() {
  const steps = [
    ['CV uploaded', 'Stored securely'],
    ['Text extracted', 'Candidate details'],
    ['AI analysis', 'Skills and evidence'],
    ['Profile ready', 'Review and match'],
  ]

  return (
    <div className="marketing-ai-flow" aria-label="CV analysis workflow">
      <div className="marketing-ai-flow__header">
        <div>
          <span>Recruiter workflow</span>
          <strong>From CV to reviewable profile</strong>
        </div>
        <ShieldCheck aria-hidden="true" size={20} />
      </div>
      <ol>
        {steps.map(([title, detail], index) => (
          <li key={title}>
            <span>{String(index + 1).padStart(2, '0')}</span>
            <div><strong>{title}</strong><small>{detail}</small></div>
            <Check aria-hidden="true" size={17} />
          </li>
        ))}
      </ol>
      <div className="marketing-ai-flow__runtime">
        <BrainCircuit aria-hidden="true" size={18} />
        <div>
          <strong>Use ChatGPT or Local inference</strong>
          <span>Choose the runtime by activity and workspace policy.</span>
        </div>
      </div>
    </div>
  )
}

export default function MarketingHomePage({ initialHostname }: { initialHostname: string }) {
  const config = getSiteConfig(initialHostname)
  const signupUrl = idpUrl('/signup', initialHostname)

  return (
    <div className="marketing-site marketing-site--people-first">
      <JsonLd data={getHomeStructuredData(config, initialHostname)} />
      <MarketingHeader />

      <main>
        <section className="marketing-people-hero">
          <div className="marketing-container marketing-people-hero__layout">
            <div className="marketing-people-hero__copy">
              <p className="marketing-section-kicker">AI-powered people operations</p>
              <h1>Run the work around your people in one connected platform.</h1>
              <p className="marketing-people-hero__lead">
                Hire, onboard, manage time and leave, support performance and prepare payroll - with shared identity,
                clear approvals and AI inside the workflows that need it.
              </p>
              <div className="marketing-people-hero__actions">
                <Link href={signupUrl} className="marketing-button marketing-button--primary" data-track-cta="hero-start-free-trial">
                  Start your 7-day trial <ArrowRight aria-hidden="true" size={17} />
                </Link>
                <BookDemoButton className="marketing-button marketing-button--secondary" trackingLabel="hero-book-demo">
                  Book a demo
                </BookDemoButton>
              </div>
              <ul className="marketing-people-hero__trust" aria-label="Platform highlights">
                <li><KeyRound aria-hidden="true" size={16} /> One secure identity</li>
                <li><BrainCircuit aria-hidden="true" size={16} /> ChatGPT or Local AI</li>
                <li><ShieldCheck aria-hidden="true" size={16} /> Human review controls</li>
              </ul>
            </div>

            <figure className="marketing-people-hero__media">
              <Image
                src="/images/seemplify-people-operations-hero.png"
                alt="A diverse workplace team collaborating around a table and planning wall"
                width={1536}
                height={1024}
                priority
                sizes="(max-width: 920px) 100vw, 52vw"
              />
              <figcaption>People work is connected when the context moves with the person.</figcaption>
            </figure>
          </div>
        </section>

        <section id="modules" className="marketing-section marketing-suite-section">
          <div className="marketing-container">
            <div className="marketing-heading-row">
              <div>
                <h2>One suite for the full people journey.</h2>
                <p>Start with the workspaces you need. The identity, organisation and access layer stays consistent underneath.</p>
              </div>
              <Link href="#how-it-works" className="marketing-inline-link">See how the work connects <ArrowRight aria-hidden="true" size={16} /></Link>
            </div>
            <div className="marketing-suite-grid">
              {suiteApps.map((app) => {
                const Icon = app.icon
                return (
                  <article className="marketing-suite-card" key={app.name}>
                    <div className="marketing-suite-card__topline">
                      <Icon aria-hidden="true" size={20} />
                      {app.status ? <span>{app.status}</span> : null}
                    </div>
                    <h3>{app.name}</h3>
                    <p>{app.description}</p>
                  </article>
                )
              })}
            </div>
          </div>
        </section>

        <section id="ai" className="marketing-section marketing-ai-section">
          <div className="marketing-container marketing-ai-section__layout">
            <div className="marketing-ai-section__copy">
              <p className="marketing-section-kicker">AI where it earns its place</p>
              <h2>Helpful automation, with the model choice left open.</h2>
              <p>
                Seemplify is not tied to one model. Connect ChatGPT for supported activities or use your organisation's Local
                runtime. Policies decide where AI can run, and people remain responsible for the decision.
              </p>
              <div className="marketing-ai-capabilities">
                {aiCapabilities.map((capability) => {
                  const Icon = capability.icon
                  return (
                    <article key={capability.title}>
                      <Icon aria-hidden="true" size={20} />
                      <div><h3>{capability.title}</h3><p>{capability.description}</p></div>
                    </article>
                  )
                })}
              </div>
            </div>
            <AiWorkflowGraphic />
          </div>
        </section>

        <section id="how-it-works" className="marketing-section marketing-journey-section">
          <div className="marketing-container">
            <div className="marketing-heading-row">
              <div>
                <h2>From candidate to colleague without losing the thread.</h2>
                <p>Each workspace has a focused job. The person, organisation and decision history provide the common context.</p>
              </div>
            </div>
            <div className="marketing-journey-grid">
              <div className="marketing-journey-steps">
                {journeySteps.map(([number, title, description]) => (
                  <article key={number}>
                    <span>{number}</span>
                    <div><h3>{title}</h3><p>{description}</p></div>
                  </article>
                ))}
              </div>
              <Image
                className="marketing-journey-image"
                src="/images/seemplify-payroll-review.png"
                alt="HR and finance colleagues reviewing people operations together"
                width={1536}
                height={1024}
                sizes="(max-width: 920px) 100vw, 48vw"
              />
            </div>
          </div>
        </section>

        <section id="platform" className="marketing-section marketing-platform-story">
          <div className="marketing-container marketing-platform-story__layout">
            <div className="marketing-platform-story__image-wrap">
              <Image
                src="/images/seemplify-team-culture.png"
                alt="Colleagues laughing and building something together during a workplace break"
                width={1536}
                height={1024}
                sizes="(max-width: 920px) 100vw, 50vw"
              />
            </div>
            <div className="marketing-platform-story__copy">
              <p className="marketing-section-kicker">Built around people</p>
              <h2>Corporate software does not have to make work feel cold.</h2>
              <p>
                Good people operations give teams clarity without taking away their humanity. Seemplify keeps routine work organised
                so managers and employees have more time for useful conversations, development and the work itself.
              </p>
              <ul>
                <li><Check aria-hidden="true" size={17} /> Single sign-on across enabled applications</li>
                <li><Check aria-hidden="true" size={17} /> Organisation-aware roles and permissions</li>
                <li><Check aria-hidden="true" size={17} /> Clear workflow histories and approval ownership</li>
                <li><Check aria-hidden="true" size={17} /> AI activity controls and visible processing states</li>
              </ul>
            </div>
          </div>
        </section>

        <section id="africa" className="marketing-section marketing-regions-section">
          <div className="marketing-container">
            <div className="marketing-heading-row">
              <div>
                <h2>Built for teams operating across Africa and beyond.</h2>
                <p>
                  Use the same core workspaces across locations. Country-specific payroll and statutory calculations remain available
                  only where the published jurisdiction coverage says they are ready.
                </p>
              </div>
              <Link href="/africa" className="marketing-inline-link">Review regional coverage <ArrowRight aria-hidden="true" size={16} /></Link>
            </div>
            <div className="marketing-regions-list">
              {primaryMarkets.map((market) => (
                <Link href={`/africa/${market.slug}`} key={market.slug}>
                  <MapPin aria-hidden="true" size={18} />
                  <div><strong>{market.country}</strong><span>{market.cities.join(' / ')}</span></div>
                  <ArrowRight aria-hidden="true" size={17} />
                </Link>
              ))}
            </div>
          </div>
        </section>

        <section id="faq" className="marketing-section marketing-faq-section">
          <div className="marketing-container marketing-faq-section__layout">
            <div><h2>Questions teams ask before they begin.</h2><p>For a rollout or coverage question specific to your organisation, book a walkthrough.</p></div>
            <div className="marketing-faq-list">
              {homeFaqs.map((faq, index) => (
                <details key={faq.question} open={index === 0}>
                  <summary>{faq.question}<span aria-hidden="true">+</span></summary>
                  <p>{faq.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section id="cta" className="marketing-final-cta">
          <div className="marketing-container marketing-final-cta__inner">
            <div><h2>Make the next people workflow easier to run.</h2><p>Start a seven-day trial or show us the work you want to bring together.</p></div>
            <div>
              <Link href={signupUrl} className="marketing-button marketing-button--primary" data-track-cta="footer-start-free-trial">
                Start free trial <ArrowRight aria-hidden="true" size={17} />
              </Link>
              <BookDemoButton className="marketing-button marketing-button--secondary" trackingLabel="footer-book-demo">Book a demo</BookDemoButton>
            </div>
          </div>
        </section>
      </main>

      <MarketingFooter />
    </div>
  )
}
