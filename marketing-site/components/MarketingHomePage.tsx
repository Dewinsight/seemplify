'use client'

import { type LucideIcon } from 'lucide-react'
import {
  ArrowRight,
  BarChart3,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  Clock3,
  FileCheck2,
  KeyRound,
  Landmark,
  MapPin,
  Network,
  ShieldCheck,
  Target,
  UsersRound,
  WalletCards,
  Workflow,
} from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { BookDemoButton } from '@/components/BookDemoModal'
import JsonLd from '@/components/JsonLd'
import MarketingFooter from '@/components/MarketingFooter'
import MarketingHeader from '@/components/MarketingHeader'
import {
  broaderEnglishSpeakingAfricanCountries,
  homeFaqs,
  localizedMarketMap,
  primaryMarketMap,
  primaryMarkets,
  type SeoMarket,
} from '@/app/seo-markets'
import { absoluteUrl, getSiteConfig, idpUrl } from '@/app/site-config'

const MARKET_COOKIE = 'seemplify-market'

type SuiteApp = {
  name: string
  signal: string
  description: string
  icon: LucideIcon
  footerLabel: string
  footerValue: string
  feature?: 'wide'
}

const suiteApps: SuiteApp[] = [
  {
    name: 'Recruiter',
    signal: 'Hire with signal',
    description: 'Coordinate sourcing, screening, interviews, documents, and hiring decisions from one workspace.',
    icon: BriefcaseBusiness,
    footerLabel: 'Workspace',
    footerValue: 'Recruitment',
    feature: 'wide',
  },
  {
    name: 'Experience Management',
    signal: 'Listen, learn, act',
    description: 'Turn research, listening, journeys, and evidence into a clearer picture of your people experience.',
    icon: BarChart3,
    footerLabel: 'Workspace',
    footerValue: 'Insights',
  },
  {
    name: 'Leave Management',
    signal: 'Time off, sorted',
    description: 'Give employees a simple request flow while managers keep balances, policies, and approvals in view.',
    icon: CalendarDays,
    footerLabel: 'Workflow',
    footerValue: 'Requests',
  },
  {
    name: 'Performance Management',
    signal: 'Goals that move',
    description: 'Keep OKRs, review cycles, manager actions, and ongoing feedback close to the work.',
    icon: Target,
    footerLabel: 'Workspace',
    footerValue: 'Reviews',
  },
  {
    name: 'Payroll',
    signal: 'Pay run confidence',
    description: 'Prepare salaries, adjustments, contract work, approvals, reports, and exports with a clean audit trail.',
    icon: WalletCards,
    footerLabel: 'Workspace',
    footerValue: 'Payroll',
  },
  {
    name: 'Time & Attendance',
    signal: 'Hours you can trust',
    description: 'Track clock-ins, breaks, timesheets, attendance rules, approvals, and reporting in one pass.',
    icon: Clock3,
    footerLabel: 'Status',
    footerValue: 'Live attendance',
  },
]

const platformPrinciples = [
  {
    icon: KeyRound,
    title: 'One identity',
    description: 'Sign in once and move between the workspaces your organisation has made available.',
  },
  {
    icon: UsersRound,
    title: 'One people structure',
    description: 'Departments, teams, branches, roles, and reporting relationships stay connected.',
  },
  {
    icon: Workflow,
    title: 'One approval trail',
    description: 'Requests and decisions retain the context people need to act with confidence.',
  },
]

