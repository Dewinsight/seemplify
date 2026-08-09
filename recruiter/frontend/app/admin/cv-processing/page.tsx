"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { AlertCircle, Ban, CheckCircle2, Clock3, FileText, Loader2, Menu, RefreshCw, RotateCcw, Search } from "lucide-react"
import AdminHeader from "@/components/AdminHeader"
import AdminSidebar from "@/components/AdminSidebar"
import { useAdmin } from "@/context/AdminContext"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { CVIngestionJob } from "@/services/candidateService"
import {
  getAdminCVIngestionJob,
  getAdminCVIngestionJobs,
  getAdminCVIngestionOrganizations,
  retryAdminCVIngestionJob,
  type CVIngestionOrganizationOption,
  type CVIngestionState,
} from "@/services/cvIngestionService"
import { useToast } from "@/components/ui/use-toast"
import { CvProcessingTimeline } from "@/components/cv-processing/CvProcessingTimeline"

function formatDate(value?: string | null) {
  if (!value) return "—"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat(undefined, {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  }).format(date)
}

function fileName(job: CVIngestionJob) {
  return job.file?.name || job.file?.originalName || job.originalName || "CV"
}

function organizationName(job: CVIngestionJob) {
  if (typeof job.organization === "string") return job.organization
  return job.organization?.name || job.organization?.id || job.organization?.organizationId || "Unknown organization"
}

function uploaderName(job: CVIngestionJob) {
  if (typeof job.uploader === "string") return job.uploader
  return job.uploader?.name || job.uploader?.email || "System/public"
}

function stateLabel(job: CVIngestionJob) {
  if (job.state === "waiting_for_chatgpt") return "Waiting"
  if (job.state === "completed") return "Completed"
  if (job.state === "failed") return "Failed"
  if (job.state === "cancelled") return "Cancelled"
  if (job.state === "deleted") return "Deleted"
  return (job.stage || job.state).replaceAll("_", " ")
}

function StateIcon({ job }: { job: CVIngestionJob }) {
  if (job.state === "completed") return <CheckCircle2 className="h-4 w-4 text-emerald-400" />
  if (job.state === "failed") return <AlertCircle className="h-4 w-4 text-red-400" />
  if (job.state === "cancelled" || job.state === "deleted") return <Ban className="h-4 w-4 text-gray-500" />
  return <Clock3 className="h-4 w-4 text-amber-400" />
}

