export const CV_UPLOAD_HISTORY_VERSION = 1;
export const CV_UPLOAD_HISTORY_LIMIT = 8;
export const CV_UPLOAD_HISTORY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type PersistedUploadFile = {
  name: string;
  size: number;
};

export type PersistedBulkUpload = {
  batchId: string;
  createdAt: string;
  files: PersistedUploadFile[];
};

export type StoredUploadHistory = {
  version: typeof CV_UPLOAD_HISTORY_VERSION;
  uploads: PersistedBulkUpload[];
};

type TerminalResult = {
  fileName: string;
  candidateId?: string | null;
};

type TerminalError = {
  fileName: string;
  error?: string | null;
};

type RichUploadJob = {
  jobId?: string;
  state?: string;
  phase?: string | null;
  stage?: string | null;
  progress?: number | null;
  stageStartedAt?: string | null;
  file?: {
    name?: string | null;
    originalName?: string | null;
    size?: number | null;
    receivedAt?: string | null;
    storedAt?: string | null;
    cloudStoredAt?: string | null;
  } | null;
  originalName?: string | null;
  candidate?: { id?: string | null; candidateId?: string | null } | string | null;
  candidateId?: string | null;
  error?: { message?: string | null; code?: string | null } | null;
  retry?: { available?: boolean } | null;
  artifacts?: {
    received?: { at?: string | null };
    durableFile?: { storedAt?: string | null };
    cloudinaryFile?: { storedAt?: string | null };
    extractedText?: { extractedAt?: string | null };
    analysis?: { completedAt?: string | null };
    profile?: { committedAt?: string | null };
  } | null;
  stageHistory?: Array<{
    stage?: string | null;
    state?: string | null;
    progress?: number | null;
    at?: string | null;
  }>;
};

export type UploadStatusLike = {
  state: string;
  results?: TerminalResult[];
  errors?: TerminalError[];
  jobs?: RichUploadJob[];
};

export type UploadFileRow = {
  key: string;
  fileName: string;
  size?: number;
  jobId?: string;
  state: "queued" | "waiting" | "processing" | "completed" | "failed" | "cancelled" | "unknown";
  stage: string | null;
  progress: number | null;
  candidateId?: string | null;
  error?: string | null;
  errorStage?: string | null;
  errorAt?: string | null;
  stageStartedAt?: string | null;
  receivedAt?: string | null;
  storedAt?: string | null;
  cloudStoredAt?: string | null;
  textExtractedAt?: string | null;
  analysisCompletedAt?: string | null;
  profileCommittedAt?: string | null;
  stageHistory: Array<{
    stage: string;
    state?: string | null;
    progress?: number | null;
    at?: string | null;
  }>;
  canRetry: boolean;
  detailIsExact: boolean;
};

export type CvStageTimelineItem = {
  label: string;
  state: "done" | "active" | "failed" | "pending" | "unknown";
  at?: string | null;
};

const CV_STAGE_DEFINITIONS = [
  { label: "Received", history: ["received", "ingesting"], current: ["received", "ingesting"] },
  { label: "Secure storage", history: [] as string[], current: [] as string[], artifact: "storedAt" as const },
  { label: "Cloudinary", history: ["uploading", "stored"], current: ["uploading"], artifact: "cloudStoredAt" as const },
  { label: "Text extraction", history: ["extracting"], current: ["extracting"], artifact: "textExtractedAt" as const },
  { label: "AI analysis", history: ["analyzing"], current: ["analyzing"], artifact: "analysisCompletedAt" as const },
  { label: "Profile creation", history: ["profile_creation", "finalizing"], current: ["profile_creation", "finalizing"], artifact: "profileCommittedAt" as const },
  { label: "Complete", history: ["completed"], current: ["completed"] },
] as const;

function stageRank(stage?: string | null) {
  if (!stage) return -1;
  if (["received", "ingesting"].includes(stage)) return 0;
  if (stage === "uploading" || stage === "stored") return 2;
  if (stage === "extracting" || stage === "parsing") return 3;
  if (stage === "analyzing" || stage === "analysis") return 4;
  if (stage === "profile_creation" || stage === "finalizing") return 5;
  if (stage === "completed") return 6;
  return -1;
}

