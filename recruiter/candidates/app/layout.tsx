import type { Metadata } from "next"
import type { ReactNode } from "react"
import { headers } from "next/headers"
import { IBM_Plex_Sans, Space_Grotesk } from "next/font/google"
import { Toaster } from "sonner"
import { CandidateBrandProvider } from "@/components/candidate-brand-provider"
import { detectCandidateBrandFromHostname } from "@/lib/brand"
import "./globals.css"

const candidateSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-candidate-sans",
})

const candidateDisplay = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-candidate-display",
})

export async function generateMetadata(): Promise<Metadata> {
  const headersList = await headers()
  const brand = detectCandidateBrandFromHostname(headersList.get("host"))

  return {
    title: brand.metaTitle,
    description: brand.metaDescription,
    openGraph: {
      title: brand.metaTitle,
      description: brand.metaDescription,
      siteName: brand.portalName,
      images: brand.logoUrl ? [brand.logoUrl] : undefined,
    },
  }
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const headersList = await headers()
  const brand = detectCandidateBrandFromHostname(headersList.get("host"))

  return (
    <html lang="en">
      <body className={`${candidateSans.variable} ${candidateDisplay.variable}`}>
        <CandidateBrandProvider initialBrand={brand}>
          {children}
          <Toaster position="top-right" richColors />
        </CandidateBrandProvider>
      </body>
    </html>
  )
}