const operatingStories = [
  {
    index: '01',
    title: 'People join with context.',
    description: 'Move from recruitment into onboarding, team membership, documents, and role access without re-entering the same information.',
    icon: UsersRound,
  },
  {
    index: '02',
    title: 'Work moves through clear decisions.',
    description: 'Leave, time, performance, and pay changes follow visible ownership and approval paths.',
    icon: FileCheck2,
  },
  {
    index: '03',
    title: 'Leaders see the whole picture.',
    description: 'Shared records make reporting easier to follow across people, teams, and operational workspaces.',
    icon: BarChart3,
  },
]

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
        areaServed: broaderEnglishSpeakingAfricanCountries.map((country) => ({
          '@type': 'Country',
          name: country,
        })),
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
        applicationSubCategory: 'People Operations Software',
        operatingSystem: 'Web',
        url: config.url,
        description: config.description,
        areaServed: broaderEnglishSpeakingAfricanCountries.map((country) => ({
          '@type': 'Country',
          name: country,
        })),
        featureList: [
          'Recruiting workflow management',
          'Employee onboarding',
          'Leave management',
          'Performance management',
          'Time and attendance',
          'Payroll operations',
        ],
      },
      {
        '@type': 'FAQPage',
        mainEntity: homeFaqs.map((faq) => ({
          '@type': 'Question',
          name: faq.question,
          acceptedAnswer: {
            '@type': 'Answer',
            text: faq.answer,
          },
        })),
      },
    ],
  }
}

function getCookieValue(cookieName: string) {
  if (typeof document === 'undefined') return null
  const prefix = `${cookieName}=`
  const entry = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
  return entry ? decodeURIComponent(entry.slice(prefix.length)) : null
}

function SuitePreview() {
  const previewApps = suiteApps.slice(0, 6)

  return (
    <div className="marketing-suite-preview" aria-label="Seemplify application workspace preview">
      <div className="marketing-suite-preview__header">
        <div>
          <p className="marketing-suite-preview__eyebrow">Working in</p>
          <div className="marketing-suite-preview__organisation">
            <span className="marketing-suite-preview__avatar">AI</span>
            <div>
              <strong>AIIN</strong>
              <span>Connected workspace</span>
            </div>
          </div>
        </div>
        <span className="marketing-suite-preview__status"><ShieldCheck aria-hidden="true" size={14} /> SSO on</span>
      </div>

      <div className="marketing-suite-preview__apps">
        {previewApps.map((app) => {
          const Icon = app.icon
          return (
            <div className="marketing-suite-preview__app" key={app.name}>
              <span className="marketing-suite-preview__app-icon"><Icon aria-hidden="true" size={16} /></span>
              <span>{app.name}</span>
            </div>
          )
        })}
      </div>

      <div className="marketing-suite-preview__footer">
        <span><KeyRound aria-hidden="true" size={14} /> One identity</span>
        <span><UsersRound aria-hidden="true" size={14} /> Shared structure</span>
        <span><Workflow aria-hidden="true" size={14} /> Connected work</span>
      </div>
    </div>
  )
}

