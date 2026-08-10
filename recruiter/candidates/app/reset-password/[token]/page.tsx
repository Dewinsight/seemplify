"use client"

import Link from "next/link"
import { FormEvent, useState } from "react"
import { useParams } from "next/navigation"
import { ArrowRight, CheckCircle2, Lock } from "lucide-react"
import { AuthShell } from "@/components/candidate-ui"
import { resetCandidatePassword } from "@/lib/api"
import { useCandidateBrand } from "@/lib/use-candidate-brand"

export default function CandidateResetPasswordPage() {
  const params = useParams<{ token: string }>()
  const brand = useCandidateBrand()
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [error, setError] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [complete, setComplete] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError("")

    if (password.length < 8) {
      setError("Password must be at least 8 characters")
      return
    }
    if (password.length > 128) {
      setError("Password must be no more than 128 characters")
      return
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match")
      return
    }

    try {
      setSubmitting(true)
      await resetCandidatePassword(params.token, password)
      setComplete(true)
    } catch (resetError: any) {
      setError(resetError.message || "Could not reset your password")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthShell brand={brand} eyebrow={brand.loginEyebrow} title={brand.loginHeading} description={brand.loginDescription}>
      {complete ? (
        <div aria-live="polite">
          <CheckCircle2 className={`h-9 w-9 ${brand.accentTextClass}`} />
          <h2 className="mt-5 text-2xl font-semibold text-slate-950">Password reset</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">Your candidate portal password has been updated. You can now sign in with the new password.</p>
          <Link
            href="/login"
            className={`mt-6 inline-flex h-11 w-full items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold text-white ${brand.primaryButtonClass}`}
          >
            Sign in
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      ) : (
        <>
          <div className="mb-8">
            <h2 className="text-3xl font-semibold text-slate-950">Choose a new password</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">Use at least 8 characters. Resetting your password will sign out other candidate portal sessions.</p>
          </div>

          <form className="space-y-4" onSubmit={submit}>
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">New password</span>
              <div className="relative">
                <Lock className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                <input
                  className={`h-11 w-full rounded-md border border-slate-300 bg-white pl-10 pr-3 text-slate-950 outline-none transition focus:ring-2 ${brand.focusRingClass}`}
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  minLength={8}
                  maxLength={128}
                  required
                  autoFocus
                />
              </div>
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">Confirm new password</span>
              <input
                className={`h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-slate-950 outline-none transition focus:ring-2 ${brand.focusRingClass}`}
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                minLength={8}
                maxLength={128}
                required
              />
            </label>

            {error && (
              <div role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {error}
              </div>
            )}

            <button
              className={`inline-flex h-11 w-full items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-60 ${brand.primaryButtonClass}`}
              disabled={submitting}
            >
              {submitting ? "Resetting password..." : "Reset password"}
              <ArrowRight className="h-4 w-4" />
            </button>
          </form>

          <p className="mt-6 text-sm text-slate-600">
            Link expired? <Link className={`font-medium hover:underline ${brand.accentTextClass}`} href="/forgot-password">Request another reset link</Link>.
          </p>
        </>
      )}
    </AuthShell>
  )
}
