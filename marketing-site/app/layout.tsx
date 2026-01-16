import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Seemplify AI - Transform Your HR Operations',
  description: 'AI-powered HR management platform. Streamline recruitment, leave management, performance reviews, and payroll with intelligent automation.',
  keywords: 'HR software, AI recruitment, leave management, performance management, payroll, HRIS',
  openGraph: {
    title: 'Seemplify AI - Transform Your HR Operations',
    description: 'AI-powered HR management platform for modern businesses',
    type: 'website',
    url: 'https://seemplifyai.com',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="scroll-smooth">
      <body className={`${inter.className} antialiased`}>
        {children}
      </body>
    </html>
  )
}