export default function AdminCvProcessingPage() {
  const { checkPermission } = useAdmin()
  const { toast } = useToast()
  const pollInFlight = useRef(false)
  const detailPollInFlight = useRef(false)
  const [jobs, setJobs] = useState<CVIngestionJob[]>([])
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [state, setState] = useState<CVIngestionState | "all">("all")
  const [source, setSource] = useState<"private" | "public" | "bulk" | "replacement" | "ai-interview" | "all">("all")
  const [organizationId, setOrganizationId] = useState("all")
  const [organizations, setOrganizations] = useState<CVIngestionOrganizationOption[]>([])
  const [searchInput, setSearchInput] = useState("")
  const [search, setSearch] = useState("")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<CVIngestionJob | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [retentionDays, setRetentionDays] = useState<number | null>(null)
  const [coverageStartedAt, setCoverageStartedAt] = useState<string | null>(null)
  const canRetry = checkPermission("systemSettings")

  useEffect(() => {
    const timer = window.setTimeout(() => { setSearch(searchInput.trim()); setPage(1) }, 350)
    return () => window.clearTimeout(timer)
  }, [searchInput])

  useEffect(() => {
    void getAdminCVIngestionOrganizations().then((result) => {
      setOrganizations(result.organizations || [])
    }).catch(() => {
      // History remains usable with global text search if this helper list is unavailable.
      setOrganizations([])
    })
  }, [])

  const load = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!silent) setLoading(true)
    try {
      const result = await getAdminCVIngestionJobs({
        page,
        limit: 25,
        state: state === "all" ? "" : state,
        source: source === "all" ? "" : source,
        search,
        from,
        to,
        organizationId: organizationId === "all" ? "" : organizationId,
      })
      setJobs(result.jobs || [])
      setPages(Math.max(1, result.pages || 1))
      setTotal(result.total || 0)
      setRetentionDays(typeof result.retentionDays === "number" ? result.retentionDays : null)
      setCoverageStartedAt(result.coverageStartedAt || null)
      setError(null)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "CV processing records could not be loaded")
    } finally {
      if (!silent) setLoading(false)
    }
  }, [from, organizationId, page, search, source, state, to])

  useEffect(() => { void load() }, [load])

  const hasActiveJobs = jobs.some((job) => !["completed", "failed", "cancelled", "deleted"].includes(job.state))
  useEffect(() => {
    if (!hasActiveJobs) return
    const refresh = async () => {
      if (pollInFlight.current || !navigator.onLine || document.visibilityState !== "visible") return
      pollInFlight.current = true
      try { await load({ silent: true }) } finally { pollInFlight.current = false }
    }
    const onWake = () => { if (document.visibilityState === "visible") void refresh() }
    const timer = window.setInterval(() => void refresh(), 5_000)
    window.addEventListener("focus", onWake)
    window.addEventListener("online", onWake)
    document.addEventListener("visibilitychange", onWake)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener("focus", onWake)
      window.removeEventListener("online", onWake)
      document.removeEventListener("visibilitychange", onWake)
    }
  }, [hasActiveJobs, load])

  const openJob = useCallback(async (jobId: string) => {
    setDetailLoading(true)
    try {
      setSelected(await getAdminCVIngestionJob(jobId))
    } catch (detailError) {
      toast({ title: "Could not load processing detail", description: detailError instanceof Error ? detailError.message : "Try again.", variant: "destructive" })
    } finally {
      setDetailLoading(false)
    }
  }, [toast])

  const selectedJobId = selected?.jobId || null
  const selectedIsActive = Boolean(selected && !["completed", "failed", "cancelled", "deleted"].includes(selected.state))
  useEffect(() => {
    if (!selectedJobId || !selectedIsActive) return
    let disposed = false
    const refreshDetail = async () => {
      if (detailPollInFlight.current || !navigator.onLine || document.visibilityState !== "visible") return
      detailPollInFlight.current = true
      try {
        const detail = await getAdminCVIngestionJob(selectedJobId)
        if (!disposed) setSelected(detail)
      } catch {
        // Retain the last confirmed timeline during a transient admin API
        // failure. Polling resumes on the next interval/focus/online event.
      } finally {
        detailPollInFlight.current = false
      }
    }
    const onWake = () => { void refreshDetail() }
    const timer = window.setInterval(() => void refreshDetail(), 5_000)
    window.addEventListener("focus", onWake)
    window.addEventListener("online", onWake)
    document.addEventListener("visibilitychange", onWake)
    return () => {
      disposed = true
      window.clearInterval(timer)
      window.removeEventListener("focus", onWake)
      window.removeEventListener("online", onWake)
      document.removeEventListener("visibilitychange", onWake)
    }
  }, [selectedIsActive, selectedJobId])

  async function retry(stage: "failed" | "parsing" | "analysis" = "failed") {
    if (!selected || retrying || !canRetry) return
    setRetrying(true)
    try {
      const result = await retryAdminCVIngestionJob(selected.jobId, stage)
      setSelected(result.job)
      toast({ title: "CV processing restarted", description: `${fileName(result.job)} was returned to the queue.` })
      await load({ silent: true })
    } catch (retryError) {
      toast({ title: "Retry failed", description: retryError instanceof Error ? retryError.message : "Try again.", variant: "destructive" })
    } finally {
      setRetrying(false)
    }
  }

  return (
    <div className="flex h-screen overflow-hidden bg-gray-950 text-gray-100">
      <div className="hidden lg:flex"><AdminSidebar /></div>
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <AdminHeader>
          <Sheet>
            <SheetTrigger asChild><Button variant="ghost" size="icon" className="text-gray-300 hover:bg-gray-700 hover:text-white lg:hidden" aria-label="Open admin navigation"><Menu className="h-5 w-5" /></Button></SheetTrigger>
            <SheetContent side="left" className="w-64 border-gray-700 bg-gray-800 p-0 sm:max-w-64"><SheetHeader className="sr-only"><SheetTitle>Admin navigation</SheetTitle><SheetDescription>Navigate the admin portal</SheetDescription></SheetHeader><AdminSidebar /></SheetContent>
          </Sheet>
        </AdminHeader>
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-7xl px-5 py-6 sm:px-7">
            <div className="mb-6 flex flex-col gap-4 border-b border-gray-800 pb-5 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h1 className="text-xl font-semibold text-white">CV processing</h1>
                <p className="mt-1 text-sm text-gray-400">Inspect cross-organization ingestion history and retry retained failures.</p>
                {coverageStartedAt ? <p className="mt-1 text-xs text-gray-500">History coverage from {formatDate(coverageStartedAt)}{retentionDays ? ` · retained for ${retentionDays} days` : ""}</p> : null}
              </div>
              <Button variant="outline" onClick={() => void load()} disabled={loading} className="border-gray-700 bg-transparent text-gray-100 hover:bg-gray-800"><RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh</Button>
            </div>

            <section className="mb-4 grid gap-3 border border-gray-800 bg-gray-900 p-4 xl:grid-cols-[minmax(220px,1fr)_210px_155px_155px_145px_145px]">
              <div className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-500" /><Input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Organization, uploader, file, candidate, or ID" className="border-gray-700 bg-gray-950 pl-9 text-gray-100" /></div>
              <Select value={organizationId} onValueChange={(value) => { setOrganizationId(value); setPage(1) }}><SelectTrigger className="border-gray-700 bg-gray-950"><SelectValue placeholder="All organizations" /></SelectTrigger><SelectContent><SelectItem value="all">All organizations</SelectItem>{organizations.map((organization) => <SelectItem key={organization.id} value={organization.id}>{organization.name}</SelectItem>)}</SelectContent></Select>
              <Select value={state} onValueChange={(value) => { setState(value as typeof state); setPage(1) }}><SelectTrigger className="border-gray-700 bg-gray-950"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All states</SelectItem><SelectItem value="queued">Queued</SelectItem><SelectItem value="waiting_for_chatgpt">Waiting</SelectItem><SelectItem value="processing">Processing</SelectItem><SelectItem value="completed">Completed</SelectItem><SelectItem value="failed">Failed</SelectItem><SelectItem value="cancelled">Cancelled</SelectItem></SelectContent></Select>
              <Select value={source} onValueChange={(value) => { setSource(value as typeof source); setPage(1) }}><SelectTrigger className="border-gray-700 bg-gray-950"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All sources</SelectItem><SelectItem value="private">Recruiter upload</SelectItem><SelectItem value="public">Public application</SelectItem><SelectItem value="bulk">Bulk upload</SelectItem><SelectItem value="replacement">Corrected CV</SelectItem><SelectItem value="ai-interview">AI interview</SelectItem></SelectContent></Select>
              <Input type="date" value={from} onChange={(event) => { setFrom(event.target.value); setPage(1) }} aria-label="From date" className="border-gray-700 bg-gray-950 text-gray-200" />
              <Input type="date" value={to} onChange={(event) => { setTo(event.target.value); setPage(1) }} aria-label="To date" className="border-gray-700 bg-gray-950 text-gray-200" />
            </section>

            {error ? <div className="mb-4 border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-200"><AlertCircle className="mr-2 inline h-4 w-4" />{error}</div> : null}

            <section className="overflow-hidden border border-gray-800 bg-gray-900">
              <div className="flex items-center justify-between border-b border-gray-800 px-4 py-3 text-sm"><span><strong>{total}</strong> records across organizations</span><span className="text-gray-400">Page {page} of {pages}</span></div>
              {loading ? <div className="flex min-h-60 items-center justify-center text-sm text-gray-400"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading processing history…</div>
                : jobs.length === 0 ? <div className="min-h-60 px-6 py-16 text-center text-sm text-gray-400"><FileText className="mx-auto mb-3 h-6 w-6" />No CV processing records match these filters.</div>
                  : <div className="overflow-x-auto"><Table><TableHeader><TableRow className="border-gray-800 hover:bg-transparent"><TableHead className="text-gray-400">CV</TableHead><TableHead className="text-gray-400">Organization</TableHead><TableHead className="text-gray-400">Uploader</TableHead><TableHead className="text-gray-400">Source</TableHead><TableHead className="text-gray-400">Status</TableHead><TableHead className="text-gray-400">Updated</TableHead><TableHead className="w-px"><span className="sr-only">Details</span></TableHead></TableRow></TableHeader><TableBody>{jobs.map((job) => <TableRow key={job.jobId} className="cursor-pointer border-gray-800 hover:bg-gray-800/60" onClick={() => void openJob(job.jobId)}><TableCell><div className="max-w-64 truncate font-medium text-white">{fileName(job)}</div><div className="font-mono text-[11px] text-gray-500">{job.jobId}</div></TableCell><TableCell><div className="max-w-52 truncate">{organizationName(job)}</div></TableCell><TableCell><div className="max-w-44 truncate text-gray-300">{uploaderName(job)}</div></TableCell><TableCell className="capitalize text-gray-300">{job.source.replace("-", " ")}</TableCell><TableCell><div className="flex items-center gap-2"><StateIcon job={job} /><span className="capitalize">{stateLabel(job)}</span>{typeof job.progress === "number" && !["completed", "failed", "cancelled"].includes(job.state) ? <span className="text-xs text-gray-500">{job.progress}%</span> : null}</div></TableCell><TableCell className="whitespace-nowrap text-gray-400">{formatDate(job.updatedAt || job.completedAt || job.failedAt || job.createdAt)}</TableCell><TableCell><Button variant="ghost" size="sm" aria-label={`View processing details for ${fileName(job)}`} onClick={(event) => { event.stopPropagation(); void openJob(job.jobId) }} className="text-gray-200 hover:bg-gray-800 hover:text-white">View</Button></TableCell></TableRow>)}</TableBody></Table></div>}
              <div className="flex justify-end gap-2 border-t border-gray-800 px-4 py-3"><Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((value) => value - 1)} className="border-gray-700 bg-transparent">Previous</Button><Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((value) => value + 1)} className="border-gray-700 bg-transparent">Next</Button></div>
            </section>
          </div>
        </main>
      </div>

      <Sheet open={Boolean(selected) || detailLoading} onOpenChange={(open) => { if (!open) setSelected(null) }}>
        <SheetContent className="w-full overflow-y-auto border-gray-700 bg-gray-900 text-gray-100 sm:max-w-xl">
          <SheetHeader><SheetTitle className="text-white">CV processing detail</SheetTitle><SheetDescription className="text-gray-400">Cross-organization stage history, attempts, and retry controls.</SheetDescription></SheetHeader>
          {detailLoading && !selected ? <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin" /></div> : selected ? <div className="mt-6 space-y-6">
            <div className="border border-gray-700 bg-gray-950 p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-medium text-white">{fileName(selected)}</p><p className="mt-1 font-mono text-xs text-gray-500">{selected.jobId}</p></div><div className="flex items-center gap-2 text-sm"><StateIcon job={selected} /><span className="capitalize">{stateLabel(selected)}</span></div></div><dl className="mt-4 grid grid-cols-2 gap-3 text-sm"><div><dt className="text-gray-500">Organization</dt><dd className="mt-0.5">{organizationName(selected)}</dd></div><div><dt className="text-gray-500">Uploader</dt><dd className="mt-0.5">{uploaderName(selected)}</dd></div><div><dt className="text-gray-500">Source</dt><dd className="mt-0.5 capitalize">{selected.source}</dd></div><div><dt className="text-gray-500">Progress</dt><dd className="mt-0.5">{selected.progress ?? 0}%</dd></div></dl>{selected.retry?.available ? <Button className="mt-4" size="sm" onClick={() => void retry()} disabled={retrying || !canRetry}>{retrying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}Retry processing</Button> : null}{selected.retry?.available && !canRetry ? <p className="mt-2 text-xs text-gray-500">System settings permission is required to retry.</p> : null}</div>
            <CvProcessingTimeline job={selected} dark />
            <div><h3 className="text-sm font-medium text-white">Attempts</h3><div className="mt-3 divide-y divide-gray-800 border border-gray-800">{(selected.attemptHistory || []).map((attempt) => <div key={`${attempt.number}:${attempt.startedAt}`} className="px-3 py-2 text-sm"><div className="flex justify-between"><span>Attempt {attempt.number} · {attempt.trigger}</span><span className="capitalize text-gray-400">{attempt.status.replaceAll("_", " ")}</span></div><p className="mt-1 text-xs text-gray-500">{attempt.stage ? `Stage: ${attempt.stage.replaceAll("_", " ")} · ` : ""}Started {formatDate(attempt.startedAt)}{attempt.finishedAt ? ` · Finished ${formatDate(attempt.finishedAt)}` : ""}{attempt.errorCode ? ` · ${attempt.errorCode}` : ""}</p>{attempt.errorMessage ? <p className="mt-1 text-xs text-red-300">{attempt.errorMessage}</p> : null}</div>)}{!selected.attemptHistory?.length ? <p className="px-3 py-4 text-sm text-gray-500">No attempt history was retained.</p> : null}</div></div>
          </div> : null}
        </SheetContent>
      </Sheet>
    </div>
  )
}
