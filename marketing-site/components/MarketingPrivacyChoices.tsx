'use client'

export const MARKETING_CONSENT_OPEN_EVENT = 'seemplify-marketing-consent-open'

export default function MarketingPrivacyChoices() {
  return (
    <button
      type="button"
      className="marketing-footer__link marketing-footer__privacy-choice"
      onClick={() => window.dispatchEvent(new Event(MARKETING_CONSENT_OPEN_EVENT))}
    >
      Privacy choices
    </button>
  )
}
