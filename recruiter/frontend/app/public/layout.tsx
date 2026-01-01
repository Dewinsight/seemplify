import type React from "react"
import { Inter } from "next/font/google"
import "../globals.css"
import "../responsive-fixes.css"
import "../../styles/metro-layout.css"

import { ConfigThemeProvider } from "@/components/env-theme-provider"
import { Toaster } from "@/components/ui/toaster"

const inter = Inter({ subsets: ["latin"] })

export default function PublicLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <ConfigThemeProvider attribute="class" enableSystem disableTransitionOnChange>
          {children}
          <Toaster />
        </ConfigThemeProvider>
      </body>
    </html>
  )
}
