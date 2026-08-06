/**
 * Bulk CV upload + large-scale matching integration test (runs inside backend context).
 *
 * Usage (from recruiter/backend):
 *   node scripts/testBulkPipeline.js
 *
 * Env:
 *   MONGO_URI              — required
 *   TEST_USER_EMAIL        — default: michaelegbo@gmail.com
 *   TEST_CV_COUNT          — default: 100 (use 5–20 for a quick smoke test)
 *   TEST_TOP_K             — default: 150 (must be > 100 for vector-ranked / controller parity)
 *   BULK_UPLOAD_CONCURRENCY — passed through to bulkUploadService (default 8 in service)
 *   REDIS_HOST / REDIS_PORT — Redis for BullMQ (default host dokploy-redis — only resolves on Dokploy Docker network)
 *   SKIP_CLEANUP=1         — leave DB/Weaviate data for inspection
 *
 * Auth: uses sessionService (no OTP) for the test user — same as trusted server-side automation.
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const mongoose = require('mongoose');
const PDFDocument = require('pdfkit');

const User = require('../models/User');
const Job = require('../models/Job');
const Candidate = require('../models/Candidate');
const Department = require('../models/Department');
const sessionService = require('../services/sessionService');
const bulkUploadService = require('../services/bulkUploadService');
const embeddingService = require('../services/embeddingService');
const IORedis = require('ioredis');

const LARGE_SCALE_THRESHOLD = 100;

async function assertRedisReachable() {
  const host = process.env.REDIS_HOST || 'dokploy-redis';
  const port = parseInt(process.env.REDIS_PORT || '6379', 10);
  const client = new IORedis(port, host, {
    maxRetriesPerRequest: 1,
    enableReadyCheck: false,
    lazyConnect: true,
    connectTimeout: 8000,
    retryStrategy: () => null,
  });
  client.on('error', () => {
    /* handled via connect().catch */
  });
  try {
    await client.connect();
    await client.ping();
  } finally {
    try {
      await client.quit();
    } catch (_) {
      try {
        client.disconnect();
      } catch (_) {}
    }
  }
}

const FIRST_NAMES = ['Ada', 'Chidi', 'Kemi', 'Tunde', 'Ngozi', 'Emeka', 'Funke', 'Yusuf', 'Amaka', 'Ibrahim'];
const LAST_NAMES = ['Okafor', 'Nwosu', 'Adeyemi', 'Bello', 'Eze', 'Mohammed', 'Okonkwo', 'Danjuma', 'Ibeh', 'Garba'];
const STACKS = [
  'Node.js, TypeScript, React, PostgreSQL, AWS, Docker, Kubernetes',
  'Python, FastAPI, Django, PostgreSQL, Redis, GCP',
  'Java, Spring Boot, Kafka, MongoDB, Azure',
  'C#, .NET, SQL Server, Azure DevOps, microservices',
  'Go, gRPC, Kubernetes, Prometheus, Terraform',
];

function randomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function buildCvText(i, batchTag) {
  const stack = randomItem(STACKS);
  return [
    `CURRICULUM VITAE — ${batchTag}`,
    `Candidate index: ${i}`,
    '',
    'PROFESSIONAL SUMMARY',
    `Senior Software Engineer with 6+ years building scalable web platforms, APIs, and cloud-native services.`,
    `Core stack: ${stack}. Experienced with CI/CD, test automation, system design, and mentoring engineers.`,
    '',
    'EXPERIENCE',
    'Lead Software Engineer — FinTech Platform (2021–Present)',
    `• Designed REST and event-driven services handling 2M+ daily requests using ${stack.split(',')[0]} and cloud infra.`,
    '• Reduced p95 latency by 35% via caching, query tuning, and async workers.',
    'Software Engineer — SaaS Analytics (2018–2021)',
    '• Shipped customer-facing dashboards and ETL pipelines; collaborated with product and data teams.',
    '',
    'SKILLS',
    stack,
    'Agile, code review, mentoring, technical documentation.',
    '',
    'EDUCATION',
    'B.Sc. Computer Science',
    '',
    `Keywords for matching: JavaScript TypeScript React Node.js software engineer backend frontend full-stack ${batchTag}`,
  ].join('\n');
}

