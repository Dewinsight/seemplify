"use client"

import Link from "next/link"
import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { ArrowLeft, FileUp, Loader2, Save, ShieldCheck, Send } from "lucide-react"
import { toast } from "sonner"
import { CandidateShell, StatusPill } from "@/components/candidate-ui"
import { TransitionFlowNav, TransitionFlowTopNav } from "@/components/transition-flow-nav"
import {
  getAccessToken,
  getOnboardingForm,
  getStoredAccount,
  logout,
  saveOnboardingForm,
  submitOnboardingForm,
  uploadOnboardingFormFile,
} from "@/lib/api"
import { transitionActionHref } from "@/lib/transition-flow"
import type { CandidateAccount, CandidateOnboarding, OnboardingFormField, OnboardingFormSubmission } from "@/lib/types"
import { useCandidateBrand } from "@/lib/use-candidate-brand"

function fieldValue(form: OnboardingFormSubmission | null, field: OnboardingFormField) {
  const value = form?.values?.find((entry) => entry.key === field.key || entry.fieldId === field.id)
  if (field.sensitive) return ""
  return value?.value === undefined || value?.value === null ? "" : String(value.value)
}

function inputClass(brandClass: string) {
  return `mt-2 min-h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none focus:ring-2 ${brandClass}`
}

