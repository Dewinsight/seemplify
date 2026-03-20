import type { MetadataRoute } from 'next'
import { primaryMarkets } from './seo-markets'
import { siteConfig } from './site-config'

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date()

  return [
    {
      url: siteConfig.url,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 1,
    },
    {
      url: `${siteConfig.url}/africa`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.9,
    },
    ...primaryMarkets.map((market) => ({
      url: `${siteConfig.url}/africa/${market.slug}`,
      lastModified: now,
      changeFrequency: 'weekly' as const,
      priority: 0.85,
    })),
    {
      url: `${siteConfig.url}/privacy-policy`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.2,
    },
    {
      url: `${siteConfig.url}/terms`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.2,
    },
  ]
}
