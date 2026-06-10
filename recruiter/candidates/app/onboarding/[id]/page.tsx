"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { ArrowRight, Check, ClipboardList, Download, FileSignature, PenLine, ShieldCheck, UsersRound } from "lucide-react"
import { toast } from "sonner"
import { CandidateShell, EmptyState, ProgressRail, StatusPill } from "@/components/candidate-ui"
import { TransitionFlowNav, TransitionFlowTopNav } from "@/components/transition-flow-nav"
import { getAccessToken, getOnboarding, getStoredAccount, logout } from "@/lib/api"
import type { CandidateAccount, CandidateOnboarding, EnvelopeDocument } from "@/lib/types"
import { useCandidateBrand } from "@/lib/use-candidate-brand"
import { transitionLabel } from "@/lib/labels"

function documentAction(document: EnvelopeDocument) {
  if (document.status === "completed" || document.status === "signed") {
    return {
      href: `/documents/${document._id}/download`,
      label: "Download",
      icon: Download,
    }
  }
  const candidateFields = document.signatureFields?.filter((field) => (field.role || "candidate") === "candidate") || []
  const fillOnly = candidateFields.some((field) => field.type === "text") && !candidateFields.some((field) => field.type === "signature")
  return {
    href: `/documents/${document._id}/sign`,
    label: fillOnly ? "Fill document" : "Review and sign",
    icon: fillOnly ? ClipboardList : PenLine,
  }
}


