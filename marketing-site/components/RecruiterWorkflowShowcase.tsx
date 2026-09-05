import {
  ArrowRight,
  BriefcaseBusiness,
  FileUp,
  ScanSearch,
  UserRoundCheck,
} from 'lucide-react'
import ThemedImage from '@/components/ThemedImage'
import Link from 'next/link'
import styles from './RecruiterWorkflowShowcase.module.css'

const workflow = [
  'Open role',
  'Candidate intake',
  'Match and shortlist',
  'Interview',
  'Decision',
]

const views = [
  {
    eyebrow: 'Candidate intake',
    title: 'Bring every application into one usable talent record.',
    description:
      'Receive applications or add candidates directly. For high-volume hiring, upload CVs in bulk and let Recruiter keep the processing state visible while each file becomes a record the team can review.',
    detail: 'Bulk upload supports PDF, DOC and DOCX files, with a clear route back to the candidate workspace.',
    image: '/images/product-showcases/recruiter-cv-upload.png',
    width: 1669,
    height: 980,
    alt: 'Recruiter bulk CV upload workspace with a large drag-and-drop area for candidate files',
    label: 'Bulk CV upload',
    crop: 'upload',
    Icon: FileUp,
  },
  {
    eyebrow: 'AI matching and pipeline',
    title: 'Review fit in the context of the role—not in a separate AI tool.',
    description:
      'Open a job to review applicants, hiring stages, interviews, insights and questions together. When AI matching is enabled, ranked suggestions and explanation controls sit beside the shortlist so recruiters can verify the evidence and move the pipeline themselves.',
    detail: 'The role, applicants, shortlist and hiring pipeline stay connected to the same job record.',
    image: '/images/product-showcases/recruiter.png',
    width: 1982,
    height: 973,
    alt: 'Recruiter job workspace showing applicants, hiring pipeline, interviews and AI matching for an open role',
    label: 'Role and matching workspace',
    crop: 'full',
    Icon: ScanSearch,
  },
  {
    eyebrow: 'Candidate experience',
    title: 'Give candidates a focused interview workspace of their own.',
    description:
      'Candidates follow the question sequence, see their progress and answer by text or voice without entering the recruiter dashboard. The hiring team can return to the transcript and question-level evidence before deciding what happens next.',
    detail: 'The candidate sees the active question, time remaining, progress and answer controls in one place.',
    image: '/images/product-showcases/recruiter-candidate-interview.png',
    width: 1957,
    height: 926,
    alt: 'Candidate-facing AI Interview workspace showing question progress, interviewer messages and answer controls',
    label: 'Candidate AI Interview',
    crop: 'full',
    Icon: UserRoundCheck,
    href: '/products/recruiter/ai-interview',
  },
]

export default function RecruiterWorkflowShowcase() {
  return (
    <section className={styles.section} aria-labelledby="recruiter-workspace-story-title">
      <div className="marketing-container">
        <header className={styles.heading}>
          <div>
            <span><BriefcaseBusiness aria-hidden="true" size={17} /> Complete recruiting workflow</span>
            <h2 id="recruiter-workspace-story-title">More than interviews. One workspace from role to decision.</h2>
          </div>
          <p>
            Recruiter covers the work before, during and after an interview: publishing roles, receiving and uploading candidates,
            reviewing matches, managing the pipeline, gathering evidence and recording the outcome.
          </p>
        </header>

        <ol className={styles.workflow} aria-label="Recruiter workflow">
          {workflow.map((step, index) => (
            <li key={step}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              <strong>{step}</strong>
            </li>
          ))}
        </ol>

        <div className={styles.views}>
          {views.map(({ Icon, ...view }, index) => (
            <article className={styles.view} key={view.eyebrow}>
              <div className={styles.copy}>
                <div className={styles.viewNumber}>{String(index + 1).padStart(2, '0')}</div>
                <span className={styles.eyebrow}><Icon aria-hidden="true" size={17} /> {view.eyebrow}</span>
                <h3>{view.title}</h3>
                <p>{view.description}</p>
                <div className={styles.detail}>{view.detail}</div>
                {view.href ? (
                  <Link href={view.href}>Explore AI Interview <ArrowRight aria-hidden="true" size={17} /></Link>
                ) : null}
              </div>

              <figure className={styles.capture} data-capture={view.crop}>
                <div className={styles.captureBar}>
                  <strong>Recruiter</strong>
                  <span>{view.label}</span>
                </div>
                <ThemedImage
                  src={view.image}
                  alt={view.alt}
                  width={view.width}
                  height={view.height}
                  sizes="(max-width: 900px) 100vw, 58vw"
                />
              </figure>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
