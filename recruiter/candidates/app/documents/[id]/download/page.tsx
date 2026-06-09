"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { ArrowLeft, Download, ExternalLink, FileText, FileWarning, Loader2, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { CandidateShell, StatusPill } from "@/components/candidate-ui"
import { PdfCanvasPreview } from "@/components/pdf-canvas-preview"
import { TransitionFlowNav, TransitionFlowTopNav } from "@/components/transition-flow-nav"
import { downloadDocumentBlob, getAccessToken, getDocument, getDocumentPreviewBlob, getStoredAccount, logout } from "@/lib/api"
import type { CandidateAccount, CandidateDocumentPayload, CandidateOnboarding } from "@/lib/types"
import { useCandidateBrand } from "@/lib/use-candidate-brand"

function saveBlob(blob: Blob, fileName: string) {
  const objectUrl = URL.createObjectURL(blob)
  const link = window.document.createElement("a")
  link.href = objectUrl
  link.download = fileName
  window.document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
}

export default function CandidateDocumentDownloadPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const brand = useCandidateBrand()
  const [account, setAccount] = useState<CandidateAccount | null>(null)
  const [payload, setPayload] = useState<CandidateDocumentPayload | null>(null)
  const [transition, setTransition] = useState<CandidateOnboarding | null>(null)
  const [loading, setLoading] = useState(true)
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null)
  const [previewUrl, setPreviewUrl] = useState("")
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState("")
  const [previewReloadKey, setPreviewReloadKey] = useState(0)
  const [downloading, setDownloading] = useState(false)

  useEffect(() => {
    if (!getAccessToken()) {
      router.replace("/login")
      return
    }

    setAccount(getStoredAccount())
    getDocument(params.id)
      .then((result) => {
        setPayload(result.data)
        setTransition(result.transition || null)
      })
      .catch((error) => toast.error(error.message || "Failed to load document"))
      .finally(() => setLoading(false))
  }, [params.id, router])

  useEffect(() => {
    if (!payload) return

    let objectUrl = ""
    let cancelled = false
    setPreviewLoading(true)
    setPreviewError("")

    getDocumentPreviewBlob(params.id)
      .then((blob) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setPreviewBlob(blob)
        setPreviewUrl(objectUrl)
      })
      .catch((error) => {
        if (cancelled) return
        setPreviewBlob(null)
        setPreviewUrl("")
        setPreviewError(error.message || "Failed to load the PDF preview")
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false)
      })

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [params.id, payload, previewReloadKey])

  async function downloadCopy() {
    try {
      setDownloading(true)
      const { blob, fileName } = await downloadDocumentBlob(params.id)
      saveBlob(blob, fileName)
    } catch (error: any) {
      toast.error(error.message || "Could not download document")
    } finally {
      setDownloading(false)
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
      title={payload?.document.title || "Download document"}
      subtitle="Review the latest signed PDF and download a copy for your records."
      onSignOut={signOut}
    >
      <section className="mx-auto max-w-7xl">
        <Link href={transition?._id ? `/transitions/${transition._id}` : "/dashboard"} className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-950">
          <ArrowLeft className="h-4 w-4" />
          {transition?._id ? "Back to packet" : "Dashboard"}
        </Link>

        {loading && <div className="mt-5 rounded-md border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-soft">Preparing document...</div>}
        {!loading && payload && (
          <>
          <div className="mt-5 lg:hidden">
            <TransitionFlowTopNav brand={brand} record={transition} currentStepId={`document:${payload.document._id}`} />
          </div>
          <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
            <section className="min-h-[760px] overflow-hidden rounded-md border border-slate-200 bg-white shadow-soft">
              <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h1 className="text-xl font-semibold text-slate-950">{payload.document.title}</h1>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <p className="text-sm text-slate-600">{payload.envelope.title}</p>
                    <StatusPill status={payload.document.status} />
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setPreviewReloadKey((value) => value + 1)}
                    disabled={previewLoading}
                    className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <RefreshCw className={`h-4 w-4 ${previewLoading ? "animate-spin" : ""}`} />
                    Refresh
                  </button>
                  <button
                    type="button"
                    onClick={() => previewUrl && window.open(previewUrl, "_blank", "noopener,noreferrer")}
                    disabled={!previewUrl}
                    className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <ExternalLink className="h-4 w-4" />
                    Open PDF
                  </button>
                </div>
              </div>
              <div className="h-[760px] bg-slate-100">
                {previewLoading ? (
                  <div className="flex h-full items-center justify-center gap-3 p-6 text-sm text-slate-600">
                    <Loader2 className={`h-5 w-5 animate-spin ${brand.accentTextClass}`} />
                    Rendering PDF preview...
                  </div>
                ) : previewBlob ? (
                  <PdfCanvasPreview blob={previewBlob} title={payload.document.title} />
                ) : previewError ? (
                  <div className="flex h-full items-center justify-center p-6">
                    <div className="max-w-md rounded-md border border-amber-200 bg-amber-50 p-5 text-center text-sm text-amber-900">
                      <FileWarning className="mx-auto mb-3 h-8 w-8" />
                      <p className="font-semibold">The document preview could not be loaded.</p>
                      <p className="mt-2 leading-6">{previewError}</p>
                    </div>
                  </div>
                ) : (
                  <div className="flex h-full items-center justify-center p-6 text-center text-sm text-slate-600">
                    No PDF preview is available yet.
                  </div>
                )}
              </div>
            </section>

            <aside className="h-fit space-y-4 lg:sticky lg:top-24">
              <div className="hidden lg:block">
                <TransitionFlowNav brand={brand} record={transition} currentStepId={`document:${payload.document._id}`} />
              </div>
              <section className="rounded-md border border-slate-200 bg-white p-5 shadow-soft">
                <FileText className={`h-9 w-9 ${brand.accentTextClass}`} />
                <h2 className="mt-4 text-xl font-semibold text-slate-950">Signed copy</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  This is the latest PDF available for the document. When signing is complete, the stamped signed PDF is shown here.
                </p>
                <button
                  type="button"
                  onClick={downloadCopy}
                  disabled={downloading}
                  className={`mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60 ${brand.primaryButtonClass}`}
                >
                  {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  {downloading ? "Preparing PDF..." : "Download PDF"}
                </button>
              </section>
            </aside>
          </div>
          </>
        )}
      </section>
    </CandidateShell>
  )
}
