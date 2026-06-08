"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { ArrowLeft, ArrowRight, CheckCircle2, Download, FileSignature } from "lucide-react"
import { toast } from "sonner"
import { CandidateShell, StatusPill } from "@/components/candidate-ui"
import { getAccessToken, getDocument, getStoredAccount, logout } from "@/lib/api"
import type { CandidateAccount, CandidateDocumentPayload } from "@/lib/types"
import { useCandidateBrand } from "@/lib/use-candidate-brand"

export default function CandidateDocumentCompletePage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const brand = useCandidateBrand()
  const [account, setAccount] = useState<CandidateAccount | null>(null)
  const [payload, setPayload] = useState<CandidateDocumentPayload | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!getAccessToken()) {
      router.replace("/login")
      return
    }

    setAccount(getStoredAccount())
    setLoading(true)
    setPayload(null)
    getDocument(params.id)
      .then((result) => setPayload(result.data))
      .catch((error) => toast.error(error.message || "Failed to load document"))
      .finally(() => setLoading(false))
  }, [params.id, router])

  async function signOut() {
    await logout()
    router.push("/login")
  }

  const completionMessage = payload?.nextDocumentId
    ? "This document is complete. Continue to the next document in the packet."
    : payload?.document.status === "completed"
      ? "The document is complete and ready to download."
      : "Your signature has been recorded. The packet may still require an internal countersignature before the final PDF is available."

  return (
    <CandidateShell
      brand={brand}
      account={account}
      title="Signature submitted"
      subtitle="Your portal keeps transition signing status and downloads together."
      onSignOut={signOut}
    >
      <section className="mx-auto max-w-3xl rounded-md border border-slate-200 bg-white p-6 text-center shadow-soft sm:p-8">
        {loading && <p className="text-sm text-slate-600">Checking document status...</p>}
        {!loading && payload && (
          <>
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-md bg-emerald-50">
              <CheckCircle2 className="h-8 w-8 text-emerald-700" />
            </div>
            <h1 className="mt-4 text-3xl font-semibold text-slate-950">Signature submitted</h1>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              {completionMessage}
            </p>

            <div className="mt-6 rounded-md border border-slate-200 bg-slate-50 p-4 text-left">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <FileSignature className={`h-5 w-5 ${brand.accentTextClass}`} />
                  <div>
                    <div className="font-medium text-slate-950">{payload.document.title}</div>
                    <div className="text-sm capitalize text-slate-600">{payload.document.status}</div>
                  </div>
                </div>
                <StatusPill status={payload.document.status} />
              </div>
            </div>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
              <Link href="/dashboard" className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50">
                <ArrowLeft className="h-4 w-4" />
                Dashboard
              </Link>
              <Link
                href={`/documents/${params.id}/download`}
                className={`inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold ${payload.nextDocumentId ? "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50" : `text-white ${brand.primaryButtonClass}`}`}
              >
                <Download className="h-4 w-4" />
                Download copy
              </Link>
              {payload.nextDocumentId && (
                <Link href={`/documents/${payload.nextDocumentId}/sign`} className={`inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold text-white ${brand.primaryButtonClass}`}>
                  Next document
                  <ArrowRight className="h-4 w-4" />
                </Link>
              )}
            </div>
          </>
        )}
      </section>
    </CandidateShell>
  )
}
