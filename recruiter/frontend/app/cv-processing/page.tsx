"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import { AlertCircle, Ban, CheckCircle2, Clock3, FileText, Loader2, RefreshCw, RotateCcw, Search, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { replaceCVIngestionJob, retryCVIngestionJob, type CVIngestionJob } from "@/services/candidateService"
import { getCVIngestionJob, getCVIngestionJobs, type CVIngestionState } from "@/services/cvIngestionService"
import { toast } from "sonner"
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

function candidateName(job: CVIngestionJob) {
  if (typeof job.candidate === "string") return job.candidate
  return job.candidate?.name || job.candidate?.email || job.candidateId || "—"
}

function stateLabel(job: CVIngestionJob) {
  if (job.state === "waiting_for_chatgpt") return "Waiting"
  if (job.state === "completed") return "Completed"
  if (job.state === "failed") return "Failed"
  if (job.state === "cancelled") return "Cancelled"
  if (job.state === "deleted") return "Deleted"
  if (job.stage === "profile_creation" || job.stage === "finalizing") return "Creating profile"
  if (job.stage === "analyzing") return "AI analysis"
  if (job.stage === "extracting") return "Text extraction"
  if (job.stage === "uploading" || job.stage === "stored") return "Securing file"
  return job.state === "processing" ? "Processing" : "Queued"
}

function StateMark({ job }: { job: CVIngestionJob }) {
  if (job.state === "completed") return <CheckCircle2 className="h-4 w-4 text-emerald-600" />
  if (job.state === "failed") return <AlertCircle className="h-4 w-4 text-red-600" />
  if (job.state === "cancelled" || job.state === "deleted") return <Ban className="h-4 w-4 text-muted-foreground" />
  return <Clock3 className="h-4 w-4 text-amber-600" />
}

