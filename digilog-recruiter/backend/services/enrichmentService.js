const { Queue, Worker, QueueEvents } = require('bullmq');
const IORedis = require('ioredis');
const prisma = require('../db/client');
const aiMatchCacheService = require('./aiMatchCacheService');
const creditsService = require('./creditsService');
const embeddingService = require('./embeddingService');
const gptAnalysisService = require('./gptAnalysisService');

const REDIS_ENABLED = process.env.REDIS_ENABLED
  ? process.env.REDIS_ENABLED !== 'false'
  : process.env.NODE_ENV === 'production' || Boolean(process.env.REDIS_HOST);
const REDIS_HOST = process.env.REDIS_HOST || (process.env.NODE_ENV === 'production' ? 'dokploy-redis' : '127.0.0.1');
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);
const CONCURRENCY = parseInt(process.env.ENRICHMENT_CONCURRENCY || '2', 10);
const BATCH_SIZE = 10;
const QUEUE_NAME = 'candidate-enrichment';

const connection = REDIS_ENABLED ? new IORedis(REDIS_PORT, REDIS_HOST, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  lazyConnect: true,
}) : null;

if (connection) {
  connection.on('error', (err) => {
    console.error('❌ Enrichment Redis connection error:', err.message);
  });

  connection.on('connect', () => {
    console.log('✅ Enrichment Redis connected');
  });
}

let queue = null;
let worker = null;
let queueEvents = null;

const enrichmentStatus = new Map();

function parseSkills(skills) {
  if (!skills) return [];
  if (Array.isArray(skills)) return skills;
  if (typeof skills === 'string') return skills.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
}

function getJobSkillsCount(job) {
  if (!job?.skills) return 0;
  return Array.isArray(job.skills) ? job.skills.length : parseSkills(job.skills).length;
}

function createGptExplanation(result, job) {
  const score = result.relevanceScore || 0;
  const gpt = result.gptAnalysis || {};
  const candidateExperience = result.candidate?.experience || 0;
  const requiredExperience = job?.experience || 0;

  return {
    skillsMatch: {
      matchedSkills: gpt.technicalStrengths || [],
      missingSkills: gpt.skillGaps || [],
      bonusSkills: gpt.transferableSkills || [],
      matchPercentage: gpt.skillMatchPercentage || 0,
      totalRequired: getJobSkillsCount(job),
      totalMatched: (gpt.technicalStrengths || []).length,
    },
    experienceMatch: {
      isMatch: (gpt.experienceFit || 0) >= 6,
      required: requiredExperience,
      candidate: candidateExperience,
      difference: candidateExperience - requiredExperience,
      category: (gpt.experienceFit || 0) >= 8 ? 'Strong' : (gpt.experienceFit || 0) >= 6 ? 'Good' : 'Below',
    },
    locationMatch: {
      isMatch: true,
      type: 'Enhanced',
      job: job?.location || '',
      candidate: result.candidate?.location || '',
    },
    aiInsights: {
      hasAIAnalysis: true,
      summary: gpt.explanation || 'No detailed analysis available',
      strengths: gpt.technicalStrengths || [],
      potentialFlags: gpt.skillGaps || [],
      strengthsCount: (gpt.technicalStrengths || []).length,
      flagsCount: (gpt.skillGaps || []).length,
    },
    matchStrength: embeddingService.categorizeMatchStrength(score),
    overallScore: Math.round(score * 100),
    gptEnhanced: {
      skillMatchPercentage: gpt.skillMatchPercentage || 0,
      experienceFit: gpt.experienceFit || 5,
      culturalAlignment: gpt.culturalAlignment || 5,
      growthPotential: gpt.growthPotential || 5,
      interviewFocus: gpt.interviewFocus || [],
      confidenceScore: gpt.confidenceScore || 5,
      contextualExplanation: gpt.explanation || 'No detailed analysis available',
    },
    reasons: [
      gpt.explanation || 'AI-enriched ranking available',
      ...(gpt.technicalStrengths || []).slice(0, 3).map((strength) => `Strong in ${strength}`),
      (gpt.skillMatchPercentage || 0) > 70 ? `${gpt.skillMatchPercentage}% skills match` : null,
      (gpt.experienceFit || 0) >= 7 ? 'Excellent experience fit' : null,
    ].filter(Boolean).slice(0, 5),
    concerns: [
      ...(gpt.skillGaps || []).slice(0, 2).map((gap) => `Missing: ${gap}`),
      (gpt.skillMatchPercentage || 0) < 50 ? 'Low skills match' : null,
      (gpt.experienceFit || 0) < 5 ? 'Experience may be insufficient' : null,
    ].filter(Boolean).slice(0, 3),
  };
}

