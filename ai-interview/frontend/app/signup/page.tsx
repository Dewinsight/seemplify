"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { UserPlus } from "lucide-react";
import { toast } from "sonner";
import { ADMIN_TOKEN_KEY, apiRequest, TOKEN_KEY } from "@/services/apiConfig";

const fieldClass = "h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100";

export default function RecruiterSignupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    try {
      const response = await apiRequest("/api/auth/signup", {
        method: "POST",
        body: JSON.stringify({ name, email, password })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Signup failed");
      localStorage.setItem(TOKEN_KEY, data.token);
      localStorage.removeItem(ADMIN_TOKEN_KEY);
      toast.success("Recruiter account created.");
      router.replace("/app");
    } catch (error: any) {
      toast.error(error.message || "Signup failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-[linear-gradient(135deg,#f8fafc_0%,#eef6ff_54%,#f6f7fb_100%)] px-4 py-10 text-slate-950">
      <section className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-xl items-center">
        <form onSubmit={submit} className="w-full rounded-[2rem] border bg-white p-6 shadow-2xl sm:p-10">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-600 text-white">
            <UserPlus className="h-5 w-5" />
          </div>
          <h1 className="mt-6 text-3xl font-bold">Create recruiter account</h1>
          <p className="mt-2 text-sm text-slate-500">Admin can disable public signup from the standalone admin console.</p>
          <div className="mt-8 space-y-4">
            <label className="block space-y-1.5 text-sm font-semibold">Full name
              <input className={fieldClass} value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" />
            </label>
            <label className="block space-y-1.5 text-sm font-semibold">Email
              <input className={fieldClass} type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
            </label>
            <label className="block space-y-1.5 text-sm font-semibold">Password
              <input className={fieldClass} type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" />
            </label>
          </div>
          <button disabled={loading} className="mt-6 h-12 w-full rounded-2xl bg-slate-950 text-sm font-semibold text-white disabled:opacity-60">
            {loading ? "Creating account..." : "Create account"}
          </button>
          <div className="mt-5 text-sm">
            <Link href="/login" className="font-semibold text-blue-700">Already have an account? Sign in</Link>
          </div>
        </form>
      </section>
    </main>
  );
}
