"use client"

import { FormEvent, Suspense, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { ArrowRight, KeyRound, Lock } from "lucide-react"
import { toast } from "sonner"
import { AuthShell } from "@/components/candidate-ui"
import { acceptInvite } from "@/lib/api"
import { useCandidateBrand } from "@/lib/use-candidate-brand"

function SignupForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const brand = useCandidateBrand()
  const [token, setToken] = useState(searchParams.get("token") || "")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [submitting, setSubmitting] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters")
      return
    }
    if (password !== confirmPassword) {
      toast.error("Passwords do not match")
      return
    }

    try {
      setSubmitting(true)
      await acceptInvite(token, password)
      router.push("/dashboard")
    } catch (error: any) {
      toast.error(error.message || "Could not accept invitation")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthShell brand={brand} eyebrow={brand.signupEyebrow} title="Create a secure candidate account." description="Accept your recruiter invitation, set a password, then review and sign every onboarding document in one workspace.">
      <div className="mb-8">
        <div className={`text-sm font-semibold uppercase tracking-wide ${brand.accentTextClass}`}>{brand.signupEyebrow}</div>
        <h1 className="mt-2 text-3xl font-semibold text-slate-950">Create your portal password</h1>
        <p className="mt-2 text-sm text-slate-600">
          This account is separate from any Recruiter or employee account that may use the same email.
        </p>
      </div>

      <form className="space-y-4" onSubmit={submit}>
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-slate-700">Invitation token</span>
          <div className="relative">
            <KeyRound className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
            <input
              className={`h-11 w-full rounded-md border border-slate-300 bg-white pl-10 pr-3 text-slate-950 outline-none transition focus:ring-2 ${brand.focusRingClass}`}
              value={token}
              onChange={(event) => setToken(event.target.value)}
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
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-slate-700">Confirm password</span>
          <input
            className={`h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-slate-950 outline-none transition focus:ring-2 ${brand.focusRingClass}`}
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            required
          />
        </label>

        <button
          className={`inline-flex h-11 w-full items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-60 ${brand.primaryButtonClass}`}
          disabled={submitting}
        >
          {submitting ? "Creating account..." : "Create account"}
          <ArrowRight className="h-4 w-4" />
        </button>
      </form>

      <p className="mt-6 text-sm text-slate-600">
        Already created your password?{" "}
        <Link className={`font-medium hover:underline ${brand.accentTextClass}`} href="/login">Sign in</Link>.
      </p>
    </AuthShell>
  )
}

export default function CandidateSignupPage() {
  return (
    <Suspense fallback={<main className="p-6 text-sm text-slate-600">Loading invitation...</main>}>
      <SignupForm />
    </Suspense>
  )
}