export function buildCvStageTimeline(row: UploadFileRow): CvStageTimelineItem[] {
  const effectiveStage = row.errorStage || row.stage;
  const effectiveRank = stageRank(effectiveStage);
  const timeline: CvStageTimelineItem[] = CV_STAGE_DEFINITIONS.map((definition, index) => {
    const entry = row.stageHistory.find((item) => definition.history.includes(item.stage as never));
    const artifactAt = "artifact" in definition ? row[definition.artifact] : null;
    const matchesFailure = row.state === "failed" && (
      definition.current.includes(effectiveStage as never)
      || (effectiveStage === "parsing" && index === 3)
      || (effectiveStage === "analysis" && index === 4)
      || (effectiveStage !== "failed" && effectiveRank >= 0 && index === effectiveRank)
    );
    const matchesCurrent = !["completed", "failed"].includes(row.state)
      && definition.current.includes(row.stage as never);
    let state: CvStageTimelineItem["state"] = "pending";
    if (matchesFailure) state = "failed";
    else if (matchesCurrent) state = "active";
    else if (artifactAt || (entry && (effectiveRank > index || row.state === "completed"))) state = "done";
    else if (index === 6 && row.state === "completed") state = "done";
    else if (!row.detailIsExact) state = "unknown";
    return {
      label: definition.label,
      state,
      at: artifactAt || entry?.at || (matchesFailure ? row.errorAt : null),
    };
  });
  if (row.state === "failed" && !timeline.some((item) => item.state === "failed")) {
    timeline.push({ label: "Failed (stage not reported)", state: "failed", at: row.errorAt || null });
  }
  return timeline;
}

function safeDate(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeFile(value: unknown): PersistedUploadFile | null {
  if (!value || typeof value !== "object") return null;
  const file = value as Record<string, unknown>;
  if (typeof file.name !== "string" || !file.name.trim()) return null;
  const size = typeof file.size === "number" && Number.isFinite(file.size) && file.size >= 0
    ? file.size
    : 0;
  return { name: file.name, size };
}

function normalizeUpload(value: unknown): PersistedBulkUpload | null {
  if (!value || typeof value !== "object") return null;
  const upload = value as Record<string, unknown>;
  if (typeof upload.batchId !== "string" || !upload.batchId.trim()) return null;
  const createdAt = safeDate(upload.createdAt);
  if (createdAt === null) return null;
  const files = Array.isArray(upload.files)
    ? upload.files.map(normalizeFile).filter((file): file is PersistedUploadFile => Boolean(file))
    : [];
  return { batchId: upload.batchId, createdAt: new Date(createdAt).toISOString(), files };
}

export function parseUploadHistory(raw: string | null, now = Date.now()): PersistedBulkUpload[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed.version !== CV_UPLOAD_HISTORY_VERSION || !Array.isArray(parsed.uploads)) return [];
    const newestByBatch = new Map<string, PersistedBulkUpload>();
    parsed.uploads.forEach((value) => {
      const upload = normalizeUpload(value);
      if (!upload) return;
      const createdAt = Date.parse(upload.createdAt);
      if (createdAt > now + 5 * 60 * 1000 || now - createdAt > CV_UPLOAD_HISTORY_MAX_AGE_MS) return;
      if (!newestByBatch.has(upload.batchId)) newestByBatch.set(upload.batchId, upload);
    });
    return [...newestByBatch.values()]
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
      .slice(0, CV_UPLOAD_HISTORY_LIMIT);
  } catch {
    return [];
  }
}

export function serializeUploadHistory(uploads: PersistedBulkUpload[]): string {
  const normalized = uploads
    .map(normalizeUpload)
    .filter((upload): upload is PersistedBulkUpload => Boolean(upload))
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .slice(0, CV_UPLOAD_HISTORY_LIMIT);
  const history: StoredUploadHistory = { version: CV_UPLOAD_HISTORY_VERSION, uploads: normalized };
  return JSON.stringify(history);
}

export function upsertUploadHistory(
  uploads: PersistedBulkUpload[],
  next: PersistedBulkUpload,
): PersistedBulkUpload[] {
  return [next, ...uploads.filter((upload) => upload.batchId !== next.batchId)]
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .slice(0, CV_UPLOAD_HISTORY_LIMIT);
}

