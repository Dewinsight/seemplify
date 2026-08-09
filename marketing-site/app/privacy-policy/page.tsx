import type { Metadata } from 'next'
import Link from 'next/link'
import MarketingPageShell from '@/components/MarketingPageShell'
import '../legal-pages.css'

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'Read the Seemplify privacy policy.',
  alternates: {
    canonical: '/privacy-policy',
    languages: {
      en: '/privacy-policy',
    },
  },
  openGraph: {
    title: 'Privacy Policy | Seemplify',
    description: 'Read the Seemplify privacy policy.',
    url: '/privacy-policy',
  },
}

const sections = [
  {
    id: 'introduction',
    title: 'Introduction',
    content: (
      <p>
        Welcome to Seemplify (&quot;we,&quot; &quot;our,&quot; or &quot;us&quot;). We are committed to protecting your personal information and your right to privacy.
        When you use our platform and related services, you trust us with your personal data. We take that trust seriously.
        This privacy policy seeks to explain to you in the clearest way possible what information we collect, how we use it,
        and what rights you have in relation to it.
      </p>
    ),
  },
  {
    id: 'information-we-collect',
    title: 'Information We Collect',
    content: (
      <>
        <p>
          We collect personal information that you voluntarily provide to us when you register on the Services,
          express an interest in obtaining information about us or our products and Services, when you participate in activities
          on the Services, or otherwise when you contact us.
        </p>
        <ul>
          <li><strong>Personal Identity Information:</strong> Name, contact details, job title, and company information.</li>
          <li><strong>Employment Data:</strong> Information related to your employment, performance reviews, and organizational role if applicable.</li>
          <li><strong>Demo Request Information:</strong> The name, work email, company, role, and message you choose to submit when requesting a walkthrough.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'optional-analytics',
    title: 'Optional Analytics Data',
    content: (
      <>
        <p>
          Marketing analytics are off until you choose to accept them. If you accept, we create random visitor and session identifiers
          and collect the page URL and path you visit, the referring page, the first landing page, campaign parameters such as UTM source,
          medium, campaign, term, and content, and the label of a marketing call-to-action you select.
        </p>
        <p>
          We use this information to understand how people find and use the marketing site, which product information is useful,
          and whether a visit leads to a demo request. The information is sent to Seemplify service infrastructure used for marketing measurement.
        </p>
      </>
    ),
  },
  {
    id: 'storage-and-choices',
    title: 'Storage and Your Choices',
    content: (
      <>
        <p>
          If you accept optional analytics, local storage keeps the visitor identifier and campaign, landing-page, and referrer information.
          Session storage keeps the most recent session activity time. A new session identifier is created after 30 minutes of inactivity.
          We also save your analytics choice so the site can continue to respect it.
        </p>
        <p>
          If you decline, the marketing site does not create analytics identifiers, persist attribution information, or send page-view and
          call-to-action analytics. Declining does not affect navigation, sign-in, or the demo request form. You can review or change your choice
          at any time through <strong>Privacy choices</strong> in the site footer. Turning analytics off clears the attribution information stored by this site.
        </p>
        <p>
          The site may still use functional storage for choices such as theme and market context. These settings support the experience you request
          and are separate from optional marketing analytics.
        </p>
      </>
    ),
  },
  {
    id: 'how-we-use-your-information',
    title: 'How We Use Your Information',
    content: (
      <p>
        We use personal information collected via our Services for a variety of business purposes described below.
        We process your personal information for these purposes in reliance on our legitimate business interests,
        in order to enter into or perform a contract with you, with your consent, and/or for compliance with our legal obligations.
        We use the information to manage user accounts, send administrative information to you, and protect our Services.
      </p>
    ),
  },
  {
    id: 'data-security',
    title: 'Data Security',
    content: (
      <p>
        We have implemented appropriate technical and organizational security measures designed to protect the security of any
        personal information we process. However, despite our safeguards and efforts to secure your information, no electronic
        transmission over the Internet or information storage technology can be guaranteed to be 100% secure, so we cannot promise
        or guarantee that hackers, cybercriminals, or other unauthorized third parties will not be able to defeat our security
        and improperly collect, access, steal, or modify your information.
      </p>
    ),
  },
  {
    id: 'contact-us',
    title: 'Contact Us',
    content: (
      <p>
        If you have questions or comments about this policy, you may email us at{' '}
        <a href="mailto:privacy@seemplify.com">privacy@seemplify.com</a>.
      </p>
    ),
  },
]

export default function PrivacyPolicy() {
  return (
    <MarketingPageShell>
      <header className="legal-page__hero">
        <div className="marketing-container legal-page__hero-inner">
          <nav className="legal-page__breadcrumb" aria-label="Breadcrumb">
            <Link href="/">Home</Link>
            <span aria-hidden="true">/</span>
            <span aria-current="page">Privacy</span>
          </nav>
          <h1 id="privacy-policy-title">Privacy Policy</h1>
          <p className="legal-page__updated">
            Last updated: <time dateTime="2026-08-09">August 9, 2026</time>
          </p>
        </div>
      </header>

      <section className="legal-page__body" aria-labelledby="privacy-policy-title">
        <div className="marketing-container legal-page__layout">
          <nav className="legal-page__contents" aria-label="Privacy policy sections">
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
