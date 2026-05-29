"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { ArrowLeft, Check, Download, FileSignature, PenLine } from "lucide-react"
import { toast } from "sonner"
import { getAccessToken, getOnboarding } from "@/lib/api"
import type { CandidateOnboarding, EnvelopeDocument } from "@/lib/types"
import { useCandidateBrand } from "@/lib/use-candidate-brand"

function documentAction(document: EnvelopeDocument) {
  if (document.status === "completed" || document.status === "signed") {
    return {
      href: `/documents/${document.document}/download`,
      label: "Download",
      icon: Download,
    }
  }
  return {
    href: `/documents/${document.document}/sign`,
    label: "Review and sign",
    icon: PenLine,
  }
}

export default function CandidateOnboardingDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const brand = useCandidateBrand()
  const [record, setRecord] = useState<CandidateOnboarding | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!getAccessToken()) {
      router.replace("/login")
      return
    }

    getOnboarding(params.id)
      .then((result) => setRecord(result.data))
      .catch((error) => toast.error(error.message || "Failed to load onboarding"))
      .finally(() => setLoading(false))
  }, [params.id, router])

  return (
    <main className="min-h-screen">
      <section className="mx-auto max-w-6xl px-4 py-8">
        <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-950">
          <ArrowLeft className="h-4 w-4" />
          Dashboard
        </Link>

        {loading && <div className="mt-8 rounded-md border border-slate-200 bg-white p-5 text-sm text-slate-600">Loading onboarding...</div>}

        {!loading && record && (
          <>
            <div className="mt-6 rounded-md border border-slate-200 bg-white p-6 shadow-soft">
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className={`text-sm font-semibold uppercase tracking-wide ${brand.accentTextClass}`}>{record.organization?.name || brand.organizationName}</div>
                  <h1 className="mt-2 text-3xl font-semibold text-slate-950">{record.title}</h1>
                  <p className="mt-2 text-sm text-slate-600">Review each document and complete required signatures digitally.</p>
                </div>
                <span className={`w-fit rounded-md border px-3 py-1 text-sm font-medium capitalize ${brand.accentBorderClass} ${brand.accentBgClass} ${brand.accentTextClass}`}>
                  {record.status.replace("_", " ")}
                </span>
              </div>
            </div>

            <div className="mt-6 space-y-4">
              {(record.envelopes || []).map((envelope) => (
                <section key={envelope._id} className="rounded-md border border-slate-200 bg-white shadow-soft">
                  <div className="border-b border-slate-200 p-5">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <h2 className="font-semibold text-slate-950">{envelope.title}</h2>
                        <p className="mt-1 text-sm text-slate-600">{envelope.message || "Complete the documents below."}</p>
                      </div>
                      <span className="w-fit rounded-md border border-slate-200 px-2 py-1 text-xs font-medium capitalize text-slate-600">
                        {envelope.status.replace("_", " ")}
                      </span>
                    </div>
                  </div>

                  <div className="divide-y divide-slate-200">
                    {envelope.documents.map((document) => {
                      const action = documentAction(document)
                      const Icon = action.icon
                      return (
                        <Link key={document._id} href={action.href} className="flex flex-col gap-3 p-5 transition hover:bg-slate-50 sm:flex-row sm:items-center sm:justify-between">
                          <div className="flex items-start gap-3">
                            <div className="rounded-md bg-slate-100 p-2">
                              {document.status === "completed" ? <Check className="h-5 w-5 text-emerald-700" /> : <FileSignature className={`h-5 w-5 ${brand.accentTextClass}`} />}
                            </div>
                            <div>
                              <h3 className="font-medium text-slate-950">{document.title}</h3>
                              <p className="mt-1 text-sm text-slate-600 capitalize">{document.status}</p>
                            </div>
                          </div>
                          <span className={`inline-flex items-center gap-2 text-sm font-semibold ${brand.accentTextClass}`}>
                            <Icon className="h-4 w-4" />
                            {action.label}
                          </span>
                        </Link>
                      )
                    })}
                  </div>
                </section>
              ))}
            </div>
          </>
        )}
      </section>
    </main>
  )
}