function normalizeCandidateForGpt(match) {
  const candidateId = match.candidateId || match.candidate?._id || match.candidate?.id;
  const metadata = match.metadata || {};
  const candidate = match.candidate || {};
  const name = candidate.name || metadata.name || `${metadata.firstName || ''} ${metadata.lastName || ''}`.trim() || 'Unknown';
  const skills = parseSkills(candidate.skills || metadata.skills);
  const experience = Number(candidate.experience ?? metadata.totalYearsExp ?? metadata.experience ?? 0) || 0;

  return {
    _id: String(candidateId),
    id: String(candidateId),
    name,
    skills,
    experience,
    location: candidate.location || metadata.location || '',
    currentRole: candidate.position || metadata.currentPosition || metadata.position || '',
    education: candidate.education || metadata.education || '',
    bio: metadata.aiSummary || '',
    score: Number(match.similarity ?? match.relevanceScore ?? 0) || 0,
  };
}

function mapResultsByCandidateId(results) {
  const mapped = new Map();
  for (const result of results || []) {
    const c = result?.candidate;
    const rawId = c?._id ?? c?.id;
    if (rawId == null) continue;
    const asString = String(rawId);
    mapped.set(asString, result);
    if (typeof rawId === 'object' && typeof rawId.toString === 'function') {
      const alt = rawId.toString();
      if (alt && alt !== asString) mapped.set(alt, result);
    }
  }
  return mapped;
}

function getGptResultForMatch(resultById, match) {
  const candidates = [
    match?.candidateId,
    match?.candidate?._id,
    match?.candidate?.id,
  ].filter((id) => id != null);
  for (const id of candidates) {
    const key = String(id);
    const hit = resultById.get(key);
    if (hit) return hit;
    if (typeof id === 'object' && typeof id.toString === 'function') {
      const alt = id.toString();
      const hitAlt = resultById.get(alt);
      if (hitAlt) return hitAlt;
    }
  }
  return undefined;
}

function sortByRelevance(matches) {
  return [...matches].sort((a, b) => {
    const scoreA = Number(a?.relevanceScore ?? a?.similarity ?? 0) || 0;
    const scoreB = Number(b?.relevanceScore ?? b?.similarity ?? 0) || 0;
    return scoreB - scoreA;
  });
}

function getEnrichmentStatus(enrichmentId) {
  return enrichmentStatus.get(enrichmentId) || null;
}

function initEnrichmentStatus({
  enrichmentId,
  jobId,
  organizationId,
  userId,
  totalCandidates,
  enrichCount,
  batchCount,
  estimatedCredits,
  costPerBatch,
  sourceMatches,
}) {
  const status = {
    enrichmentId,
    jobId,
    organizationId,
    userId,
    totalCandidates,
    enrichCount,
    batchCount,
    costPerBatch,
    estimatedCredits,
    completedBatches: 0,
    successfulBatches: 0,
    failedBatches: 0,
    completedCandidates: 0,
    successfulCandidates: 0,
    failedCandidates: 0,
    progressPercent: 0,
    state: 'processing',
    errors: [],
    enrichedMatchesById: {},
    rankedMatches: [],
    sourceMatches: sourceMatches || [],
    startedAt: new Date().toISOString(),
    completedAt: null,
  };

  enrichmentStatus.set(enrichmentId, status);
  return status;
}

function markCompletedIfDone(status) {
  if (status.completedBatches < status.batchCount) return;

  const rankedMatches = sortByRelevance(
    status.sourceMatches.map((match) => {
      const enriched = status.enrichedMatchesById[String(match.candidateId)];
      return enriched || match;
    })
  );

  status.rankedMatches = rankedMatches;
  status.state = 'completed';
  status.completedAt = new Date().toISOString();
}

