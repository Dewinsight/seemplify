import type { MetadataRoute } from 'next'
import { headers } from 'next/headers'
import { getSiteConfig } from './site-config'

export default async function robots(): Promise<MetadataRoute.Robots> {
  const requestHeaders = await headers()
  const host = requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host') ?? ''
  const config = getSiteConfig(host.toLowerCase())

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/'],
      },
    ],
    sitemap: `${config.url}/sitemap.xml`,
    host: config.url,
  }
}
