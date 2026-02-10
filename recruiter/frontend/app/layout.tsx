// RootLayout is a Server Component by default, metadata can be exported here.
import type React from "react"
import { Inter } from "next/font/google"
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

import { ConfigThemeProvider } from "@/components/env-theme-provider"
import { Toaster } from "@/components/ui/toaster"
import ErrorBoundary from "@/components/ErrorBoundary"; // Import error boundary
import ConditionalProviders from "@/components/ConditionalProviders"; // Import conditional providers wrapper
import MaintenanceMode from "@/components/MaintenanceMode";
import { ChristmasPopup } from "@/components/ChristmasPopup";
import Script from 'next/script'
import { themeInitScript } from '@/lib/theme-sync'

const inter = Inter({ subsets: ["latin"] })

export const metadata = {
  title: "SMART HR",
  description: "Intelligent HR Management System",
  generator: 'v0.dev'
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
        {/* Theme sync script - reads from shared cookie before hydration */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=0" />
      </head>
      <body className={`${inter.className} bg-[rgb(var(--background-start-rgb))] relative`}>
        {/* Ambient Backgorund Gradient */}
        <div className="fixed inset-0 bg-gradient-to-br from-indigo-100/25 via-purple-100/25 to-pink-100/25 dark:from-indigo-900/18 dark:via-purple-900/18 dark:to-pink-900/18 blur-3xl pointer-events-none -z-10" />

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
