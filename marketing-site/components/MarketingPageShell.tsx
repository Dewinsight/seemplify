import type { ReactNode } from 'react'
import MarketingFooter from '@/components/MarketingFooter'
import MarketingHeader from '@/components/MarketingHeader'

export default function MarketingPageShell({ children }: { children: ReactNode }) {
  return (
    <div className="marketing-page">
      <MarketingHeader />
      <main>{children}</main>
      <MarketingFooter />
    </div>
  )
}
