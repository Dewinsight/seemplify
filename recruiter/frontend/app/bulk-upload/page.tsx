"use client"

import type React from "react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Circle,
  Clock3,
  Eye,
  FileText,
  Loader2,
  PauseCircle,
  Plus,
  RefreshCw,
  RotateCcw,
  Upload,
  Users,
  WifiOff,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useToast } from "@/hooks/use-toast"
import { useOrganization } from "@/context/OrganizationContext"
import { useUser } from "@/context/UserContext"
import {
  bulkUploadCVs,
  getBulkUploadStatus,
  getRecentBulkUploadStatus,
  retryBulkUpload,
  retryCVIngestionJob,
  type BulkUploadStatus,
} from "@/services/candidateService"
import {
  parseUploadHistory,
  buildCvStageTimeline,
  reconcileUploadFiles,
  serializeUploadHistory,
  upsertUploadHistory,
  type PersistedBulkUpload,
  type UploadFileRow,
} from "@/utils/cvUploadProgress"
import { getCVIngestionJobs } from "@/services/cvIngestionService"
import type { CVIngestionJob } from "@/services/candidateService"

type UploadMode = "history" | "select" | "uploading"

const POLL_INTERVAL_MS = 3_500

function jobBatchId(job: CVIngestionJob) {
  if (typeof job.batch === "string") return job.batch
  return job.batch?.id || job.batch?.batchId || null
}

function statusFromJobs(batchId: string, jobs: CVIngestionJob[]): BulkUploadStatus {
  const completed = jobs.filter((job) => job.state === "completed")
  const failed = jobs.filter((job) => job.state === "failed")
  const cancelled = jobs.filter((job) => job.state === "cancelled" || job.state === "deleted")
  const waiting = jobs.filter((job) => ["queued", "waiting_for_chatgpt"].includes(job.state))
  const processing = jobs.filter((job) => job.state === "processing")
  const terminal = completed.length + failed.length + cancelled.length === jobs.length
  const candidateId = (job: CVIngestionJob) => job.candidateId
    || (typeof job.candidate === "string" ? job.candidate : job.candidate?.id || job.candidate?.candidateId)
    || ""
  return {
    batchId,
    totalFiles: jobs.length,
    completed: completed.length + failed.length + cancelled.length,
    successful: completed.length,
    failed: failed.length,
    cancelled: cancelled.length,
    processing: processing.length,
    queued: waiting.length,
    results: completed.map((job) => ({
      fileName: job.file?.name || job.file?.originalName || job.originalName || "CV",
      candidateId: candidateId(job),
      success: true as const,
    })),
    errors: failed.map((job) => ({
      fileName: job.file?.name || job.file?.originalName || job.originalName || "CV",
      error: job.error?.message || "CV processing failed",
      success: false as const,
    })),
    jobs,
    startedAt: jobs.map((job) => job.createdAt).filter(Boolean).sort()[0] || new Date().toISOString(),
    completedAt: terminal ? jobs.map((job) => job.completedAt || job.failedAt).filter(Boolean).sort().at(-1) || null : null,
    state: terminal ? "completed"
      : jobs.some((job) => job.state === "waiting_for_chatgpt") ? "waiting_for_chatgpt"
        : "processing",
  }
}

function formatSize(bytes?: number) {
  if (!bytes) return ""
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDuration(startedAt?: string | null) {
  if (!startedAt) return ""
  const elapsed = Math.max(0, Math.floor((Date.now() - Date.parse(startedAt)) / 1000))
  if (elapsed < 60) return `${elapsed}s`
  const minutes = Math.floor(elapsed / 60)
  return `${minutes}m ${elapsed % 60}s`
}

function formatWhen(value?: string | null) {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date)
}

function statusLabel(row: UploadFileRow) {
  if (row.state === "completed") return "Candidate created"
  if (row.state === "failed") return "Failed"
  if (row.state === "cancelled") return "Cancelled"
  if (row.state === "waiting") return "Analysis paused"
  if (row.state === "queued") return "Queued"
  if (row.state === "processing") {
    if (row.stage === "extracting") return "Extracting CV"
    if (row.stage === "analyzing") return "Analyzing CV"
    if (row.stage === "finalizing") return "Creating candidate"
    return "Processing"
  }
  return "Queued or analyzing"
}

