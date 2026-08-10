"use client";

import { ReactNode } from "react";
import { AuthProvider } from "@/context/AuthContext";
import { PerformanceWorkspaceProvider } from "@/context/PerformanceWorkspaceContext";
import AttendancePresenceReporter from "@/components/AttendancePresenceReporter";

interface ProvidersProps {
  children: ReactNode;
}

export default function Providers({ children }: ProvidersProps) {
  // Using custom AuthProvider for OIDC-based authentication
  // No NextAuth SessionProvider needed as we handle auth with localStorage tokens
  return (
    <AuthProvider>
      <AttendancePresenceReporter />
      <PerformanceWorkspaceProvider>{children}</PerformanceWorkspaceProvider>
    </AuthProvider>
  );
}