export default function CvProcessingPage() {
  const searchParams = useSearchParams()
  const initialJobId = searchParams.get("jobId")
  const pollInFlight = useRef(false)
  const detailPollInFlight = useRef(false)
  const [jobs, setJobs] = useState<CVIngestionJob[]>([])
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [state, setState] = useState<CVIngestionState | "all">("all")
  const [source, setSource] = useState<"private" | "public" | "bulk" | "replacement" | "ai-interview" | "all">("all")
  const [searchInput, setSearchInput] = useState("")
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<CVIngestionJob | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [replacing, setReplacing] = useState(false)
  const replacementInputRef = useRef<HTMLInputElement>(null)
  const [retentionDays, setRetentionDays] = useState<number | null>(null)
  const [coverageStartedAt, setCoverageStartedAt] = useState<string | null>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => { setSearch(searchInput.trim()); setPage(1) }, 350)
    return () => window.clearTimeout(timer)
  }, [searchInput])

  const load = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!silent) setLoading(true)
    try {
      const result = await getCVIngestionJobs({
        page,
        limit: 25,
        state: state === "all" ? "" : state,
        source: source === "all" ? "" : source,
        search,
      })
      setJobs(result.jobs || [])
      setPages(Math.max(1, result.pages || 1))
      setTotal(result.total || 0)
      setRetentionDays(typeof result.retentionDays === "number" ? result.retentionDays : null)
      setCoverageStartedAt(result.coverageStartedAt || null)
      setError(null)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "CV processing history could not be loaded")
    } finally {
      if (!silent) setLoading(false)
    }
  }, [page, search, source, state])

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
      setSelected(await getCVIngestionJob(jobId))
    } catch (detailError) {
      toast.error(detailError instanceof Error ? detailError.message : "CV processing detail could not be loaded")
    } finally {
      setDetailLoading(false)
    }
  }, [])

  const selectedJobId = selected?.jobId || null
  const selectedIsActive = Boolean(selected && !["completed", "failed", "cancelled", "deleted"].includes(selected.state))
  useEffect(() => {
    if (!selectedJobId || !selectedIsActive) return
    let disposed = false
    const refreshDetail = async () => {
      if (detailPollInFlight.current || !navigator.onLine || document.visibilityState !== "visible") return
      detailPollInFlight.current = true
      try {
        const detail = await getCVIngestionJob(selectedJobId)
        if (!disposed) setSelected(detail)
      } catch {
        // Keep the last confirmed timeline visible; the next poll or an
        // explicit refresh can recover from a transient detail failure.
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

  useEffect(() => { if (initialJobId) void openJob(initialJobId) }, [initialJobId, openJob])

  async function retrySelected(stage: "failed" | "parsing" | "analysis" = "failed") {
    if (!selected || retrying) return
    setRetrying(true)
    try {
      await retryCVIngestionJob(selected.jobId, stage)
      toast.success(selected.state === "waiting_for_chatgpt" ? "CV analysis queued now" : "CV processing restarted")
      await Promise.all([openJob(selected.jobId), load({ silent: true })])
    } catch (retryError) {
      toast.error(retryError instanceof Error ? retryError.message : "CV processing could not be retried")
    } finally {
      setRetrying(false)
    }
  }

  async function replaceSelected(file: File) {
    if (!selected || replacing || selected.retry?.replacementAvailable !== true || selected.retry?.available === true) return
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Corrected CVs must be 10MB or smaller")
      return
    }
    const fingerprint = `${file.name}:${file.size}:${file.lastModified}`
    const storageKey = `seemplify:cv-replacement:v1:${selected.jobId}`
    let retained: { fingerprint?: string; idempotencyKey?: string } | null = null
    try { retained = JSON.parse(localStorage.getItem(storageKey) || "null") } catch { retained = null }
    const idempotencyKey = retained?.fingerprint === fingerprint && retained.idempotencyKey
      ? retained.idempotencyKey
      : globalThis.crypto?.randomUUID?.() || `replacement-${Date.now()}-${Math.random().toString(36).slice(2)}`
    localStorage.setItem(storageKey, JSON.stringify({ fingerprint, idempotencyKey }))
    setReplacing(true)
    try {
      const result = await replaceCVIngestionJob(selected.jobId, file, idempotencyKey)
      localStorage.removeItem(storageKey)
      setSelected(result.job)
      toast.success("Corrected CV secured as a new revision")
      await load({ silent: true })
    } catch (replacementError) {
      const typedError = replacementError as Error & { status?: number; code?: string }
      const keyConflict = typedError.status === 409 && typedError.code === "CV_IDEMPOTENCY_KEY_REUSED"
      if (keyConflict) localStorage.removeItem(storageKey)
      toast.error(keyConflict
        ? "This corrected file differs from the earlier attempt. Choose it again to use a new request key."
        : replacementError instanceof Error ? replacementError.message : "Corrected CV could not be accepted")
    } finally {
      setReplacing(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <header className="mb-6 flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">CV processing history</h1>
          <p className="mt-1 text-sm text-muted-foreground">Server-retained status for CVs processed across this organization.</p>
          {coverageStartedAt ? <p className="mt-1 text-xs text-muted-foreground">History coverage from {formatDate(coverageStartedAt)}{retentionDays ? ` · retained for ${retentionDays} days` : ""}</p> : null}
        </div>
        <Button variant="outline" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh
        </Button>
      </header>

      <section className="mb-4 grid gap-3 border bg-card p-4 md:grid-cols-[minmax(220px,1fr)_180px_180px]">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="File, candidate, uploader, or job ID" className="pl-9" />
        </div>
        <Select value={state} onValueChange={(value) => { setState(value as typeof state); setPage(1) }}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All states</SelectItem>
            <SelectItem value="queued">Queued</SelectItem>
            <SelectItem value="waiting_for_chatgpt">Waiting</SelectItem>
            <SelectItem value="processing">Processing</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
        <Select value={source} onValueChange={(value) => { setSource(value as typeof source); setPage(1) }}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sources</SelectItem>
            <SelectItem value="private">Recruiter upload</SelectItem>
            <SelectItem value="public">Public application</SelectItem>
            <SelectItem value="bulk">Bulk upload</SelectItem>
            <SelectItem value="replacement">Corrected CV</SelectItem>
            <SelectItem value="ai-interview">AI interview</SelectItem>
          </SelectContent>
        </Select>
      </section>

      {error ? <div className="mb-4 border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"><AlertCircle className="mr-2 inline h-4 w-4" />{error}</div> : null}

      <section className="overflow-hidden border bg-card">
        <div className="flex items-center justify-between border-b px-4 py-3 text-sm">
          <span><strong>{total}</strong> processing records</span>
          <span className="text-muted-foreground">Page {page} of {pages}</span>
        </div>
        {loading ? (
          <div className="flex min-h-52 items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading history…</div>
        ) : jobs.length === 0 ? (
          <div className="min-h-52 px-6 py-14 text-center text-sm text-muted-foreground"><FileText className="mx-auto mb-3 h-6 w-6" />No CV processing records match these filters.</div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow><TableHead>CV</TableHead><TableHead>Source</TableHead><TableHead>Status</TableHead><TableHead>Candidate</TableHead><TableHead>Updated</TableHead><TableHead className="w-px"><span className="sr-only">Details</span></TableHead></TableRow></TableHeader>
              <TableBody>
                {jobs.map((job) => (
                  <TableRow key={job.jobId} className="cursor-pointer" onClick={() => void openJob(job.jobId)}>
                    <TableCell><div className="max-w-72 truncate font-medium">{fileName(job)}</div><div className="font-mono text-[11px] text-muted-foreground">{job.jobId}</div></TableCell>
                    <TableCell className="capitalize">{job.source.replace("-", " ")}</TableCell>
                    <TableCell><div className="flex items-center gap-2"><StateMark job={job} /><span>{stateLabel(job)}</span>{typeof job.progress === "number" && !["completed", "failed", "cancelled", "deleted"].includes(job.state) ? <span className="text-xs text-muted-foreground">{job.progress}%</span> : null}</div></TableCell>
                    <TableCell><div className="max-w-52 truncate">{candidateName(job)}</div></TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(job.updatedAt || job.completedAt || job.failedAt || job.createdAt)}</TableCell>
                    <TableCell><Button variant="ghost" size="sm" aria-label={`View processing details for ${fileName(job)}`} onClick={(event) => { event.stopPropagation(); void openJob(job.jobId) }}>View</Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <div className="flex items-center justify-end gap-2 border-t px-4 py-3">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</Button>
          <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((value) => value + 1)}>Next</Button>
        </div>
      </section>

      <Sheet open={Boolean(selected) || detailLoading} onOpenChange={(open) => { if (!open) setSelected(null) }}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>CV processing detail</SheetTitle>
            <SheetDescription>Durable ingestion history, attempts, and failure information.</SheetDescription>
          </SheetHeader>
          {detailLoading && !selected ? <div className="flex py-12 justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div> : selected ? (
            <div className="mt-6 space-y-6">
              <div className="border p-4">
                <div className="flex items-start justify-between gap-4"><div><p className="font-medium">{fileName(selected)}</p><p className="mt-1 font-mono text-xs text-muted-foreground">{selected.jobId}</p>{selected.revision ? <p className="mt-1 text-xs text-muted-foreground">Revision {selected.revision}</p> : null}</div><div className="flex items-center gap-2 text-sm"><StateMark job={selected} />{stateLabel(selected)}</div></div>
                {selected.state === "waiting_for_chatgpt" && selected.retry?.canRunNow ? <Button className="mt-4" size="sm" onClick={() => void retrySelected("analysis")} disabled={retrying}>{retrying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}Run analysis now</Button> : null}
                {selected.retry?.available ? <Button className="mt-4" size="sm" onClick={() => void retrySelected()} disabled={retrying}>{retrying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}Retry processing</Button> : null}
                {selected.retry?.replacementAvailable && !selected.retry.available ? <><Button className="mt-4" size="sm" variant="outline" onClick={() => replacementInputRef.current?.click()} disabled={replacing}>{replacing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}Upload corrected CV</Button><input ref={replacementInputRef} type="file" className="hidden" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.tif,.tiff" aria-label={`Choose a corrected CV for ${fileName(selected)}`} onChange={(event) => { const file = event.target.files?.[0]; if (file) void replaceSelected(file); event.target.value = "" }} /></> : null}
              </div>
              <CvProcessingTimeline job={selected} />
              <div>
                <h3 className="text-sm font-medium">Attempt history</h3>
                <p className="mt-1 text-xs text-muted-foreground">Previous errors remain here for audit. The status at the top is the current result.</p>
                <div className="mt-3 divide-y border">{(selected.attemptHistory || []).map((attempt) => <div key={`${attempt.number}:${attempt.startedAt}`} className="px-3 py-2 text-sm"><div className="flex justify-between"><span>Attempt {attempt.number} · {attempt.trigger}</span><span className="capitalize text-muted-foreground">{attempt.status.replaceAll("_", " ")}</span></div><p className="mt-1 text-xs text-muted-foreground">{attempt.stage ? `Stage: ${attempt.stage.replaceAll("_", " ")} · ` : ""}Started {formatDate(attempt.startedAt)}{attempt.finishedAt ? ` · Finished ${formatDate(attempt.finishedAt)}` : ""}{attempt.errorCode ? ` · ${attempt.errorCode}` : ""}</p>{attempt.errorMessage ? <p className="mt-1 text-xs text-red-700">{attempt.errorMessage}</p> : null}</div>)}{!selected.attemptHistory?.length ? <p className="px-3 py-4 text-sm text-muted-foreground">No attempt history was retained.</p> : null}</div>
              </div>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  )
}