function updateBatchProgress(enrichmentId, batchResult) {
  const status = enrichmentStatus.get(enrichmentId);
  if (!status || status.state === 'failed') return null;

  status.completedBatches += 1;
  status.completedCandidates += batchResult.batchSize;
  status.successfulCandidates += batchResult.successfulCandidates;
  status.failedCandidates += batchResult.failedCandidates;
  status.progressPercent = Math.min(100, Math.round((status.completedBatches / status.batchCount) * 100));

  if (batchResult.success) {
    status.successfulBatches += 1;
  } else {
    status.failedBatches += 1;
    status.errors.push({
      batchIndex: batchResult.batchIndex,
      error: batchResult.error || 'Batch failed',
      failedCandidates: batchResult.failedCandidates,
      timestamp: new Date().toISOString(),
    });
  }

  for (const match of batchResult.enrichedMatches || []) {
    status.enrichedMatchesById[String(match.candidateId)] = match;
  }

  markCompletedIfDone(status);
  enrichmentStatus.set(enrichmentId, status);
  return status;
}

function markEnrichmentFailed(enrichmentId, message) {
  const status = enrichmentStatus.get(enrichmentId);
  if (!status) return null;

  status.state = 'failed';
  status.completedAt = new Date().toISOString();
  status.errors.push({
    error: message || 'Unknown failure',
    timestamp: new Date().toISOString(),
  });
  enrichmentStatus.set(enrichmentId, status);
  return status;
}

async function persistFinalCache(status) {
  if (!status?.rankedMatches?.length) return;
  await aiMatchCacheService.setCachedBulkMatch(status.jobId, status.rankedMatches, {
    candidateCount: status.rankedMatches.length,
    generationTime: Date.now() - new Date(status.startedAt).getTime(),
    modelUsed: gptAnalysisService.modelName || 'enrichment-service',
    version: 2,
  });
}

async function processEnrichmentBatch(job) {
  const {
    enrichmentId,
    batchIndex,
    batchSize,
    jobId,
    organizationId,
    userId,
    candidates,
    originalMatches,
  } = job.data;

  const status = enrichmentStatus.get(enrichmentId);
  if (!status) {
    throw new Error(`Enrichment ${enrichmentId} not found`);
  }
  if (status.state === 'failed') {
    throw new Error(`Enrichment ${enrichmentId} is already marked failed`);
  }

  const dbJob = await prisma.job.findFirst({ where: { id: jobId, organizationId: organizationId } });
  if (!dbJob) {
    throw new Error(`Job ${jobId} not found for enrichment`);
  }

  await job.updateProgress(10);

  const creditResult = await creditsService.consumeCredits(
    organizationId,
    'aiMatching',
    enrichmentId,
    'matching',
    userId,
    {
      enrichmentId,
      batchIndex,
      batchSize,
      jobId,
      source: 'background_enrichment',
    }
  );

  if (!creditResult?.success) {
    throw new Error(creditResult?.message || 'Failed to deduct credits for enrichment batch');
  }

  await job.updateProgress(35);

  const gptResults = await gptAnalysisService.batchAnalyzeCandidates(dbJob, candidates);
  const resultById = mapResultsByCandidateId(gptResults);

  await job.updateProgress(75);

  const enrichedMatches = [];
  for (const match of originalMatches) {
    const result = getGptResultForMatch(resultById, match);
    if (!result) continue;

    const cid = String(match.candidateId ?? match.candidate?._id ?? match.candidate?.id ?? '');

    enrichedMatches.push({
      ...match,
      candidateId: cid || match.candidateId,
      similarity: result.relevanceScore,
      relevanceScore: result.relevanceScore,
      similarityPercentage: Math.round((result.relevanceScore || 0) * 100),
      explanation: createGptExplanation(result, dbJob),
    });
  }

  const failedCandidates = Math.max(0, batchSize - enrichedMatches.length);
  const batchResult = {
    success: true,
    enrichmentId,
    batchIndex,
    batchSize,
    successfulCandidates: enrichedMatches.length,
    failedCandidates,
    enrichedMatches,
  };

  const updated = updateBatchProgress(enrichmentId, batchResult);
  await job.updateProgress(100);

  if (updated?.state === 'completed') {
    await persistFinalCache(updated);
  }

  return batchResult;
}

