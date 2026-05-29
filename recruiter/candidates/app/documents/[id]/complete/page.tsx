"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { ArrowLeft, CheckCircle2, Download, FileSignature } from "lucide-react"
import { toast } from "sonner"
import { getAccessToken, getDocument } from "@/lib/api"
import type { CandidateDocumentPayload } from "@/lib/types"

export default function CandidateDocumentCompletePage() {
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

  return (
    <main className="min-h-screen px-4 py-8">
      <section className="mx-auto max-w-2xl rounded-md border border-slate-200 bg-white p-6 text-center shadow-soft sm:p-8">
        {loading && <p className="text-sm text-slate-600">Checking document status...</p>}
        {!loading && payload && (
          <>
            <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-700" />
            <h1 className="mt-4 text-3xl font-semibold text-slate-950">Signature submitted</h1>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              {payload.document.status === "completed"
                ? "The document is complete and ready to download."
                : "Your signature has been recorded. The packet may still require an internal countersignature before the final PDF is available."}
            </p>

            <div className="mt-6 rounded-md border border-slate-200 bg-slate-50 p-4 text-left">
              <div className="flex items-center gap-3">
                <FileSignature className="h-5 w-5 text-blue-700" />
                <div>
                  <div className="font-medium text-slate-950">{payload.document.title}</div>
                  <div className="text-sm capitalize text-slate-600">{payload.document.status}</div>
                </div>
              </div>
            </div>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
              <Link href="/dashboard" className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50">
                <ArrowLeft className="h-4 w-4" />
                Dashboard
              </Link>
              <Link href={`/documents/${params.id}/download`} className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-slate-950 px-4 text-sm font-semibold text-white hover:bg-slate-800">
                <Download className="h-4 w-4" />
                Download copy
              </Link>
            </div>
          </>
        )}
      </section>
    </main>
  )
}
