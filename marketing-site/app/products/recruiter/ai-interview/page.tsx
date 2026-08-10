import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import {
  ArrowRight,
  Check,
  Clock3,
  FileText,
  MessageSquareText,
  Mic2,
  ShieldCheck,
  Sparkles,
  UserRoundCheck,
} from 'lucide-react'
import { absoluteUrl, idpUrl, siteConfig } from '@/app/site-config'
import { BookDemoButton } from '@/components/BookDemoModal'
import JsonLd from '@/components/JsonLd'
import MarketingPageShell from '@/components/MarketingPageShell'
import styles from './page.module.css'

const canonical = '/products/recruiter/ai-interview'
const summary =
  'Prepare structured interview questions, invite candidates to a guided voice or text experience, and review transcripts and scoring evidence while recruiters keep the hiring decision.'

export const metadata: Metadata = {
  title: 'AI Interview for structured candidate interviews',
  description: summary,
  alternates: { canonical },
  openGraph: {
    title: `AI Interview | ${siteConfig.name} Recruiter`,
    description: summary,
    type: 'website',
    url: absoluteUrl(canonical),
    siteName: siteConfig.name,
    images: [{
      url: '/images/seemplify-ai-interview-candidate.webp',
      width: 1536,
      height: 1024,
      alt: 'A candidate taking part in a structured remote interview',
    }],
  },
  twitter: {
    card: 'summary_large_image',
    title: `AI Interview | ${siteConfig.name} Recruiter`,
    description: summary,
    images: ['/images/seemplify-ai-interview-candidate.webp'],
  },
}

const journey = [
  {
    icon: Sparkles,
    title: 'Prepare from the role',
    description: 'Build or generate role-specific questions, scoring criteria and follow-up prompts, then set the interview timing and voice options.',
  },
  {
    icon: ShieldCheck,
    title: 'Invite the candidate',
    description: 'Send a candidate-specific interview link with a defined window, so the experience begins with the right job and question set.',
  },
  {
    icon: Mic2,
    title: 'Guide the conversation',
    description: 'Present one question at a time through voice or text, let the candidate ask for clarification and keep the interview moving within its timers.',
  },
  {
    icon: FileText,
    title: 'Return to the evidence',
    description: 'Review the transcript, time spent, question-level scoring evidence, strengths, concerns and follow-up context before choosing the next step.',
  },
]

const structuredData = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'SoftwareApplication',
      name: `${siteConfig.name} Recruiter AI Interview`,
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web',
      url: absoluteUrl(canonical),
      description: summary,
      featureList: journey.map((step) => step.title),
    },
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: siteConfig.url },
        { '@type': 'ListItem', position: 2, name: 'Recruiter', item: absoluteUrl('/products/recruiter') },
        { '@type': 'ListItem', position: 3, name: 'AI Interview', item: absoluteUrl(canonical) },
      ],
    },
  ],
}

function InterviewReviewVisual() {
  return (
    <div className={styles.reviewVisual} role="img" aria-label="Illustrative recruiter review showing an interview transcript, evidence and a human review step">
      <div className={styles.reviewHeader}>
        <div><span>Candidate interview</span><strong>Evidence ready for review</strong></div>
        <span>Human review</span>
      </div>
      <div className={styles.reviewBody}>
        <div className={styles.transcript}>
          <span>Question 04 of 06</span>
          <p>Tell us how you brought a delayed project back on track.</p>
          <div><span aria-hidden="true" /><span aria-hidden="true" /><span aria-hidden="true" /></div>
          <small>Answer transcript retained with the interview record</small>
        </div>
        <div className={styles.reviewNotes}>
          <div><Check aria-hidden="true" size={16} /><span>Evidence connected to the question</span></div>
          <div><Check aria-hidden="true" size={16} /><span>Strengths and concerns separated</span></div>
          <div><UserRoundCheck aria-hidden="true" size={16} /><span>Recruiter decides the next step</span></div>
        </div>
      </div>
    </div>
  )
}

