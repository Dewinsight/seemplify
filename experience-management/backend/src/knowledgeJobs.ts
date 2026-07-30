import { config } from './config.js';
import { publishEvent } from './events.js';
import { deleteKnowledgeIndex, indexKnowledgeDocument } from './knowledgeClient.js';
import {
  claimNextKnowledgeJob, completeKnowledgeDelete, completeKnowledgeIndex, failKnowledgeJob,
  getKnowledgeBase, getKnowledgeDocument, getKnowledgeJob, knowledgeDocumentSourcePath,
  knowledgeJobAudienceUserId, knowledgeQueueStatus, KnowledgeError, markKnowledgeJobStage,
  processKnowledgeFileCleanup, requeueKnowledgeJob,
  type KnowledgeJobRecord
} from './knowledgeRepository.js';

function publishKnowledgeJob(job: KnowledgeJobRecord | null) {
  if (job) publishEvent('knowledge-job', job, job.spaceId, knowledgeJobAudienceUserId(job));
  return job;
}

async function executeKnowledgeJob(job: KnowledgeJobRecord) {
  const base = getKnowledgeBase(job.knowledgeBaseId, job.spaceId, true);
  if (!base) throw new KnowledgeError('Knowledge base not found.', 404, 'KNOWLEDGE_BASE_NOT_FOUND');
  if (!job.targetVersion) throw new KnowledgeError('Knowledge job has no target index version.', 500, 'KNOWLEDGE_JOB_INVALID');
  if (job.kind === 'document.index' || job.kind === 'document.reindex') {
    if (!job.documentId) throw new KnowledgeError('Knowledge indexing job has no document.', 500, 'KNOWLEDGE_JOB_INVALID');
    const document = getKnowledgeDocument(job.documentId, job.knowledgeBaseId, job.spaceId, true);
    if (!document || document.deletedAt) throw new KnowledgeError('Knowledge document not found.', 404, 'KNOWLEDGE_DOCUMENT_NOT_FOUND');
    publishKnowledgeJob(markKnowledgeJobStage(job, 'extracting', 20));
    const sourcePath = knowledgeDocumentSourcePath(document);
    publishKnowledgeJob(markKnowledgeJobStage(job, 'indexing', 45));
    const metadata = job.input.metadata && typeof job.input.metadata === 'object' && !Array.isArray(job.input.metadata)
      ? job.input.metadata as Record<string, unknown> : {};
    const result = await indexKnowledgeDocument({
      jobId: job.id, spaceId: job.spaceId, targetVersion: job.targetVersion,
      knowledgeBase: {
        id: base.id, name: base.name, indexVersion: base.currentVersion,
        embeddingModel: base.embeddingModel, embeddingDimension: base.embeddingDimension,
        chunkerVersion: base.chunkerVersion
      },
      document: {
        id: document.id, sourcePath, originalName: document.originalName, mimeType: document.mimeType,
        sizeBytes: document.sizeBytes, sha256: document.sha256, metadata
      }
    });
    return completeKnowledgeIndex(job, result);
  }
  if (job.kind === 'document.delete' || job.kind === 'base.delete') {
    publishKnowledgeJob(updateDeleteStage(job));
    const result = await deleteKnowledgeIndex({
      jobId: job.id, spaceId: job.spaceId, knowledgeBaseId: job.knowledgeBaseId,
      documentId: job.kind === 'document.delete' ? job.documentId : null, targetVersion: job.targetVersion
    });
    return completeKnowledgeDelete(job, result);
  }
  throw new KnowledgeError(`Unsupported knowledge job kind ${job.kind}`, 400, 'KNOWLEDGE_JOB_UNSUPPORTED');
}

function updateDeleteStage(job: KnowledgeJobRecord) {
  const updated = markKnowledgeJobStage(job, 'deleting_index', 45);
  return updated;
}

export class KnowledgeJobRunner {
  private timer: NodeJS.Timeout | null = null;
  private active = 0;
  private activeBySpace = new Map<string, number>();
  private stopped = true;

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.timer = setInterval(() => void this.pump(), config.knowledgeWorkerPollMs);
    this.timer.unref();
    processKnowledgeFileCleanup();
    void this.pump();
  }

  async pump() {
    if (this.stopped) return;
    processKnowledgeFileCleanup();
    while (this.active < config.knowledgeWorkerConcurrency) {
      const job = claimNextKnowledgeJob();
      if (!job) return;
      this.active += 1;
      this.activeBySpace.set(job.spaceId, (this.activeBySpace.get(job.spaceId) || 0) + 1);
      publishKnowledgeJob(job);
      void this.run(job).finally(() => {
        this.active -= 1;
        const remaining = Math.max(0, (this.activeBySpace.get(job.spaceId) || 1) - 1);
        if (remaining) this.activeBySpace.set(job.spaceId, remaining); else this.activeBySpace.delete(job.spaceId);
        void this.pump();
      });
    }
  }

  private async run(job: KnowledgeJobRecord) {
    try {
      const completed = await executeKnowledgeJob(job);
      publishKnowledgeJob(completed);
      publishEvent('data-changed', { reason: 'knowledge-changed' }, job.spaceId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const current = getKnowledgeJob(job.id) || job;
      // Explicit runtime outages, rate limits and 5xx responses wait durably for
      // recovery regardless of the ordinary poison-job attempt ceiling. Invalid
      // documents, schemas and grounding failures are terminal. Unexpected
      // internal failures retain the bounded legacy retry policy.
      const waitForRuntime = error instanceof KnowledgeError && error.retryable
        && (error.code === 'KNOWLEDGE_RUNTIME_UNAVAILABLE'
          || error.code === 'KNOWLEDGE_RUNTIME_NOT_CONFIGURED'
          || error.status === 429 || error.status >= 500);
      const retryUnexpected = !(error instanceof KnowledgeError) && current.attempt < current.maxAttempts;
      if (waitForRuntime || retryUnexpected) {
        const delay = Math.min(5 * 60_000, 5_000 * (2 ** Math.min(6, Math.max(0, current.attempt - 1))));
        const queued = requeueKnowledgeJob(current, 'waiting_for_knowledge_runtime', message,
          new Date(Date.now() + delay).toISOString());
        publishKnowledgeJob(queued);
      } else {
        publishKnowledgeJob(failKnowledgeJob(current, message));
      }
    }
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async drain(timeoutMs = 8_000) {
    const deadline = Date.now() + Math.max(0, timeoutMs);
    while (this.active > 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
    return this.active === 0;
  }

  status(spaceId: string) {
    return {
      running: !this.stopped,
      active: this.activeBySpace.get(spaceId) || 0,
      concurrency: config.knowledgeWorkerConcurrency,
      ...knowledgeQueueStatus(spaceId)
    };
  }
}

export const knowledgeJobRunner = new KnowledgeJobRunner();
