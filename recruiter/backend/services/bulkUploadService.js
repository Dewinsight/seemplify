const { Queue, Worker, QueueEvents } = require('bullmq');
const IORedis = require('ioredis');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const { promisify } = require('util');
const unlinkAsync = promisify(fs.unlink);

const REDIS_HOST = process.env.REDIS_HOST || 'dokploy-redis';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);

const connection = new IORedis(REDIS_PORT, REDIS_HOST, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  lazyConnect: true,
});

connection.on('error', (err) => {
  console.error('❌ BullMQ Redis connection error:', err.message);
});

connection.on('connect', () => {
  console.log('✅ BullMQ Redis connected');
});

const QUEUE_NAME = 'bulk-cv-upload';
const CONCURRENCY = parseInt(process.env.BULK_UPLOAD_CONCURRENCY || '5', 10);

let queue = null;
let worker = null;
let queueEvents = null;

const batchStatus = new Map();

function getBatchStatus(batchId) {
  return batchStatus.get(batchId) || null;
}

function initBatchStatus(batchId, totalFiles, organizationId, userId) {
  const status = {
    batchId,
    organizationId,
    userId,
    totalFiles,
    completed: 0,
    successful: 0,
    failed: 0,
    processing: 0,
    results: [],
    errors: [],
    startedAt: new Date().toISOString(),
    completedAt: null,
    state: 'processing',
  };
  batchStatus.set(batchId, status);
  return status;
}

function updateBatchFile(batchId, fileResult) {
  const status = batchStatus.get(batchId);
  if (!status) return;

  status.completed++;
  if (fileResult.success) {
    status.successful++;
    status.results.push({
      fileName: fileResult.fileName,
      candidateId: fileResult.candidateId,
      candidateName: fileResult.candidateName,
      success: true,
    });
  } else {
    status.failed++;
    status.errors.push({
      fileName: fileResult.fileName,
      error: fileResult.error,
      success: false,
    });
  }

  status.processing = status.totalFiles - status.completed;

  if (status.completed >= status.totalFiles) {
    status.state = 'completed';
    status.completedAt = new Date().toISOString();
  }

  batchStatus.set(batchId, status);
  return status;
}

