import type { MetadataRoute } from 'next'
import { headers } from 'next/headers'
import { getSiteConfig } from './site-config'

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const requestHeaders = await headers()
  const host = requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host') ?? ''
  const config = getSiteConfig(host.toLowerCase())

  return {
    name: config.name,
    short_name: config.shortName,
    description: config.description,
    start_url: '/',
    display: 'standalone',
    background_color: config.name === 'Akwa Ibom State' ? '#f0fdf4' : '#efede7',
    theme_color: config.name === 'Akwa Ibom State' ? '#14532d' : '#111014',
    lang: 'en',
    categories: ['business', 'productivity', 'technology'],
    icons: [
      {
        src: config.name === 'Akwa Ibom State' ? '/logoakwa.png' : '/favicon.svg',
        sizes: 'any',
        type: config.name === 'Akwa Ibom State' ? 'image/png' : 'image/svg+xml',
      },
    ],
  }
}
