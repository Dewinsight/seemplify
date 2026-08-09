import type { Metadata } from 'next'
import { ArrowRight, MapPin } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import JsonLd from '@/components/JsonLd'
import MarketingPageShell from '@/components/MarketingPageShell'
import { BookDemoButton } from '@/components/BookDemoModal'
import { primaryMarketMap, primaryMarkets } from '@/app/seo-markets'
import { absoluteUrl, siteConfig } from '@/app/site-config'
import '../../market-pages.css'

type MarketPageProps = {
  params: Promise<{
    market: string
  }>
}

export function generateStaticParams() {
  return primaryMarkets.map((market) => ({ market: market.slug }))
}

export async function generateMetadata({ params }: MarketPageProps): Promise<Metadata> {
  const { market } = await params
  const page = primaryMarketMap[market]

  if (!page) {
    return {}
  }

  return {
    title: page.headline,
    description: page.description,
    keywords: [
      `${page.headline}`,
      `AI workflow automation ${page.country}`,
      `AI platform ${page.country}`,
      `employee management software ${page.country}`,
      'AI software Africa',
    ],
    alternates: {
      canonical: `/africa/${page.slug}`,
      languages: {
        en: `/africa/${page.slug}`,
      },
    },
    openGraph: {
      title: `${page.headline} | ${siteConfig.name}`,
      description: page.description,
      url: `/africa/${page.slug}`,
      type: 'website',
      siteName: siteConfig.name,
      images: [
        {
          url: siteConfig.ogImage,
          width: 1200,
          height: 630,
          alt: `${page.headline} | ${siteConfig.name}`,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: `${page.headline} | ${siteConfig.name}`,
      description: page.description,
      images: [siteConfig.ogImage],
    },
  }
}

export default async function MarketPage({ params }: MarketPageProps) {
  const { market } = await params
  const page = primaryMarketMap[market]

  if (!page) {
    notFound()
  }

  const structuredData = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        name: page.headline,
        url: absoluteUrl(`/africa/${page.slug}`),
        description: page.description,
        breadcrumb: {
          '@type': 'BreadcrumbList',
          itemListElement: [
            {
              '@type': 'ListItem',
              position: 1,
              name: 'Home',
              item: absoluteUrl('/'),
            },
            {
              '@type': 'ListItem',
              position: 2,
              name: 'Africa',
              item: absoluteUrl('/africa'),
            },
            {
              '@type': 'ListItem',
              position: 3,
              name: page.country,
              item: absoluteUrl(`/africa/${page.slug}`),
            },
          ],
        },
      },
      {
        '@type': 'FAQPage',
        mainEntity: page.faqs.map((faq) => ({
          '@type': 'Question',
          name: faq.question,
          acceptedAnswer: {
            '@type': 'Answer',
            text: faq.answer,
          },
        })),
      },
      {
        '@type': 'SoftwareApplication',
        name: siteConfig.name,
        applicationCategory: 'BusinessApplication',
        applicationSubCategory: 'AI Software',
        operatingSystem: 'Web',
        description: page.description,
        url: absoluteUrl(`/africa/${page.slug}`),
        areaServed: {
          '@type': 'Country',
          name: page.country,
        },
      },
    ],
  }

  const relatedMarkets = primaryMarkets.filter((entry) => entry.slug !== page.slug)

  return (
    <MarketingPageShell>
      <JsonLd data={structuredData} />

      <section className="marketing-page-hero market-page-hero market-page-hero--country">
        <div className="marketing-container">
          <nav className="market-breadcrumb" aria-label="Breadcrumb">
            <ol>
              <li><Link href="/">Home</Link></li>
              <li><Link href="/africa">Africa</Link></li>
              <li aria-current="page">{page.country}</li>
            </ol>
          </nav>

          <div className="market-page-hero__grid">
            <div className="marketing-page-hero__inner market-page-hero__copy">
              <p className="marketing-eyebrow">{page.country}</p>
              <h1>{page.headline}</h1>
              <p className="marketing-page-hero__description">{page.intro}</p>
              <div className="market-page-actions">
                <Link href="/#modules" className="marketing-button marketing-button--secondary">
                  Explore the product
                </Link>
                <BookDemoButton
                  className="marketing-button marketing-button--primary"
                  trackingLabel={`${page.slug}-hero-book-demo`}
                >
                  Book a walkthrough
                </BookDemoButton>
              </div>
            </div>

            <aside className="market-country-brief" aria-label={`${page.country} market summary`}>
              <p className="market-panel-eyebrow">Operating context</p>
              <div className="market-country-brief__section">
                <span><MapPin aria-hidden="true" /> Key locations</span>
                <ul>{page.cities.map((city) => <li key={city}>{city}</li>)}</ul>
              </div>
              <div className="market-country-brief__section">
                <span>Best-fit sectors</span>
                <ul>{page.industries.map((industry) => <li key={industry}>{industry}</li>)}</ul>
              </div>
            </aside>
          </div>
        </div>
      </section>

      <section className="marketing-page-section market-fit" aria-labelledby="market-fit-title">
        <div className="marketing-container market-fit__grid">
          <div className="market-fit__main">
            <p className="marketing-eyebrow">Why Teams Choose Seemplify</p>
            <h2 id="market-fit-title">How Seemplify supports growing teams in {page.country}.</h2>
            <p className="market-fit__description">{page.description}</p>
            <ol className="market-highlight-list">
              {page.highlights.map((highlight, index) => (
                <li key={highlight}>
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <p>{highlight}</p>
                </li>
              ))}
            </ol>
          </div>

          <aside className="market-industries" aria-labelledby="market-industries-title">
            <p className="market-panel-eyebrow">Best Fit Teams</p>
            <h2 id="market-industries-title">
              Common sectors searching for modern AI software in {page.country}.
            </h2>
            <ul>
              {page.industries.map((industry, index) => (
                <li key={industry}>
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  {industry}
                </li>
              ))}
            </ul>
          </aside>
        </div>
      </section>

      <section className="marketing-page-section market-faq" aria-labelledby="market-faq-title">
        <div className="marketing-container market-faq__grid">
          <div className="market-faq__heading">
            <p className="marketing-eyebrow">FAQ</p>
            <h2 id="market-faq-title">Questions from teams in {page.country}.</h2>
            <p>Practical answers on how the platform fits local and distributed operations.</p>
          </div>
          <div className="market-faq__list">
            {page.faqs.map((faq, index) => (
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

      <section className="marketing-page-section market-related" aria-labelledby="related-markets-title">
        <div className="marketing-container">
          <div className="market-section-heading">
            <div>
              <p className="marketing-eyebrow">Explore More Markets</p>
              <h2 id="related-markets-title">Keep the same operating model as your footprint grows.</h2>
            </div>
            <Link href="/africa" className="marketing-inline-link">View Africa overview</Link>
          </div>
          <div className="market-related__grid">
            {relatedMarkets.map((marketEntry, index) => (
              <Link
                key={marketEntry.slug}
                href={`/africa/${marketEntry.slug}`}
                className="market-related-card"
              >
                <span className="market-related-card__index">{String(index + 1).padStart(2, '0')}</span>
                <h3>{marketEntry.country}</h3>
                <p>{marketEntry.description}</p>
                <span className="market-related-card__action">
                  View market <ArrowRight aria-hidden="true" />
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="market-page-cta" aria-labelledby="market-page-cta-title">
        <div className="marketing-container market-page-cta__inner">
          <div>
            <p className="marketing-eyebrow">Build for {page.country}</p>
            <h2 id="market-page-cta-title">Give your team one clear place to run the work.</h2>
          </div>
          <div className="market-page-actions">
            <Link href="/#platform" className="marketing-button marketing-button--secondary">
              See the platform
            </Link>
            <BookDemoButton
              className="marketing-button marketing-button--primary"
              trackingLabel={`${page.slug}-footer-book-demo`}
            >
              Talk to Seemplify
            </BookDemoButton>
          </div>
        </div>
      </section>
    </MarketingPageShell>
  )
}
