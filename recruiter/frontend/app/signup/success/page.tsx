"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Signup is handled by the IDP. This route redirects authenticated users
 * to organization check, or to login if not authenticated.
 */
export default function SignupSuccessRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    if (typeof window !== "undefined") {
      const hasJwt = !!localStorage.getItem("jwt");
      router.replace(hasJwt ? "/organization/check" : "/login");
    }
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#050505] text-white">
      <p className="text-zinc-400">Redirecting…</p>
    </div>
  );
}