function writeCvPdf(filePath, i, batchTag) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);
    doc.fontSize(18).text(`Software Engineer — ${batchTag}`, { underline: true });
    doc.moveDown();
    doc.fontSize(11).text(buildCvText(i, batchTag));
    doc.end();
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function pollBatch(batchId, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const st = bulkUploadService.getBatchStatus(batchId);
    if (!st) {
      await sleep(500);
      continue;
    }
    if (st.state === 'completed') return st;
    if (st.failed >= st.totalFiles && st.completed >= st.totalFiles) return st;
    await sleep(2000);
  }
  throw new Error(`Batch ${batchId} did not complete within ${timeoutMs}ms`);
}

async function main() {
  const testEmail = process.env.TEST_USER_EMAIL || 'michaelegbo@gmail.com';
  const cvCount = Math.min(10000, Math.max(1, parseInt(process.env.TEST_CV_COUNT || '100', 10)));
  const topK = parseInt(process.env.TEST_TOP_K || '150', 10);
  const skipCleanup = process.env.SKIP_CLEANUP === '1';
  const pollTimeoutMs = parseInt(process.env.TEST_POLL_TIMEOUT_MS || `${2 * 60 * 60 * 1000}`, 10); // 2h default

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  BULK UPLOAD + VECTOR MATCHING PIPELINE TEST             ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`  User: ${testEmail}`);
  console.log(`  CV count: ${cvCount}, topK: ${topK}, skipCleanup: ${skipCleanup}`);
  console.log('');

  if (!process.env.MONGO_URI) {
    console.error('❌ MONGO_URI is required');
    process.exit(1);
  }

  try {
    await assertRedisReachable();
    console.log(`📮 Redis OK (${process.env.REDIS_HOST || 'dokploy-redis'}:${process.env.REDIS_PORT || '6379'})`);
  } catch (e) {
    console.error('❌ Redis is required for BullMQ bulk upload.');
    console.error(`   Tried ${process.env.REDIS_HOST || 'dokploy-redis'}:${process.env.REDIS_PORT || '6379'} — ${e.message}`);
    console.error('   On the Dokploy backend container use defaults; locally set REDIS_HOST=127.0.0.1 if Redis is exposed.');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log('📡 MongoDB connected');

  const batchId = `batch-pipeline-test-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const batchTag = `PIPELINE-TEST-${batchId.slice(-12)}`;

  let testJob = null;
  let tmpDir = null;
  const metrics = {
    batchId,
    cvCount,
    bulkUploadMs: null,
    successfulUploads: 0,
    failedUploads: 0,
    matchCount: 0,
    vectorRankedParity: null,
    explanationGenerated: false,
  };

  try {
    const user = await User.findOne({ email: testEmail.toLowerCase().trim() });
    if (!user) {
      throw new Error(`User not found: ${testEmail}`);
    }
    if (!user.currentOrganization) {
      throw new Error('User has no currentOrganization — complete org setup first');
    }

    const organizationId = user.currentOrganization.toString();
    const department = await Department.findOne({ organization: user.currentOrganization, isActive: true });
    if (!department) {
      throw new Error('No active department for organization — create one in the app first');
    }

    tmpDir = path.join(os.tmpdir(), `bulk-pipeline-${batchId}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    console.log(`📁 Temp CV directory: ${tmpDir}`);

    console.log(`📝 Generating ${cvCount} PDF CVs…`);
    const files = [];
    for (let i = 0; i < cvCount; i++) {
      const name = `cv-${batchTag}-${i}.pdf`;
      const fp = path.join(tmpDir, name);
      await writeCvPdf(fp, i, batchTag);
      files.push({
        path: fp,
        mimetype: 'application/pdf',
        originalname: name,
      });
    }

    await bulkUploadService.initQueue();
    bulkUploadService.initBatchStatus(batchId, files.length, organizationId, user._id.toString());

    const tBulkStart = Date.now();
    await bulkUploadService.addBulkUploadJobs(batchId, files, organizationId, user._id.toString());
    console.log(`📦 Queued ${files.length} jobs for batch ${batchId}`);

    const finalStatus = await pollBatch(batchId, pollTimeoutMs);
    metrics.bulkUploadMs = Date.now() - tBulkStart;
    metrics.successfulUploads = finalStatus.successful;
    metrics.failedUploads = finalStatus.failed;

    console.log(`✅ Batch finished in ${metrics.bulkUploadMs}ms`);
    console.log(`   Successful: ${finalStatus.successful}, Failed: ${finalStatus.failed}`);

    if (finalStatus.failed > 0) {
      console.log('   Sample errors:', JSON.stringify(finalStatus.errors?.slice(0, 3), null, 2));
    }

    if (finalStatus.successful === 0) {
      throw new Error('No CVs processed successfully — aborting matching tests');
    }

    const testTitle = `[Bulk Pipeline Test] Senior Software Engineer ${Date.now()}`;
    testJob = new Job({
      title: testTitle,
      department: department._id,
      location: 'Lagos, Nigeria',
      type: 'Full-time',
      level: 'Senior',
      description:
        'We need an experienced software engineer to build and scale APIs and web applications. ' +
        'You will work with TypeScript, Node.js, React, cloud infrastructure, and modern DevOps.',
      requirements:
        '5+ years of software development. Strong JavaScript/TypeScript, Node.js, React, REST APIs, SQL/NoSQL, AWS or GCP, Docker.',
      responsibilities:
        'Design and implement services, review code, improve reliability and performance, collaborate with product.',
      skills: 'JavaScript, TypeScript, Node.js, React, PostgreSQL, AWS, Docker, Kubernetes, REST APIs',
      experience: '5-7',
      education: 'Bachelor',
      organization: user.currentOrganization,
      createdBy: user._id,
      status: 'draft',
      uploadMetadata: { source: 'bulk-pipeline-test' },
    });
    await testJob.save();
    console.log(`📋 Test job created: ${testJob._id} — ${testTitle}`);

    await embeddingService.createJobEmbedding(testJob);
    testJob.isEmbedded = true;
    testJob.embeddingCreatedAt = new Date();
    await testJob.save();
    console.log('🔢 Job embedding stored');

    const isLargeScale = topK > LARGE_SCALE_THRESHOLD;
    metrics.vectorRankedParity = isLargeScale;

    const matchResult = await embeddingService.findMatchingCandidatesForJob(testJob, topK, { skipCache: true });
    const matches = matchResult.matches || [];
    metrics.matchCount = matches.length;

    console.log(`🔍 Matching (service, topK=${topK}, large-scale parity=${isLargeScale}): ${matches.length} matches`);

    const batchCandidates = await Candidate.find({
      organization: user.currentOrganization,
      'processingMetadata.bulkBatchId': batchId,
    })
      .select('_id firstName lastName')
      .lean();
    const batchIdSet = new Set(batchCandidates.map((c) => c._id.toString()));

    const fromBatchInResults = matches.filter((m) => batchIdSet.has(m.candidateId)).length;
    console.log(`   Candidates from this batch appearing in top ${topK}: ${fromBatchInResults} / ${batchCandidates.length}`);

    if (matches.length === 0) {
      console.warn('⚠️ No vector matches returned — check Weaviate/org filter');
    } else {
      const first = matches[0];
      const explanation = await embeddingService.generateMatchExplanation(testJob, first);
      metrics.explanationGenerated = !!(explanation && (explanation.reasons?.length || explanation.overallScore != null));
      console.log(`✅ On-demand explanation for top match (${first.candidateId}): overallScore=${explanation?.overallScore}`);
    }

    // Optional: hit HTTP API like production (needs API_BASE + Bearer token + credits)
    const apiBase = process.env.TEST_API_BASE;
    if (apiBase) {
      const { accessToken } = await sessionService.createSession({
        user,
        fingerprint: 'bulk-pipeline-test-fp',
        userAgent: 'testBulkPipeline/1',
        ip: '127.0.0.1',
      });
      const axios = require('axios');
      const url = `${apiBase.replace(/\/$/, '')}/api/jobs/${testJob._id}/matching-candidates?topK=${topK}`;
      try {
        const { data } = await axios.get(url, {
          headers: { Authorization: `Bearer ${accessToken}` },
          timeout: 120000,
        });
        console.log(`🌐 HTTP matching: mode=${data.mode} explanationsIncluded=${data.explanationsIncluded} count=${data.matchCount}`);
        if (data.mode !== (isLargeScale ? 'vector-ranked' : 'full-analysis')) {
          console.warn('⚠️ HTTP mode does not match expected large-scale flag — check controller threshold');
        }
      } catch (e) {
        console.warn('⚠️ HTTP matching test skipped/failed:', e.response?.data || e.message);
      }

      if (matches[0]) {
        const expUrl = `${apiBase.replace(/\/$/, '')}/api/jobs/${testJob._id}/candidate/${matches[0].candidateId}/explanation`;
        try {
          const expRes = await axios.get(expUrl, {
            headers: { Authorization: `Bearer ${accessToken}` },
            timeout: 120000,
          });
          console.log('🌐 HTTP explanation keys:', expRes.data?.explanation ? Object.keys(expRes.data.explanation) : 'none');
        } catch (e) {
          console.warn('⚠️ HTTP explanation test skipped/failed:', e.response?.data || e.message);
        }
      }
    }

    console.log('');
    console.log('📊 Metrics:', JSON.stringify(metrics, null, 2));
  } catch (err) {
    console.error('❌ Test failed:', err.message);
    console.error(err.stack);
    process.exitCode = 1;
  } finally {
    if (!skipCleanup && mongoose.connection.readyState === 1) {
      try {
        const ids = await Candidate.find({
          'processingMetadata.bulkBatchId': batchId,
        }).select('_id');

        console.log(`🧹 Cleaning up ${ids.length} test candidates + embeddings…`);
        for (const row of ids) {
          try {
            await embeddingService.deleteEmbedding(row._id.toString(), embeddingService.candidateIndexName);
          } catch (e) {
            console.warn(`   Weaviate delete candidate ${row._id}:`, e.message);
          }
        }
        await Candidate.deleteMany({ 'processingMetadata.bulkBatchId': batchId });

        if (testJob?._id) {
          try {
            const aiMatchCacheService = require('../services/aiMatchCacheService');
            await aiMatchCacheService.invalidateJobCache(testJob._id);
          } catch (e) {
            console.warn('   Cache invalidate:', e.message);
          }
          try {
            await embeddingService.deleteEmbedding(testJob._id.toString(), embeddingService.jobIndexName);
          } catch (e) {
            console.warn('   Weaviate delete job:', e.message);
          }
          await Job.deleteOne({ _id: testJob._id });
          console.log(`🧹 Deleted test job ${testJob._id}`);
        }
      } catch (cleanupErr) {
        console.error('⚠️ Cleanup error:', cleanupErr.message);
      }
    } else if (skipCleanup) {
      console.log('⏭️ SKIP_CLEANUP=1 — test candidates and job left in database');
    }

    if (tmpDir && fs.existsSync(tmpDir)) {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        console.log('🧹 Removed temp CV directory');
      } catch (e) {
        console.warn('⚠️ Could not remove temp dir:', e.message);
      }
    }

    try {
      await bulkUploadService.shutdownQueue();
    } catch (_) {}

    await mongoose.disconnect();
    console.log('📡 MongoDB disconnected');
  }
}

main();
