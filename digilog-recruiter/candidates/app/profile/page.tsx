"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowRight, FileSignature, Mail, Phone, ShieldCheck, UserRound } from "lucide-react"
import { toast } from "sonner"
import { CandidateShell, StatusPill } from "@/components/candidate-ui"
import { fullName, getAccessToken, getMe, getStoredAccount, logout } from "@/lib/api"
import type { CandidateAccount } from "@/lib/types"
import { useCandidateBrand } from "@/lib/use-candidate-brand"

export default function CandidateProfilePage() {
  const router = useRouter()
  const brand = useCandidateBrand()
  const [account, setAccount] = useState<CandidateAccount | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!getAccessToken()) {
      router.replace("/login")
      return
    }

    setAccount(getStoredAccount())
    getMe()
      .then((result) => setAccount(result.account))
      .catch((error) => toast.error(error.message || "Failed to refresh profile"))
      .finally(() => setLoading(false))
  }, [router])

  async function signOut() {
    await logout()
    router.push("/login")
  }

  return (
    <CandidateShell
      brand={brand}
      account={account}
      title="Profile"
      subtitle="Candidate account details used for onboarding signatures and downloads."
      onSignOut={signOut}
    >
      <section className="mx-auto max-w-5xl">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="rounded-md border border-slate-200 bg-white p-6 shadow-soft">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className={`text-sm font-semibold uppercase tracking-wide ${brand.accentTextClass}`}>Candidate account</div>
                <h2 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">{loading ? "Loading profile..." : fullName(account)}</h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">This profile is separate from any recruiter, employee, or IDP account that may use the same email address.</p>
              </div>
              {!loading && <StatusPill status={account?.status || "active"} />}
            </div>

            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <UserRound className="h-4 w-4" />
                  Full name
                </div>
                <div className="mt-3 text-sm font-semibold text-slate-950">{fullName(account)}</div>
              </div>
              <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <Mail className="h-4 w-4" />
                  Email
                </div>
                <div className="mt-3 break-all text-sm font-semibold text-slate-950">{account?.email || "Not available"}</div>
              </div>
              <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <Phone className="h-4 w-4" />
                  Phone
                </div>
                <div className="mt-3 text-sm font-semibold text-slate-950">{account?.profile?.phone || "Not provided"}</div>
              </div>
              <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <ShieldCheck className="h-4 w-4" />
                  Account type
                </div>
                <div className="mt-3 text-sm font-semibold text-slate-950">Candidate portal account</div>
              </div>
            </div>
          </div>

          <aside className="h-fit rounded-md border border-slate-200 bg-white p-5 shadow-soft">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
              <FileSignature className={`h-4 w-4 ${brand.accentTextClass}`} />
              Next actions
            </div>
            <div className="mt-4 space-y-3">
              <Link href="/documents" className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-100">
                View documents
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link href="/dashboard" className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-100">
                Back to dashboard
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </aside>
        </div>
      </section>
    </CandidateShell>
  )
}