export default function AiInterviewPage() {
  return (
    <MarketingPageShell>
      <JsonLd data={structuredData} />
      <article className={styles.page}>
        <div className="marketing-container">
          <nav className={styles.breadcrumbs} aria-label="Breadcrumb">
            <ol>
              <li><Link href="/">Home</Link></li>
              <li><Link href="/products/recruiter">Recruiter</Link></li>
              <li><span aria-current="page">AI Interview</span></li>
            </ol>
          </nav>

          <header className={styles.hero}>
            <div className={styles.heroCopy}>
              <div className={styles.eyebrow}><Mic2 aria-hidden="true" size={19} /><span>Recruiter · AI Interview</span></div>
              <h1>A structured first interview, ready when the candidate is.</h1>
              <p className={styles.heroLead}>
                Give every candidate the same clear interview path without losing the human judgement that hiring needs.
                Prepare the questions once, let people respond by voice or text, and return to evidence you can actually review.
              </p>
              <div className={styles.heroActions}>
                <Link href={idpUrl('/signup')} className="marketing-button marketing-button--primary" data-track-cta="ai-interview-start-trial">
                  Start your 7-day trial <ArrowRight aria-hidden="true" size={17} />
                </Link>
                <BookDemoButton className="marketing-button marketing-button--secondary" trackingLabel="ai-interview-book-demo">
                  Book a demo
                </BookDemoButton>
              </div>
              <p className={styles.humanBoundary}><ShieldCheck aria-hidden="true" size={17} /> AI scoring and summaries support review. They do not make the hiring decision.</p>
            </div>
            <div className={styles.heroMedia}>
              <Image
                src="/images/seemplify-ai-interview-candidate.webp"
                alt="A candidate speaking naturally during a remote structured interview"
                width={1536}
                height={1024}
                priority
                sizes="(max-width: 980px) 100vw, 54vw"
              />
              <div className={styles.mediaNote}><Mic2 aria-hidden="true" size={18} /><span>Voice or text</span><small>One question at a time</small></div>
            </div>
          </header>
        </div>

        <section className={styles.storySection} aria-labelledby="interview-journey-title">
          <div className="marketing-container">
            <div className={styles.sectionHeading}>
              <p>From an open role to a reviewable conversation</p>
              <h2 id="interview-journey-title">A better interview journey for both sides of the table.</h2>
              <span>Candidates get clarity and space to answer. Recruiters get a consistent structure and a record they can revisit.</span>
            </div>
            <ol className={styles.journey}>
              {journey.map((step, index) => {
                const Icon = step.icon
                return (
                  <li key={step.title}>
                    <div className={styles.stepNumber}>{String(index + 1).padStart(2, '0')}</div>
                    <Icon aria-hidden="true" size={22} />
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                  </li>
                )
              })}
            </ol>
          </div>
        </section>

        <section className={styles.candidateSection} aria-labelledby="candidate-experience-title">
          <div className={`marketing-container ${styles.candidateLayout}`}>
            <div className={styles.candidateCopy}>
              <p>Designed for the candidate, not the automation</p>
              <h2 id="candidate-experience-title">A conversation that explains itself as it goes.</h2>
              <p>
                The candidate opens the interview in a browser, receives a clear welcome and answers one question at a time.
                They can ask for clarification, see the time available and complete the experience without navigating a recruiter dashboard.
              </p>
              <ul>
                <li><MessageSquareText aria-hidden="true" size={18} /><span><strong>Clear pacing</strong> with one active question and visible progress.</span></li>
                <li><Mic2 aria-hidden="true" size={18} /><span><strong>Voice or text responses</strong> according to the configured interview.</span></li>
                <li><Clock3 aria-hidden="true" size={18} /><span><strong>Defined timing</strong> for the interview and individual questions.</span></li>
              </ul>
            </div>
            <div className={styles.conversation} aria-label="Illustrative candidate interview conversation">
              <div className={styles.conversationTop}><span>Interview in progress</span><strong>03 / 06</strong></div>
              <div className={styles.question}>
                <small>Interview question</small>
                <p>How do you build trust when you join a team that is already under pressure?</p>
              </div>
              <div className={styles.answer}>
                <div><Mic2 aria-hidden="true" size={18} /><strong>Your response</strong></div>
                <span className={styles.voiceLine} aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /><i /><i /></span>
                <small>You can ask for clarification before answering.</small>
              </div>
            </div>
          </div>
        </section>

        <section className={styles.reviewSection} aria-labelledby="review-evidence-title">
          <div className={`marketing-container ${styles.reviewLayout}`}>
            <div className={styles.reviewCopy}>
              <p>When the interview ends</p>
              <h2 id="review-evidence-title">The recruiter returns to the conversation—not just a number.</h2>
              <p>
                The interview record can bring together the transcript, time spent, question-level scoring evidence, strengths,
                concerns and suggested follow-up. It gives the recruiter a useful place to begin the review, while the job requirements,
                candidate record and human feedback remain in view.
              </p>
              <Link href="/products/recruiter">See everything in Recruiter <ArrowRight aria-hidden="true" size={17} /></Link>
            </div>
            <InterviewReviewVisual />
          </div>
        </section>

        <section className={styles.controlSection} aria-labelledby="ai-interview-controls-title">
          <div className="marketing-container">
            <div className={styles.sectionHeading}>
              <p>Responsible by design</p>
              <h2 id="ai-interview-controls-title">Keep the useful structure. Keep people accountable.</h2>
            </div>
            <div className={styles.controlGrid}>
              <article><h3>Candidate transparency</h3><p>The experience should clearly present itself as an AI-guided interview and explain its format before the candidate begins.</p></article>
              <article><h3>Recruiter responsibility</h3><p>Scores, rankings, summaries and concerns are review aids. A person verifies the evidence and owns the hiring outcome.</p></article>
              <article><h3>Bounded monitoring</h3><p>Configured activity events can support review, but they do not prove a candidate's identity, intent or suitability.</p></article>
              <article><h3>Workspace controls</h3><p>Question sets, timers, voice options, access windows and AI runtime availability stay tied to the configured organisation workflow.</p></article>
            </div>
          </div>
        </section>

        <section className={styles.cta}>
          <div className={`marketing-container ${styles.ctaInner}`}>
            <div><p>AI Interview in Recruiter</p><h2>Give your next candidate a clearer first conversation.</h2></div>
            <div>
              <BookDemoButton className="marketing-button marketing-button--primary" trackingLabel="ai-interview-footer-demo">Book a demo</BookDemoButton>
              <Link href="/products/recruiter" className="marketing-button marketing-button--secondary">Explore Recruiter</Link>
            </div>
          </div>
        </section>
      </article>
    </MarketingPageShell>
  )
}