export default function CandidateOnboardingDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const brand = useCandidateBrand()
  const [account, setAccount] = useState<CandidateAccount | null>(null)
  const [record, setRecord] = useState<CandidateOnboarding | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!getAccessToken()) {
      router.replace("/login")
      return
    }

    setAccount(getStoredAccount())
    getOnboarding(params.id)
      .then((result) => setRecord(result.data))
      .catch((error) => toast.error(error.message || "Failed to load transition"))
      .finally(() => setLoading(false))
  }, [params.id, router])

  const progress = useMemo(() => {
    const documents = (record?.envelopes || []).flatMap((envelope) => envelope.documents || [])
    const completed = documents.filter((document) => document.status === "completed" || document.status === "signed").length
    const workflowPercent = record?.progress?.percent
    return {
      documents,
      completed,
      percent: workflowPercent ?? (documents.length ? Math.round((completed / documents.length) * 100) : 0),
    }
  }, [record])

  async function signOut() {
    await logout()
    router.push("/login")
  }

  return (
    <CandidateShell
      brand={brand}
      account={account}
      title={record?.title || "Transition packet"}
      subtitle="Review forms, complete signatures, and download final copies."
      onSignOut={signOut}
    >
      <section className="mx-auto max-w-7xl">
        <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-950">
          Back to dashboard
        </Link>

        {loading && <div className="mt-5 rounded-md border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-soft">Loading transition...</div>}

        {!loading && !record && (
          <div className="mt-5 rounded-md border border-slate-200 bg-white shadow-soft">
            <EmptyState brand={brand} title="Transition not found" description="This packet may have expired or may not be linked to your candidate account." />
          </div>
        )}

        {!loading && record && (
          <>
            <div className="mt-5 rounded-md border border-slate-200 bg-white p-5 shadow-soft sm:p-6">
              <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
                <div>
                  <div className={`text-sm font-semibold uppercase tracking-wide ${brand.accentTextClass}`}>
                    {record.organization?.name || brand.organizationName} - {transitionLabel(record)}
                  </div>
                  <h2 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">{record.title}</h2>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Complete each form and document assigned to this transition. Final copies remain available for download from this portal.</p>
                </div>
                <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold text-slate-950">Packet status</span>
                    <StatusPill status={record.status} />
                  </div>
                  <div className="mt-4">
                    <ProgressRail brand={brand} value={progress.percent} />
                  </div>
                  <p className="mt-3 text-xs text-slate-500">
                    {record.progress?.completedItems ?? progress.completed} of {record.progress?.totalItems ?? progress.documents.length} transition step(s) complete.
                  </p>
                </div>
              </div>
            </div>

            {record.nextAction && record.nextAction.type !== "complete" && (
              <div className="mt-5 rounded-md border border-slate-200 bg-white p-5 shadow-soft">
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className={`text-xs font-semibold uppercase tracking-wide ${brand.accentTextClass}`}>Next action</div>
                    <h3 className="mt-1 text-lg font-semibold text-slate-950">{record.nextAction.label}</h3>
                    {record.nextAction.dueAt && (
                      <p className="mt-1 text-sm text-slate-600">Due {new Date(record.nextAction.dueAt).toLocaleDateString()}</p>
                    )}
                  </div>
                  <Link
                    href={record.nextAction.href}
                    className={record.nextAction.type === "waiting"
                      ? "inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                      : `inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold text-white ${brand.primaryButtonClass}`}
                  >
                    {record.nextAction.type === "waiting" ? "View status" : "Continue"}
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              </div>
            )}

            <div className="mt-5 xl:hidden">
              <TransitionFlowTopNav brand={brand} record={record} />
            </div>

            <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
              <div className="space-y-5">
                <section className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-soft">
                  <div className="border-b border-slate-200 p-5">
                    <h3 className="text-lg font-semibold text-slate-950">Transition timeline</h3>
                    <p className="mt-1 text-sm text-slate-600">Complete forms, signatures, and review steps in order.</p>
                  </div>
                  <div className="divide-y divide-slate-200">
                    {(record.workflowItems || []).length === 0 ? (
                      <div className="p-5 text-sm text-slate-500">No workflow steps have been assigned yet.</div>
                    ) : (record.workflowItems || []).map((item) => (
                      <div key={item._id} className={`flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between ${item.isOverdue ? "bg-rose-50" : item.isDueSoon ? "bg-amber-50" : ""}`}>
                        <div className="flex items-start gap-3">
                          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-slate-100">
                            {item.type === "form" ? <ClipboardList className={`h-5 w-5 ${brand.accentTextClass}`} /> : item.type === "approval" ? <ShieldCheck className="h-5 w-5 text-amber-700" /> : <FileSignature className={`h-5 w-5 ${brand.accentTextClass}`} />}
                          </div>
                          <div>
                            <div className="font-semibold text-slate-950">{item.title}</div>
                            {item.description && <div className="mt-1 text-sm text-slate-600">{item.description}</div>}
                            {item.dueAt && (
                              <div className={`mt-1 text-xs ${item.isOverdue ? "font-semibold text-rose-700" : item.isDueSoon ? "font-semibold text-amber-700" : "text-slate-500"}`}>
                                {item.isOverdue ? "Overdue" : "Due"} {new Date(item.dueAt).toLocaleDateString()}
                              </div>
                            )}
                          </div>
                        </div>
                        <StatusPill status={item.status} />
                      </div>
                    ))}
                  </div>
                </section>

                {(record.forms || []).length > 0 && (
                  <section className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-soft">
                    <div className="border-b border-slate-200 p-5">
                      <h3 className="text-lg font-semibold text-slate-950">Forms</h3>
                      <p className="mt-1 text-sm text-slate-600">Fill in required details before final completion.</p>
                    </div>
                    <div className="divide-y divide-slate-200">
                      {(record.forms || []).map((form) => (
                        <div key={form._id} className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <div className="font-semibold text-slate-950">{form.title}</div>
                            <div className="mt-1 text-sm text-slate-600">
                              {form.hasSensitiveValues ? "Contains encrypted sensitive fields" : "Standard transition form"}
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <StatusPill status={form.status} />
                            {form.status === "draft" || form.status === "rejected" ? (
                              <Link href={`/forms/${form._id}`} className={`inline-flex items-center gap-2 text-sm font-semibold ${brand.accentTextClass}`}>
                                Fill form <ArrowRight className="h-4 w-4" />
                              </Link>
                            ) : (
                              <Link href={`/forms/${form._id}`} className={`inline-flex items-center gap-2 text-sm font-semibold ${brand.accentTextClass}`}>
                                View <ArrowRight className="h-4 w-4" />
                              </Link>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {(record.envelopes || []).map((envelope) => (
                  <section key={envelope._id} className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-soft">
                    <div className="flex flex-col gap-3 border-b border-slate-200 p-5 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <h3 className="text-lg font-semibold text-slate-950">{envelope.title}</h3>
                        <p className="mt-1 text-sm text-slate-600">{envelope.message || "Complete the documents below."}</p>
                      </div>
                      <StatusPill status={envelope.status} />
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[720px] text-left text-sm">
                        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                          <tr>
                            <th className="px-5 py-3 font-semibold">Document</th>
                            <th className="px-5 py-3 font-semibold">Fields</th>
                            <th className="px-5 py-3 font-semibold">Status</th>
                            <th className="px-5 py-3 text-right font-semibold">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                          {(envelope.documents || []).map((document) => {
                            const action = documentAction(document)
                            const Icon = action.icon
                            const complete = document.status === "completed" || document.status === "signed"
                            return (
                              <tr key={document._id} className="hover:bg-slate-50">
                                <td className="px-5 py-4">
                                  <div className="flex items-center gap-3">
                                    <div className="flex h-9 w-9 items-center justify-center rounded-md bg-slate-100">
                                      {complete ? <Check className="h-5 w-5 text-emerald-700" /> : <FileSignature className={`h-5 w-5 ${brand.accentTextClass}`} />}
                                    </div>
                                    <div>
                                      <div className="font-semibold text-slate-950">{document.title}</div>
                                      <div className="mt-1 text-xs text-slate-500">Prepared PDF snapshot</div>
                                    </div>
                                  </div>
                                </td>
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
                  </section>
                ))}
              </div>

              <aside className="h-fit space-y-4 xl:sticky xl:top-24">
                <div className="hidden xl:block">
                  <TransitionFlowNav brand={brand} record={record} />
                </div>
                <section className="rounded-md border border-slate-200 bg-white p-5 shadow-soft">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                    <UsersRound className={`h-4 w-4 ${brand.accentTextClass}`} />
                    Signing order
                  </div>
                  <div className="mt-4 space-y-3">
                    {(record.envelopes || []).flatMap((envelope) => envelope.signers || []).map((signer) => (
                      <div key={signer._id} className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-slate-950">{signer.name || signer.email}</div>
                          <div className="truncate text-xs text-slate-500">{signer.role} signer</div>
                        </div>
                        <StatusPill status={signer.status} />
                      </div>
                    ))}
                  </div>
                </section>
              </aside>
            </div>
          </>
        )}
      </section>
    </CandidateShell>
  )
}
