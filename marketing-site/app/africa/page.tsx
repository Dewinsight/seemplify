import type { Metadata } from 'next'
import Link from 'next/link'
import JsonLd from '@/components/JsonLd'
import {
  africaFaqs,
  broaderEnglishSpeakingAfricanCountries,
  primaryMarkets,
} from '../seo-markets'
import { absoluteUrl, siteConfig } from '../site-config'

export const metadata: Metadata = {
  title: 'AI Software for Africa',
  description:
    'Discover Seemplify AI software for Africa, with dedicated market positioning for Nigeria, Ghana, Kenya, South Africa, and English-speaking African teams.',
  keywords: [
    'AI software Africa',
    'AI platform Africa',
    'team operations software Africa',
    'AI software English-speaking Africa',
  ],
  alternates: {
    canonical: '/africa',
    languages: {
      en: '/africa',
    },
  },
  openGraph: {
    title: 'AI Software for Africa | Seemplify',
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
        alt: 'Seemplify AI software for Africa',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'AI Software for Africa | Seemplify',
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
      name: 'AI Software for Africa',
      url: absoluteUrl('/africa'),
      description:
        'Market overview page for AI software across Africa, focused on Nigeria, Ghana, Kenya, South Africa, and English-speaking African countries.',
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

export default function AfricaPage() {
  return (
    <main className="min-h-screen bg-[#f7f7fb] px-6 py-24 text-zinc-900 dark:bg-[#020205] dark:text-white">
      <JsonLd data={africaStructuredData} />

      <div className="mx-auto max-w-6xl">
        <div className="max-w-4xl">
          <p className="text-xs uppercase tracking-[0.35em] text-emerald-700 dark:text-emerald-300">
            Africa Coverage
          </p>
          <h1 className="mt-4 font-display text-5xl tracking-tight md:text-6xl">
            AI software for Nigeria, Ghana, Kenya, South Africa, and English-speaking Africa.
          </h1>
          <p className="mt-6 max-w-3xl text-lg text-zinc-700 dark:text-white/75">
            Explore how Seemplify supports teams across key African growth markets. Use the
            country pages below to see the product in the context of your operating footprint.
          </p>
        </div>

        <section className="mt-16 grid gap-6 md:grid-cols-2 xl:grid-cols-4">
          {primaryMarkets.map((market) => (
            <Link
              key={market.slug}
              href={`/africa/${market.slug}`}
              className="rounded-3xl border border-black/10 bg-white p-8 shadow-sm transition hover:-translate-y-1 hover:border-emerald-500/40 dark:border-white/10 dark:bg-white/[0.04]"
            >
              <p className="text-xs uppercase tracking-[0.3em] text-zinc-500 dark:text-white/50">
                {market.country}
              </p>
              <h2 className="mt-4 font-display text-3xl">{market.headline}</h2>
              <p className="mt-4 text-sm text-zinc-600 dark:text-white/70">{market.description}</p>
              <p className="mt-6 text-sm font-medium text-emerald-700 dark:text-emerald-300">
                Explore market page
              </p>
            </Link>
          ))}
        </section>

        <section className="mt-20 grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-3xl border border-black/10 bg-white p-10 dark:border-white/10 dark:bg-white/[0.04]">
            <p className="text-xs uppercase tracking-[0.35em] text-zinc-600 dark:text-white/60">
              Broader Coverage
            </p>
            <h2 className="mt-4 font-display text-4xl">
              Built for English-speaking African teams beyond the major hubs.
            </h2>
            <p className="mt-4 text-zinc-700 dark:text-white/75">
              Seemplify is designed for regional teams that need consistent recruiting, onboarding,
              employee operations, leave, and performance workflows across multiple countries.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              {broaderEnglishSpeakingAfricanCountries.map((country) => (
                <span
                  key={country}
                  className="rounded-full border border-black/10 bg-zinc-50 px-4 py-2 text-sm dark:border-white/10 dark:bg-white/[0.04]"
                >
                  {country}
                </span>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-black/10 bg-[#0b2f29] p-10 text-white dark:border-white/10">
            <p className="text-xs uppercase tracking-[0.35em] text-white/60">What Teams Need</p>
            <h2 className="mt-4 font-display text-4xl">
              Core priorities for growing teams across Africa.
            </h2>
            <ul className="mt-6 grid gap-4 text-sm text-white/75">
              <li>Faster hiring coordination</li>
              <li>Cleaner employee records</li>
              <li>Consistent onboarding journeys</li>
              <li>Reliable leave and approval workflows</li>
              <li>Performance management at scale</li>
              <li>Multi-country operational visibility</li>
            </ul>
          </div>
        </section>

        <section className="mt-20">
          <p className="text-xs uppercase tracking-[0.35em] text-zinc-600 dark:text-white/60">
            FAQ
          </p>
          <div className="mt-6 grid gap-4">
            {africaFaqs.map((faq) => (
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
      </div>
    </main>
  )
}
