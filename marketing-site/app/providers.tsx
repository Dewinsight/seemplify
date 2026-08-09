'use client'

import { useEffect, useState } from 'react'
import MarketingConsentBanner from '@/components/MarketingConsentBanner'
import { MARKETING_CONSENT_OPEN_EVENT } from '@/components/MarketingPrivacyChoices'
import MarketingAttributionTracker from '@/components/MarketingAttributionTracker'
import {
  readMarketingConsent,
  type MarketingConsentChoice,
  writeMarketingConsent,
} from '@/lib/marketingConsent'
import { clearAttributionState } from '@/lib/marketingAttribution'

export function Providers({ children }: { children: React.ReactNode }) {
  const [consent, setConsent] = useState<MarketingConsentChoice | null | undefined>(undefined)
  const [isChoicePanelOpen, setIsChoicePanelOpen] = useState(false)
  const [isMarketingConsentHost, setIsMarketingConsentHost] = useState(false)

  useEffect(() => {
    const isAkwaIbomHost = window.location.hostname.toLowerCase().includes('akwaibom')
    if (isAkwaIbomHost) return

    setIsMarketingConsentHost(true)
    const savedConsent = readMarketingConsent()
    if (savedConsent === 'declined') clearAttributionState()
    setConsent(savedConsent)

    const openChoices = () => setIsChoicePanelOpen(true)
    window.addEventListener(MARKETING_CONSENT_OPEN_EVENT, openChoices)
    return () => window.removeEventListener(MARKETING_CONSENT_OPEN_EVENT, openChoices)
  }, [])

  const choose = (choice: MarketingConsentChoice) => {
    writeMarketingConsent(choice)
    if (choice === 'declined') clearAttributionState()
    setConsent(choice)
    setIsChoicePanelOpen(false)
  }

  const shouldShowChoices =
    isMarketingConsentHost && consent !== undefined && (consent === null || isChoicePanelOpen)

  return (
    <>
      {isMarketingConsentHost && consent === 'accepted' && <MarketingAttributionTracker />}
      {children}
      {shouldShowChoices && (
        <MarketingConsentBanner
          currentChoice={consent}
          onAccept={() => choose('accepted')}
          onDecline={() => choose('declined')}
          onClose={consent ? () => setIsChoicePanelOpen(false) : undefined}
        />
      )}
    </>
  )
}
