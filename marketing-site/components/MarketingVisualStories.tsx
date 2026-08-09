import Image from 'next/image'
import { MapPin, ShieldCheck } from 'lucide-react'
import { ProductStoryRail } from './MarketingMotion'
import styles from './MarketingVisualStories.module.css'

export function PeopleJourneyStory() {
  return (
    <section id="how-it-works" className={styles.journeySection} aria-labelledby="visual-journey-title">
      <div className="marketing-container">
        <div className={styles.heading}>
          <div>
            <h2 id="visual-journey-title">Follow the handoff, not just the task.</h2>
            <p>
              The work changes as someone moves from candidate to colleague. Their identity and
              organisational context should not have to start over each time.
            </p>
          </div>
          <span><ShieldCheck size={17} aria-hidden="true" /> Illustrated product journey</span>
        </div>

        <div className={styles.journeyLayout}>
          <div className={styles.illustrationFrame}>
            <Image
              src="/images/seemplify-people-journey-illustration.webp"
              alt=""
              width={1536}
              height={784}
              sizes="(max-width: 900px) 100vw, 54vw"
            />
            <p aria-hidden="true">Interview / welcome / everyday work / pay review</p>
          </div>
          <div className={styles.railWrap}>
            <ProductStoryRail />
          </div>
        </div>
      </div>
    </section>
  )
}

export function DistributedWorkIllustration() {
  return (
    <figure className={styles.distributedFigure}>
      <Image
        src="/images/seemplify-distributed-work-illustration.webp"
        alt="An office manager, a remote colleague and a field employee connected across three work settings"
        width={1536}
        height={784}
        sizes="(max-width: 900px) 100vw, 56vw"
      />
      <figcaption>
        <MapPin size={17} aria-hidden="true" />
        One organisation can include office, remote and field work while keeping country-specific
        payroll coverage explicit.
      </figcaption>
    </figure>
  )
}
