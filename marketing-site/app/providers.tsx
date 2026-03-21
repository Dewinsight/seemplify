'use client'

import { ThemeProvider } from 'next-themes'
import MarketingAttributionTracker from '@/components/MarketingAttributionTracker'

export function Providers({ children }: { children: React.ReactNode }) {
    return (
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
            <MarketingAttributionTracker />
            {children}
        </ThemeProvider>
    )
}
