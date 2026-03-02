const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const axios = require('axios');
const FormData = require('form-data');
const mongoose = require('mongoose');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const connectDB = require('../config/db');
const sessionService = require('../services/sessionService');
const User = require('../models/User');
const Candidate = require('../models/Candidate');
const Interview = require('../models/Interview');
const InterviewComment = require('../models/InterviewComment');

const PORT = Number(process.env.SMOKE_TEST_PORT || 5101);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const VERBOSE_SERVER_LOGS = process.env.SMOKE_TEST_VERBOSE === 'true';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureFileExists(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Required file not found: ${filePath}`);
  }
}

async function waitForServerReady(baseUrl, timeoutMs = 180000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await axios.get(`${baseUrl}/`, {
        timeout: 3000,
        validateStatus: () => true
      });

      if (response.status >= 200 && response.status < 500) {
        return response;
      }
    } catch (_error) {
      // Keep polling until timeout.
    }

    await sleep(1500);
  }

  throw new Error(`Server did not become ready within ${timeoutMs}ms`);
}

function startServer() {
  const backendDir = path.join(__dirname, '..');
  const child = spawn('node', ['server.js'], {
    cwd: backendDir,
    env: {
      ...process.env,
      PORT: String(PORT)
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  if (VERBOSE_SERVER_LOGS) {
    child.stdout.on('data', (chunk) => {
      const text = String(chunk || '').trim();
      if (text) {
        console.log(`[server] ${text}`);
      }
    });

    child.stderr.on('data', (chunk) => {
      const text = String(chunk || '').trim();
      if (text) {
        console.log(`[server:error] ${text}`);
      }
    });
  }

  return child;
}

async function postMultipart({ url, fileFieldName, filePath, extraFields = {}, timeout = 600000, headers = {} }) {
  const form = new FormData();
  form.append(fileFieldName, fs.createReadStream(filePath));

  Object.entries(extraFields).forEach(([key, value]) => {
    form.append(key, value);
  });

  return axios.post(url, form, {
    timeout,
    maxBodyLength: Infinity,
    headers: {
      ...form.getHeaders(),
      ...headers
    },
    validateStatus: () => true
  });
}

async function run() {
  const summary = {
    baseUrl: BASE_URL,
    checks: []
  };

  let server = null;
  let authSessionId = null;
  let tempCandidateId = null;
  let tempInterviewId = null;
  let tempCommentId = null;

  try {
    server = startServer();
    const readinessProbe = await waitForServerReady(BASE_URL);

    const healthProbe = await axios.get(`${BASE_URL}/api/health`, {
      timeout: 10000,
      validateStatus: () => true
    });

    summary.checks.push({
      check: 'Server readiness + health endpoint reachable',
      statusCode: healthProbe.status,
      success: readinessProbe.status >= 200 && readinessProbe.status < 500,
      details: {
        readinessStatus: readinessProbe.status,
        healthStatus: healthProbe.status,
        healthPayload: healthProbe.data
      }
    });

    const docxPath = path.join(__dirname, '../uploads/resume-1761836961115-665108541.docx');
    const scannedPdfPath = path.join(__dirname, '../uploads/resume-1769596730781-729967738.pdf');
    ensureFileExists(docxPath);
    ensureFileExists(scannedPdfPath);

    const cvParseTextResponse = await postMultipart({
      url: `${BASE_URL}/api/cv/parse`,
      fileFieldName: 'cv',
      filePath: docxPath
    });

    summary.checks.push({
      check: 'Public CV parse endpoint (text-based DOCX)',
      statusCode: cvParseTextResponse.status,
      success:
        cvParseTextResponse.status === 200 &&
        cvParseTextResponse.data?.success === true &&
        cvParseTextResponse.data?.parseSuccess === true &&
        cvParseTextResponse.data?.aiSuccess === true,
      details: {
        success: cvParseTextResponse.data?.success,
        parseSuccess: cvParseTextResponse.data?.parseSuccess,
        aiSuccess: cvParseTextResponse.data?.aiSuccess,
        extractedEmail: cvParseTextResponse.data?.personalInfo?.email,
        extractedName: `${cvParseTextResponse.data?.personalInfo?.firstName || ''} ${cvParseTextResponse.data?.personalInfo?.lastName || ''}`.trim()
      }
    });

    const cvParseImageResponse = await postMultipart({
      url: `${BASE_URL}/api/cv/parse`,
      fileFieldName: 'cv',
      filePath: scannedPdfPath
    });

    summary.checks.push({
      check: 'Public CV parse endpoint blocks image-based PDF',
      statusCode: cvParseImageResponse.status,
      success:
        cvParseImageResponse.status >= 400 &&
        String(cvParseImageResponse.data?.msg || '').includes('IMAGE_BASED_CV'),
      details: cvParseImageResponse.data
    });

    const publicUploadResponse = await postMultipart({
      url: `${BASE_URL}/api/candidates/public/upload-cv`,
      fileFieldName: 'resume',
      filePath: docxPath
    });

    summary.checks.push({
      check: 'Public candidate upload endpoint executes CV flow',
      statusCode: publicUploadResponse.status,
      success:
        publicUploadResponse.status === 400 &&
        String(publicUploadResponse.data?.msg || '').toLowerCase().includes('organization required'),
      details: publicUploadResponse.data
    });

    await connectDB();

    const user = await User.findOne({ currentOrganization: { $ne: null } });
    if (!user) {
      throw new Error('No user with currentOrganization found for authenticated endpoint smoke test.');
    }

    const session = await sessionService.createSession({
      user,
      fingerprint: `smoke-${Date.now()}`,
      userAgent: 'llama-endpoint-smoke-test',
      ip: '127.0.0.1'
    });

    authSessionId = session.session.accessTokenId;
    const authHeader = { Authorization: `Bearer ${session.accessToken}` };

    const uniqueKey = Date.now();
    const candidate = await Candidate.create({
      firstName: 'Smoke',
      lastName: 'Candidate',
      email: `smoke-candidate-${uniqueKey}@example.com`,
      phone: '+441234567890',
      position: 'Backend Engineer',
      experience: '5-10',
      education: 'BSc Computer Science',
      skills: 'Node.js,SQL,APIs',
      status: 'Interviewing',
      source: 'Smoke Test',
      organization: user.currentOrganization,
      createdBy: user._id
    });

    tempCandidateId = candidate._id;

    const interview = await Interview.create({
      candidateId: candidate._id,
      interviewerId: user._id,
      title: 'Smoke Test Interview',
      type: 'technical',
      status: 'completed',
      duration: 45,
      scheduledAt: new Date(),
      transcript: {
        content: 'Interviewer: Tell me about backend scaling. Candidate: I scaled Node.js services using caching, indexing, and queue-based processing with measurable latency reductions.'
      }
    });

    tempInterviewId = interview._id;

    const aiSummaryResponse = await axios.post(
      `${BASE_URL}/api/interviews/${tempInterviewId}/ai-summary`,
      {},
      {
        headers: authHeader,
        timeout: 240000,
        validateStatus: () => true
      }
    );

    summary.checks.push({
      check: 'Interview AI summary endpoint',
      statusCode: aiSummaryResponse.status,
      success: aiSummaryResponse.status === 200 && aiSummaryResponse.data?.success === true,
      details: {
        success: aiSummaryResponse.data?.success,
        recommendation: aiSummaryResponse.data?.summary?.recommendation,
        confidence: aiSummaryResponse.data?.summary?.confidence
      }
    });

    const addCommentResponse = await axios.post(
      `${BASE_URL}/api/interviews/${tempInterviewId}/comments`,
      {
        content: 'Smoke test interviewer comment: strong technical depth with clear communication.',
        commentType: 'general',
        rating: {
          overall: 4
        },
        categories: ['technical_skills'],
        visibility: 'team'
      },
      {
        headers: {
          ...authHeader,
          'Content-Type': 'application/json'
        },
        timeout: 120000,
        validateStatus: () => true
      }
    );

    if (addCommentResponse.status === 201 && addCommentResponse.data?.comment?._id) {
      tempCommentId = addCommentResponse.data.comment._id;
    } else {
      const fallbackAuthorName =
        `${user.profile?.firstName || ''} ${user.profile?.lastName || ''}`.trim() ||
        user.email ||
        'Smoke Test Reviewer';

      const fallbackComment = await InterviewComment.create({
        interviewId: tempInterviewId,
        authorId: user._id,
        authorName: fallbackAuthorName,
        authorRole: 'interviewer',
        content: 'Fallback smoke comment for team analysis endpoint validation.',
        commentType: 'general',
        categories: ['general'],
        visibility: 'team',
        organization: user.currentOrganization,
        rating: {
          overall: 4
        }
      });

      tempCommentId = fallbackComment._id;
    }

    summary.checks.push({
      check: 'Interview add comment endpoint (precondition for team analysis)',
      statusCode: addCommentResponse.status,
      success: addCommentResponse.status === 201 && addCommentResponse.data?.success === true,
      details: {
        success: addCommentResponse.data?.success,
        commentId: addCommentResponse.data?.comment?._id,
        responseBody: addCommentResponse.data
      }
    });

    const analyzeCommentsResponse = await axios.post(
      `${BASE_URL}/api/interviews/${tempInterviewId}/analyze-comments`,
      {},
      {
        headers: authHeader,
        timeout: 240000,
        validateStatus: () => true
      }
    );

    summary.checks.push({
      check: 'Interview team comments analysis endpoint',
      statusCode: analyzeCommentsResponse.status,
      success: analyzeCommentsResponse.status === 200 && analyzeCommentsResponse.data?.success === true,
      details: {
        success: analyzeCommentsResponse.data?.success,
        overallSentiment: analyzeCommentsResponse.data?.analysis?.overallSentiment,
        recommendation: analyzeCommentsResponse.data?.analysis?.finalRecommendation?.decision
      }
    });

    const passed = summary.checks.filter((check) => check.success).length;
    const failed = summary.checks.length - passed;

    summary.totals = {
      passed,
      failed,
      allPassed: failed === 0
    };

    console.log('\n=== Llama Endpoint Smoke Test Summary ===');
    console.log(JSON.stringify(summary, null, 2));

    if (failed > 0) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error('\nSmoke test failed:', error.message);
    process.exitCode = 1;
  } finally {
    try {
      if (tempCommentId) {
        await InterviewComment.findByIdAndDelete(tempCommentId);
      }

      if (tempInterviewId) {
        await Interview.findByIdAndDelete(tempInterviewId);
      }

      if (tempCandidateId) {
        await Candidate.findByIdAndDelete(tempCandidateId);
      }

      if (authSessionId) {
        await sessionService.revokeSessionById(authSessionId, 'smoke_test_cleanup');
      }
    } catch (cleanupError) {
      console.warn('Cleanup warning:', cleanupError.message);
    }

    try {
      if (mongoose.connection.readyState !== 0) {
        await mongoose.connection.close();
      }
    } catch (_closeError) {
      // Ignore close errors during cleanup.
    }

    if (server && !server.killed) {
      server.kill('SIGTERM');
      await sleep(1000);
      if (!server.killed) {
        server.kill('SIGKILL');
      }
    }
  }
}

run();
