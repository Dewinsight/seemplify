"use client"

import Link from "next/link"
import { FormEvent, useState } from "react"
import { ArrowLeft, ArrowRight, CheckCircle2, Mail } from "lucide-react"
import { toast } from "sonner"
import { AuthShell } from "@/components/candidate-ui"
import { requestCandidatePasswordReset } from "@/lib/api"
import { useCandidateBrand } from "@/lib/use-candidate-brand"

export default function CandidateForgotPasswordPage() {
  const brand = useCandidateBrand()
  const [email, setEmail] = useState("")
  const [submittedEmail, setSubmittedEmail] = useState("")
  const [submitting, setSubmitting] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    try {
      setSubmitting(true)
      await requestCandidatePasswordReset(email)
      setSubmittedEmail(email.trim())
    } catch (error: any) {
      toast.error(error.message || "Could not request a password reset")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthShell brand={brand} eyebrow={brand.loginEyebrow} title={brand.loginHeading} description={brand.loginDescription}>
      {submittedEmail ? (
        <div aria-live="polite">
          <CheckCircle2 className={`h-9 w-9 ${brand.accentTextClass}`} />
          <h2 className="mt-5 text-2xl font-semibold text-slate-950">Check your email</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            If a candidate account exists for <span className="font-medium text-slate-900">{submittedEmail}</span>, we sent a password reset link. It expires in one hour.
          </p>

          <Link
            href="/login"
            className={`mt-6 inline-flex h-11 w-full items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold text-white ${brand.primaryButtonClass}`}
          >
            Back to sign in
            <ArrowRight className="h-4 w-4" />
          </Link>

          <button
            type="button"
            onClick={() => setSubmittedEmail("")}
            className={`mt-4 w-full text-sm font-medium hover:underline ${brand.accentTextClass}`}
          >
            Try another email address
          </button>
        </div>
      ) : (
        <>
          <div className="mb-8">
            <h2 className="text-3xl font-semibold text-slate-950">Reset your password</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">Enter the email address used for your candidate portal account.</p>
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
                  autoFocus
                />
              </div>
            </label>

            <button
              className={`inline-flex h-11 w-full items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-60 ${brand.primaryButtonClass}`}
              disabled={submitting}
            >
              {submitting ? "Sending link..." : "Send reset link"}
              <ArrowRight className="h-4 w-4" />
            </button>
          </form>

          <Link href="/login" className={`mt-6 inline-flex items-center gap-2 text-sm font-medium hover:underline ${brand.accentTextClass}`}>
            <ArrowLeft className="h-4 w-4" />
            Back to sign in
          </Link>
        </>
      )}
    </AuthShell>
  )
}
