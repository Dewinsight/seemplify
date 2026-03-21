'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { buildAttributedUrl, ensureAttributionState, trackMarketingVisit } from '@/lib/marketingAttribution'
import { idpUrl } from '@/app/site-config'

const TRACKING_ENDPOINT = idpUrl('/api/public/marketing/visit')

function shouldDecorate(url: string) {
  try {
    const parsed = new URL(url, window.location.origin)
    return parsed.hostname === 'auth.seemplifyai.com' || parsed.hostname.endsWith('.seemplifyai.com')
  } catch {
    return false
  }
}

export default function MarketingAttributionTracker() {
  const pathname = usePathname()

  useEffect(() => {
    ensureAttributionState(window.location.search)
    trackMarketingVisit(TRACKING_ENDPOINT, {
      eventType: 'page_view',
      sourceApp: 'marketing-site',
      source: 'marketing-site',
      channel: 'web',
      pageUrl: window.location.href,
      path: pathname,
      referrer: document.referrer,
    }).catch(() => {})
  }, [pathname])

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      const trackable = target?.closest('[data-track-cta]')
      const anchor = target?.closest('a')

      if (trackable) {
        trackMarketingVisit(TRACKING_ENDPOINT, {
          eventType: 'cta_click',
          sourceApp: 'marketing-site',
          source: 'marketing-site',
          channel: 'web',
          pageUrl: window.location.href,
          path: pathname,
          referrer: document.referrer,
          eventLabel: trackable.getAttribute('data-track-cta') || '',
        }).catch(() => {})
      }

      if (anchor && anchor.href && shouldDecorate(anchor.href)) {
        anchor.href = buildAttributedUrl(anchor.href)
      }
    }

    document.addEventListener('click', handleClick, true)
    return () => document.removeEventListener('click', handleClick, true)
  }, [pathname])

  return null
}