function FileStageTrack({ row }: { row: UploadFileRow }) {
  const steps = buildCvStageTimeline(row)
  const latestDone = [...steps].reverse().find((step) => step.state === "done")
  const current = steps.find((step) => ["active", "failed"].includes(step.state)) || latestDone
  const retryEvent = row.stageHistory.find((entry) => entry.stage === "retry_scheduled")

  return (
    <details className="mt-3 text-xs" data-testid="cv-stage-timeline">
      <summary className="cursor-pointer select-none text-muted-foreground hover:text-foreground">
        Stage timeline{current ? ` · ${current.label}` : ""}
      </summary>
      <ol className="mt-3 space-y-0 border-l border-border pl-4" aria-label={`Detailed progress for ${row.fileName}`}>
        {steps.map((step) => (
          <li key={step.label} className="relative pb-3 last:pb-0">
            <span className="absolute -left-[21px] top-0.5 bg-card">
              {step.state === "done" ? <Check className="h-3.5 w-3.5 text-emerald-600" />
                : step.state === "failed" ? <AlertCircle className="h-3.5 w-3.5 text-red-600" />
                  : step.state === "active" ? <Circle className="h-3.5 w-3.5 fill-amber-400 text-amber-500" />
                    : <Circle className="h-3.5 w-3.5 text-border" />}
            </span>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className={step.state === "failed" ? "font-medium text-red-700 dark:text-red-300"
                : step.state === "active" ? "font-medium text-foreground" : "text-muted-foreground"}>
                {step.label}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {step.at ? formatWhen(step.at) : step.state === "active" ? "In progress" : step.state === "unknown" ? "Not reported" : ""}
              </span>
            </div>
          </li>
        ))}
        {retryEvent ? (
          <li className="relative pb-1 text-amber-700 dark:text-amber-300">
            <RotateCcw className="absolute -left-[21px] top-0.5 h-3.5 w-3.5 bg-card" />
            Retry scheduled{retryEvent.at ? ` · ${formatWhen(retryEvent.at)}` : ""}
          </li>
        ) : null}
      </ol>
    </details>
  )
}

function BatchState({ status }: { status?: BulkUploadStatus }) {
  if (!status) return <span className="text-xs text-muted-foreground">Restoring status</span>
  if (status.state === "completed" && status.failed > 0) {
    return <span className="text-xs font-medium text-red-700 dark:text-red-300">Completed with failures</span>
  }
  if (status.state === "completed" && (status.cancelled || 0) > 0) {
    return <span className="text-xs font-medium text-muted-foreground">Completed with cancellations</span>
  }
  if (status.state === "completed") {
    return <span className="text-xs font-medium text-emerald-700 dark:text-emerald-300">Completed</span>
  }
  if (status.state === "waiting_for_chatgpt") {
    return <span className="text-xs font-medium text-amber-700 dark:text-amber-300">Needs attention</span>
  }
  return <span className="text-xs font-medium text-foreground">In progress</span>
}

