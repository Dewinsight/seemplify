import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import JsonLd from '@/components/JsonLd'
import { primaryMarketMap, primaryMarkets } from '@/app/seo-markets'
import { absoluteUrl, siteConfig } from '@/app/site-config'

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
    <main className="min-h-screen bg-[#f7f7fb] px-6 py-24 text-zinc-900 dark:bg-[#020205] dark:text-white">
      <JsonLd data={structuredData} />

      <div className="mx-auto max-w-6xl">
        <div className="max-w-4xl">
          <Link href="/africa" className="text-sm text-emerald-700 dark:text-emerald-300">
            Back to Africa SEO hub
          </Link>
          <p className="mt-8 text-xs uppercase tracking-[0.35em] text-zinc-600 dark:text-white/60">
            {page.country}
          </p>
          <h1 className="mt-4 font-display text-5xl tracking-tight md:text-6xl">{page.headline}</h1>
          <p className="mt-6 max-w-3xl text-lg text-zinc-700 dark:text-white/75">{page.intro}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            {page.cities.map((city) => (
              <span
                key={city}
                className="rounded-full border border-black/10 bg-white px-4 py-2 text-sm dark:border-white/10 dark:bg-white/[0.04]"
              >
                {city}
              </span>
            ))}
          </div>
        </div>

        <section className="mt-16 grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-3xl border border-black/10 bg-white p-10 dark:border-white/10 dark:bg-white/[0.04]">
            <p className="text-xs uppercase tracking-[0.35em] text-zinc-600 dark:text-white/60">
              Why Teams Choose Seemplify
            </p>
            <h2 className="mt-4 font-display text-4xl">
              How Seemplify supports growing teams in {page.country}.
            </h2>
            <p className="mt-4 text-zinc-700 dark:text-white/75">{page.description}</p>
            <div className="mt-8 grid gap-4">
              {page.highlights.map((highlight) => (
                <div
                  key={highlight}
                  className="rounded-2xl border border-black/10 bg-zinc-50 p-5 text-sm dark:border-white/10 dark:bg-white/[0.04]"
                >
                  {highlight}
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-black/10 bg-[#0b2f29] p-10 text-white dark:border-white/10">
            <p className="text-xs uppercase tracking-[0.35em] text-white/60">Best Fit Teams</p>
            <h2 className="mt-4 font-display text-4xl">
              Common sectors searching for modern AI software in {page.country}.
            </h2>
            <div className="mt-8 grid gap-3">
              {page.industries.map((industry) => (
                <div
                  key={industry}
                  className="rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-sm text-white/80"
                >
                  {industry}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mt-20">
          <p className="text-xs uppercase tracking-[0.35em] text-zinc-600 dark:text-white/60">
            FAQ
          </p>
          <div className="mt-6 grid gap-4">
            {page.faqs.map((faq) => (
              <article
                key={faq.question}
                className="rounded-3xl border border-black/10 bg-white p-8 dark:border-white/10 dark:bg-white/[0.04]"
              >
                <h2 className="font-display text-2xl">{faq.question}</h2>
                <p className="mt-3 text-zinc-700 dark:text-white/75">{faq.answer}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-20 rounded-3xl border border-black/10 bg-white p-10 dark:border-white/10 dark:bg-white/[0.04]">
          <p className="text-xs uppercase tracking-[0.35em] text-zinc-600 dark:text-white/60">
            Explore More Markets
          </p>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {relatedMarkets.map((marketEntry) => (
              <Link
                key={marketEntry.slug}
                href={`/africa/${marketEntry.slug}`}
                className="rounded-2xl border border-black/10 bg-zinc-50 p-6 transition hover:-translate-y-1 hover:border-emerald-500/40 dark:border-white/10 dark:bg-white/[0.04]"
              >
                <h2 className="font-display text-2xl">{marketEntry.country}</h2>
                <p className="mt-3 text-sm text-zinc-700 dark:text-white/70">
                  {marketEntry.description}
                </p>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </main>
  )
}
