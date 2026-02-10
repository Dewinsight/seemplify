"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Signup is handled by the IDP. This route redirects to login;
 * users register at the Identity Provider, then sign in here.
 */
export default function SignupRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/login");
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#050505] text-white">
      <p className="text-zinc-400">Redirecting to login…</p>
    </div>
  );
}
