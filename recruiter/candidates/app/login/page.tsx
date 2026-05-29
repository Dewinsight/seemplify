"use client"

import Link from "next/link"
import { FormEvent, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowRight, Lock, Mail } from "lucide-react"
import { toast } from "sonner"
import { CandidateBrandMark } from "@/components/candidate-brand-mark"
import { login } from "@/lib/api"
import { useCandidateBrand } from "@/lib/use-candidate-brand"

export default function CandidateLoginPage() {
  const router = useRouter()
  const brand = useCandidateBrand()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [submitting, setSubmitting] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    try {
      setSubmitting(true)
      await login(email, password)
      router.push("/dashboard")
    } catch (error: any) {
      toast.error(error.message || "Login failed")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="min-h-screen px-4 py-8">
      <div className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-6xl items-center gap-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(420px,1fr)]">
        <section className="hidden lg:block">
          <div className="max-w-xl">
            <div className="mb-6">
              <CandidateBrandMark brand={brand} />
            </div>
            <div className={`mb-5 inline-flex rounded-md border px-3 py-1 text-sm font-medium ${brand.accentBorderClass} ${brand.accentBgClass} ${brand.accentTextClass}`}>
              {brand.loginEyebrow}
            </div>
            <h1 className="text-5xl font-semibold tracking-tight text-slate-950">{brand.loginHeading}</h1>
            <p className="mt-5 text-lg leading-8 text-slate-600">
              {brand.loginDescription}
            </p>
          </div>
        </section>

        <section className="rounded-md border border-slate-200 bg-white p-6 shadow-soft sm:p-8">
          <div className="mb-8">
            <div className="mb-4 lg:hidden">
              <CandidateBrandMark brand={brand} compact />
            </div>
            <div className={`text-sm font-semibold uppercase tracking-wide ${brand.accentTextClass}`}>Candidate login</div>
            <h2 className="mt-2 text-3xl font-semibold text-slate-950">Welcome back</h2>
            <p className="mt-2 text-sm text-slate-600">Use the candidate portal password you created from your invitation.</p>
          </div>

          <form className="space-y-4" onSubmit={submit}>
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">Email</span>
              <div className="relative">
                <Mail className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                <input
                  className={`h-11 w-full rounded-md border border-slate-300 bg-white pl-10 pr-3 text-slate-950 outline-none transition focus:ring-2 ${brand.focusRingClass}`}
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </div>
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">Password</span>
              <div className="relative">
                <Lock className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                <input
                  className={`h-11 w-full rounded-md border border-slate-300 bg-white pl-10 pr-3 text-slate-950 outline-none transition focus:ring-2 ${brand.focusRingClass}`}
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
              </div>
            </label>

            <button
              className={`inline-flex h-11 w-full items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-60 ${brand.primaryButtonClass}`}
              disabled={submitting}
            >
              {submitting ? "Signing in..." : "Sign in"}
              <ArrowRight className="h-4 w-4" />
            </button>
          </form>

          <p className="mt-6 text-sm text-slate-600">
            First time here? Open the invite link from your recruiter or go to{" "}
            <Link className={`font-medium hover:underline ${brand.accentTextClass}`} href="/signup">candidate signup</Link>.
          </p>
        </section>
      </div>
    </main>
  )
}
