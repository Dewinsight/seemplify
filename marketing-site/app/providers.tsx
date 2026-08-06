'use client'

import MarketingAttributionTracker from '@/components/MarketingAttributionTracker'

export function Providers({ children }: { children: React.ReactNode }) {
    return (
        <>
            <MarketingAttributionTracker />
            {children}
        </>
    )
}
