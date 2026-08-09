'use client'

import Link from 'next/link'
import type { MarketingConsentChoice } from '@/lib/marketingConsent'

type MarketingConsentBannerProps = {
  currentChoice: MarketingConsentChoice | null
  onAccept: () => void
  onDecline: () => void
  onClose?: () => void
}

export default function MarketingConsentBanner({
  currentChoice,
  onAccept,
  onDecline,
  onClose,
}: MarketingConsentBannerProps) {
  return (
    <section className="marketing-consent" aria-label="Privacy choices">
      <div className="marketing-container marketing-consent__inner">
        <div className="marketing-consent__copy">
          <strong>Optional analytics</strong>
          <p>
            With your permission, Seemplify stores random visitor and session identifiers to understand page visits and demo interest.{' '}
            <Link href="/privacy-policy">Read the privacy policy</Link>.
          </p>
          {currentChoice && (
            <span>Your current choice is {currentChoice === 'accepted' ? 'analytics on' : 'analytics off'}.</span>
          )}
        </div>
        <div className="marketing-consent__actions">
          <button type="button" className="marketing-consent__decline" onClick={onDecline}>
            {currentChoice === 'accepted' ? 'Turn off analytics' : 'Decline'}
          </button>
          <button type="button" className="marketing-consent__accept" onClick={onAccept}>
            {currentChoice === 'declined' ? 'Turn on analytics' : 'Accept analytics'}
          </button>
          {currentChoice && onClose && (
            <button type="button" className="marketing-consent__close" onClick={onClose}>
              Keep current choice
            </button>
          )}
        </div>
      </div>
    </section>
  )
}