function fileNameForJob(job: RichUploadJob): string | null {
  return job.file?.name?.trim()
    || job.file?.originalName?.trim()
    || job.originalName?.trim()
    || null;
}

function candidateIdForJob(job: RichUploadJob): string | null {
  if (job.candidateId) return job.candidateId;
  if (typeof job.candidate === "string") return job.candidate;
  return job.candidate?.id || job.candidate?.candidateId || null;
}

function normalizeJobState(state: string | undefined): UploadFileRow["state"] {
  if (state === "completed") return "completed";
  if (state === "failed") return "failed";
  if (state === "cancelled" || state === "deleted") return "cancelled";
  if (state === "processing") return "processing";
  if (state === "waiting_for_chatgpt" || state === "waiting") return "waiting";
  if (state === "queued") return "queued";
  return "unknown";
}

function takeMatching<T extends { fileName: string }>(
  buckets: Map<string, T[]>,
  fileName: string,
): T | undefined {
  const bucket = buckets.get(fileName);
  return bucket?.shift();
}

function bucketsFor<T extends { fileName: string }>(values: T[] | undefined): Map<string, T[]> {
  const buckets = new Map<string, T[]>();
  (values || []).forEach((value) => {
    const bucket = buckets.get(value.fileName) || [];
    bucket.push(value);
    buckets.set(value.fileName, bucket);
  });
  return buckets;
}

export function reconcileUploadFiles(
  persistedFiles: PersistedUploadFile[],
  status: UploadStatusLike,
): UploadFileRow[] {
  const jobsByName = new Map<string, RichUploadJob[]>();
  (status.jobs || []).forEach((job) => {
    const name = fileNameForJob(job);
    if (!name) return;
    const bucket = jobsByName.get(name) || [];
    bucket.push(job);
    jobsByName.set(name, bucket);
  });
  const results = bucketsFor(status.results);
  const errors = bucketsFor(status.errors);
  const occurrences = new Map<string, number>();
  const jobFiles = (status.jobs || []).flatMap((job) => {
    const name = fileNameForJob(job);
    return name ? [{ name, size: job.file?.size || 0 }] : [];
  });
  const sourceFiles = persistedFiles.length > 0
    ? persistedFiles
    : jobFiles.length > 0
      ? jobFiles
      : [
          ...(status.results || []).map((result) => ({ name: result.fileName, size: 0 })),
          ...(status.errors || []).map((error) => ({ name: error.fileName, size: 0 })),
        ];

  return sourceFiles.map((file) => {
    const occurrence = occurrences.get(file.name) || 0;
    occurrences.set(file.name, occurrence + 1);
    const job = jobsByName.get(file.name)?.shift();
    if (job) {
      const state = normalizeJobState(job.state);
      return {
        key: job.jobId || `${file.name}:${occurrence}`,
        fileName: file.name,
        size: file.size || job.file?.size || undefined,
        jobId: job.jobId,
        state,
        stage: job.stage || job.phase || null,
        progress: typeof job.progress === "number" ? Math.max(0, Math.min(100, job.progress)) : null,
        candidateId: candidateIdForJob(job),
        error: job.error?.message || null,
        errorStage: (job.error as { stage?: string | null } | null | undefined)?.stage || null,
        errorAt: (job.error as { at?: string | null } | null | undefined)?.at || null,
        stageStartedAt: job.stageStartedAt || null,
        receivedAt: job.artifacts?.received?.at || job.file?.receivedAt || null,
        storedAt: job.artifacts?.durableFile?.storedAt || job.file?.storedAt || null,
        cloudStoredAt: job.artifacts?.cloudinaryFile?.storedAt || job.file?.cloudStoredAt || null,
        textExtractedAt: job.artifacts?.extractedText?.extractedAt || null,
        analysisCompletedAt: job.artifacts?.analysis?.completedAt || null,
        profileCommittedAt: job.artifacts?.profile?.committedAt || null,
        stageHistory: (job.stageHistory || []).flatMap((entry) => entry.stage ? [{
          stage: entry.stage,
          state: entry.state,
          progress: entry.progress,
          at: entry.at,
        }] : []),
        canRetry: state === "failed" && job.retry?.available === true,
        detailIsExact: true,
      };
    }
    const result = takeMatching(results, file.name);
    if (result) {
      return {
        key: `${file.name}:${occurrence}`,
        fileName: file.name,
        size: file.size || undefined,
        state: "completed",
        stage: "completed",
        progress: 100,
        candidateId: result.candidateId,
        stageHistory: [],
        canRetry: false,
        detailIsExact: true,
      };
    }
    const error = takeMatching(errors, file.name);
    if (error) {
      return {
        key: `${file.name}:${occurrence}`,
        fileName: file.name,
        size: file.size || undefined,
        state: "failed",
        stage: "failed",
        progress: null,
        error: error.error || "CV processing failed",
        stageHistory: [],
        canRetry: true,
        detailIsExact: true,
      };
    }
    return {
      key: `${file.name}:${occurrence}`,
      fileName: file.name,
      size: file.size || undefined,
      state: status.state === "waiting_for_chatgpt" ? "waiting" : "unknown",
      stage: null,
      progress: null,
      stageHistory: [],
      canRetry: false,
      detailIsExact: false,
    };
  });
}

