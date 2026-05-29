"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { ArrowLeft, Download, FileText, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { downloadDocumentBlob, getAccessToken, getDocument } from "@/lib/api"
import type { CandidateDocumentPayload } from "@/lib/types"
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
  const [payload, setPayload] = useState<CandidateDocumentPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [downloading, setDownloading] = useState(false)

  useEffect(() => {
    if (!getAccessToken()) {
      router.replace("/login")
      return
    }

    getDocument(params.id)
      .then((result) => setPayload(result.data))
      .catch((error) => toast.error(error.message || "Failed to load document"))
      .finally(() => setLoading(false))
  }, [params.id, router])

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

  return (
    <main className="min-h-screen px-4 py-8">
      <section className="mx-auto max-w-2xl rounded-md border border-slate-200 bg-white p-6 shadow-soft sm:p-8">
        <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-950">
          <ArrowLeft className="h-4 w-4" />
          Dashboard
        </Link>

        {loading && <p className="mt-6 text-sm text-slate-600">Preparing download...</p>}
        {!loading && payload && (
          <div className="mt-6">
            <FileText className={`h-10 w-10 ${brand.accentTextClass}`} />
            <h1 className="mt-4 text-3xl font-semibold text-slate-950">{payload.document.title}</h1>
            <p className="mt-2 text-sm text-slate-600">
              Download the latest available PDF for this onboarding document.
            </p>

            <button
              type="button"
              onClick={downloadCopy}
              disabled={downloading}
              className={`mt-6 inline-flex h-11 items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60 ${brand.primaryButtonClass}`}
            >
              {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {downloading ? "Preparing PDF..." : "Download PDF"}
            </button>
          </div>
        )}
      </section>
    </main>
  )
}
