import type { Metadata } from 'next'
import Link from 'next/link'
import MarketingPageShell from '@/components/MarketingPageShell'
import '../legal-pages.css'

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: 'Read the Seemplify terms of service.',
  alternates: {
    canonical: '/terms',
    languages: {
      en: '/terms',
    },
  },
  openGraph: {
    title: 'Terms of Service | Seemplify',
    description: 'Read the Seemplify terms of service.',
    url: '/terms',
  },
}

const sections = [
  {
    id: 'agreement-to-terms',
    title: 'Agreement to Terms',
    content: (
      <p>
        These Terms of Service constitute a legally binding agreement made between you, whether personally or on behalf of an entity (&quot;you&quot;)
        and Seemplify (&quot;we,&quot; &quot;us,&quot; or &quot;our&quot;), concerning your access to and use of the Seemplify platform and related services.
        By accessing the Services, you acknowledge that you have read, understood, and agreed to be bound by all of these Terms of Service.
      </p>
    ),
  },
  {
    id: 'intellectual-property-rights',
    title: 'Intellectual Property Rights',
    content: (
      <p>
        Unless otherwise indicated, the Site and Services are our proprietary property and all source code, databases, functionality,
        software, website designs, audio, video, text, photographs, and graphics on the Site (collectively, the &quot;Content&quot;) and the trademarks,
        service marks, and logos contained therein (the &quot;Marks&quot;) are owned or controlled by us or licensed to us, and are protected by
        copyright and trademark laws.
      </p>
    ),
  },
  {
    id: 'user-representations',
    title: 'User Representations',
    content: (
      <>
        <p>By using the Services, you represent and warrant that:</p>
        <ul>
          <li>All registration information you submit will be true, accurate, current, and complete.</li>
          <li>You will maintain the accuracy of such information and promptly update such registration information as necessary.</li>
          <li>You have the legal capacity and you agree to comply with these Terms of Service.</li>
          <li>You will not access the Services through automated or non-human means, whether through a bot, script, or otherwise.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'prohibited-activities',
    title: 'Prohibited Activities',
    content: (
      <p>
        You may not access or use the Services for any purpose other than that for which we make the Services available.
        The Services may not be used in connection with any commercial endeavors except those that are specifically endorsed or approved by us.
        Systematic retrieval of data or other content from the Services to create or compile, directly or indirectly, a collection, compilation,
        database, or directory without written permission from us is prohibited.
      </p>
    ),
  },
  {
    id: 'governing-law',
    title: 'Governing Law',
    content: (
      <p>
        These Terms shall be governed by and defined following the laws of the State of Delaware.
        Seemplify and yourself irrevocably consent that the courts of Delaware shall have exclusive jurisdiction to resolve any dispute which may arise in connection with these terms.
      </p>
    ),
  },
]

export default function TermsOfService() {
  return (
    <MarketingPageShell>
      <header className="legal-page__hero">
        <div className="marketing-container legal-page__hero-inner">
          <nav className="legal-page__breadcrumb" aria-label="Breadcrumb">
            <Link href="/">Home</Link>
            <span aria-hidden="true">/</span>
            <span aria-current="page">Terms</span>
          </nav>
          <h1 id="terms-of-service-title">Terms of Service</h1>
          <p className="legal-page__updated">
            Last updated: <time dateTime="2026-01-06">January 6, 2026</time>
          </p>
        </div>
      </header>

      <section className="legal-page__body" aria-labelledby="terms-of-service-title">
        <div className="marketing-container legal-page__layout">
          <nav className="legal-page__contents" aria-label="Terms of service sections">
            <p className="legal-page__contents-title">On this page</p>
            <ol className="legal-page__contents-list">
              {sections.map((section) => (
                <li key={section.id}>
                  <a href={`#${section.id}`}>{section.title}</a>
                </li>
              ))}
            </ol>
          </nav>

          <article className="legal-page__document">
            {sections.map((section) => (
              <section
                key={section.id}
                id={section.id}
                className="legal-page__section"
                aria-labelledby={`${section.id}-title`}
              >
                <h2 id={`${section.id}-title`}>{section.title}</h2>
                <div className="legal-page__copy">{section.content}</div>
              </section>
            ))}
          </article>
        </div>
      </section>
    </MarketingPageShell>
  )
}