export type CandidateAnalysisIndicator = {
  tone: "warning" | "danger";
  label: string;
  detail: string;
};

export function candidateAnalysisIndicator(metadata: {
  uploadSuccess?: boolean;
  parseSuccess?: boolean;
  aiSuccess?: boolean;
} | null | undefined): CandidateAnalysisIndicator | null {
  if (!metadata) return null;
  if (metadata.uploadSuccess === false) {
    return { tone: "danger", label: "CV upload failed", detail: "The source CV was not stored successfully." };
  }
  if (metadata.parseSuccess === false) {
    return { tone: "danger", label: "CV parsing failed", detail: "Candidate fields may be incomplete." };
  }
  if (metadata.aiSuccess === false) {
    return { tone: "warning", label: "Analysis incomplete", detail: "AI insights are not available for this candidate." };
  }
  if (metadata.parseSuccess === true && metadata.aiSuccess !== true) {
    return { tone: "warning", label: "Analysis pending", detail: "The CV was parsed, but AI analysis has not completed." };
  }
  return null;
}

export type CandidateCvProgressView = {
  label: string;
  tone: "neutral" | "warning" | "danger" | "success";
  active: boolean;
};

export function candidateCvProgressView(metadata: {
  cvIngestionState?: string;
  cvProcessingStage?: string;
  uploadSuccess?: boolean;
  parseSuccess?: boolean;
  aiSuccess?: boolean;
} | null | undefined): CandidateCvProgressView | null {
  if (!metadata?.cvIngestionState) {
    const legacy = candidateAnalysisIndicator(metadata);
    if (!legacy) return null;
    return {
      label: legacy.label,
      tone: legacy.tone === "danger" ? "danger" : "warning",
      active: legacy.label === "Analysis pending",
    };
  }
  const state = metadata.cvIngestionState;
  const stage = metadata.cvProcessingStage;
  if (state === "not_received") return { label: "CV not received", tone: "danger", active: false };
  if (state === "cancelled" || state === "deleted") return { label: "CV processing cancelled", tone: "neutral", active: false };
  if (state === "failed" || stage === "failed") return { label: "CV processing failed", tone: "danger", active: false };
  if (state === "waiting" || state === "waiting_for_chatgpt") return { label: "Analysis waiting", tone: "warning", active: true };
  if (state === "completed" || stage === "completed") return { label: "Analysis complete", tone: "success", active: false };
  if (state === "queued" || stage === "retry_scheduled") return { label: "Queued for processing", tone: "neutral", active: true };
  if (stage === "stored") return { label: "CV stored", tone: "neutral", active: true };
  if (stage === "uploading") return { label: "Storing CV", tone: "neutral", active: true };
  if (stage === "extracting") return { label: "Extracting CV", tone: "neutral", active: true };
  if (stage === "analyzing") return { label: "Analyzing CV", tone: "neutral", active: true };
  if (stage === "profile_creation" || stage === "finalizing") return { label: "Creating profile", tone: "neutral", active: true };
  if (state === "accepted" || stage === "received" || stage === "ingesting") {
    return { label: "CV received", tone: "neutral", active: true };
  }
  return { label: "Processing CV", tone: "neutral", active: true };
}
