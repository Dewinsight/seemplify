"use client"

import { AlertCircle, Check, Circle } from "lucide-react"
import type { CVIngestionJob } from "@/services/candidateService"
import { buildCvStageTimeline, reconcileUploadFiles } from "@/utils/cvUploadProgress"

function formatDate(value?: string | null) {
  if (!value) return "Not reported"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "Not reported" : new Intl.DateTimeFormat(undefined, {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit",
  }).format(date)
}

export function CvProcessingTimeline({ job, dark = false }: { job: CVIngestionJob; dark?: boolean }) {
  const row = reconcileUploadFiles([{ name: job.file?.name || job.file?.originalName || job.originalName || "CV", size: job.file?.size || 0 }], {
    state: job.state,
    jobs: [job],
  })[0]
  const timeline = buildCvStageTimeline(row)
  const artifacts = job.artifacts
  const managedFile = artifacts?.managedFile || artifacts?.cloudinaryFile
  const managedStorageLabel = managedFile?.provider === "azure-blob"
    ? "Azure Blob Storage"
    : managedFile?.provider === "cloudinary"
      ? "Cloudinary"
      : "Managed storage"
  const artifactRows = [
    ["Durable file", artifacts?.durableFile?.available, artifacts?.durableFile?.storedAt],
    [managedStorageLabel, managedFile?.available, managedFile?.storedAt],
    ["Extracted text", artifacts?.extractedText?.available, artifacts?.extractedText?.extractedAt],
    ["AI result", artifacts?.analysis?.available, artifacts?.analysis?.completedAt],
    ["Candidate profile", artifacts?.profile?.available, artifacts?.profile?.committedAt],
  ] as const
  const muted = dark ? "text-gray-500" : "text-muted-foreground"
  const border = dark ? "border-gray-700" : "border-border"

  return (
    <div className="space-y-5" data-testid="cv-processing-timeline">
      {job.error?.message ? (
        <div className={dark ? "border border-red-900 bg-red-950/40 p-3 text-sm text-red-200" : "border border-red-200 bg-red-50 p-3 text-sm text-red-800"}>
          <p className="font-medium">{job.error.code || "Processing failed"}</p>
          <p className="mt-1">{job.error.message}</p>
          <p className="mt-2 text-xs opacity-80">Stage: {(job.error.stage || job.stage || "not reported").replaceAll("_", " ")} · Failed: {formatDate(job.error.at || job.failedAt)}</p>
        </div>
      ) : null}

      <div>
        <h3 className={dark ? "text-sm font-medium text-white" : "text-sm font-medium"}>Processing timeline</h3>
        <ol className={`mt-3 border-l pl-4 ${border}`}>
          {timeline.map((item) => (
            <li key={item.label} className="relative pb-4 text-sm last:pb-0">
              <span className={`absolute -left-[21px] top-0.5 ${dark ? "bg-gray-900" : "bg-background"}`}>
                {item.state === "done" ? <Check className="h-3.5 w-3.5 text-emerald-500" />
                  : item.state === "failed" ? <AlertCircle className="h-3.5 w-3.5 text-red-500" />
                    : <Circle className={`h-3.5 w-3.5 ${item.state === "active" ? "fill-amber-400 text-amber-500" : dark ? "text-gray-700" : "text-border"}`} />}
              </span>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className={item.state === "active" ? (dark ? "font-medium text-white" : "font-medium")
                  : item.state === "failed" ? "font-medium text-red-500" : muted}>{item.label}</span>
                <span className={`text-xs ${muted}`}>{item.at ? formatDate(item.at) : item.state === "active" ? "In progress" : item.state === "unknown" ? "Not retained" : ""}</span>
              </div>
            </li>
          ))}
        </ol>
      </div>

      <div>
        <h3 className={dark ? "text-sm font-medium text-white" : "text-sm font-medium"}>Artifact checkpoints</h3>
        <div className={`mt-3 divide-y border ${dark ? "divide-gray-800 border-gray-800" : "divide-border"}`}>
          {artifactRows.map(([label, available, at]) => (
            <div key={label} className="flex items-center justify-between gap-4 px-3 py-2 text-sm">
              <span>{label}</span>
              <span className={`text-right text-xs ${available ? "text-emerald-500" : muted}`}>
                {available ? `Available · ${formatDate(at)}` : "Not available"}
                {label === "Extracted text" && artifacts?.extractedText?.length ? ` · ${artifacts.extractedText.length} chars` : ""}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
