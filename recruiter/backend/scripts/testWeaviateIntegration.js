const mongoose = require('mongoose');
const Candidate = require('../models/Candidate');
const Job = require('../models/Job');
require('dotenv').config();

async function runTests() {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════╗');
  console.log('║   WEAVIATE INTEGRATION TEST (CV + JOBS)          ║');
  console.log('╚═══════════════════════════════════════════════════╝');
  console.log('');

  const results = { passed: 0, failed: 0, tests: [] };

  function pass(name, detail) {
    results.passed++;
    results.tests.push({ name, status: 'PASS', detail });
    console.log(`  ✅ PASS: ${name}${detail ? ' — ' + detail : ''}`);
  }
  function fail(name, detail) {
    results.failed++;
    results.tests.push({ name, status: 'FAIL', detail });
    console.log(`  ❌ FAIL: ${name}${detail ? ' — ' + detail : ''}`);
  }

  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('📡 MongoDB connected\n');

    const embeddingService = require('../services/embeddingService');
    const weaviateService = require('../services/weaviateService');

    // ── Test 1: Weaviate flag enabled ──
    console.log('── Test 1: Configuration ──');
    if (embeddingService.useWeaviate) {
      pass('USE_WEAVIATE is enabled');
    } else {
      fail('USE_WEAVIATE is NOT enabled', 'env var missing or false');
    }

    // ── Test 2: Weaviate connection ──
    console.log('\n── Test 2: Weaviate Connection ──');
    try {
      const stats = await weaviateService.getStats();
      pass('Weaviate connection', `Candidates: ${stats.candidates}, Jobs: ${stats.jobs}`);
      if (stats.candidates > 0) {
        pass('Candidates exist in Weaviate', `${stats.candidates} candidates`);
      } else {
        fail('No candidates in Weaviate');
      }
      if (stats.jobs > 0) {
        pass('Jobs exist in Weaviate', `${stats.jobs} jobs`);
      } else {
        fail('No jobs in Weaviate');
      }
    } catch (e) {
      fail('Weaviate connection', e.message);
    }

    // ── Test 3: Candidate embedding generation ──
    console.log('\n── Test 3: Candidate Embedding Text ──');
    const sampleCandidate = await Candidate.findOne({ isEmbedded: true }).lean();
    if (sampleCandidate) {
      const text = embeddingService.createCandidateEmbeddingText(sampleCandidate);
      if (text && text.length > 50) {
        pass('Candidate embedding text', `${text.length} chars for ${sampleCandidate.firstName} ${sampleCandidate.lastName}`);
      } else {
        fail('Candidate embedding text too short', `${text?.length || 0} chars`);
      }
    } else {
      fail('No embedded candidate found in MongoDB');
    }

    // ── Test 4: Candidate vector search via Weaviate ──
    console.log('\n── Test 4: Candidate Vector Search ──');
    try {
      const sampleJob = await Job.findOne({ isEmbedded: true }).lean();
      if (sampleJob) {
        const jobText = embeddingService.createJobEmbeddingText(sampleJob);
        const orgId = sampleJob.organization?.toString();
        console.log(`  Searching for candidates matching: "${sampleJob.title}" (org: ${orgId})`);

        const startTime = Date.now();
        const matches = await embeddingService.searchSimilarCandidates(jobText, 5, orgId);
        const elapsed = Date.now() - startTime;

        if (matches && matches.length > 0) {
          pass('Candidate search via Weaviate', `${matches.length} results in ${elapsed}ms`);
          const first = matches[0];
          const hasScore = first.score !== undefined;
          const hasMeta = first.metadata?.candidateId;
          if (hasScore && hasMeta) {
            pass('Result format correct', `score=${first.score.toFixed(3)}, candidateId=${first.metadata.candidateId}`);
          } else {
            fail('Result format incorrect', `score=${hasScore}, candidateId=${!!hasMeta}`);
          }
        } else {
          fail('No candidates returned from Weaviate search');
        }
      } else {
        fail('No embedded job in MongoDB to use as query');
      }
    } catch (e) {
      fail('Candidate search', e.message);
    }

    // ── Test 5: Job embedding store + check + delete cycle ──
    console.log('\n── Test 5: Job Store/Check/Delete Cycle ──');
    try {
      const testJobId = 'test-integration-' + Date.now();
      const testText = 'Test Software Engineer position requiring React Node.js and AWS experience';
      const embedding = await embeddingService.generateEmbedding(testText);
      pass('Embedding generation', `${embedding.length} dimensions`);

      await embeddingService.storeEmbedding(testJobId, embedding, {
        jobId: testJobId,
        organizationId: 'test-org',
        title: 'Test Job',
        department: 'Engineering',
        location: 'Remote',
      }, embeddingService.jobIndexName);
      pass('Job stored in Weaviate');

      const exists = await embeddingService.checkEmbeddingExists(testJobId, embeddingService.jobIndexName);
      if (exists) {
        pass('Job existence check', 'found in Weaviate');
      } else {
        fail('Job existence check', 'not found after store');
      }

      await embeddingService.deleteEmbedding(testJobId, embeddingService.jobIndexName);
      const existsAfter = await embeddingService.checkEmbeddingExists(testJobId, embeddingService.jobIndexName);
      if (!existsAfter) {
        pass('Job deletion', 'successfully removed from Weaviate');
      } else {
        fail('Job deletion', 'still found after delete');
      }
    } catch (e) {
      fail('Job store/check/delete cycle', e.message);
    }

    // ── Test 6: Candidate embedding store + check + delete cycle ──
    console.log('\n── Test 6: Candidate Store/Check/Delete Cycle ──');
    try {
      const testCandId = 'test-cand-' + Date.now();
      const testText = 'Senior software engineer with 8 years React experience and AWS certifications';
      const embedding = await embeddingService.generateEmbedding(testText);

      await embeddingService.storeEmbedding(testCandId, embedding, {
        candidateId: testCandId,
        organizationId: 'test-org',
        firstName: 'Test',
        lastName: 'Candidate',
        email: 'test@test.com',
        position: 'Software Engineer',
        skills: ['React', 'Node.js', 'AWS'],
        totalYearsExperience: 8,
      }, embeddingService.candidateIndexName);
      pass('Candidate stored in Weaviate');

      const exists = await embeddingService.checkEmbeddingExists(testCandId, embeddingService.candidateIndexName);
      if (exists) {
        pass('Candidate existence check', 'found in Weaviate');
      } else {
        fail('Candidate existence check', 'not found after store');
      }

      await embeddingService.deleteEmbedding(testCandId, embeddingService.candidateIndexName);
      pass('Candidate deletion completed');
    } catch (e) {
      fail('Candidate store/check/delete cycle', e.message);
    }

    // ── Test 7: Full job matching pipeline ──
    console.log('\n── Test 7: Full Job Matching Pipeline ──');
    try {
      const job = await Job.findOne({ isEmbedded: true }).lean();
      if (job) {
        console.log(`  Running full match for: "${job.title}"`);
        const startTime = Date.now();
        const result = await embeddingService.findMatchingCandidatesForJob(job, 5, { skipCache: true });
        const elapsed = Date.now() - startTime;

        const matches = result.matches || result;
        if (matches.length > 0) {
          pass('Full job matching pipeline', `${matches.length} matches in ${elapsed}ms`);
          console.log(`  Top match: ${matches[0].candidate?.name || matches[0].metadata?.firstName} (score: ${matches[0].similarity?.toFixed(3)})`);
        } else {
          fail('Full job matching pipeline', 'no matches returned');
        }
      } else {
        fail('No embedded job to test matching');
      }
    } catch (e) {
      fail('Full job matching pipeline', e.message);
    }

    // ── Summary ──
    console.log('\n');
    console.log('╔═══════════════════════════════════════════════════╗');
    console.log(`║   RESULTS: ${results.passed} PASSED, ${results.failed} FAILED                     ║`);
    console.log('╚═══════════════════════════════════════════════════╝');
    console.log('');

    if (results.failed > 0) {
      console.log('Failed tests:');
      results.tests.filter(t => t.status === 'FAIL').forEach(t => {
        console.log(`  ❌ ${t.name}: ${t.detail}`);
      });
    }

  } catch (e) {
    console.error('Fatal test error:', e);
  } finally {
    await mongoose.disconnect();
  }

  process.exit(results.failed > 0 ? 1 : 0);
}

runTests();