async function initQueue() {
  if (queue) return { queue, worker, queueEvents };

  if (!REDIS_ENABLED) {
    throw new Error('Enrichment Redis queue is disabled. Set REDIS_ENABLED=true and REDIS_HOST/REDIS_PORT to enable it locally.');
  }

  try {
    await connection.connect();
  } catch (err) {
    if (!err.message.includes('already')) throw err;
  }

  queue = new Queue(QUEUE_NAME, { connection });
  queueEvents = new QueueEvents(QUEUE_NAME, { connection });

  worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      try {
        return await processEnrichmentBatch(job);
      } catch (error) {
        const payload = job.data || {};
        updateBatchProgress(payload.enrichmentId, {
          success: false,
          enrichmentId: payload.enrichmentId,
          batchIndex: payload.batchIndex,
          batchSize: payload.batchSize || 0,
          successfulCandidates: 0,
          failedCandidates: payload.batchSize || 0,
          enrichedMatches: [],
          error: error.message,
        });
        throw error;
      }
    },
    {
      connection,
      concurrency: CONCURRENCY,
    }
  );

  worker.on('completed', (jobItem) => {
    console.log(`✅ Enrichment job ${jobItem.id} completed`);
  });

  worker.on('failed', (jobItem, err) => {
    console.error(`❌ Enrichment job ${jobItem?.id} failed: ${err.message}`);
  });

  worker.on('error', (err) => {
    console.error('❌ Enrichment worker error:', err.message);
  });

  console.log(`🚀 Enrichment BullMQ worker started (concurrency: ${CONCURRENCY})`);
  return { queue, worker, queueEvents };
}

async function addEnrichmentJobs({
  enrichmentId,
  jobId,
  organizationId,
  userId,
  matches,
  enrichCount,
}) {
  const { queue: q } = await initQueue();

  const selectedMatches = sortByRelevance(matches || []).slice(0, enrichCount);
  const batches = [];
  for (let i = 0; i < selectedMatches.length; i += BATCH_SIZE) {
    batches.push(selectedMatches.slice(i, i + BATCH_SIZE));
  }

  const jobs = batches.map((batch, index) => ({
    name: `enrichment-${enrichmentId}-${index + 1}`,
    data: {
      enrichmentId,
      jobId,
      organizationId,
      userId,
      batchIndex: index + 1,
      batchSize: batch.length,
      candidates: batch.map(normalizeCandidateForGpt),
      originalMatches: batch,
    },
    opts: {
      attempts: 1,
      removeOnComplete: { age: 3600 },
      removeOnFail: { age: 7200 },
    },
  }));

  await q.addBulk(jobs);
  return { selectedMatches, batchCount: jobs.length };
}

async function startEnrichment({
  enrichmentId,
  jobId,
  organizationId,
  userId,
  matches,
  enrichCount,
  estimatedCredits,
  costPerBatch,
}) {
  const sortedMatches = sortByRelevance(matches || []);
  const finalEnrichCount = Math.min(Math.max(enrichCount, 1), sortedMatches.length);
  const sourceMatches = sortedMatches;

  const batchCount = Math.ceil(finalEnrichCount / BATCH_SIZE);
  initEnrichmentStatus({
    enrichmentId,
    jobId,
    organizationId,
    userId,
    totalCandidates: sortedMatches.length,
    enrichCount: finalEnrichCount,
    batchCount,
    estimatedCredits,
    costPerBatch,
    sourceMatches,
  });

  await addEnrichmentJobs({
    enrichmentId,
    jobId,
    organizationId,
    userId,
    matches: sortedMatches,
    enrichCount: finalEnrichCount,
  });

  return getEnrichmentStatus(enrichmentId);
}

async function shutdownQueue() {
  try {
    if (worker) {
      await worker.close();
      worker = null;
    }
    if (queueEvents) {
      await queueEvents.close();
      queueEvents = null;
    }
    if (queue) {
      await queue.close();
      queue = null;
    }
    if (connection) {
      try {
        await connection.quit();
      } catch (_error) {
        // noop
      }
    }
  } catch (error) {
    console.warn('⚠️ enrichmentService shutdownQueue:', error.message);
  }
}

module.exports = {
  initQueue,
  startEnrichment,
  getEnrichmentStatus,
  markEnrichmentFailed,
  shutdownQueue,
  BATCH_SIZE,
  QUEUE_NAME,
};
