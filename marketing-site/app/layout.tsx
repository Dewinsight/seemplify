import type { Metadata, Viewport } from 'next'
import { headers } from 'next/headers'
import './globals.css'
import { Providers } from './providers'
import { akwaIbomConfig, getSiteConfig } from './site-config'

const themeInitScript = `(function(){try{var valid=function(value){return value==='light'||value==='dark'||value==='system'};var cookie=function(name){var prefix=name+'=',parts=document.cookie.split(';');for(var i=0;i<parts.length;i++){var item=parts[i].trim();if(item.indexOf(prefix)===0)return decodeURIComponent(item.slice(prefix.length))}return null};var preference=cookie('seemplify_theme');if(!valid(preference)){try{preference=localStorage.getItem('seemplify-theme')}catch(_){}}if(!valid(preference))preference='system';var resolved=preference==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):preference;document.documentElement.classList.add(resolved);document.documentElement.setAttribute('data-theme',resolved);document.documentElement.style.colorScheme=resolved}catch(_){document.documentElement.setAttribute('data-theme','light')}})();`

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
          alt: `${config.name} ${config === akwaIbomConfig ? 'HR software' : 'AI software'}`,
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

