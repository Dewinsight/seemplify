import type { Metadata } from "next"
import type { ReactNode } from "react"
import { headers } from "next/headers"
import { Toaster } from "sonner"
import { CandidateBrandProvider } from "@/components/candidate-brand-provider"
import { detectCandidateBrandFromHostname } from "@/lib/brand"
import "./globals.css"

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
      <body>
        <CandidateBrandProvider initialBrand={brand}>
          {children}
          <Toaster position="top-right" richColors />
        </CandidateBrandProvider>
      </body>
    </html>
  )
}
