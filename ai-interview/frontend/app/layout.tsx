import type { Metadata } from "next";
import type React from "react";
import { Toaster } from "sonner";
import { PlatformAvailabilityGate } from "@/components/PlatformAvailabilityGate";
import "./globals.css";

export const metadata: Metadata = {
  title: "Seemplify AI Interview",
  description: "Standalone AI interview workflow, admin, scoring, voice, and proctoring."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <PlatformAvailabilityGate>{children}</PlatformAvailabilityGate>
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
