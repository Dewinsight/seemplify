"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { ArrowLeft, Download, FileText } from "lucide-react"
import { toast } from "sonner"
import { getAccessToken, getDocument } from "@/lib/api"
import type { CandidateDocumentPayload } from "@/lib/types"

export default function CandidateDocumentDownloadPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const [payload, setPayload] = useState<CandidateDocumentPayload | null>(null)
  const [loading, setLoading] = useState(true)

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

  const downloadUrl = payload?.downloadUrl

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
            <FileText className="h-10 w-10 text-blue-700" />
            <h1 className="mt-4 text-3xl font-semibold text-slate-950">{payload.document.title}</h1>
            <p className="mt-2 text-sm text-slate-600">
              Download the latest available PDF for this onboarding document.
            </p>

            {downloadUrl ? (
              <a
                href={downloadUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-6 inline-flex h-11 items-center justify-center gap-2 rounded-md bg-slate-950 px-4 text-sm font-semibold text-white hover:bg-slate-800"
              >
                <Download className="h-4 w-4" />
                Open PDF
              </a>
            ) : (
              <div className="mt-6 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                No downloadable PDF is available yet. If the document needs countersigning, check back after it is complete.
              </div>
            )}
          </div>
        )}
      </section>
    </main>
  )
}
