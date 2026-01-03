import type { Metadata } from "next";
import "./globals.css";
import ThemeRegistry from "./ThemeRegistry";
import Providers from "./Providers";
import ConditionalLayout from "@/components/ConditionalLayout";

// Force all pages to be dynamic
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Performance Management - SmartHR",
  description: "AI-Powered Performance Management System",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <Providers>
          <ThemeRegistry>
            <ConditionalLayout>{children}</ConditionalLayout>
          </ThemeRegistry>
        </Providers>
      </body>
    </html>
  );
}
