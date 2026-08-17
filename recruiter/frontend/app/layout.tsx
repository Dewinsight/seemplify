// RootLayout is a Server Component by default, metadata can be exported here.
import type React from "react"
import type { Metadata } from "next"
import { headers } from "next/headers"
import { IBM_Plex_Sans, Inter, Space_Grotesk } from "next/font/google"
import { detectBrandFromHostname } from "@/config/brands"
import "./globals.css"
import "./responsive-fixes.css"
import "../styles/suite-theme.css"
import "../styles/metro-layout.css"
import "../styles/multi-step-scheduler-scoped.css"
import "../styles/dialog-overrides.css"
import "../styles/no-scrollbar.css"
import "../styles/workflow-reactflow.css"
import "./input-zoom-fix.css"
import "./ios-zoom-fix.css"
import "./login-responsive-fix.css"
import "./jetstone-theme.css"
import "../styles/ai-interview-brand.css"

import { ConfigThemeProvider } from "@/components/env-theme-provider"
import { Toaster } from "@/components/ui/toaster"
import ErrorBoundary from "@/components/ErrorBoundary"; // Import error boundary
import ConditionalProviders from "@/components/ConditionalProviders"; // Import conditional providers wrapper
import MaintenanceMode from "@/components/MaintenanceMode";
import { ChristmasPopup } from "@/components/ChristmasPopup";
import Script from 'next/script'
import { themeInitScript } from '@/lib/theme-sync'

const inter = Inter({ subsets: ["latin"] })
const suiteSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-suite-sans",
})
const suiteDisplay = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-suite-display",
})

export async function generateMetadata(): Promise<Metadata> {
  const h = await headers()
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "").toLowerCase()
  const brand = detectBrandFromHostname(host)
  const title = brand.metaTitle ?? brand.name
  const description = brand.metaDescription ?? brand.tagline

  return {
    title,
    description,
    generator: "v0.dev",
    openGraph: {
      title,
      description,
      siteName: brand.name,
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  }
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Load runtime configuration before any other scripts */}
        <Script src="/__runtime_config__.js" strategy="beforeInteractive" />
        <Script src="https://auth.seemplifyai.com/js/seemplify-browser-realtime.js?v=1" strategy="afterInteractive" />
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=0" />
      </head>
      <body className={`${inter.className} ${suiteSans.variable} ${suiteDisplay.variable}`}>
        <ErrorBoundary>
          <ConfigThemeProvider attribute="class" enableSystem disableTransitionOnChange>
            <MaintenanceMode />
            <ConditionalProviders>{children}</ConditionalProviders>
            <Toaster />
            <ChristmasPopup />
          </ConfigThemeProvider>
        </ErrorBoundary>
      </body>
    </html>
  )
}
