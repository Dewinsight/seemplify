import type { CVProcessingJobResponse } from "@/services/aiInterviewService";

export type CvUploadMode = "import" | "enrich";

export type CvUploadAttempt = {
  fingerprint: string;
  idempotencyKey: string;
  mode: CvUploadMode;
  jobId: string;
  candidateId?: string | null;
  createdAt: string;
  accepted?: {
    jobId: string;
    statusToken: string;
    statusUrl: string;
  };
};

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const STORAGE_PREFIX = "aiInterviewCvUploads:v2";
const MAX_ATTEMPTS_PER_ACTOR = 100;

function actorStorageKey(actorId: string) {
  return `${STORAGE_PREFIX}:${encodeURIComponent(actorId)}`;
}
function browserStorage(storage?: StorageLike): StorageLike | null {
  if (storage) return storage;
  return typeof window === "undefined" ? null : window.localStorage;
}

function parseAttempts(value: string | null): CvUploadAttempt[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => (
      item
      && typeof item.fingerprint === "string"
      && typeof item.idempotencyKey === "string"
      && typeof item.mode === "string"
      && typeof item.jobId === "string"
    )).slice(-MAX_ATTEMPTS_PER_ACTOR);
  } catch {
    return [];
  }
}

function writeAttempts(actorId: string, attempts: CvUploadAttempt[], storage?: StorageLike) {
  const target = browserStorage(storage);
  if (!target) return;
  const retained = attempts.slice(-MAX_ATTEMPTS_PER_ACTOR);
  if (!retained.length) target.removeItem(actorStorageKey(actorId));
  else target.setItem(actorStorageKey(actorId), JSON.stringify(retained));
}

async function sha256Hex(value: ArrayBuffer | string) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function buildCvRequestFingerprint(file: File, input: {
  mode: CvUploadMode;
  jobId: string;
  candidateId?: string | null;
}) {
  const fileSha256 = await sha256Hex(await file.arrayBuffer());
  return sha256Hex(JSON.stringify({
    mode: input.mode,
    jobId: input.jobId,
    candidateId: input.candidateId || null,
    fileSha256
  }));
}

export function loadCvUploadAttempts(actorId: string, storage?: StorageLike) {
  const target = browserStorage(storage);
  return target ? parseAttempts(target.getItem(actorStorageKey(actorId))) : [];
}

export function getOrCreateCvUploadAttempt(actorId: string, input: {
  fingerprint: string;
  mode: CvUploadMode;
  jobId: string;
  candidateId?: string | null;
}, storage?: StorageLike) {
  const attempts = loadCvUploadAttempts(actorId, storage);
  const existing = attempts.find((attempt) => attempt.fingerprint === input.fingerprint);
  if (existing) return existing;
  const attempt: CvUploadAttempt = {
    ...input,
    candidateId: input.candidateId || null,
    idempotencyKey: crypto.randomUUID(),
    createdAt: new Date().toISOString()
  };
  writeAttempts(actorId, [...attempts, attempt], storage);
  return attempt;
}

export function recordAcceptedCvUpload(
  actorId: string,
  fingerprint: string,
  job: Pick<CVProcessingJobResponse, "jobId" | "statusToken" | "statusUrl">,
  storage?: StorageLike
) {
  if (!job.statusToken || !job.statusUrl) return;
  const attempts = loadCvUploadAttempts(actorId, storage);
  const index = attempts.findIndex((attempt) => attempt.fingerprint === fingerprint);
  if (index < 0) return;
  attempts[index] = {
    ...attempts[index],
    accepted: {
      jobId: job.jobId,
      statusToken: job.statusToken,
      statusUrl: job.statusUrl
    }
  };
  writeAttempts(actorId, attempts, storage);
}

export function reconcileAcceptedCvUploads(
  actorId: string,
  jobs: CVProcessingJobResponse[],
  storage?: StorageLike
) {
  const attempts = loadCvUploadAttempts(actorId, storage);
  let changed = false;
  for (const attempt of attempts) {
    const job = jobs.find((item) => item.requestFingerprint === attempt.fingerprint);
    if (!job?.statusToken || !job.statusUrl) continue;
    const accepted = {
      jobId: job.jobId,
      statusToken: job.statusToken,
      statusUrl: job.statusUrl
    };
    if (JSON.stringify(attempt.accepted) !== JSON.stringify(accepted)) {
      attempt.accepted = accepted;
      changed = true;
    }
  }
  if (changed) writeAttempts(actorId, attempts, storage);
  return attempts;
}

export function forgetCvUploadAttempt(actorId: string, fingerprint: string, storage?: StorageLike) {
  writeAttempts(
    actorId,
    loadCvUploadAttempts(actorId, storage).filter((attempt) => attempt.fingerprint !== fingerprint),
    storage
  );
}
