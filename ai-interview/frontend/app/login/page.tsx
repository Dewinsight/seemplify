"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { LockKeyhole, Mic2 } from "lucide-react";
import { toast } from "sonner";
import { ADMIN_TOKEN_KEY, apiRequest, TOKEN_KEY } from "@/services/apiConfig";

const fieldClass = "h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100";

export default function RecruiterLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("recruiter@aiinterview.local");
  const [password, setPassword] = useState("RecruiterPass123!");
  const [loading, setLoading] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    try {
      const response = await apiRequest("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Login failed");
      localStorage.setItem(TOKEN_KEY, data.token);
      localStorage.removeItem(ADMIN_TOKEN_KEY);
      toast.success("Logged in to AI Interview.");
      router.replace("/app");
    } catch (error: any) {
      toast.error(error.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(37,99,235,0.14),transparent_34%),linear-gradient(135deg,#f8fafc_0%,#edf6ff_54%,#f6f7fb_100%)] px-4 py-10 text-slate-950">
      <section className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-5xl items-center justify-center">
        <div className="grid w-full overflow-hidden rounded-[2rem] border bg-white shadow-2xl lg:grid-cols-[1fr_440px]">
          <div className="hidden bg-slate-950 p-10 text-white lg:block">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-semibold">
              <Mic2 className="h-4 w-4" />
              Recruiter workspace
            </div>
            <h1 className="mt-8 max-w-md text-4xl font-bold leading-tight">Create voice-led AI interviews and send secure candidate links.</h1>
            <p className="mt-4 max-w-md text-sm leading-6 text-slate-300">
              This is the standalone app, backed by its own Mongo database, wallet billing, Brevo invites, scoring, and proctoring.
            </p>
          </div>
          <form onSubmit={submit} className="p-6 sm:p-10">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-950 text-white">
              <LockKeyhole className="h-5 w-5" />
            </div>
            <h2 className="mt-6 text-3xl font-bold">Recruiter login</h2>
            <p className="mt-2 text-sm text-slate-500">Use your AI Interview recruiter account.</p>
            <div className="mt-8 space-y-4">
              <label className="block space-y-1.5 text-sm font-semibold">
                Email
                <input className={fieldClass} type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
              </label>
              <label className="block space-y-1.5 text-sm font-semibold">
                Password
                <input className={fieldClass} type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" />
              </label>
            </div>
            <button disabled={loading} className="mt-6 h-12 w-full rounded-2xl bg-slate-950 text-sm font-semibold text-white disabled:opacity-60">
              {loading ? "Signing in..." : "Sign in"}
            </button>
            <div className="mt-5 flex flex-wrap justify-between gap-3 text-sm">
              <Link href="/signup" className="font-semibold text-blue-700">Create recruiter account</Link>
              <Link href="/admin/login" className="font-semibold text-slate-600">Admin login</Link>
            </div>
          </form>
        </div>
      </section>
    </main>
  );
}
