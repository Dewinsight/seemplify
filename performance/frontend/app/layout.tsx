import type { Metadata } from "next";
import { Manrope, Sora } from "next/font/google";
import "./globals.css";
import ThemeRegistry from "./ThemeRegistry";
import Providers from "./Providers";
import ConditionalLayout from "@/components/ConditionalLayout";

const bodyFont = Manrope({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

const displayFont = Sora({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

// Force all pages to be dynamic
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Performance Management - SmartHR",
  description: "AI-powered performance conversations, reviews, and growth planning.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-scroll-behavior="smooth" suppressHydrationWarning>
      <body className={`${bodyFont.variable} ${displayFont.variable}`} suppressHydrationWarning>
        <Providers>
          <ThemeRegistry>
            <ConditionalLayout>{children}</ConditionalLayout>
          </ThemeRegistry>
        </Providers>
      </body>
    </html>
  );
}