async function initQueue() {
  if (queue) return { queue, worker, queueEvents };

  try {
    await connection.connect();
  } catch (e) {
    if (!e.message.includes('already')) throw e;
  }

  queue = new Queue(QUEUE_NAME, { connection });
  queueEvents = new QueueEvents(QUEUE_NAME, { connection });

  worker = new Worker(QUEUE_NAME, async (job) => {
    const { filePath, fileType, originalName, batchId, organizationId, userId } = job.data;

    try {
      await job.updateProgress(10);

      const cvParsingService = require('./cvParsingService');
      const cloudinaryUploadService = require('./cloudinaryUploadService');
      const RetryHelper = require('../utils/retryHelper');
      const Candidate = require('../models/Candidate');
      const embeddingService = require('./embeddingService');

      const [cloudinaryResult, cvParsingResult] = await Promise.all([
        RetryHelper.withRetry(
          () => cloudinaryUploadService.uploadFile(filePath, fileType),
          { maxRetries: 3, delay: 1000, operation: `Cloudinary upload ${originalName}` }
        ),
        RetryHelper.withRetry(
          () => cvParsingService.parseAndAnalyze(filePath, fileType),
          { maxRetries: 3, delay: 1000, operation: `CV parse ${originalName}` }
        ),
      ]);

      await job.updateProgress(50);

      if (!cloudinaryResult.success) {
        throw new Error(`Upload failed: ${cloudinaryResult.error}`);
      }
      if (!cvParsingResult.success || !cvParsingResult.resumeText || cvParsingResult.resumeText.length < 50) {
        throw new Error('Could not extract readable text from CV. Use a text-based PDF or DOCX.');
      }

      let resumeUrl = cloudinaryResult.resumeUrl;
      if (fileType === 'application/pdf') {
        try {
          resumeUrl = cloudinaryUploadService.getAccessiblePdfUrl(cloudinaryResult.publicId);
        } catch (_) { /* keep original */ }
      }

      const extractedFields = cvParsingResult.extractedFields || {};
      const aiAnalysis = cvParsingResult.aiAnalysis || { summary: 'AI analysis unavailable', strengths: [], potentialFlags: [] };

      const candidateData = {
        firstName: extractedFields.firstName || 'PARSING_FAILED',
        lastName: extractedFields.lastName || 'REVIEW_REQUIRED',
        email: extractedFields.email || `bulk-${Date.now()}-${Math.random().toString(36).slice(2,8)}@placeholder.com`,
        phone: extractedFields.phone || '',
        location: extractedFields.location || '',
        position: extractedFields.position || 'Position TBD',
        experience: extractedFields.experience || '',
        education: extractedFields.education || '',
        skills: Array.isArray(extractedFields.skills) ? extractedFields.skills.join(', ') : (extractedFields.skills || ''),
        resumeUrl,
        resumeText: cvParsingResult.resumeText || '',
        status: 'New',
        source: 'Bulk Upload',
        organization: organizationId,
        createdBy: userId || null,
        cloudinaryPublicId: cloudinaryResult.publicId,
        cloudinaryResourceType: cloudinaryResult.resourceType,
        parsedData: extractedFields,
        aiAnalysis,
        workExperience: cvParsingResult.workExperience || [],
        educationHistory: extractedFields.educationHistory || [],
        certifications: extractedFields.certifications || [],
        languages: extractedFields.languages || [],
        awards: extractedFields.awards || [],
        projects: extractedFields.projects || [],
        publications: extractedFields.publications || [],
        volunteerWork: extractedFields.volunteerWork || [],
        professionalMemberships: extractedFields.professionalMemberships || [],
        portfolioLinks: extractedFields.portfolioLinks || {},
        additionalSections: extractedFields.additionalSections || {},
        fullCVData: extractedFields.fullCVData || extractedFields || {},
        processingMetadata: {
          uploadSuccess: true,
          parseSuccess: cvParsingResult.parseSuccess || false,
          aiSuccess: cvParsingResult.aiSuccess || false,
          fileSize: 0,
          originalName,
          processedAt: new Date(),
          bulkBatchId: batchId,
        },
      };

      await job.updateProgress(70);

      const candidate = new Candidate(candidateData);
      await candidate.save();

      await job.updateProgress(85);

      try {
        await embeddingService.createCandidateEmbedding(candidate);
        candidate.isEmbedded = true;
        candidate.embeddingCreatedAt = new Date();
        await candidate.save();
      } catch (embErr) {
        console.error(`⚠️ Embedding failed for ${originalName}: ${embErr.message}`);
      }

      await job.updateProgress(100);

      const result = {
        success: true,
        fileName: originalName,
        candidateId: candidate._id.toString(),
        candidateName: `${candidate.firstName} ${candidate.lastName}`,
      };

      updateBatchFile(batchId, result);
      return result;

    } catch (error) {
      const failResult = {
        success: false,
        fileName: originalName,
        error: error.message,
      };
      updateBatchFile(batchId, failResult);
      throw error;
    } finally {
      try { await unlinkAsync(filePath); } catch (_) {}
    }
  }, {
    connection,
    concurrency: CONCURRENCY,
    limiter: { max: CONCURRENCY, duration: 1000 },
  });

  worker.on('completed', (job, result) => {
    console.log(`✅ Bulk CV job ${job.id} completed: ${result?.candidateName || result?.fileName}`);
  });

  worker.on('failed', (job, err) => {
    console.error(`❌ Bulk CV job ${job?.id} failed: ${err.message}`);
  });

  console.log(`🚀 BullMQ bulk upload worker started (concurrency: ${CONCURRENCY})`);
  return { queue, worker, queueEvents };
}

async function addBulkUploadJobs(batchId, files, organizationId, userId) {
  const { queue: q } = await initQueue();

  const jobs = files.map((file, index) => ({
    name: `cv-${batchId}-${index}`,
    data: {
      filePath: file.path,
      fileType: file.mimetype,
      originalName: file.originalname,
      batchId,
      organizationId,
      userId,
    },
    opts: {
      attempts: 2,
      backoff: { type: 'exponential', delay: 3000 },
      removeOnComplete: { age: 3600 },
      removeOnFail: { age: 7200 },
    },
  }));

  await q.addBulk(jobs);
  console.log(`📦 Queued ${jobs.length} CV processing jobs for batch ${batchId}`);
}

module.exports = {
  initQueue,
  addBulkUploadJobs,
  initBatchStatus,
  getBatchStatus,
  QUEUE_NAME,
};
