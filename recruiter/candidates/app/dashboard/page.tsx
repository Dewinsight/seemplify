"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowRight, CheckCircle2, FileSignature, Files, LogOut, UserRound } from "lucide-react"
import { toast } from "sonner"
import { fullName, getAccessToken, getOnboardingList, getStoredAccount, logout } from "@/lib/api"
import type { CandidateAccount, CandidateOnboarding } from "@/lib/types"

function statusClass(status: string) {
  if (status === "completed") return "border-emerald-200 bg-emerald-50 text-emerald-700"
  if (status === "cancelled" || status === "voided") return "border-rose-200 bg-rose-50 text-rose-700"
  return "border-blue-200 bg-blue-50 text-blue-700"
}

export default function CandidateDashboardPage() {
  const router = useRouter()
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
    return {
      active: records.filter((record) => record.status !== "completed" && record.status !== "cancelled").length,
      documents: documents.length,
      completed: records.filter((record) => record.status === "completed").length,
    }
  }, [records])

  async function signOut() {
    await logout()
    router.push("/login")
  }

  return (
    <main className="min-h-screen">
      <header className="border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <div>
            <div className="text-sm font-semibold uppercase tracking-wide text-blue-700">Seemplify</div>
            <h1 className="text-xl font-semibold text-slate-950">Candidate portal</h1>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden text-right text-sm sm:block">
              <div className="font-medium text-slate-950">{fullName(account)}</div>
              <div className="text-slate-500">{account?.email}</div>
            </div>
            <button onClick={signOut} className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50">
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-4 py-8">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-md border border-slate-200 bg-white p-5 shadow-soft">
            <UserRound className="h-5 w-5 text-blue-700" />
            <div className="mt-3 text-3xl font-semibold text-slate-950">{stats.active}</div>
            <div className="text-sm text-slate-600">Active onboarding</div>
          </div>
          <div className="rounded-md border border-slate-200 bg-white p-5 shadow-soft">
            <Files className="h-5 w-5 text-emerald-700" />
            <div className="mt-3 text-3xl font-semibold text-slate-950">{stats.documents}</div>
            <div className="text-sm text-slate-600">Documents shared</div>
          </div>
          <div className="rounded-md border border-slate-200 bg-white p-5 shadow-soft">
            <CheckCircle2 className="h-5 w-5 text-amber-700" />
            <div className="mt-3 text-3xl font-semibold text-slate-950">{stats.completed}</div>
            <div className="text-sm text-slate-600">Completed packets</div>
          </div>
        </div>

        <div className="mt-8 rounded-md border border-slate-200 bg-white shadow-soft">
          <div className="border-b border-slate-200 p-5">
            <h2 className="text-lg font-semibold text-slate-950">Your onboarding</h2>
            <p className="mt-1 text-sm text-slate-600">Open a packet to review documents, sign, and download completed copies.</p>
          </div>

          <div className="divide-y divide-slate-200">
            {loading && <div className="p-5 text-sm text-slate-600">Loading onboarding records...</div>}
            {!loading && records.length === 0 && (
              <div className="p-8 text-center">
                <FileSignature className="mx-auto h-9 w-9 text-slate-400" />
                <h3 className="mt-3 font-semibold text-slate-950">No onboarding packets yet</h3>
                <p className="mt-1 text-sm text-slate-600">When your recruiter sends a packet, it will appear here.</p>
              </div>
            )}
            {!loading && records.map((record) => (
              <Link key={record._id} href={`/onboarding/${record._id}`} className="flex flex-col gap-3 p-5 transition hover:bg-slate-50 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold text-slate-950">{record.title}</h3>
                    <span className={`rounded-md border px-2 py-1 text-xs font-medium capitalize ${statusClass(record.status)}`}>
                      {record.status.replace("_", " ")}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">
                    {record.envelopes?.length || 0} packet(s) from {record.organization?.name || "your recruiter"}
                  </p>
                </div>
                <span className="inline-flex items-center gap-2 text-sm font-semibold text-blue-700">
                  Open <ArrowRight className="h-4 w-4" />
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </main>
  )
}
