import type { Metadata, Viewport } from 'next'
import { headers } from 'next/headers'
import './globals.css'
import { Providers } from './providers'
import { akwaIbomConfig, getSiteConfig } from './site-config'
import { themeInitScript } from '@/lib/theme-sync'

export async function generateMetadata(): Promise<Metadata> {
  const h = await headers()
  const host = (h.get('x-forwarded-host') ?? h.get('host') ?? '').toLowerCase()
  const config = getSiteConfig(host)

  return {
    metadataBase: new URL(config.url),
    applicationName: config.name,
    title: {
      default: config.title,
      template: `%s | ${config.name}`,
    },
    description: config.description,
    keywords: [...config.keywords],
    referrer: 'origin-when-cross-origin',
    creator: config.name,
    publisher: config.name,
    category: 'business software',
    formatDetection: {
      email: false,
      address: false,
      telephone: false,
    },
    alternates: {
      canonical: '/',
      languages: {
        en: '/',
        'en-NG': '/',
        'en-GH': '/',
        'en-KE': '/',
        'en-ZA': '/',
      },
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        'max-image-preview': 'large',
        'max-snippet': -1,
        'max-video-preview': -1,
      },
    },
    openGraph: {
      title: config.title,
      description: config.description,
      type: 'website',
      url: config.url,
      siteName: config.name,
      images: [
        {
          url: config.ogImage,
          width: 1200,
          height: 630,
          alt: `${config.name} ${config === akwaIbomConfig ? 'HR software' : 'people operations platform'}`,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: config.title,
      description: config.description,
      images: [config.ogImage],
    },
    manifest: '/manifest.webmanifest',
    icons: {
      icon: config === akwaIbomConfig ? '/logoakwa.png' : '/favicon.svg',
      shortcut: config === akwaIbomConfig ? '/logoakwa.png' : '/favicon.svg',
      apple: config === akwaIbomConfig ? '/logoakwa.png' : '/favicon.svg',
    },
  }
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#efede7' },
    { media: '(prefers-color-scheme: dark)', color: '#111014' },
  ],
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="scroll-smooth" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}

