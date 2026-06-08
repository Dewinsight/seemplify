"use client"

import Link from "next/link"
import { ChangeEvent, useEffect, useMemo, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { ArrowLeft, FileUp, Loader2, Save, ShieldCheck, Send } from "lucide-react"
import { toast } from "sonner"
import { CandidateShell, StatusPill } from "@/components/candidate-ui"
import {
  getAccessToken,
  getOnboardingForm,
  getStoredAccount,
  logout,
  saveOnboardingForm,
  submitOnboardingForm,
  uploadOnboardingFormFile,
} from "@/lib/api"
import type { CandidateAccount, OnboardingFormField, OnboardingFormSubmission } from "@/lib/types"
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
  const [values, setValues] = useState<Record<string, string | boolean>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [uploadingKey, setUploadingKey] = useState("")

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
        const nextValues: Record<string, string | boolean> = {}
        ;(nextForm.templateSnapshot?.fields || []).forEach((field) => {
          nextValues[field.key] = field.type === "checkbox" ? fieldValue(nextForm, field) === "true" : fieldValue(nextForm, field)
        })
        setValues(nextValues)
      })
      .catch((error) => toast.error(error.message || "Failed to load form"))
      .finally(() => setLoading(false))
  }, [params.id, router])

  const fields = useMemo(() => {
    return [...(form?.templateSnapshot?.fields || [])].sort((a, b) => (a.order || 0) - (b.order || 0))
  }, [form])

  function setValue(key: string, value: string | boolean) {
    setValues((current) => ({ ...current, [key]: value }))
  }

  async function save() {
    try {
      setSaving(true)
      const result = await saveOnboardingForm(params.id, values)
      setForm(result.data)
      toast.success("Form saved")
    } catch (error: any) {
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
      toast.success(result.data.status === "under_review" ? "Form submitted for HR review" : "Form submitted")
      router.push("/dashboard")
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

  const locked = form?.status === "approved" || form?.status === "under_review"

  return (
    <CandidateShell
      brand={brand}
      account={account}
      title={form?.title || "Onboarding form"}
      subtitle="Complete the required onboarding details and submit them for review."
      onSignOut={signOut}
    >
      <section className="mx-auto max-w-5xl">
        <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-950">
          <ArrowLeft className="h-4 w-4" />
          Dashboard
        </Link>

        {loading ? (
          <div className="mt-5 rounded-md border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-soft">Loading form...</div>
        ) : form ? (
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
                    <label key={field.key} className={field.type === "textarea" || field.type === "address" || field.type === "file" ? "md:col-span-2" : ""}>
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
                      ) : field.type === "file" ? (
                        <span className="mt-2 block rounded-md border border-dashed border-slate-300 bg-slate-50 p-4">
                          <span className="flex items-center gap-2 text-sm font-medium text-slate-800">
                            <FileUp className="h-4 w-4" />
                            {saved?.valuePreview || "Upload a file"}
                          </span>
                          <input
                            type="file"
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

              <div className="flex flex-wrap justify-end gap-3 border-t border-slate-200 p-5">
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

            <aside className="h-fit rounded-md border border-slate-200 bg-white p-5 shadow-soft">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                <ShieldCheck className="h-4 w-4 text-emerald-700" />
                Secure review
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                Bank and tax values are stored encrypted. Recruiters see masked values unless they explicitly reveal them for review.
              </p>
            </aside>
          </div>
        ) : (
          <div className="mt-5 rounded-md border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-soft">Form not found.</div>
        )}
      </section>
    </CandidateShell>
  )
}
