"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { ADMIN_TOKEN_KEY, apiRequest, TOKEN_KEY } from "@/services/apiConfig";

const fieldClass = "h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100";

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("admin@aiinterview.local");
  const [password, setPassword] = useState("AdminPass123!");
  const [loading, setLoading] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    try {
      const response = await apiRequest("/api/admin/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Admin login failed");
      localStorage.setItem(ADMIN_TOKEN_KEY, data.token);
      localStorage.removeItem(TOKEN_KEY);
      toast.success("Admin signed in.");
      router.replace("/admin");
    } catch (error: any) {
      toast.error(error.message || "Admin login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-10 text-white">
      <section className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-xl items-center">
        <form onSubmit={submit} className="w-full rounded-[2rem] border border-white/10 bg-white p-6 text-slate-950 shadow-2xl sm:p-10">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-950 text-white">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <h1 className="mt-6 text-3xl font-bold">Standalone admin login</h1>
          <p className="mt-2 text-sm text-slate-500">Manage only the AI Interview app: pricing, wallet, users, email, and demo data.</p>
          <div className="mt-8 space-y-4">
            <label className="block space-y-1.5 text-sm font-semibold">Admin email
              <input className={fieldClass} type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
            </label>
            <label className="block space-y-1.5 text-sm font-semibold">Password
              <input className={fieldClass} type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" />
            </label>
          </div>
          <button disabled={loading} className="mt-6 h-12 w-full rounded-2xl bg-slate-950 text-sm font-semibold text-white disabled:opacity-60">
            {loading ? "Signing in..." : "Sign in as admin"}
          </button>
          <div className="mt-5 text-sm">
            <Link href="/login" className="font-semibold text-blue-700">Back to recruiter login</Link>
          </div>
        </form>
      </section>
    </main>
  );
}
