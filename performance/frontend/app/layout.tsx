import type { Metadata } from "next";
import { performanceCssTokens } from "@/lib/performance-design";
import "./globals.css";
import ThemeRegistry from "./ThemeRegistry";
import Providers from "./Providers";
import ConditionalLayout from "@/components/ConditionalLayout";
import { themeInitScript } from "@/lib/theme-sync";

// Force all pages to be dynamic
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Performance Management - Seemplify",
  description: "AI-powered performance conversations, reviews, and growth planning.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <style dangerouslySetInnerHTML={{ __html: performanceCssTokens }} />
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <Providers>
          <ThemeRegistry>
            <ConditionalLayout>{children}</ConditionalLayout>
          </ThemeRegistry>
        </Providers>
      </body>
    </html>
  );
}
