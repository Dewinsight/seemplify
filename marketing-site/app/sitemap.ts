import type { MetadataRoute } from 'next'
import { headers } from 'next/headers'
import { primaryMarkets } from './seo-markets'
import { akwaIbomConfig, getSiteConfig } from './site-config'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const requestHeaders = await headers()
  const host = requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host') ?? ''
  const config = getSiteConfig(host.toLowerCase())
  const now = new Date()

  if (config === akwaIbomConfig) {
    return [{
      url: config.url,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 1,
    }]
  }

  return [
    {
      url: config.url,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 1,
    },
    {
      url: `${config.url}/africa`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.9,
    },
    ...primaryMarkets.map((market) => ({
      url: `${config.url}/africa/${market.slug}`,
      lastModified: now,
      changeFrequency: 'weekly' as const,
      priority: 0.85,
    })),
    {
      url: `${config.url}/privacy-policy`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.2,
    },
    {
      url: `${config.url}/terms`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.2,
    },
  ]
}
