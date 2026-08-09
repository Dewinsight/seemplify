// RootLayout is a Server Component by default, metadata can be exported here.
import type React from "react"
import type { Metadata } from "next"
import { headers } from "next/headers"
import { Inter } from "next/font/google"
import { detectBrandFromHostname } from "@/config/brands"
import "./globals.css"
import "./responsive-fixes.css"
import "../styles/metro-layout.css"
import "../styles/multi-step-scheduler-scoped.css"
import "../styles/dialog-overrides.css"
import "../styles/no-scrollbar.css"
import "../styles/workflow-reactflow.css"
import "./input-zoom-fix.css"
import "./ios-zoom-fix.css"
import "./login-responsive-fix.css"
import "./jetstone-theme.css"

import { ConfigThemeProvider } from "@/components/env-theme-provider"
import { Toaster } from "@/components/ui/toaster"
import ErrorBoundary from "@/components/ErrorBoundary"; // Import error boundary
import ConditionalProviders from "@/components/ConditionalProviders"; // Import conditional providers wrapper
import MaintenanceMode from "@/components/MaintenanceMode";
import { ChristmasPopup } from "@/components/ChristmasPopup";
import Script from 'next/script'
import { themeInitScript } from '@/lib/theme-sync'

const inter = Inter({ subsets: ["latin"] })

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
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=0" />
      </head>
      <body className={inter.className}>
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
