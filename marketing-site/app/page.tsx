import { headers } from 'next/headers'
import AkwaIbomHomePage from '@/components/AkwaIbomHomePage'
import MarketingHomePage from '@/components/MarketingHomePage'

export default async function HomePage() {
  const requestHeaders = await headers()
  const hostname = (
    requestHeaders.get('x-forwarded-host') ??
    requestHeaders.get('host') ??
    ''
  ).toLowerCase()

  if (hostname.includes('akwaibom')) {
    return <AkwaIbomHomePage />
  }

  return <MarketingHomePage initialHostname={hostname} />
}
