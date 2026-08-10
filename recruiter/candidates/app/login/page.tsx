"use client"

import Link from "next/link"
import { FormEvent, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowRight, Lock, Mail } from "lucide-react"
import { toast } from "sonner"
import { AuthShell } from "@/components/candidate-ui"
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
    <AuthShell brand={brand} eyebrow={brand.loginEyebrow} title={brand.loginHeading} description={brand.loginDescription}>
      <div className="mb-8">
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
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>
        </label>
        <div>
          <div className="mb-2 flex items-center justify-between gap-3 text-sm font-medium text-slate-700">
            <label htmlFor="candidate-password">Password</label>
            <Link className={`font-medium hover:underline ${brand.accentTextClass}`} href="/forgot-password">
              Forgot password?
            </Link>
          </div>
          <div className="relative">
            <Lock className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
            <input
              id="candidate-password"
              className={`h-11 w-full rounded-md border border-slate-300 bg-white pl-10 pr-3 text-slate-950 outline-none transition focus:ring-2 ${brand.focusRingClass}`}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </div>
        </div>

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
    </AuthShell>
  )
}