export default function CandidateFormPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const brand = useCandidateBrand()
  const [account, setAccount] = useState<CandidateAccount | null>(null)
  const [form, setForm] = useState<OnboardingFormSubmission | null>(null)
  const [transition, setTransition] = useState<CandidateOnboarding | null>(null)
  const [values, setValues] = useState<Record<string, string | boolean>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<"saved" | "dirty" | "saving" | "error">("saved")
  const [submitting, setSubmitting] = useState(false)
  const [uploadingKey, setUploadingKey] = useState("")
  const lastSavedSignatureRef = useRef("")
  const hydratedRef = useRef(false)

  useEffect(() => {
    if (!getAccessToken()) {
      router.replace("/login")
      return
    }

    setAccount(getStoredAccount())
    getOnboardingForm(params.id)
      .then((result) => {
        const nextForm = result.data
        setForm(nextForm)
        setTransition(result.transition || null)
        const nextValues: Record<string, string | boolean> = {}
        ;(nextForm.templateSnapshot?.fields || []).forEach((field) => {
          nextValues[field.key] = field.type === "checkbox" ? fieldValue(nextForm, field) === "true" : fieldValue(nextForm, field)
        })
        setValues(nextValues)
        lastSavedSignatureRef.current = JSON.stringify(nextValues)
        hydratedRef.current = true
        setSaveStatus("saved")
      })
      .catch((error) => toast.error(error.message || "Failed to load form"))
      .finally(() => setLoading(false))
  }, [params.id, router])

  const fields = useMemo(() => {
    return [...(form?.templateSnapshot?.fields || [])].sort((a, b) => (a.order || 0) - (b.order || 0))
  }, [form])

  const locked = form?.status === "approved" || form?.status === "under_review"

  useEffect(() => {
    if (!form || loading || locked || submitting || !hydratedRef.current) return
    const signature = JSON.stringify(values)
    if (signature === lastSavedSignatureRef.current) return
    setSaveStatus("dirty")

    const timeout = window.setTimeout(async () => {
      try {
        setSaving(true)
        setSaveStatus("saving")
        const result = await saveOnboardingForm(params.id, values)
        setForm(result.data)
        setTransition(result.transition || null)
        lastSavedSignatureRef.current = signature
        setSaveStatus("saved")
      } catch {
        setSaveStatus("error")
      } finally {
        setSaving(false)
      }
    }, 1000)

    return () => window.clearTimeout(timeout)
  }, [form, loading, locked, params.id, submitting, values])

  function setValue(key: string, value: string | boolean) {
    setValues((current) => ({ ...current, [key]: value }))
  }

  async function save() {
    try {
      setSaving(true)
      const result = await saveOnboardingForm(params.id, values)
      setForm(result.data)
      setTransition(result.transition || null)
      lastSavedSignatureRef.current = JSON.stringify(values)
      setSaveStatus("saved")
      toast.success("Form saved")
    } catch (error: any) {
      setSaveStatus("error")
      toast.error(error.message || "Could not save form")
    } finally {
      setSaving(false)
    }
  }

  async function submit() {
    try {
      setSubmitting(true)
      const result = await submitOnboardingForm(params.id, values)
      setForm(result.data)
      setTransition(result.transition || null)
      toast.success(result.data.status === "under_review" ? "Form submitted for HR review" : "Form submitted")
      router.push(transitionActionHref(result.transition, result.transition?._id ? `/transitions/${result.transition._id}` : "/dashboard"))
    } catch (error: any) {
      toast.error(error.message || "Could not submit form")
    } finally {
      setSubmitting(false)
    }
  }

  async function uploadFile(field: OnboardingFormField, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      setUploadingKey(field.key)
      const result = await uploadOnboardingFormFile(params.id, field.key, file)
      setForm(result.form)
      setTransition(result.transition || null)
      toast.success("File uploaded")
    } catch (error: any) {
      toast.error(error.message || "Could not upload file")
    } finally {
      setUploadingKey("")
      event.target.value = ""
    }
  }

  async function signOut() {
    await logout()
    router.push("/login")
  }

  return (
    <CandidateShell
      brand={brand}
      account={account}
      title={form?.title || "Transition form"}
      subtitle="Complete the required details and submit them for review."
      onSignOut={signOut}
    >
      <section className="mx-auto max-w-7xl">
        <Link href={transition?._id ? `/transitions/${transition._id}` : "/dashboard"} className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-950">
          <ArrowLeft className="h-4 w-4" />
          {transition?._id ? "Back to packet" : "Dashboard"}
        </Link>

        {loading ? (
          <div className="mt-5 rounded-md border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-soft">Loading form...</div>
        ) : form ? (
          <>
          <div className="mt-5 lg:hidden">
            <TransitionFlowTopNav brand={brand} record={transition} currentStepId={`form:${form._id}`} />
          </div>
          <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
            <section className="rounded-md border border-slate-200 bg-white shadow-soft">
              <div className="flex flex-col gap-3 border-b border-slate-200 p-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-xl font-semibold text-slate-950">{form.title}</h2>
                  <p className="mt-1 text-sm text-slate-600">Sensitive fields are encrypted and masked after you save or submit.</p>
                </div>
                <StatusPill status={form.status} />
              </div>

              <div className="grid gap-5 p-5 md:grid-cols-2">
                {fields.map((field) => {
                  const saved = form.values?.find((entry) => entry.key === field.key)
                  const common = {
                    id: field.key,
                    disabled: locked,
                    className: inputClass(brand.focusRingClass),
                  }

                  return (
                    <label key={field.key} className={field.type === "textarea" || field.type === "address" || field.type === "file" || field.type === "image" ? "md:col-span-2" : ""}>
                      <span className="text-sm font-semibold text-slate-950">
                        {field.label}
                        {field.required && <span className="text-rose-600"> *</span>}
                      </span>
                      {field.helpText && <span className="mt-1 block text-xs text-slate-500">{field.helpText}</span>}
                      {field.sensitive && saved?.valuePreview && (
                        <span className="mt-1 block text-xs text-slate-500">Saved value: {saved.valuePreview}</span>
                      )}

                      {field.type === "textarea" || field.type === "address" ? (
                        <textarea
                          {...common}
                          rows={4}
                          value={String(values[field.key] || "")}
                          placeholder={field.placeholder || ""}
                          onChange={(event) => setValue(field.key, event.target.value)}
                        />
                      ) : field.type === "select" ? (
                        <select
                          {...common}
                          value={String(values[field.key] || "")}
                          onChange={(event) => setValue(field.key, event.target.value)}
                        >
                          <option value="">Select...</option>
                          {(field.options || []).map((option) => <option key={option} value={option}>{option}</option>)}
                        </select>
                      ) : field.type === "checkbox" ? (
                        <span className="mt-3 flex items-center gap-3 text-sm text-slate-700">
                          <input
                            type="checkbox"
                            checked={Boolean(values[field.key])}
                            disabled={locked}
                            onChange={(event) => setValue(field.key, event.target.checked)}
                            className="h-4 w-4 rounded border-slate-300"
                          />
                          Confirm
                        </span>
                      ) : field.type === "file" || field.type === "image" ? (
                        <span className="mt-2 block rounded-md border border-dashed border-slate-300 bg-slate-50 p-4">
                          <span className="flex items-center gap-2 text-sm font-medium text-slate-800">
                            <FileUp className="h-4 w-4" />
                            {saved?.valuePreview || (field.type === "image" ? "Upload an image" : "Upload a file")}
                          </span>
                          <input
                            type="file"
                            accept={field.type === "image" ? "image/*" : undefined}
                            disabled={locked || uploadingKey === field.key}
                            onChange={(event) => uploadFile(field, event)}
                            className="mt-3 block w-full text-sm text-slate-600"
                          />
                        </span>
                      ) : (
                        <input
                          {...common}
                          type={field.type === "email" ? "email" : field.type === "date" ? "date" : field.type === "number" ? "number" : "text"}
                          value={String(values[field.key] || "")}
                          placeholder={field.placeholder || ""}
                          onChange={(event) => setValue(field.key, event.target.value)}
                        />
                      )}
                    </label>
                  )
                })}
              </div>

              <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-200 p-5">
                <div className={`mr-auto text-xs ${
                  saveStatus === "error"
                    ? "font-semibold text-rose-700"
                    : saveStatus === "dirty" || saveStatus === "saving"
                      ? "font-semibold text-amber-700"
                      : "text-slate-500"
                }`}>
                  {locked
                    ? "Submitted"
                    : saveStatus === "saving"
                      ? "Autosaving..."
                      : saveStatus === "dirty"
                        ? "Unsaved changes"
                        : saveStatus === "error"
                          ? "Autosave failed"
                          : "Draft saved"}
                </div>
                <button
                  type="button"
                  onClick={save}
                  disabled={locked || saving || submitting}
                  className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Save draft
                </button>
                <button
                  type="button"
                  onClick={submit}
                  disabled={locked || submitting}
                  className={`inline-flex h-10 items-center gap-2 rounded-md px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60 ${brand.primaryButtonClass}`}
                >
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Submit form
                </button>
              </div>
            </section>

            <aside className="h-fit space-y-4 lg:sticky lg:top-24">
              <div className="hidden lg:block">
                <TransitionFlowNav brand={brand} record={transition} currentStepId={form ? `form:${form._id}` : undefined} />
              </div>
              <section className="rounded-md border border-slate-200 bg-white p-5 shadow-soft">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                  <ShieldCheck className="h-4 w-4 text-emerald-700" />
                  Secure review
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-600">
                  Bank and tax values are stored encrypted. Recruiters see masked values unless they explicitly reveal them for review.
                </p>
              </section>
            </aside>
          </div>
          </>
        ) : (
          <div className="mt-5 rounded-md border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-soft">Form not found.</div>
        )}
      </section>
    </CandidateShell>
  )
}
