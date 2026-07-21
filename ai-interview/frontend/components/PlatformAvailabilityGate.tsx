"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { CircleOff, Loader2 } from "lucide-react";
import { apiRequest } from "@/services/apiConfig";

export function PlatformAvailabilityGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAdminRoute = pathname.startsWith("/admin");
  const [isEnabled, setIsEnabled] = useState<boolean | null>(null);

  const refreshAvailability = useCallback(async () => {
    try {
      const response = await apiRequest("/api/platform/features", { cache: "no-store" });
      if (!response.ok) throw new Error("Feature settings could not be loaded");
      const payload = await response.json();
      setIsEnabled(payload.features?.aiInterviews !== false);
    } catch (error) {
      console.error("Could not refresh AI Interview availability:", error);
      setIsEnabled((current) => current ?? true);
    }
  }, []);

  useEffect(() => {
    if (isAdminRoute) return;
    refreshAvailability();

    const handleFocus = () => refreshAvailability();
    const intervalId = window.setInterval(refreshAvailability, 60_000);
    window.addEventListener("focus", handleFocus);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleFocus);
    };
  }, [isAdminRoute, refreshAvailability]);

  if (isAdminRoute) return children;

  if (isEnabled === null) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50">
        <Loader2 className="h-6 w-6 animate-spin text-slate-500" aria-label="Checking platform availability" />
      </main>
    );
  }

  if (!isEnabled) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
        <div className="w-full max-w-lg border-l-4 border-slate-300 bg-white px-6 py-8 shadow-sm">
          <CircleOff className="mb-4 h-7 w-7 text-slate-500" />
          <h1 className="text-xl font-semibold text-slate-950">AI Interview is unavailable</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            This product has been turned off by a Seemplify platform administrator.
          </p>
        </div>
      </main>
    );
  }

  return children;
}
