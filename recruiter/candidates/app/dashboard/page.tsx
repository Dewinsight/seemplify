"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowRight, CheckCircle2, FileSignature, Files, UserRound } from "lucide-react"
import { toast } from "sonner"
import { CandidateShell, EmptyState, MetricCard, ProgressRail, StatusPill } from "@/components/candidate-ui"
import { fullName, getAccessToken, getOnboardingList, getStoredAccount, logout } from "@/lib/api"
import type { CandidateAccount, CandidateOnboarding } from "@/lib/types"
import { useCandidateBrand } from "@/lib/use-candidate-brand"

function formatDate(value?: string) {
  if (!value) return "Not started"
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value))
}

export default function CandidateDashboardPage() {
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
      .catch((error) => toast.error(error.message || "Failed to load onboarding"))
      .finally(() => setLoading(false))
  }, [router])

  const stats = useMemo(() => {
    const envelopes = records.flatMap((record) => record.envelopes || [])
    const documents = envelopes.flatMap((envelope) => envelope.documents || [])
    const completedDocuments = documents.filter((document) => document.status === "completed" || document.status === "signed").length
    return {
      active: records.filter((record) => record.status !== "completed" && record.status !== "cancelled").length,
      documents: documents.length,
      completed: records.filter((record) => record.status === "completed").length,
      completedDocuments,
      progress: documents.length ? Math.round((completedDocuments / documents.length) * 100) : 0,
    }
  }, [records])

  async function signOut() {
    await logout()
    router.push("/login")
  }

  return (
    <CandidateShell
      brand={brand}
      account={account}
      title="Candidate dashboard"
      subtitle="Track onboarding packets, signatures, and completed downloads."
      onSignOut={signOut}
    >
      <section className="mx-auto max-w-7xl">
        <div className="rounded-md border border-slate-200 bg-white p-5 shadow-soft sm:p-6">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-center">
            <div>
              <div className={`text-sm font-semibold uppercase tracking-wide ${brand.accentTextClass}`}>Welcome back</div>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Hi {fullName(account)}</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Open an onboarding packet to review the prepared PDF, sign securely, and download the final copy when countersigning is complete.</p>
            </div>
            <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center justify-between text-sm">
                <span className="font-semibold text-slate-950">Document completion</span>
                <span className={`font-semibold ${brand.accentTextClass}`}>{stats.progress}%</span>
              </div>
              <div className="mt-3">
                <ProgressRail brand={brand} value={stats.progress} />
              </div>
              <p className="mt-3 text-xs text-slate-500">{stats.completedDocuments} of {stats.documents} document(s) signed or completed.</p>
            </div>
          </div>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-3">
          <MetricCard icon={<UserRound className="h-5 w-5" />} label="Active onboarding" value={stats.active} tone="blue" />
          <MetricCard icon={<Files className="h-5 w-5" />} label="Documents shared" value={stats.documents} tone="emerald" />
          <MetricCard icon={<CheckCircle2 className="h-5 w-5" />} label="Completed packets" value={stats.completed} tone="amber" />
        </div>

        <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div id="documents" className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-soft">
            <div className="flex flex-col gap-3 border-b border-slate-200 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">Your onboarding</h2>
                <p className="mt-1 text-sm text-slate-600">Review packets, pending signatures, and completed copies.</p>
              </div>
            </div>

            {loading && <div className="p-5 text-sm text-slate-600">Loading onboarding records...</div>}
            {!loading && records.length === 0 && (
              <EmptyState brand={brand} title="No onboarding packets yet" description="When your recruiter sends a packet, it will appear here with its documents and signing status." />
            )}
            {!loading && records.length > 0 && (
              <div className="max-h-[430px] overflow-auto">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-5 py-3 font-semibold">Packet</th>
                      <th className="px-5 py-3 font-semibold">Organization</th>
                      <th className="px-5 py-3 font-semibold">Documents</th>
                      <th className="px-5 py-3 font-semibold">Started</th>
                      <th className="px-5 py-3 font-semibold">Status</th>
                      <th className="px-5 py-3 text-right font-semibold">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {records.map((record) => {
                      const documents = (record.envelopes || []).flatMap((envelope) => envelope.documents || [])
                      return (
                        <tr key={record._id} className="hover:bg-slate-50">
                          <td className="px-5 py-4">
                            <div className="font-semibold text-slate-950">{record.title}</div>
                            <div className="mt-1 text-xs text-slate-500">{record.envelopes?.length || 0} packet(s)</div>
                          </td>
                          <td className="px-5 py-4 text-slate-600">{record.organization?.name || "Recruiter"}</td>
                          <td className="px-5 py-4 text-slate-600">{documents.length}</td>
                          <td className="px-5 py-4 text-slate-600">{formatDate(record.startedAt || record.createdAt)}</td>
                          <td className="px-5 py-4"><StatusPill status={record.status} /></td>
                          <td className="px-5 py-4 text-right">
                            <Link href={`/onboarding/${record._id}`} className={`inline-flex items-center gap-2 text-sm font-semibold ${brand.accentTextClass}`}>
                              Open <ArrowRight className="h-4 w-4" />
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

          <aside id="profile" className="h-fit rounded-md border border-slate-200 bg-white p-5 shadow-soft">
            <div className={`text-sm font-semibold uppercase tracking-wide ${brand.accentTextClass}`}>Candidate profile</div>
            <h2 className="mt-2 text-xl font-semibold text-slate-950">{fullName(account)}</h2>
            <div className="mt-5 space-y-3 text-sm">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Email</div>
                <div className="mt-1 break-all text-slate-800">{account?.email || "Not available"}</div>
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Phone</div>
                <div className="mt-1 text-slate-800">{account?.profile?.phone || "Not provided"}</div>
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Account status</div>
                <div className="mt-1"><StatusPill status={account?.status || "active"} /></div>
              </div>
            </div>
          </aside>
        </div>
      </section>
    </CandidateShell>
  )
}