function WorkflowBoard() {
  const rows = [
    { label: 'New team member', meta: 'Recruiter', status: 'Ready' },
    { label: 'Team and role assigned', meta: 'People structure', status: 'Connected' },
    { label: 'Onboarding journey', meta: 'Documents and access', status: 'In progress' },
    { label: 'Manager check-in', meta: 'Performance', status: 'Scheduled' },
  ]

  return (
    <div className="marketing-workflow-board" aria-label="A connected people workflow">
      <div className="marketing-workflow-board__topline">
        <div>
          <span>People journey</span>
          <strong>From hire to productive</strong>
        </div>
        <span className="marketing-workflow-board__live">Live workflow</span>
      </div>
      <div className="marketing-workflow-board__rows">
        {rows.map((row, index) => (
          <div className="marketing-workflow-board__row" key={row.label}>
            <span className="marketing-workflow-board__index">{String(index + 1).padStart(2, '0')}</span>
            <div>
              <strong>{row.label}</strong>
              <span>{row.meta}</span>
            </div>
            <span className="marketing-workflow-board__state">{row.status}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function MarketingHomePage({ initialHostname }: { initialHostname: string }) {
  const [personalizedMarket, setPersonalizedMarket] = useState<SeoMarket | null>(null)
  const [hostname, setHostname] = useState(initialHostname)

  useEffect(() => {
    setHostname(window.location.hostname)
    const marketSlug = getCookieValue(MARKET_COOKIE)
    setPersonalizedMarket(
      marketSlug && marketSlug !== 'global' ? localizedMarketMap[marketSlug] ?? null : null
    )
  }, [])

  const config = getSiteConfig(hostname)
  const signupUrl = idpUrl('/signup', hostname)
  const isPrimaryAfricaMarket = personalizedMarket
    ? Boolean(primaryMarketMap[personalizedMarket.slug])
    : false
  const prioritizedMarkets = personalizedMarket && isPrimaryAfricaMarket
    ? [personalizedMarket, ...primaryMarkets.filter((market) => market.slug !== personalizedMarket.slug)]
    : primaryMarkets

  const heroEyebrow = personalizedMarket
    ? `${personalizedMarket.country} · People operations software`
    : 'One connected people operations suite'
  const heroTitle = personalizedMarket
    ? `AI software for ${personalizedMarket.country}.`
    : 'People work, connected.'
  const heroSubtitle = personalizedMarket
    ? 'Built for modern teams.'
    : 'From hire to payroll.'
  const heroDescription = personalizedMarket
    ? `${personalizedMarket.intro} Bring recruiting, onboarding, leave, performance, time, and payroll into one clear operating system.`
    : 'Seemplify gives teams one place to hire, organise, support, review, and pay their people—with shared identity and structure underneath.'

  return (
    <div className="marketing-site">
      <JsonLd data={getHomeStructuredData(config, hostname)} />
      <MarketingHeader />

      <main>
        <section className="marketing-hero">
          <div className="marketing-container marketing-hero__inner">
            <div className="marketing-hero__copy">
              <p className="marketing-eyebrow">{heroEyebrow}</p>
              <h1 className="marketing-hero__title">
                {heroTitle}
                <span>{heroSubtitle}</span>
              </h1>
              <p className="marketing-hero__description">{heroDescription}</p>
              <div className="marketing-hero__actions">
                <Link
                  href={signupUrl}
                  data-track-cta="hero-start-free-trial"
                  className="marketing-button marketing-button--primary"
                >
                  Start free trial <ArrowRight aria-hidden="true" size={16} />
                </Link>
                <BookDemoButton
                  className="marketing-button marketing-button--secondary"
                  trackingLabel="hero-book-demo"
                >
                  Book a demo
                </BookDemoButton>
              </div>
              <p className="marketing-hero__note">Start with the workspaces you need. Add the rest as your team grows.</p>
            </div>

            <SuitePreview />
          </div>
        </section>

        <section className="marketing-proof" aria-label="Seemplify platform foundations">
          <div className="marketing-container marketing-proof__grid">
            {platformPrinciples.map((principle) => {
              const Icon = principle.icon
              return (
                <article className="marketing-proof__item" key={principle.title}>
                  <Icon aria-hidden="true" size={18} />
                  <div>
                    <h2>{principle.title}</h2>
                    <p>{principle.description}</p>
                  </div>
                </article>
              )
            })}
          </div>
        </section>

        <section id="modules" className="marketing-section marketing-products">
          <div className="marketing-container">
            <div className="marketing-section-heading">
              <div>
                <p className="marketing-eyebrow">The Seemplify suite</p>
                <h2>Choose the workspace. Keep the context.</h2>
                <p>Each application has a focused job. Together, they share the identity and people structure that keeps work coherent.</p>
              </div>
              <p className="marketing-section-heading__count">6 connected applications</p>
            </div>

            <div className="marketing-products__grid">
              {suiteApps.map((app) => {
                const Icon = app.icon
                return (
                  <article
                    key={app.name}
                    className="marketing-product-card"
                    data-feature={app.feature ?? 'standard'}
                  >
                    <div className="marketing-product-card__header">
                      <span className="marketing-product-card__icon"><Icon aria-hidden="true" size={20} /></span>
                      <div>
                        <h3>{app.name}</h3>
                        <p>{app.signal}</p>
                      </div>
                    </div>
                    <p className="marketing-product-card__description">{app.description}</p>
                    <div className="marketing-product-card__footer">
                      <div>
                        <span>{app.footerLabel}</span>
                        <strong>{app.footerValue}</strong>
                      </div>
                      <Link href="#cta" className="marketing-product-card__open">See in a demo <ArrowRight aria-hidden="true" size={15} /></Link>
                    </div>
                  </article>
                )
              })}
            </div>
          </div>
        </section>

        <section id="how-it-works" className="marketing-section marketing-section--inverse marketing-how">
          <div className="marketing-container">
            <div className="marketing-how__heading">
              <div>
                <p className="marketing-eyebrow">How it works</p>
                <h2>The record follows the person—not the app.</h2>
              </div>
              <p>
                Seemplify links identity, team structure, and operational work so each action starts with useful context and ends with a visible decision.
              </p>
            </div>

            <div className="marketing-how__layout">
              <div className="marketing-how__steps">
                {operatingStories.map((story) => {
                  const Icon = story.icon
                  return (
                    <article className="marketing-how__step" key={story.index}>
                      <span className="marketing-how__step-number">{story.index}</span>
                      <Icon aria-hidden="true" size={19} />
                      <div>
                        <h3>{story.title}</h3>
                        <p>{story.description}</p>
                      </div>
                    </article>
                  )
                })}
              </div>
              <WorkflowBoard />
            </div>
          </div>
        </section>

        <section id="platform" className="marketing-section marketing-platform">
          <div className="marketing-container marketing-platform__layout">
            <div className="marketing-platform__copy">
              <p className="marketing-eyebrow">The platform underneath</p>
              <h2>A secure foundation for every workspace.</h2>
              <p>
                Access, organisational structure, and approvals are managed centrally. Teams move between applications without feeling like they have entered separate products.
              </p>
              <ul className="marketing-check-list">
                <li><Check aria-hidden="true" size={15} /> Single sign-on across enabled applications</li>
                <li><Check aria-hidden="true" size={15} /> Role and organisation-aware access</li>
                <li><Check aria-hidden="true" size={15} /> Shared departments, teams, branches, and reporting lines</li>
                <li><Check aria-hidden="true" size={15} /> Traceable actions and approvals</li>
              </ul>
            </div>

            <div className="marketing-platform__panel">
              <div className="marketing-platform__panel-heading">
                <span className="marketing-platform__panel-icon"><Network aria-hidden="true" size={20} /></span>
                <div>
                  <span>Organisation structure</span>
                  <strong>People and roles</strong>
                </div>
                <span className="marketing-platform__panel-state">Connected</span>
              </div>
              <div className="marketing-platform__hierarchy">
                <div className="marketing-platform__hierarchy-root">
                  <Landmark aria-hidden="true" size={16} /> AIIN
                </div>
                <div className="marketing-platform__hierarchy-branches">
                  <div><span>Department</span><strong>Engineering</strong><small>3 teams</small></div>
                  <div><span>Department</span><strong>People</strong><small>2 teams</small></div>
                  <div><span>Branch</span><strong>London</strong><small>Primary office</small></div>
                </div>
              </div>
              <div className="marketing-platform__panel-footer">
                <span><UsersRound aria-hidden="true" size={14} /> Members</span>
                <span><ShieldCheck aria-hidden="true" size={14} /> Roles</span>
                <span><MapPin aria-hidden="true" size={14} /> Locations</span>
              </div>
            </div>
          </div>
        </section>

        <section id="onboarding" className="marketing-section marketing-operations">
          <div className="marketing-container">
            <div className="marketing-section-heading marketing-section-heading--compact">
              <div>
                <p className="marketing-eyebrow">Operational continuity</p>
                <h2>Less repeated work between key moments.</h2>
                <p>People data can support the next workflow instead of stopping at the edge of each application.</p>
              </div>
            </div>

            <div className="marketing-operations__grid">
              <article className="marketing-operation-card">
                <span className="marketing-operation-card__number">01</span>
                <div>
                  <h3>Onboarding with a head start</h3>
                  <p>Carry the hiring decision into role setup, team assignment, documents, access, and the first manager check-in.</p>
                </div>
                <span className="marketing-operation-card__meta"><UsersRound aria-hidden="true" size={15} /> Hire to team</span>
              </article>
              <article id="documents" className="marketing-operation-card marketing-operation-card--offset">
                <span className="marketing-operation-card__number">02</span>
                <div>
                  <h3>Documents with ownership</h3>
                  <p>Keep offers, acknowledgements, agreements, and signatures connected to the person and the action that created them.</p>
                </div>
                <span className="marketing-operation-card__meta"><FileCheck2 aria-hidden="true" size={15} /> Clear audit trail</span>
              </article>
              <article className="marketing-operation-card">
                <span className="marketing-operation-card__number">03</span>
                <div>
                  <h3>Decisions managers can follow</h3>
                  <p>Bring pending approvals, reviews, attendance, and people actions into a structure that makes the next step obvious.</p>
                </div>
                <span className="marketing-operation-card__meta"><Workflow aria-hidden="true" size={15} /> Action to outcome</span>
              </article>
            </div>
          </div>
        </section>

        <section id="africa" className="marketing-section marketing-markets">
          <div className="marketing-container marketing-markets__layout">
            <div className="marketing-markets__copy">
              <p className="marketing-eyebrow">Built with African teams in mind</p>
              <h2>
                {personalizedMarket
                  ? `A clearer operating model for teams in ${personalizedMarket.country}.`
                  : 'Local context. One consistent operating model.'}
              </h2>
              <p>
                {personalizedMarket
                  ? `${personalizedMarket.intro} Seemplify also supports teams working across multiple markets.`
                  : 'Support teams in Nigeria, Ghana, Kenya, South Africa, and across English-speaking African markets without rebuilding every workflow from scratch.'}
              </p>
              <Link href="/africa" className="marketing-inline-link">
                Explore Africa coverage <ArrowRight aria-hidden="true" size={15} />
              </Link>
            </div>

            <div className="marketing-markets__directory">
              {prioritizedMarkets.map((market) => (
                <Link key={market.slug} href={`/africa/${market.slug}`} className="marketing-market-row">
                  <span className="marketing-market-row__country">{market.country}</span>
                  <span>
                    <strong>{market.headline}</strong>
                    <small>{market.cities.slice(0, 3).join(' · ')}</small>
                  </span>
                  <ArrowRight aria-hidden="true" size={17} />
                </Link>
              ))}
            </div>
          </div>
        </section>

        <section id="faq" className="marketing-section marketing-faq">
          <div className="marketing-container marketing-faq__layout">
            <div className="marketing-faq__heading">
              <p className="marketing-eyebrow">Common questions</p>
              <h2>What teams ask before they bring their work together.</h2>
              <p>Need an answer about your organisation or rollout? Book a walkthrough and we’ll map it with you.</p>
            </div>
            <div className="marketing-faq__items">
              {homeFaqs.map((faq, index) => (
                <details className="marketing-faq__item" key={faq.question} open={index === 0}>
                  <summary>{faq.question}<span aria-hidden="true">+</span></summary>
                  <p>{faq.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section id="cta" className="marketing-cta">
          <div className="marketing-container">
            <div className="marketing-cta__inner">
              <div>
                <p className="marketing-eyebrow">Make the next workflow simpler</p>
                <h2>Bring your people work into one system.</h2>
                <p>Start with one workspace or walk us through the full operating model you want to build.</p>
              </div>
              <div className="marketing-cta__actions">
                <Link
                  href={signupUrl}
                  data-track-cta="footer-start-free-trial"
                  className="marketing-button marketing-button--primary"
                >
                  Start free trial <ArrowRight aria-hidden="true" size={16} />
                </Link>
                <BookDemoButton
                  className="marketing-button marketing-button--secondary"
                  trackingLabel="footer-book-demo"
                >
                  Book a demo
                </BookDemoButton>
              </div>
            </div>
          </div>
        </section>
      </main>

      <MarketingFooter />
    </div>
  )
}