export default function BulkUploadPage() {
  const router = useRouter()
  const { toast } = useToast()
  const { currentOrganization, isLoading: organizationLoading } = useOrganization()
  const { state: userState } = useUser()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const statusesRef = useRef<Record<string, BulkUploadStatus>>({})
  const uploadsRef = useRef<PersistedBulkUpload[]>([])
  const refreshInFlightRef = useRef(new Set<string>())
  const serverBatchIdsRef = useRef(new Set<string>())

  const [mode, setMode] = useState<UploadMode>("history")
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [uploads, setUploads] = useState<PersistedBulkUpload[]>([])
  const [statuses, setStatuses] = useState<Record<string, BulkUploadStatus>>({})
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null)
  const [historyReady, setHistoryReady] = useState(false)
  const [loadedStorageKey, setLoadedStorageKey] = useState<string | null>(null)
  const [batchErrors, setBatchErrors] = useState<Record<string, string>>({})
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [retrying, setRetrying] = useState<string | null>(null)
  const [, setClock] = useState(0)

  const organizationId = currentOrganization?._id
  const userId = userState.user?._id
  const storageKey = organizationId && userId
    ? `seemplify:cv-uploads:v1:${organizationId}:${userId}`
    : null

  useEffect(() => { statusesRef.current = statuses }, [statuses])
  useEffect(() => { uploadsRef.current = uploads }, [uploads])

  const persistUploads = useCallback((next: PersistedBulkUpload[]) => {
    setUploads(next)
    uploadsRef.current = next
    if (storageKey) localStorage.setItem(storageKey, serializeUploadHistory(next))
  }, [storageKey])

  const removeStaleBatch = useCallback((batchId: string) => {
    persistUploads(uploadsRef.current.filter((upload) => upload.batchId !== batchId))
    setStatuses((current) => {
      const next = { ...current }
      delete next[batchId]
      return next
    })
    setSelectedBatchId((current) => current === batchId ? uploadsRef.current[0]?.batchId || null : current)
  }, [persistUploads])

  const refreshBatch = useCallback(async (batchId: string) => {
    if (refreshInFlightRef.current.has(batchId)) return
    refreshInFlightRef.current.add(batchId)
    try {
      const next = await getBulkUploadStatus(batchId)
      setStatuses((current) => ({ ...current, [batchId]: next }))
      setBatchErrors((current) => {
        if (!current[batchId]) return current
        const nextErrors = { ...current }
        delete nextErrors[batchId]
        return nextErrors
      })
    } catch (error) {
      const typed = error as Error & { status?: number }
      if (typed.status === 404) {
        if (serverBatchIdsRef.current.has(batchId)) {
          setBatchErrors((current) => ({
            ...current,
            [batchId]: "The batch summary has expired. Its retained per-file history remains available in Processing history.",
          }))
        } else {
          removeStaleBatch(batchId)
        }
      } else {
        setBatchErrors((current) => ({
          ...current,
          [batchId]: typed.message || "Live status is temporarily unavailable. Reconnecting…",
        }))
      }
    } finally {
      refreshInFlightRef.current.delete(batchId)
    }
  }, [removeStaleBatch])

  const refreshActiveBatches = useCallback((includeSelected = false) => {
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return
    if (typeof navigator !== "undefined" && !navigator.onLine) return
    const ids = uploadsRef.current
      .filter((upload) => statusesRef.current[upload.batchId]?.state !== "completed")
      .map((upload) => upload.batchId)
    if (includeSelected && selectedBatchId && !ids.includes(selectedBatchId)) ids.push(selectedBatchId)
    void Promise.all(ids.map(refreshBatch))
  }, [refreshBatch, selectedBatchId])

  useEffect(() => {
    if (!storageKey || organizationLoading || userState.isLoading) return
    let cancelled = false
    setHistoryReady(false)
    setLoadedStorageKey(null)
    const restored = parseUploadHistory(localStorage.getItem(storageKey))
    setStatuses({})
    statusesRef.current = {}
    setBatchErrors({})
    persistUploads(restored)
    setSelectedBatchId(restored[0]?.batchId || null)
    setHistoryReady(true)
    setLoadedStorageKey(storageKey)
    setMode(restored.length > 0 ? "history" : "select")

    const restore = async () => {
      let recent: BulkUploadStatus | null = null
      let retainedJobs: CVIngestionJob[] = []
      const [recentResult, historyResult] = await Promise.allSettled([
        getRecentBulkUploadStatus(),
        getCVIngestionJobs({ source: "bulk", page: 1, limit: 100 }),
      ])
      if (recentResult.status === "fulfilled") recent = recentResult.value
      if (historyResult.status === "fulfilled") retainedJobs = historyResult.value.jobs || []
      if (cancelled) return
      let nextUploads = restored
      const jobsByBatch = new Map<string, CVIngestionJob[]>()
      retainedJobs.forEach((job) => {
        const id = jobBatchId(job)
        if (!id) return
        const group = jobsByBatch.get(id) || []
        group.push(job)
        jobsByBatch.set(id, group)
      })
      serverBatchIdsRef.current = new Set(jobsByBatch.keys())
      jobsByBatch.forEach((jobs, id) => {
        const serverStatus = statusFromJobs(id, jobs)
        setStatuses((current) => ({ ...current, [id]: serverStatus }))
        nextUploads = upsertUploadHistory(nextUploads, {
          batchId: id,
          createdAt: serverStatus.startedAt,
          files: jobs.map((job) => ({
            name: job.file?.name || job.file?.originalName || job.originalName || "CV",
            size: job.file?.size || 0,
          })),
        })
      })
      if (recent) {
        setStatuses((current) => ({ ...current, [recent!.batchId]: recent! }))
        const files = reconcileUploadFiles([], recent).map((row) => ({ name: row.fileName, size: row.size || 0 }))
        nextUploads = upsertUploadHistory(nextUploads, {
          batchId: recent.batchId,
          createdAt: recent.startedAt || new Date().toISOString(),
          files,
        })
      }
      persistUploads(nextUploads)
      if (nextUploads.length > 0) {
        setSelectedBatchId((current) => current || nextUploads[0].batchId)
        setMode("history")
      }
      await Promise.all(nextUploads.map((upload) => refreshBatch(upload.batchId)))
    }
    void restore()
    return () => { cancelled = true }
  }, [organizationLoading, persistUploads, refreshBatch, storageKey, userState.isLoading])

  useEffect(() => {
    if (!historyReady) return
    const refresh = () => refreshActiveBatches(true)
    const refreshWhenVisible = () => { if (document.visibilityState === "visible") refresh() }
    const timer = window.setInterval(() => refreshActiveBatches(false), POLL_INTERVAL_MS)
    window.addEventListener("online", refresh)
    window.addEventListener("focus", refresh)
    document.addEventListener("visibilitychange", refreshWhenVisible)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener("online", refresh)
      window.removeEventListener("focus", refresh)
      document.removeEventListener("visibilitychange", refreshWhenVisible)
    }
  }, [historyReady, refreshActiveBatches])

  useEffect(() => {
    const active = selectedBatchId && statuses[selectedBatchId]?.state !== "completed"
    if (!active) return
    const timer = window.setInterval(() => setClock((value) => value + 1), 1_000)
    return () => window.clearInterval(timer)
  }, [selectedBatchId, statuses])

  const activeUpload = uploads.find((upload) => upload.batchId === selectedBatchId) || null
  const activeStatus = selectedBatchId ? statuses[selectedBatchId] : undefined
  const activeError = selectedBatchId ? batchErrors[selectedBatchId] : null
  const fileRows = useMemo(
    () => activeUpload && activeStatus ? reconcileUploadFiles(activeUpload.files, activeStatus) : [],
    [activeStatus, activeUpload],
  )
  const progressPercent = activeStatus && activeStatus.totalFiles > 0
    ? Math.round((activeStatus.completed / activeStatus.totalFiles) * 100)
    : 0
  const isParked = Boolean(activeStatus && (
    activeStatus.state === "waiting_for_chatgpt" || activeStatus.waitingReason || activeStatus.waitingCode
  ))

  function handleFiles(files: FileList | File[]) {
    const accepted = Array.from(files).filter((file) => {
      const name = file.name.toLowerCase()
      return name.endsWith(".pdf") || name.endsWith(".doc") || name.endsWith(".docx")
    })
    if (accepted.length === 0) {
      toast({ title: "No supported files", description: "Choose PDF, DOC, or DOCX files.", variant: "destructive" })
      return
    }
    setSelectedFiles((current) => [...current, ...accepted])
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  function handleDrop(event: React.DragEvent) {
    event.preventDefault()
    if (event.dataTransfer.files.length > 0) handleFiles(event.dataTransfer.files)
  }

  async function startUpload() {
    if (selectedFiles.length === 0 || !storageKey) return
    const attemptStorageKey = `${storageKey}:pending-acceptance`
    setMode("uploading")
    setUploadError(null)
    try {
      const fingerprint = selectedFiles
        .map((file) => `${file.name}:${file.size}:${file.lastModified}`)
        .join("|")
      let idempotencyKey: string | null = null
      try {
        const retained = JSON.parse(sessionStorage.getItem(attemptStorageKey) || "null") as { fingerprint?: string; key?: string } | null
        if (retained?.fingerprint === fingerprint && retained.key) idempotencyKey = retained.key
      } catch {
        // A malformed browser entry should never block a fresh upload.
      }
      idempotencyKey = idempotencyKey
        || globalThis.crypto?.randomUUID?.()
        || `bulk-${Date.now()}-${Math.random().toString(36).slice(2)}`
      sessionStorage.setItem(attemptStorageKey, JSON.stringify({ fingerprint, key: idempotencyKey }))
      const accepted = await bulkUploadCVs(selectedFiles, idempotencyKey)
      sessionStorage.removeItem(attemptStorageKey)
      const createdAt = new Date().toISOString()
      const upload: PersistedBulkUpload = {
        batchId: accepted.batchId,
        createdAt,
        files: selectedFiles.map((file) => ({ name: file.name, size: file.size })),
      }
      const nextUploads = upsertUploadHistory(uploadsRef.current, upload)
      persistUploads(nextUploads)
      setStatuses((current) => ({
        ...current,
        [accepted.batchId]: {
          batchId: accepted.batchId,
          totalFiles: accepted.totalFiles,
          completed: 0,
          successful: 0,
          failed: 0,
          processing: 0,
          queued: accepted.totalFiles,
          results: [],
          errors: [],
          startedAt: createdAt,
          completedAt: null,
          state: "processing",
        },
      }))
      setSelectedBatchId(accepted.batchId)
      setSelectedFiles([])
      setMode("history")
      toast({ title: "CVs secured", description: `${accepted.totalFiles} files are queued for background processing.` })
      void refreshBatch(accepted.batchId)
    } catch (error) {
      const typedError = error as Error & { status?: number; code?: string }
      const keyConflict = typedError.status === 409 && typedError.code === "CV_IDEMPOTENCY_KEY_REUSED"
      if (keyConflict) sessionStorage.removeItem(attemptStorageKey)
      const message = keyConflict
        ? "The selected files changed after this upload was first attempted. Retry to secure them with a new request key."
        : error instanceof Error ? error.message : "The CVs could not be uploaded."
      setUploadError(message)
      setMode("select")
      toast({ title: "Upload failed", description: message, variant: "destructive" })
    }
  }

  async function retryBatch() {
    if (!activeStatus || retrying) return
    setRetrying(activeStatus.batchId)
    try {
      const next = await retryBulkUpload(activeStatus.batchId)
      setStatuses((current) => ({ ...current, [activeStatus.batchId]: next }))
      setBatchErrors((current) => ({ ...current, [activeStatus.batchId]: "" }))
      toast({
        title: next.promoted > 0 ? "Retry started" : "Processing is already active",
        description: next.promoted > 0
          ? `${next.promoted} retained ${next.promoted === 1 ? "CV was" : "CVs were"} returned to the queue.`
          : "No waiting job needed to be restarted.",
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : "CV analysis could not be retried."
      setBatchErrors((current) => ({ ...current, [activeStatus.batchId]: message }))
      toast({ title: "Retry failed", description: message, variant: "destructive" })
    } finally {
      setRetrying(null)
    }
  }

  async function retryFile(row: UploadFileRow) {
    if (!activeStatus || retrying) return
    if (!row.jobId) {
      await retryBatch()
      return
    }
    setRetrying(row.jobId)
    try {
      await retryCVIngestionJob(row.jobId, "failed")
      toast({ title: "CV returned to the queue", description: row.fileName })
      await refreshBatch(activeStatus.batchId)
    } catch (error) {
      const message = error instanceof Error ? error.message : "This CV could not be retried."
      setBatchErrors((current) => ({ ...current, [activeStatus.batchId]: message }))
      toast({ title: "Retry failed", description: message, variant: "destructive" })
    } finally {
      setRetrying(null)
    }
  }

  if (!historyReady || loadedStorageKey !== storageKey || organizationLoading || userState.isLoading || !storageKey) {
    return (
      <div className="mx-auto flex min-h-[360px] max-w-6xl items-center justify-center px-5">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">Loading upload history…</span>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <header className="mb-6 flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Bulk CV upload</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Upload CVs, leave this page, and return later. Processing status is retained for this account and organization.
          </p>
        </div>
        <div className="flex gap-2">
          {mode === "history" ? (
            <Button variant="outline" onClick={() => { setUploadError(null); setMode("select") }}>
              <Plus className="mr-2 h-4 w-4" />New upload
            </Button>
          ) : null}
          <Button variant="outline" onClick={() => router.push("/candidates")}>
            <Users className="mr-2 h-4 w-4" />Candidates
          </Button>
          <Button variant="outline" onClick={() => router.push("/cv-processing")}>Processing history</Button>
        </div>
      </header>

      {mode === "select" || mode === "uploading" ? (
        <Card className="mx-auto max-w-3xl">
          <CardHeader>
            <CardTitle className="text-lg">Select CV files</CardTitle>
            <CardDescription>PDF, DOC, or DOCX; up to 10 MB per file.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <button
              type="button"
              className="flex w-full flex-col items-center border border-dashed px-6 py-10 text-center transition-colors hover:border-foreground/40 hover:bg-muted/40 disabled:cursor-wait disabled:opacity-60"
              onDragOver={(event) => event.preventDefault()}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              disabled={mode === "uploading"}
            >
              {mode === "uploading" ? <Loader2 className="mb-3 h-7 w-7 animate-spin text-muted-foreground" />
                : <Upload className="mb-3 h-7 w-7 text-muted-foreground" />}
              <span className="font-medium">{mode === "uploading" ? "Securing files for background processing…" : "Choose files or drop them here"}</span>
              <span className="mt-1 text-sm text-muted-foreground">Analysis begins after every file is durably accepted.</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.doc,.docx"
              className="hidden"
              onChange={(event) => event.target.files && handleFiles(event.target.files)}
            />

            {selectedFiles.length > 0 ? (
              <div className="overflow-hidden border">
                <div className="flex items-center justify-between border-b bg-muted/30 px-3 py-2 text-sm">
                  <span><strong>{selectedFiles.length}</strong> files · {formatSize(selectedFiles.reduce((total, file) => total + file.size, 0))}</span>
                  <Button variant="ghost" size="sm" onClick={() => setSelectedFiles([])} disabled={mode === "uploading"}>Clear</Button>
                </div>
                <ScrollArea className="h-48">
                  {selectedFiles.slice(0, 500).map((file, index) => (
                    <div key={`${file.name}:${file.lastModified}:${index}`} className="flex items-center gap-3 border-b px-3 py-2 text-sm last:border-b-0">
                      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">{file.name}</span>
                      <span className="text-xs text-muted-foreground">{formatSize(file.size)}</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        disabled={mode === "uploading"}
                        aria-label={`Remove ${file.name}`}
                        onClick={() => setSelectedFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                  {selectedFiles.length > 500 ? (
                    <p className="px-3 py-2 text-xs text-muted-foreground">And {selectedFiles.length - 500} more files.</p>
                  ) : null}
                </ScrollArea>
              </div>
            ) : null}

            {uploadError ? (
              <div className="flex gap-2 border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{uploadError}
              </div>
            ) : null}

            <div className="flex justify-end gap-2">
              {uploads.length > 0 ? <Button variant="ghost" onClick={() => setMode("history")} disabled={mode === "uploading"}>Cancel</Button> : null}
              <Button onClick={() => void startUpload()} disabled={selectedFiles.length === 0 || mode === "uploading"}>
                {mode === "uploading" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                {mode === "uploading" ? "Securing files" : `Upload ${selectedFiles.length || ""} CV${selectedFiles.length === 1 ? "" : "s"}`}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : uploads.length === 0 ? (
        <div className="border px-6 py-14 text-center">
          <Upload className="mx-auto h-7 w-7 text-muted-foreground" />
          <h2 className="mt-3 font-medium">No recent uploads</h2>
          <p className="mt-1 text-sm text-muted-foreground">Start a bulk upload to track each CV here.</p>
          <Button className="mt-4" onClick={() => setMode("select")}><Plus className="mr-2 h-4 w-4" />New upload</Button>
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="self-start overflow-hidden border bg-card">
            <div className="border-b px-4 py-3">
              <h2 className="text-sm font-medium">Current and recent</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">Latest eight uploads on this account</p>
            </div>
            <div className="divide-y">
              {uploads.map((upload) => {
                const itemStatus = statuses[upload.batchId]
                const selected = selectedBatchId === upload.batchId
                return (
                  <button
                    type="button"
                    key={upload.batchId}
                    onClick={() => setSelectedBatchId(upload.batchId)}
                    className={`w-full border-l-2 px-4 py-3 text-left transition-colors ${selected ? "border-l-foreground bg-muted/60" : "border-l-transparent hover:bg-muted/30"}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-medium">{itemStatus?.totalFiles || upload.files.length} CVs</span>
                      <BatchState status={itemStatus} />
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{formatWhen(itemStatus?.startedAt || upload.createdAt)}</p>
                    {itemStatus ? (
                      <p className="mt-2 text-xs text-muted-foreground">
                        {itemStatus.successful} created · {itemStatus.failed} failed{itemStatus.cancelled ? ` · ${itemStatus.cancelled} cancelled` : ""} · {itemStatus.totalFiles - itemStatus.completed} remaining
                      </p>
                    ) : null}
                  </button>
                )
              })}
            </div>
          </aside>

          <main className="min-w-0 space-y-4">
            {!activeStatus ? (
              <div className="flex min-h-52 items-center justify-center border text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />Restoring batch status…
              </div>
            ) : (
              <>
                <section className="border bg-card">
                  <div className="flex flex-col gap-4 border-b px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        {activeStatus.state === "completed" && activeStatus.failed === 0 && !activeStatus.cancelled
                          ? <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                          : activeStatus.state === "completed" && activeStatus.failed === 0
                            ? <PauseCircle className="h-5 w-5 text-muted-foreground" />
                            : isParked ? <PauseCircle className="h-5 w-5 text-amber-600" />
                            : activeStatus.state === "completed" ? <AlertCircle className="h-5 w-5 text-red-600" />
                              : <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
                        <h2 className="font-semibold">
                          {activeStatus.state === "completed"
                            ? activeStatus.failed > 0
                              ? "Processing finished with failures"
                              : activeStatus.cancelled
                                ? "Processing finished with cancellations"
                                : "Processing complete"
                            : isParked ? "Analysis paused" : "Processing CVs"}
                        </h2>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Started {formatWhen(activeStatus.startedAt)}
                        {activeStatus.state !== "completed" ? ` · ${formatDuration(activeStatus.startedAt)} elapsed` : ""}
                      </p>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => void refreshBatch(activeStatus.batchId)}>
                      <RefreshCw className="mr-2 h-3.5 w-3.5" />Refresh
                    </Button>
                  </div>
                  <div className="px-5 py-4">
                    <div className="mb-2 flex items-center justify-between text-sm">
                      <span>{activeStatus.completed} of {activeStatus.totalFiles} finished</span>
                      <span className="font-medium">{progressPercent}%</span>
                    </div>
                    <Progress value={progressPercent} className="h-2" />
                    <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 border-t pt-3 text-sm">
                      <span><strong className="text-emerald-700 dark:text-emerald-300">{activeStatus.successful}</strong> candidates created</span>
                      <span><strong className={activeStatus.failed > 0 ? "text-red-700 dark:text-red-300" : ""}>{activeStatus.failed}</strong> failed</span>
                      {activeStatus.cancelled ? <span><strong>{activeStatus.cancelled}</strong> cancelled</span> : null}
                      <span><strong>{activeStatus.processing}</strong> processing</span>
                      <span><strong>{activeStatus.queued}</strong> queued</span>
                    </div>
                  </div>
                </section>

                {typeof navigator !== "undefined" && !navigator.onLine ? (
                  <div className="flex gap-2 border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                    <WifiOff className="mt-0.5 h-4 w-4 shrink-0" />You are offline. Status will reconnect automatically when the network returns.
                  </div>
                ) : null}

                {activeError ? (
                  <div className="flex items-start justify-between gap-3 border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">
                    <div className="flex gap-2"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{activeError}</span></div>
                    <Button variant="outline" size="sm" onClick={() => void refreshBatch(activeStatus.batchId)}>Reconnect</Button>
                  </div>
                ) : null}

                {isParked ? (
                  <div className="border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
                    <p className="font-medium">The CV files are retained safely, but AI analysis needs attention.</p>
                    {activeStatus.waitingReason ? <p className="mt-1 text-amber-800 dark:text-amber-200">{activeStatus.waitingReason}</p> : null}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button size="sm" onClick={() => void retryBatch()} disabled={Boolean(retrying)}>
                        {retrying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}
                        Verify connection and retry
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => router.push("/settings/ai-account")}>ChatGPT settings</Button>
                    </div>
                  </div>
                ) : null}

                <section className="overflow-hidden border bg-card">
                  <div className="flex items-center justify-between border-b px-5 py-3">
                    <div>
                      <h2 className="text-sm font-medium">Files</h2>
                      <p className="mt-0.5 text-xs text-muted-foreground">Each row updates as its CV moves through ingestion.</p>
                    </div>
                    {activeStatus.state === "completed" && activeStatus.failed > 0 ? (
                      <Button variant="outline" size="sm" onClick={() => void retryBatch()} disabled={Boolean(retrying)}>
                        {retrying === activeStatus.batchId ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="mr-2 h-3.5 w-3.5" />}
                        Retry all failed
                      </Button>
                    ) : null}
                  </div>
                  <div className="divide-y">
                    {fileRows.map((row) => (
                      <div key={row.key} className="px-5 py-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 items-center gap-2">
                              {row.state === "completed" ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                                : row.state === "failed" ? <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />
                                  : row.state === "waiting" ? <PauseCircle className="h-4 w-4 shrink-0 text-amber-600" />
                                    : <Clock3 className="h-4 w-4 shrink-0 text-muted-foreground" />}
                              <span className="truncate text-sm font-medium">{row.fileName}</span>
                              {row.size ? <span className="shrink-0 text-xs text-muted-foreground">{formatSize(row.size)}</span> : null}
                            </div>
                            <div className="mt-1 flex items-center gap-2 text-xs">
                              <span className={row.state === "failed" ? "text-red-700 dark:text-red-300"
                                : row.state === "waiting" ? "text-amber-700 dark:text-amber-300"
                                  : row.state === "completed" ? "text-emerald-700 dark:text-emerald-300"
                                    : "text-muted-foreground"}>
                                {statusLabel(row)}{typeof row.progress === "number" && row.state !== "completed" ? ` · ${row.progress}%` : ""}
                              </span>
                              {!row.detailIsExact ? <span className="text-muted-foreground">· awaiting per-file update</span> : null}
                            </div>
                            {row.error ? <p className="mt-2 max-w-2xl text-sm text-red-700 dark:text-red-300">{row.error}</p> : null}
                            <FileStageTrack row={row} />
                          </div>
                          <div className="flex shrink-0 gap-2">
                            {row.candidateId ? (
                              <Button variant="outline" size="sm" onClick={() => router.push(`/candidates/${row.candidateId}`)}>
                                <Eye className="mr-2 h-3.5 w-3.5" />View candidate
                              </Button>
                            ) : null}
                            {row.state === "failed" && row.canRetry ? (
                              <Button variant="outline" size="sm" onClick={() => void retryFile(row)} disabled={Boolean(retrying)}>
                                {retrying === (row.jobId || activeStatus.batchId)
                                  ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                                  : <RotateCcw className="mr-2 h-3.5 w-3.5" />}
                                Retry
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    ))}
                    {fileRows.length === 0 ? (
                      <div className="px-5 py-10 text-center text-sm text-muted-foreground">Waiting for the first per-file update…</div>
                    ) : null}
                  </div>
                </section>
              </>
            )}
          </main>
        </div>
      )}
    </div>
  )
}
