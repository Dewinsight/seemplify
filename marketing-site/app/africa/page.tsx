import type { Metadata } from 'next'
import { ArrowRight, MapPin } from 'lucide-react'
import Link from 'next/link'
import JsonLd from '@/components/JsonLd'
import MarketingPageShell from '@/components/MarketingPageShell'
import { BookDemoButton } from '@/components/BookDemoModal'
import {
  africaFaqs,
  broaderEnglishSpeakingAfricanCountries,
  primaryMarkets,
} from '../seo-markets'
import { absoluteUrl, siteConfig } from '../site-config'
import '../market-pages.css'

export const metadata: Metadata = {
  title: 'People Operations Software for Africa',
  description:
    'Explore Seemplify people operations software for Nigeria, Ghana, Kenya, South Africa and distributed teams across Africa.',
  keywords: [
    'people operations software Africa',
    'HR software Africa',
    'recruiting software Africa',
    'employee management software Africa',
  ],
  alternates: {
    canonical: '/africa',
    languages: {
      en: '/africa',
    },
  },
  openGraph: {
    title: 'People Operations Software for Africa | Seemplify',
    description:
      'Seemplify helps African teams centralize recruiting, onboarding, leave, performance, and operations.',
    url: '/africa',
    siteName: siteConfig.name,
    type: 'website',
    images: [
      {
        url: siteConfig.ogImage,
        width: 1200,
        height: 630,
        alt: 'Seemplify people operations software for Africa',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'People Operations Software for Africa | Seemplify',
    description:
      'Explore Seemplify market pages for Nigeria, Ghana, Kenya, South Africa, and English-speaking African teams.',
    images: [siteConfig.ogImage],
  },
}

const africaStructuredData = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebPage',
      name: 'People Operations Software for Africa',
      url: absoluteUrl('/africa'),
      description:
        'Market overview for connected recruiting and people operations across Nigeria, Ghana, Kenya, South Africa and distributed African teams.',
    },
    {
      '@type': 'FAQPage',
      mainEntity: africaFaqs.map((faq) => ({
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

const teamPriorities = [
  'Faster hiring coordination',
  'Cleaner employee records',
  'Consistent onboarding journeys',
  'Reliable leave and approval workflows',
  'Performance management at scale',
  'Multi-country operational visibility',
]

export default function AfricaPage() {
  return (
    <MarketingPageShell>
      <JsonLd data={africaStructuredData} />

      <section className="marketing-page-hero market-page-hero">
        <div className="marketing-container">
          <nav className="market-breadcrumb" aria-label="Breadcrumb">
            <ol>
              <li><Link href="/">Home</Link></li>
              <li aria-current="page">Africa</li>
            </ol>
          </nav>

          <div className="market-page-hero__grid">
            <div className="marketing-page-hero__inner market-page-hero__copy">
              <p className="marketing-eyebrow">Regional operations</p>
              <h1>One people operations platform for teams across Africa.</h1>
              <p className="marketing-page-hero__description">
                Explore how Seemplify connects recruiting, onboarding and everyday people workflows
                across key African markets. Statutory payroll coverage remains country-specific and clearly labelled.
              </p>
              <div className="market-page-actions">
                <Link href="/#modules" className="marketing-button marketing-button--secondary">
                  Explore the product
                </Link>
                <BookDemoButton
                  className="marketing-button marketing-button--primary"
                  trackingLabel="africa-hero-book-demo"
                >
                  Book a walkthrough
                </BookDemoButton>
              </div>
            </div>

            <aside className="market-coverage-brief" aria-label="Africa coverage at a glance">
              <p className="market-panel-eyebrow">Coverage at a glance</p>
              <dl className="market-coverage-brief__facts">
                <div>
                  <dt>Priority markets</dt>
                  <dd>{primaryMarkets.length}</dd>
                </div>
                <div>
                  <dt>Regional coverage</dt>
                  <dd>{broaderEnglishSpeakingAfricanCountries.length} locations</dd>
                </div>
                <div>
                  <dt>Operating model</dt>
                  <dd>One shared system</dd>
                </div>
              </dl>
            </aside>
          </div>
        </div>
      </section>

      <section className="marketing-page-section market-directory" aria-labelledby="market-directory-title">
        <div className="marketing-container">
          <div className="market-section-heading">
            <div>
              <p className="marketing-eyebrow">Market directory</p>
              <h2 id="market-directory-title">Start with the market closest to your team.</h2>
              <p>Each page puts the same Seemplify platform in the context of local operating teams.</p>
            </div>
            <p className="market-section-heading__count">{primaryMarkets.length} focused markets</p>
          </div>

          <ol className="market-directory__list">
            {primaryMarkets.map((market, index) => (
              <li key={market.slug}>
                <Link href={`/africa/${market.slug}`} className="market-directory-card">
                  <span className="market-directory-card__index" aria-hidden="true">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <div className="market-directory-card__body">
                    <p className="market-directory-card__country">{market.country}</p>
                    <h3>{market.headline}</h3>
                    <p>{market.description}</p>
                  </div>
                  <div className="market-directory-card__coverage">
                    <span><MapPin aria-hidden="true" /> Key locations</span>
                    <strong>{market.cities.join(' · ')}</strong>
                  </div>
                  <span className="market-directory-card__action">
                    View market <ArrowRight aria-hidden="true" />
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="marketing-page-section market-operating-model" aria-labelledby="regional-coverage-title">
        <div className="marketing-container market-operating-model__grid">
          <div className="market-regional-coverage">
            <p className="marketing-eyebrow">Broader Coverage</p>
            <h2 id="regional-coverage-title">Built for English-speaking African teams beyond the major hubs.</h2>
            <p>
              Seemplify is designed for regional teams that need consistent recruiting, onboarding,
              employee operations, leave, and performance workflows across multiple countries.
            </p>
            <ul className="market-country-index" aria-label="Countries in Seemplify's broader Africa coverage">
              {broaderEnglishSpeakingAfricanCountries.map((country, index) => (
                <li key={country}>
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  {country}
                </li>
              ))}
            </ul>
          </div>

          <aside className="market-priorities" aria-labelledby="market-priorities-title">
            <p className="market-panel-eyebrow">What Teams Need</p>
            <h2 id="market-priorities-title">Core priorities for growing teams across Africa.</h2>
            <ul>
              {teamPriorities.map((priority) => <li key={priority}>{priority}</li>)}
            </ul>
          </aside>
        </div>
      </section>

      <section className="marketing-page-section market-faq" aria-labelledby="africa-faq-title">
        <div className="marketing-container market-faq__grid">
          <div className="market-faq__heading">
            <p className="marketing-eyebrow">FAQ</p>
            <h2 id="africa-faq-title">What regional teams usually ask first.</h2>
            <p>Clear answers on coverage, operating models, and where Seemplify fits.</p>
          </div>
          <div className="market-faq__list">
            {africaFaqs.map((faq, index) => (
              <details key={faq.question} className="market-faq-item" open={index === 0}>
                <summary>
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  {faq.question}
                </summary>
                <p>{faq.answer}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="market-page-cta" aria-labelledby="africa-cta-title">
        <div className="marketing-container market-page-cta__inner">
          <div>
            <p className="marketing-eyebrow">Your operating footprint</p>
            <h2 id="africa-cta-title">Bring every team into one clear operating system.</h2>
          </div>
          <div className="market-page-actions">
            <Link href="/#platform" className="marketing-button marketing-button--secondary">
              See the platform
            </Link>
            <BookDemoButton
              className="marketing-button marketing-button--primary"
              trackingLabel="africa-footer-book-demo"
            >
              Talk to Seemplify
            </BookDemoButton>
          </div>
        </div>
      </section>
    </MarketingPageShell>
  )
}
