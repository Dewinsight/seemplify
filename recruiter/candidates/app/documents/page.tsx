"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowRight, CheckCircle2, Download, FileSignature, PenLine } from "lucide-react"
import { toast } from "sonner"
import { CandidateShell, EmptyState, MetricCard, StatusPill } from "@/components/candidate-ui"
import { getAccessToken, getOnboardingList, getStoredAccount, logout } from "@/lib/api"
import type { CandidateAccount, CandidateOnboarding, EnvelopeDocument } from "@/lib/types"
import { useCandidateBrand } from "@/lib/use-candidate-brand"

function documentAction(document: EnvelopeDocument) {
  if (document.status === "completed" || document.status === "signed") {
    return {
      href: `/documents/${document._id}/download`,
      label: "Download",
      icon: Download,
    }
  }

  return {
    href: `/documents/${document._id}/sign`,
    label: "Review and sign",
    icon: PenLine,
  }
}

function processLabel(record: CandidateOnboarding) {
  const processType = record.processType || "onboarding"
  if (processType === "exit") return "Exit"
  if (processType === "retirement") return "Retirement"
  return "Onboarding"
}

export default function CandidateDocumentsPage() {
  const router = useRouter()
  const brand = useCandidateBrand()
  const [account, setAccount] = useState<CandidateAccount | null>(null)
  const [records, setRecords] = useState<CandidateOnboarding[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!getAccessToken()) {
      router.replace("/login")
      return
    }

    setAccount(getStoredAccount())
    getOnboardingList()
      .then((result) => setRecords(result.data || []))
      .catch((error) => toast.error(error.message || "Failed to load documents"))
      .finally(() => setLoading(false))
  }, [router])

  const rows = useMemo(() => {
    return records.flatMap((record) =>
      (record.envelopes || []).flatMap((envelope) =>
        (envelope.documents || []).map((document) => ({
          record,
          envelope,
          document,
        })),
      ),
    )
  }, [records])

  const stats = useMemo(() => {
    const completed = rows.filter(({ document }) => document.status === "completed" || document.status === "signed").length
    return {
      total: rows.length,
      pending: rows.filter(({ document }) => document.status === "pending").length,
      completed,
    }
  }, [rows])

  async function signOut() {
    await logout()
    router.push("/login")
  }

  return (
    <CandidateShell
      brand={brand}
      account={account}
      title="Documents"
      subtitle="Open transition documents for signing, download completed PDFs, and track packet status."
      onSignOut={signOut}
    >
      <section className="mx-auto max-w-7xl">
        <div className="grid gap-4 md:grid-cols-3">
          <MetricCard icon={<FileSignature className="h-5 w-5" />} label="Documents shared" value={stats.total} tone="blue" />
          <MetricCard icon={<PenLine className="h-5 w-5" />} label="Pending signature" value={stats.pending} tone="amber" />
          <MetricCard icon={<CheckCircle2 className="h-5 w-5" />} label="Completed documents" value={stats.completed} tone="emerald" />
        </div>

        <div className="mt-6 overflow-hidden rounded-md border border-slate-200 bg-white shadow-soft">
          <div className="flex flex-col gap-3 border-b border-slate-200 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Document library</h2>
              <p className="mt-1 text-sm text-slate-600">All transition documents sent to this portal account.</p>
            </div>
          </div>

          {loading && <div className="p-5 text-sm text-slate-600">Loading documents...</div>}
          {!loading && rows.length === 0 && (
            <EmptyState brand={brand} title="No documents yet" description="When a recruiter sends transition documents, they will appear here for review, signing, and download." />
          )}
          {!loading && rows.length > 0 && (
            <div className="max-h-[620px] overflow-auto">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-5 py-3 font-semibold">Document</th>
                    <th className="px-5 py-3 font-semibold">Process</th>
                    <th className="px-5 py-3 font-semibold">Packet</th>
                    <th className="px-5 py-3 font-semibold">Envelope</th>
                    <th className="px-5 py-3 font-semibold">Fields</th>
                    <th className="px-5 py-3 font-semibold">Status</th>
                    <th className="px-5 py-3 text-right font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {rows.map(({ record, envelope, document }) => {
                    const action = documentAction(document)
                    const Icon = action.icon
                    return (
                      <tr key={document._id} className="hover:bg-slate-50">
                        <td className="px-5 py-4">
                          <div className="font-semibold text-slate-950">{document.title}</div>
                          <div className="mt-1 text-xs text-slate-500">Prepared PDF snapshot</div>
                        </td>
                        <td className="px-5 py-4 text-slate-600">{processLabel(record)}</td>
                        <td className="px-5 py-4 text-slate-600">{record.title}</td>
                        <td className="px-5 py-4 text-slate-600">{envelope.title}</td>
                        <td className="px-5 py-4 text-slate-600">{document.signatureFields?.length || 0}</td>
                        <td className="px-5 py-4"><StatusPill status={document.status} /></td>
                        <td className="px-5 py-4 text-right">
                          <Link href={action.href} className={`inline-flex items-center gap-2 text-sm font-semibold ${brand.accentTextClass}`}>
                            <Icon className="h-4 w-4" />
                            {action.label}
                            <ArrowRight className="h-4 w-4" />
                          </Link>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </CandidateShell>
  )
}
