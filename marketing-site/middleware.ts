import { NextResponse, type NextRequest } from 'next/server'
import { findLocalizedMarketByCountryCode } from './app/seo-markets'

const MARKET_COOKIE = 'seemplify-market'

function detectCountryCode(request: NextRequest) {
  const candidateHeaders = [
    request.headers.get('x-vercel-ip-country'),
    request.headers.get('cf-ipcountry'),
    request.headers.get('cloudfront-viewer-country'),
    request.headers.get('x-country-code'),
    request.headers.get('x-appengine-country'),
    request.headers.get('x-geo-country'),
  ]

  for (const value of candidateHeaders) {
    const normalizedValue = value?.trim().toUpperCase()

    if (normalizedValue && normalizedValue !== 'XX' && normalizedValue !== 'T1') {
      return normalizedValue
    }
  }

  return null
}

export function middleware(request: NextRequest) {
  const response = NextResponse.next()
  const market = findLocalizedMarketByCountryCode(detectCountryCode(request))

  response.cookies.set(MARKET_COOKIE, market?.slug ?? 'global', {
    path: '/',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30,
  })

  return response
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|manifest.webmanifest).*)'],
}
