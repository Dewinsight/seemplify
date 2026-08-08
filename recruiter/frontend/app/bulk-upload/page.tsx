"use client"

import type React from "react"
import { useState, useRef, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import {
  Upload, FileText, CheckCircle, AlertCircle, X, Loader2,
  Users, Plus, Eye, Zap, BarChart3, Clock, RefreshCw,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useToast } from "@/hooks/use-toast"
import {
  bulkUploadCVs,
  getBulkUploadStatus,
  getRecentBulkUploadStatus,
  retryBulkUpload,
  type BulkUploadStatus,
} from "@/services/candidateService"

type PageState = "idle" | "uploading" | "processing" | "completed"

export default function BulkUploadPage() {
  const router = useRouter()
  const { toast } = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pollRef = useRef<NodeJS.Timeout | null>(null)
  const restoreAttemptedRef = useRef(false)

  const [pageState, setPageState] = useState<PageState>("idle")
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [batchId, setBatchId] = useState<string | null>(null)
  const [status, setStatus] = useState<BulkUploadStatus | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [pollError, setPollError] = useState<string | null>(null)
  const [retrying, setRetrying] = useState(false)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)

  const progressPercent = status
    ? Math.round((status.completed / status.totalFiles) * 100)
    : 0

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return
    const newFiles = Array.from(e.target.files).filter((f) => {
      const ext = f.name.toLowerCase()
      return ext.endsWith('.pdf') || ext.endsWith('.doc') || ext.endsWith('.docx')
    })
    if (newFiles.length === 0) {
      toast({ title: "Invalid files", description: "Only PDF, DOC, DOCX files are accepted.", variant: "destructive" })
      return
    }
    setSelectedFiles((prev) => [...prev, ...newFiles])
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation() }
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation()
    if (e.dataTransfer.files) {
      const input = fileInputRef.current
      if (input) { input.files = e.dataTransfer.files; handleFileSelect({ target: input } as any) }
    }
  }

  const removeFile = (index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index))
  }

  const startUpload = async () => {
    if (selectedFiles.length === 0) return
    setPageState("uploading")
    setUploadError(null)
    setElapsedSeconds(0)

    try {
      const result = await bulkUploadCVs(selectedFiles)
      setBatchId(result.batchId)
      setPageState("processing")
      toast({ title: "Upload accepted", description: `${result.totalFiles} CVs queued for processing.` })
    } catch (err: any) {
      setUploadError(err.message)
      setPageState("idle")
      toast({ title: "Upload failed", description: err.message, variant: "destructive" })
    }
  }

  // Poll for status updates
  const pollStatus = useCallback(async () => {
    if (!batchId) return
    try {
      const s = await getBulkUploadStatus(batchId)
      setStatus(s)
      setPollError(null)
      if (s.state === 'completed') {
        setPageState("completed")
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
        toast({
          title: "Bulk processing complete",
          description: `${s.successful} candidates created, ${s.failed} failed out of ${s.totalFiles} CVs.`,
        })
      }
    } catch (error: any) {
      setPollError(error?.message || "Live status is temporarily unavailable. Retrying…")
    }
  }, [batchId, toast])

  // A deployment or accidental refresh must not orphan a retained batch in
  // browser memory. Restore this recruiter's latest actionable batch.
  useEffect(() => {
    if (restoreAttemptedRef.current || batchId || pageState !== "idle") return
    restoreAttemptedRef.current = true
    let cancelled = false
    const restoreRecentBatch = async () => {
      const retryDelays = [0, 1_000, 2_000, 4_000, 8_000]
      for (const delay of retryDelays) {
        if (cancelled) return
        if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))
        try {
          const recent = await getRecentBulkUploadStatus()
          if (cancelled || !recent || (recent.state === "completed" && recent.failed === 0)) return
          setBatchId(recent.batchId)
          setStatus(recent)
          setPageState(recent.state === "completed" ? "completed" : "processing")
          if (recent.startedAt) {
            setElapsedSeconds(Math.max(0, Math.floor((Date.now() - new Date(recent.startedAt).getTime()) / 1000)))
          }
          return
        } catch {
          // Authentication and organization context can settle just after the
          // page mounts. Keep retrying briefly instead of losing the retained
          // batch behind an empty uploader.
        }
      }
    }
    void restoreRecentBatch()
    return () => { cancelled = true }
  }, [batchId, pageState])

  useEffect(() => {
    if (pageState === "processing" && batchId) {
      pollStatus()
      pollRef.current = setInterval(pollStatus, 2000)
      return () => { if (pollRef.current) clearInterval(pollRef.current) }
    }
  }, [pageState, batchId, pollStatus])

  // Elapsed time counter
  useEffect(() => {
    if (pageState === "processing" || pageState === "uploading") {
      const timer = setInterval(() => setElapsedSeconds((s) => s + 1), 1000)
      return () => clearInterval(timer)
    }
  }, [pageState])

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return m > 0 ? `${m}m ${s}s` : `${s}s`
  }

  const formatSize = (bytes: number) => {
    if (bytes === 0) return "0 B"
    const k = 1024
    const sizes = ["B", "KB", "MB"]
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
  }

  const totalSize = selectedFiles.reduce((sum, f) => sum + f.size, 0)

  const handleReset = () => {
    setPageState("idle")
    setSelectedFiles([])
    setBatchId(null)
    setStatus(null)
    setUploadError(null)
    setElapsedSeconds(0)
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }

  const rate = status && elapsedSeconds > 0
    ? (status.completed / elapsedSeconds * 60).toFixed(1)
    : null
  const eta = status && rate && parseFloat(rate) > 0
    ? Math.ceil((status.totalFiles - status.completed) / (parseFloat(rate) / 60))
    : null
  const isParked = Boolean(status && (
    status.state === "waiting_for_chatgpt" || status.waitingReason || status.waitingCode
  ))
  const canRetryFailed = Boolean(status && status.state === "completed" && status.failed > 0)

  const handleRetryAnalysis = async () => {
    if (!batchId || retrying) return
    setRetrying(true)
    try {
      const next = await retryBulkUpload(batchId)
      setStatus(next)
      setPageState(next.state === "completed" ? "completed" : "processing")
      setPollError(null)
      toast({
        title: next.promoted > 0 ? "CV analysis restarted" : "CV analysis is already moving",
        description: next.promoted > 0
          ? `${next.promoted} waiting ${next.promoted === 1 ? "CV was" : "CVs were"} sent for analysis now.`
          : "The queue no longer reports a parked CV."
      })
    } catch (error: any) {
      const message = error?.message || "CV analysis could not be retried"
      setPollError(message)
      toast({ title: "Action needed", description: message, variant: "destructive" })
    } finally {
      setRetrying(false)
    }
  }

  return (
    <div className="container mx-auto py-6 max-w-4xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Bulk CV Upload</h1>
          <p className="text-muted-foreground">Upload up to 10,000 CVs at once. AI processes each CV in parallel.</p>
        </div>
        <Button variant="outline" onClick={() => router.push("/candidates")}>
          <Users className="mr-2 h-4 w-4" /> View Candidates
        </Button>
      </div>

      {/* File Selection */}
      {(pageState === "idle") && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Upload className="h-5 w-5" /> Select CV Files</CardTitle>
            <CardDescription>
              Drag & drop or browse for PDF, DOC, DOCX files. Text-based CVs only (no scanned images).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div
              className="rounded-lg border-2 border-dashed border-gray-300 hover:border-blue-400 transition-colors p-12 text-center cursor-pointer"
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="mx-auto h-10 w-10 text-gray-400 mb-4" />
              <p className="text-lg font-medium mb-1">Drop CV files here or click to browse</p>
              <p className="text-sm text-muted-foreground">PDF, DOC, DOCX &middot; up to 10MB each &middot; up to 10,000 files</p>
              <input ref={fileInputRef} type="file" multiple accept=".pdf,.doc,.docx" className="hidden" onChange={handleFileSelect} />
            </div>

            {selectedFiles.length > 0 && (
              <>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Badge variant="secondary" className="text-base px-3 py-1">
                      {selectedFiles.length} file{selectedFiles.length !== 1 ? 's' : ''} selected
                    </Badge>
                    <span className="text-sm text-muted-foreground">{formatSize(totalSize)} total</span>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                      <Plus className="h-4 w-4 mr-1" /> Add More
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setSelectedFiles([])}>
                      Clear All
                    </Button>
                  </div>
                </div>

                <ScrollArea className="h-[240px] border rounded-lg">
                  <div className="p-2 space-y-1">
                    {selectedFiles.map((file, i) => (
                      <div key={`${file.name}-${i}`} className="flex items-center justify-between py-1.5 px-3 rounded hover:bg-muted/50 text-sm">
                        <div className="flex items-center gap-2 min-w-0">
                          <FileText className="h-4 w-4 text-blue-500 shrink-0" />
                          <span className="truncate">{file.name}</span>
                          <span className="text-muted-foreground shrink-0">{formatSize(file.size)}</span>
                        </div>
                        <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => removeFile(i)}>
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </ScrollArea>

                {uploadError && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 shrink-0" /> {uploadError}
                  </div>
                )}

                <Button className="w-full h-12 text-base" onClick={startUpload}>
                  <Zap className="h-5 w-5 mr-2" />
                  Start Processing {selectedFiles.length} CV{selectedFiles.length !== 1 ? 's' : ''}
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Uploading spinner */}
      {pageState === "uploading" && (
        <Card>
          <CardContent className="py-16 text-center space-y-4">
            <Loader2 className="h-12 w-12 animate-spin mx-auto text-blue-500" />
            <h2 className="text-xl font-semibold">Uploading {selectedFiles.length} files...</h2>
            <p className="text-muted-foreground">Sending files to the server. This may take a moment for large batches.</p>
            <p className="text-sm text-muted-foreground"><Clock className="inline h-3 w-3 mr-1" />{formatTime(elapsedSeconds)}</p>
          </CardContent>
        </Card>
      )}

      {/* Processing progress */}
      {(pageState === "processing" || pageState === "completed") && status && (
        <div className="space-y-4">
          {/* Stats bar */}
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            <Card className="p-4 text-center">
              <div className="text-2xl font-bold">{status.totalFiles}</div>
              <div className="text-xs text-muted-foreground">Total CVs</div>
            </Card>
            <Card className="p-4 text-center">
              <div className="text-2xl font-bold text-green-600">{status.successful}</div>
              <div className="text-xs text-muted-foreground">Created</div>
            </Card>
            <Card className="p-4 text-center">
              <div className="text-2xl font-bold text-red-600">{status.failed}</div>
              <div className="text-xs text-muted-foreground">Failed</div>
            </Card>
            <Card className="p-4 text-center">
              <div className="text-2xl font-bold text-blue-600">{status.processing}</div>
              <div className="text-xs text-muted-foreground">Processing</div>
            </Card>
            <Card className="p-4 text-center">
              <div className="text-2xl font-bold">{status.queued}</div>
              <div className="text-xs text-muted-foreground">Waiting</div>
            </Card>
            <Card className="p-4 text-center">
              <div className="text-2xl font-bold">{formatTime(elapsedSeconds)}</div>
              <div className="text-xs text-muted-foreground">Elapsed</div>
            </Card>
          </div>

          {isParked && (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              {/* Saying only "waiting" leaves someone watching a spinner with no
                  idea whether to wait a minute or a week — so the runtime's own
                  reason is shown when it gave one. */}
              <p className="font-medium">
                AI analysis is paused. All {status.queued} waiting {status.queued === 1 ? "CV is" : "CVs are"} saved
                and will resume automatically.
              </p>
              {status.waitingReason && (
                <p className="mt-1 text-amber-800">{status.waitingReason}</p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" onClick={handleRetryAnalysis} disabled={retrying}>
                  {retrying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                  Verify connection and retry now
                </Button>
                <Button size="sm" variant="outline" onClick={() => router.push("/settings/ai-account")}>
                  Open ChatGPT settings
                </Button>
              </div>
            </div>
          )}

          {pollError && (
            <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <AlertCircle className="mr-2 inline h-4 w-4" />{pollError}
            </div>
          )}

          {canRetryFailed && (
            <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              <p className="font-medium">One or more retained CVs could not finish processing.</p>
              <p className="mt-1 text-red-700">Retry the saved files now; you do not need to upload them again.</p>
              <Button className="mt-3" size="sm" onClick={handleRetryAnalysis} disabled={retrying}>
                {retrying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                Retry failed CVs
              </Button>
            </div>
          )}

          {/* Progress */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  {pageState === "processing" ? isParked ? (
                    <><AlertCircle className="h-5 w-5 text-amber-600" /> AI analysis needs attention</>
                  ) : (
                    <><Loader2 className="h-5 w-5 animate-spin text-blue-500" /> Processing CVs...</>
                  ) : (
                    <><CheckCircle className="h-5 w-5 text-green-500" /> Processing Complete</>
                  )}
                </CardTitle>
                <div className="text-sm text-muted-foreground">
                  {status.completed} / {status.totalFiles}
                  {rate && <span className="ml-3"><BarChart3 className="inline h-3 w-3 mr-1" />{rate}/min</span>}
                  {eta !== null && pageState === "processing" && (
                    <span className="ml-3"><Clock className="inline h-3 w-3 mr-1" />~{formatTime(eta)} left</span>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <Progress value={progressPercent} className="h-3" />

              <ScrollArea className="h-[350px] border rounded-lg">
                <div className="p-2 space-y-1">
                  {/* Show recent successes */}
                  {[...status.results].reverse().slice(0, 200).map((r, i) => (
                    <div key={`s-${i}`} className="flex items-center justify-between py-1.5 px-3 rounded hover:bg-muted/50 text-sm">
                      <div className="flex items-center gap-2 min-w-0">
                        <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
                        <span className="truncate font-medium">{r.candidateName}</span>
                        <span className="text-muted-foreground truncate">{r.fileName}</span>
                      </div>
                      <Button variant="ghost" size="sm" className="h-7 shrink-0" onClick={() => router.push(`/candidates/${r.candidateId}`)}>
                        <Eye className="h-3 w-3 mr-1" /> View
                      </Button>
                    </div>
                  ))}
                  {/* Show errors */}
                  {status.errors.map((e, i) => (
                    <div key={`e-${i}`} className="flex items-center gap-2 py-1.5 px-3 rounded text-sm text-red-600 bg-red-50/50">
                      <AlertCircle className="h-4 w-4 shrink-0" />
                      <span className="truncate font-medium">{e.fileName}</span>
                      <span className="text-red-500 truncate text-xs">{e.error}</span>
                    </div>
                  ))}
                  {status.completed === 0 && !isParked && (
                    <div className="py-8 text-center text-muted-foreground">
                      <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
                      Starting CV processing...
                    </div>
                  )}
                  {status.completed === 0 && isParked && (
                    <div className="py-10 text-center text-amber-800">
                      <AlertCircle className="mx-auto mb-3 h-7 w-7" />
                      <p className="font-medium">CV saved safely; AI analysis is paused.</p>
                      <p className="mt-1 text-sm text-amber-700">Use “Verify connection and retry now” above. You do not need to upload the file again.</p>
                    </div>
                  )}
                </div>
              </ScrollArea>

              {pageState === "completed" && (
                <div className="flex justify-center gap-3 pt-2">
                  <Button onClick={() => router.push("/candidates")}>
                    <Users className="mr-2 h-4 w-4" /> View All Candidates
                  </Button>
                  <Button variant="outline" onClick={handleReset}>
                    <RefreshCw className="mr-2 h-4 w-4" /> Upload More
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
