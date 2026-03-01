const fs = require('fs');
const path = require('path');
const axios = require('axios');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const CVParsingService = require('../services/cvParsingService');

const DEFAULT_OUTPUT = path.join(__dirname, '../docs/cv-extraction-gpt41-vs-llama33.md');

function parseArgs(argv) {
  const args = {};

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;

    const [rawKey, inlineValue] = token.split('=');
    const key = rawKey.replace(/^--/, '');

    if (inlineValue !== undefined) {
      args[key] = inlineValue;
      continue;
    }

    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      args[key] = next;
      i += 1;
    } else {
      args[key] = true;
    }
  }

  return args;
}

function asBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (value === undefined || value === null) return false;
  const normalized = String(value).trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (ext === '.doc') return 'application/msword';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.tif' || ext === '.tiff') return 'image/tiff';
  throw new Error(`Unsupported resume file extension: ${ext}`);
}

function findResumeFilesSorted() {
  const uploadsDir = path.join(__dirname, '../uploads');
  if (!fs.existsSync(uploadsDir)) {
    throw new Error(`Uploads directory not found: ${uploadsDir}`);
  }

  const candidates = fs.readdirSync(uploadsDir)
    .filter((fileName) => fileName.toLowerCase().startsWith('resume-'))
    .map((fileName) => {
      const absolute = path.join(uploadsDir, fileName);
      const stats = fs.statSync(absolute);
      return { absolute, fileName, mtimeMs: stats.mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  if (candidates.length === 0) {
    throw new Error(`No resume-* files found in ${uploadsDir}`);
  }

  return candidates.map((item) => item.absolute);
}

function toSingleLine(value) {
  if (value === null || value === undefined) return 'N/A';
  if (Array.isArray(value)) return value.length ? value.join(', ') : '[]';
  if (typeof value === 'object') return JSON.stringify(value);
  const asString = String(value).replace(/\s+/g, ' ').trim();
  return asString || 'N/A';
}

function escapeMarkdownCell(value) {
  return toSingleLine(value).replace(/\|/g, '\\|');
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function looksLikeNA(value) {
  const raw = String(value || '').trim().toLowerCase();
  return raw === '' || raw === 'n/a' || raw === 'na' || raw === 'not available';
}

function average(values) {
  if (!values.length) return null;
  const total = values.reduce((sum, value) => sum + value, 0);
  return total / values.length;
}

function percentage(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return 'N/A';
  return Number(value).toFixed(2);
}

function endpointLabel(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}`;
  } catch (_error) {
    return url;
  }
}

function uniqueNormalized(values, normalizer) {
  const map = new Map();

  values.forEach((value) => {
    const raw = String(value || '').trim();
    if (!raw) return;
    const normalized = normalizer(raw);
    if (!normalized) return;
    if (!map.has(normalized)) {
      map.set(normalized, raw);
    }
  });

  return {
    normalized: Array.from(map.keys()),
    display: Array.from(map.values())
  };
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizePhone(value) {
  const digits = onlyDigits(value);
  if (digits.length < 8 || digits.length > 15) return '';
  return digits;
}

function normalizeCompany(value) {
  return normalizeText(value)
    .replace(/\b(inc|incorporated|llc|ltd|limited|plc|corp|corporation|company|co)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractEmails(text) {
  const matches = String(text || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  return uniqueNormalized(matches, normalizeEmail);
}

function extractPhones(text) {
  const matches = String(text || '').match(/(?:\+?\d[\d\s().-]{7,}\d)/g) || [];
  return uniqueNormalized(matches, normalizePhone);
}

function extractYears(text) {
  const matches = String(text || '').match(/\b(?:19|20)\d{2}\b/g) || [];
  return uniqueNormalized(matches, (value) => value.trim());
}

function extractCompaniesFromResumeText(resumeText) {
  const lines = String(resumeText || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const candidates = [];

  for (const line of lines) {
    if (line.includes('|')) {
      const left = line.split('|')[0].trim();
      if (left.length >= 2 && left.length <= 100) {
        candidates.push(left);
      }
    }

    const bankPattern = line.match(/^([A-Za-z0-9&.,'()\- ]{2,60}\b(?:BANK|GROUP|TECH|SYSTEMS|LABS))\b/i);
    if (bankPattern && bankPattern[1]) {
      candidates.push(bankPattern[1].trim());
    }
  }

  return uniqueNormalized(candidates, normalizeCompany);
}

function collectStrings(value, target = []) {
  if (value === null || value === undefined) return target;
  if (typeof value === 'string') {
    target.push(value);
    return target;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectStrings(item, target));
    return target;
  }
  if (typeof value === 'object') {
    Object.values(value).forEach((item) => collectStrings(item, target));
  }
  return target;
}

function extractPredictedCompanies(parsed) {
  const jobHistory = parsed?.workExperience?.jobHistory;
  if (!Array.isArray(jobHistory)) return uniqueNormalized([], normalizeCompany);

  const names = jobHistory
    .map((entry) => entry && entry.company)
    .filter((name) => typeof name === 'string' && !looksLikeNA(name));

  return uniqueNormalized(names, normalizeCompany);
}

function buildExpectedSignals(resumeText) {
  return {
    emails: extractEmails(resumeText),
    phones: extractPhones(resumeText),
    years: extractYears(resumeText),
    companies: extractCompaniesFromResumeText(resumeText)
  };
}

function buildPredictedSignals(parsed) {
  const strings = collectStrings(parsed);
  return {
    emails: extractEmails(strings.join('\n')),
    phones: extractPhones(strings.join('\n')),
    years: extractYears(strings.join('\n')),
    companies: extractPredictedCompanies(parsed)
  };
}

function companyMatches(expectedCompany, predictedCompany) {
  const e = normalizeCompany(expectedCompany);
  const p = normalizeCompany(predictedCompany);
  if (!e || !p) return false;
  return e === p || e.includes(p) || p.includes(e);
}

function scoreSet(expectedSet, predictedSet, matcher = (a, b) => a === b) {
  const expected = [...expectedSet];
  const predicted = [...predictedSet];

  const matchedExpected = new Set();
  let truePositive = 0;

  for (const predictedValue of predicted) {
    const index = expected.findIndex((expectedValue, expectedIndex) => {
      if (matchedExpected.has(expectedIndex)) return false;
      return matcher(expectedValue, predictedValue);
    });

    if (index !== -1) {
      truePositive += 1;
      matchedExpected.add(index);
    }
  }

  const falsePositive = Math.max(predicted.length - truePositive, 0);
  const falseNegative = Math.max(expected.length - truePositive, 0);

  const precision = predicted.length === 0 ? (expected.length === 0 ? 100 : 0) : (truePositive / predicted.length) * 100;
  const recall = expected.length === 0 ? 100 : (truePositive / expected.length) * 100;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  const hallucinationRate = predicted.length === 0 ? 0 : (falsePositive / predicted.length) * 100;

  return {
    expectedCount: expected.length,
    predictedCount: predicted.length,
    truePositive,
    falsePositive,
    falseNegative,
    precision: Number(precision.toFixed(2)),
    recall: Number(recall.toFixed(2)),
    f1: Number(f1.toFixed(2)),
    hallucinationRate: Number(hallucinationRate.toFixed(2))
  };
}

function scoreLiteralEvidence(values, resumeText, field) {
  const list = (values || []).filter((value) => !looksLikeNA(value));
  if (list.length === 0) {
    return {
      checked: 0,
      matched: 0,
      evidenceScore: 100,
      hallucinationRate: 0
    };
  }

  let matched = 0;
  list.forEach((value) => {
    if (valueFoundInResume(field, value, resumeText)) {
      matched += 1;
    }
  });

  const evidenceScore = (matched / list.length) * 100;
  return {
    checked: list.length,
    matched,
    evidenceScore: Number(evidenceScore.toFixed(2)),
    hallucinationRate: Number((100 - evidenceScore).toFixed(2))
  };
}

function valueFoundInResume(field, value, resumeText) {
  if (value === null || value === undefined || looksLikeNA(value)) {
    return true;
  }

  if (field === 'phone') {
    const resumeDigits = onlyDigits(resumeText);
    const valueDigits = onlyDigits(value);
    if (!valueDigits) return true;
    return resumeDigits.includes(valueDigits);
  }

  const normalizedResume = normalizeText(resumeText);
  const normalizedValue = normalizeText(value);
  if (!normalizedValue) return true;
  return normalizedResume.includes(normalizedValue);
}

function safeJsonParse(content) {
  if (!content || typeof content !== 'string') {
    return { parsed: null, parseError: 'Empty response content' };
  }

  try {
    return { parsed: JSON.parse(content), parseError: null };
  } catch (_error) {
    const firstBrace = content.indexOf('{');
    const lastBrace = content.lastIndexOf('}');

    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      const candidate = content.slice(firstBrace, lastBrace + 1);
      try {
        return { parsed: JSON.parse(candidate), parseError: null };
      } catch (error) {
        return { parsed: null, parseError: error.message };
      }
    }

    return { parsed: null, parseError: 'Could not locate JSON object in response' };
  }
}

function evaluateExtraction(parsed, resumeText) {
  const fields = [
    'firstName',
    'lastName',
    'email',
    'phone',
    'location',
    'position',
    'experience',
    'education',
    'skills',
    'summary',
    'workExperience.totalYearsExperience',
    'workExperience.jobHistory'
  ];

  const getters = {
    firstName: (obj) => obj.firstName,
    lastName: (obj) => obj.lastName,
    email: (obj) => obj.email,
    phone: (obj) => obj.phone,
    location: (obj) => obj.location,
    position: (obj) => obj.position,
    experience: (obj) => obj.experience,
    education: (obj) => obj.education,
    skills: (obj) => obj.skills,
    summary: (obj) => obj.summary,
    'workExperience.totalYearsExperience': (obj) => obj.workExperience && obj.workExperience.totalYearsExperience,
    'workExperience.jobHistory': (obj) => obj.workExperience && obj.workExperience.jobHistory
  };

  const isFilled = (value) => {
    if (value === null || value === undefined) return false;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'string') return !looksLikeNA(value);
    if (typeof value === 'object') return Object.keys(value).length > 0;
    return true;
  };

  let filled = 0;
  fields.forEach((field) => {
    if (isFilled(getters[field](parsed))) {
      filled += 1;
    }
  });

  const evidenceChecks = [
    ['firstName', parsed.firstName],
    ['lastName', parsed.lastName],
    ['email', parsed.email],
    ['phone', parsed.phone],
    ['location', parsed.location]
  ];

  let matchedEvidence = 0;
  let checkedEvidence = 0;
  evidenceChecks.forEach(([field, value]) => {
    if (value === null || value === undefined || looksLikeNA(value)) return;
    checkedEvidence += 1;
    if (valueFoundInResume(field, value, resumeText)) {
      matchedEvidence += 1;
    }
  });

  const expected = buildExpectedSignals(resumeText);
  const predicted = buildPredictedSignals(parsed);

  const emailScores = scoreSet(expected.emails.normalized, predicted.emails.normalized);
  const phoneScores = scoreSet(expected.phones.normalized, predicted.phones.normalized);
  const yearScores = scoreSet(expected.years.normalized, predicted.years.normalized);
  const companyScores = scoreSet(expected.companies.normalized, predicted.companies.normalized, companyMatches);

  const companyLiteral = scoreLiteralEvidence(predicted.companies.display, resumeText, 'company');
  const emailLiteral = scoreLiteralEvidence(predicted.emails.display, resumeText, 'email');
  const phoneLiteral = scoreLiteralEvidence(predicted.phones.display, resumeText, 'phone');

  const completenessScore = Number(((filled / fields.length) * 100).toFixed(2));
  const evidenceMatchScore = checkedEvidence === 0 ? 100 : Number(((matchedEvidence / checkedEvidence) * 100).toFixed(2));

  const coverageInputs = [
    completenessScore,
    emailScores.recall,
    phoneScores.recall,
    yearScores.recall
  ];

  if (companyScores.expectedCount > 0) {
    coverageInputs.push(companyScores.recall);
  }

  const coverageScore = Number(average(coverageInputs).toFixed(2));

  const groundingScore = Number(average([
    evidenceMatchScore,
    emailLiteral.evidenceScore,
    phoneLiteral.evidenceScore,
    companyLiteral.evidenceScore
  ]).toFixed(2));

  const finalQualityScore = Number((coverageScore * 0.6 + groundingScore * 0.4).toFixed(2));

  return {
    completenessScore,
    fieldsFilled: filled,
    totalFields: fields.length,
    evidenceMatchScore,
    evidenceMatches: matchedEvidence,
    evidenceChecked: checkedEvidence,
    coverageScore,
    groundingScore,
    finalQualityScore,
    signals: {
      expected,
      predicted,
      emailScores,
      phoneScores,
      yearScores,
      companyScores,
      companyLiteral,
      emailLiteral,
      phoneLiteral
    }
  };
}

async function callModel(modelName, endpoint, apiKey, resumeText) {
  const systemPrompt = [
    'You are an AI assistant specialized in parsing CVs and extracting complete, structured information.',
    'CRITICAL ANTI-HALLUCINATION RULES:',
    '1) ONLY extract information explicitly present in the CV text.',
    '2) NEVER invent names, emails, phone numbers, locations, skills, employers, or years.',
    '3) If a field is missing, use "N/A" for strings and [] for arrays.',
    '4) Return ONLY valid JSON.'
  ].join('\n');

  const userPrompt = [
    'Analyze this CV text and return JSON with EXACT keys:',
    '{',
    '  "firstName": "string",',
    '  "lastName": "string",',
    '  "email": "string",',
    '  "phone": "string",',
    '  "location": "string",',
    '  "position": "string",',
    '  "experience": "string",',
    '  "education": "string",',
    '  "skills": ["string"],',
    '  "summary": "string",',
    '  "strengths": ["string"],',
    '  "potentialFlags": ["string"],',
    '  "workExperience": {',
    '    "totalYearsExperience": "string",',
    '    "jobHistory": [',
    '      {"company": "string", "position": "string", "duration": "string", "responsibilities": "string"}',
    '    ]',
    '  }',
    '}',
    '',
    'CV Text:',
    resumeText
  ].join('\n');

  const startedAt = Date.now();

  try {
    const response = await axios.post(
      endpoint,
      {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.2,
        top_p: 1,
        max_completion_tokens: 2500
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'api-key': apiKey
        },
        timeout: 240000
      }
    );

    const elapsedMs = Date.now() - startedAt;
    const rawContent = response.data?.choices?.[0]?.message?.content;
    const content = Array.isArray(rawContent)
      ? rawContent.map((chunk) => (typeof chunk === 'string' ? chunk : chunk?.text || '')).join('')
      : String(rawContent || '');

    const { parsed, parseError } = safeJsonParse(content);

    if (!parsed) {
      return {
        modelName,
        success: false,
        elapsedMs,
        endpoint: endpointLabel(endpoint),
        parseError,
        rawContentPreview: content.slice(0, 800)
      };
    }

    return {
      modelName,
      success: true,
      elapsedMs,
      endpoint: endpointLabel(endpoint),
      usage: response.data?.usage || null,
      parsed
    };
  } catch (error) {
    const elapsedMs = Date.now() - startedAt;
    const status = error.response?.status;
    const data = error.response?.data;

    return {
      modelName,
      success: false,
      elapsedMs,
      endpoint: endpointLabel(endpoint),
      status,
      error: error.message,
      errorData: typeof data === 'string' ? data : JSON.stringify(data || {}, null, 2)
    };
  }
}

function aggregateModelResults(results) {
  const successful = results.filter((result) => result.success && result.evaluation);

  return {
    totalRuns: results.length,
    successCount: successful.length,
    successRate: results.length ? (successful.length / results.length) * 100 : 0,
    avgLatencyMs: average(successful.map((item) => item.elapsedMs)),
    avgCompleteness: average(successful.map((item) => item.evaluation.completenessScore)),
    avgEvidence: average(successful.map((item) => item.evaluation.evidenceMatchScore)),
    avgCoverage: average(successful.map((item) => item.evaluation.coverageScore)),
    avgGrounding: average(successful.map((item) => item.evaluation.groundingScore)),
    avgFinalQuality: average(successful.map((item) => item.evaluation.finalQualityScore)),
    avgCompanyHallucination: average(successful.map((item) => item.evaluation.signals.companyLiteral.hallucinationRate)),
    avgEmailHallucination: average(successful.map((item) => item.evaluation.signals.emailLiteral.hallucinationRate)),
    avgPhoneHallucination: average(successful.map((item) => item.evaluation.signals.phoneLiteral.hallucinationRate))
  };
}

function decideWinner(gptAggregate, llamaAggregate) {
  const gptQuality = gptAggregate.avgFinalQuality || 0;
  const llamaQuality = llamaAggregate.avgFinalQuality || 0;
  const qualityDiff = gptQuality - llamaQuality;

  if (Math.abs(qualityDiff) >= 1) {
    if (qualityDiff > 0) {
      return {
        winner: 'GPT-4.1',
        reason: `Higher quality score (${percentage(gptQuality)} vs ${percentage(llamaQuality)})`
      };
    }

    return {
      winner: 'Llama 3.3 70B',
      reason: `Higher quality score (${percentage(llamaQuality)} vs ${percentage(gptQuality)})`
    };
  }

  const gptGrounding = gptAggregate.avgGrounding || 0;
  const llamaGrounding = llamaAggregate.avgGrounding || 0;
  const groundingDiff = gptGrounding - llamaGrounding;

  if (Math.abs(groundingDiff) >= 1) {
    if (groundingDiff > 0) {
      return {
        winner: 'GPT-4.1',
        reason: `Similar quality, but better grounding score (${percentage(gptGrounding)} vs ${percentage(llamaGrounding)})`
      };
    }

    return {
      winner: 'Llama 3.3 70B',
      reason: `Similar quality, but better grounding score (${percentage(llamaGrounding)} vs ${percentage(gptGrounding)})`
    };
  }

  const gptLatency = gptAggregate.avgLatencyMs || Number.POSITIVE_INFINITY;
  const llamaLatency = llamaAggregate.avgLatencyMs || Number.POSITIVE_INFINITY;

  if (gptLatency < llamaLatency) {
    return {
      winner: 'GPT-4.1',
      reason: `Near-tie on quality, faster latency (${percentage(gptLatency)}ms vs ${percentage(llamaLatency)}ms)`
    };
  }

  if (llamaLatency < gptLatency) {
    return {
      winner: 'Llama 3.3 70B',
      reason: `Near-tie on quality, faster latency (${percentage(llamaLatency)}ms vs ${percentage(gptLatency)}ms)`
    };
  }

  return {
    winner: 'Tie',
    reason: 'Quality, grounding, and latency are effectively equivalent in this run.'
  };
}

function buildComparisonMarkdown({
  generatedAt,
  runCount,
  resumeRecords,
  skippedResumes,
  gptResults,
  llamaResults,
  gptEndpoint,
  llamaEndpoint
}) {
  const gptAggregate = aggregateModelResults(gptResults);
  const llamaAggregate = aggregateModelResults(llamaResults);
  const decision = decideWinner(gptAggregate, llamaAggregate);

  const lines = [];
  lines.push('# CV Extraction Comparison: GPT-4.1 vs Llama 3.3 70B');
  lines.push('');
  lines.push(`Generated: ${generatedAt}`);
  lines.push(`Runs per resume per model: ${runCount}`);
  lines.push(`Resumes evaluated: ${resumeRecords.length}`);
  lines.push(`Resumes skipped (insufficient/unreadable): ${skippedResumes.length}`);
  lines.push('');

  lines.push('## Test Setup');
  lines.push('');
  lines.push(`- GPT-4.1 endpoint: \`${endpointLabel(gptEndpoint)}\``);
  lines.push(`- Llama 3.3 endpoint: \`${endpointLabel(llamaEndpoint)}\``);
  lines.push('- Shared extraction prompt and JSON schema for both models');
  lines.push('- Temperature: 0.2, max_completion_tokens: 2500');
  lines.push('- Enhanced rubric: JSON validity, latency, completeness, evidence match, section recall, hallucination checks');
  lines.push('');

  lines.push('## Overall Scoreboard');
  lines.push('');
  lines.push('| Metric | GPT-4.1 | Llama 3.3 70B |');
  lines.push('|---|---:|---:|');
  lines.push(`| Successful runs | ${gptAggregate.successCount}/${gptAggregate.totalRuns} | ${llamaAggregate.successCount}/${llamaAggregate.totalRuns} |`);
  lines.push(`| Success rate (%) | ${percentage(gptAggregate.successRate)} | ${percentage(llamaAggregate.successRate)} |`);
  lines.push(`| Avg latency (ms) | ${percentage(gptAggregate.avgLatencyMs)} | ${percentage(llamaAggregate.avgLatencyMs)} |`);
  lines.push(`| Avg completeness (%) | ${percentage(gptAggregate.avgCompleteness)} | ${percentage(llamaAggregate.avgCompleteness)} |`);
  lines.push(`| Avg evidence match (%) | ${percentage(gptAggregate.avgEvidence)} | ${percentage(llamaAggregate.avgEvidence)} |`);
  lines.push(`| Avg coverage score (%) | ${percentage(gptAggregate.avgCoverage)} | ${percentage(llamaAggregate.avgCoverage)} |`);
  lines.push(`| Avg grounding score (%) | ${percentage(gptAggregate.avgGrounding)} | ${percentage(llamaAggregate.avgGrounding)} |`);
  lines.push(`| Avg final quality score (%) | ${percentage(gptAggregate.avgFinalQuality)} | ${percentage(llamaAggregate.avgFinalQuality)} |`);
  lines.push(`| Avg company hallucination (%) | ${percentage(gptAggregate.avgCompanyHallucination)} | ${percentage(llamaAggregate.avgCompanyHallucination)} |`);
  lines.push('');

  lines.push('## Verdict');
  lines.push('');
  lines.push(`- Winner: **${decision.winner}**`);
  lines.push(`- Why: ${decision.reason}`);
  lines.push('');

  lines.push('## Per Resume Summary');
  lines.push('');
  lines.push('| Resume | Text Length | GPT Avg Quality | Llama Avg Quality | GPT Avg Latency (ms) | Llama Avg Latency (ms) |');
  lines.push('|---|---:|---:|---:|---:|---:|');

  resumeRecords.forEach((record) => {
    const gptAggregateForResume = aggregateModelResults(record.gptRuns);
    const llamaAggregateForResume = aggregateModelResults(record.llamaRuns);

    lines.push(`| ${escapeMarkdownCell(path.basename(record.resumePath))} | ${record.resumeTextLength} | ${percentage(gptAggregateForResume.avgFinalQuality)} | ${percentage(llamaAggregateForResume.avgFinalQuality)} | ${percentage(gptAggregateForResume.avgLatencyMs)} | ${percentage(llamaAggregateForResume.avgLatencyMs)} |`);
  });

  lines.push('');

  if (skippedResumes.length) {
    lines.push('## Skipped Resumes');
    lines.push('');
    skippedResumes.forEach((item) => {
      lines.push(`- ${path.basename(item.resumePath)}: ${item.reason}`);
    });
    lines.push('');
  }

  lines.push('## Run Details');
  lines.push('');

  resumeRecords.forEach((record) => {
    lines.push(`### ${path.basename(record.resumePath)}`);
    lines.push('');
    lines.push('| Run | Model | Success | Latency (ms) | Completeness | Coverage | Grounding | Final Quality | Company Hallucination | Parse/Error |');
    lines.push('|---:|---|---|---:|---:|---:|---:|---:|---:|---|');

    for (let runIndex = 0; runIndex < runCount; runIndex += 1) {
      const gpt = record.gptRuns[runIndex];
      const llama = record.llamaRuns[runIndex];

      const gptError = gpt.success ? 'OK' : (gpt.parseError || gpt.error || `HTTP ${gpt.status || 'unknown'}`);
      const llamaError = llama.success ? 'OK' : (llama.parseError || llama.error || `HTTP ${llama.status || 'unknown'}`);

      lines.push(`| ${runIndex + 1} | GPT-4.1 | ${gpt.success ? 'Yes' : 'No'} | ${gpt.elapsedMs} | ${gpt.success ? percentage(gpt.evaluation.completenessScore) : 'N/A'} | ${gpt.success ? percentage(gpt.evaluation.coverageScore) : 'N/A'} | ${gpt.success ? percentage(gpt.evaluation.groundingScore) : 'N/A'} | ${gpt.success ? percentage(gpt.evaluation.finalQualityScore) : 'N/A'} | ${gpt.success ? percentage(gpt.evaluation.signals.companyLiteral.hallucinationRate) : 'N/A'} | ${escapeMarkdownCell(gptError)} |`);
      lines.push(`| ${runIndex + 1} | Llama 3.3 70B | ${llama.success ? 'Yes' : 'No'} | ${llama.elapsedMs} | ${llama.success ? percentage(llama.evaluation.completenessScore) : 'N/A'} | ${llama.success ? percentage(llama.evaluation.coverageScore) : 'N/A'} | ${llama.success ? percentage(llama.evaluation.groundingScore) : 'N/A'} | ${llama.success ? percentage(llama.evaluation.finalQualityScore) : 'N/A'} | ${llama.success ? percentage(llama.evaluation.signals.companyLiteral.hallucinationRate) : 'N/A'} | ${escapeMarkdownCell(llamaError)} |`);
    }

    lines.push('');
  });

  lines.push('## Notes');
  lines.push('');
  lines.push('- Final quality score formula: 60% coverage + 40% grounding.');
  lines.push('- Coverage combines completeness + recall (email, phone, years, job-history companies).');
  lines.push('- Grounding combines literal evidence match + hallucination penalties (email/phone/company).');
  lines.push('- This is a script-level benchmark and should be complemented with human review on hiring-critical flows.');
  lines.push('- API keys are intentionally omitted from this report.');
  lines.push('');

  return {
    markdown: lines.join('\n'),
    decision,
    gptAggregate,
    llamaAggregate
  };
}

async function resolveResumeRecords(cvParsingService, resumeCandidates) {
  const resolved = [];
  const skipped = [];

  for (const resumePath of resumeCandidates) {
    try {
      const mimeType = getMimeType(resumePath);
      console.log('Extracting text from:', resumePath);
      const resumeText = await cvParsingService.parseCV(resumePath, mimeType);

      if (!resumeText || resumeText.trim().length < 50) {
        skipped.push({
          resumePath,
          reason: `Insufficient extractable text (${resumeText ? resumeText.length : 0} chars)`
        });
        continue;
      }

      resolved.push({
        resumePath,
        resumeText,
        resumeTextLength: resumeText.length,
        gptRuns: [],
        llamaRuns: []
      });
    } catch (error) {
      skipped.push({
        resumePath,
        reason: error.message
      });
    }
  }

  return { resolved, skipped };
}

async function run() {
  const args = parseArgs(process.argv);

  const llamaEndpoint = args['llama-endpoint'] || process.env.LLAMA_AZURE_ENDPOINT;
  const llamaApiKey = args['llama-key'] || process.env.LLAMA_AZURE_API_KEY || process.env.AZURE_GPT4O_API_KEY;
  const gptEndpoint = args['gpt-endpoint'] || process.env.azure_openai_url;
  const gptApiKey = args['gpt-key'] || process.env.azure_openai_key;
  const runs = Number(args.runs || 1);
  const outputPath = path.resolve(args.output || DEFAULT_OUTPUT);
  const allResumes = asBoolean(args['all-resumes']) || asBoolean(args.all);
  const resumeArgPath = args.resume ? path.resolve(args.resume) : null;

  if (!llamaEndpoint) {
    throw new Error('Missing llama endpoint. Provide --llama-endpoint or LLAMA_AZURE_ENDPOINT.');
  }
  if (!llamaApiKey) {
    throw new Error('Missing llama API key. Provide --llama-key or LLAMA_AZURE_API_KEY (or AZURE_GPT4O_API_KEY).');
  }
  if (!gptEndpoint || !gptApiKey) {
    throw new Error('Missing GPT-4.1 endpoint/key. Check azure_openai_url and azure_openai_key in .env or pass --gpt-endpoint/--gpt-key.');
  }
  if (!Number.isInteger(runs) || runs < 1) {
    throw new Error('--runs must be an integer >= 1');
  }

  const cvParsingService = new CVParsingService();

  let resumeCandidates = [];
  if (resumeArgPath) {
    resumeCandidates = [resumeArgPath];
  } else {
    const discovered = findResumeFilesSorted();
    resumeCandidates = allResumes ? discovered : [discovered[0]];
  }

  const { resolved: resumeRecords, skipped: skippedResumes } = await resolveResumeRecords(cvParsingService, resumeCandidates);

  if (!resumeRecords.length) {
    throw new Error('No resume files with sufficient text were available for comparison.');
  }

  const gptResults = [];
  const llamaResults = [];

  for (const record of resumeRecords) {
    console.log(`\n===== Benchmarking ${path.basename(record.resumePath)} (${record.resumeTextLength} chars) =====`);

    for (let runIndex = 0; runIndex < runs; runIndex += 1) {
      console.log(`\n--- ${path.basename(record.resumePath)} | Run ${runIndex + 1} ---`);

      const gpt = await callModel('GPT-4.1', gptEndpoint, gptApiKey, record.resumeText);
      if (gpt.success) {
        gpt.evaluation = evaluateExtraction(gpt.parsed, record.resumeText);
      }
      record.gptRuns.push(gpt);
      gptResults.push(gpt);
      console.log(`GPT-4.1: ${gpt.success ? 'success' : 'failed'} (${gpt.elapsedMs}ms)`);

      const llama = await callModel('Llama 3.3 70B', llamaEndpoint, llamaApiKey, record.resumeText);
      if (llama.success) {
        llama.evaluation = evaluateExtraction(llama.parsed, record.resumeText);
      }
      record.llamaRuns.push(llama);
      llamaResults.push(llama);
      console.log(`Llama 3.3 70B: ${llama.success ? 'success' : 'failed'} (${llama.elapsedMs}ms)`);
    }
  }

  const { markdown, decision, gptAggregate, llamaAggregate } = buildComparisonMarkdown({
    generatedAt: new Date().toISOString(),
    runCount: runs,
    resumeRecords,
    skippedResumes,
    gptResults,
    llamaResults,
    gptEndpoint,
    llamaEndpoint
  });

  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(outputPath, markdown, 'utf8');

  console.log('\n===== Final Summary =====');
  console.log(`Winner: ${decision.winner}`);
  console.log(`Reason: ${decision.reason}`);
  console.log(`GPT-4.1 avg quality: ${percentage(gptAggregate.avgFinalQuality)} | avg latency: ${percentage(gptAggregate.avgLatencyMs)}ms`);
  console.log(`Llama avg quality: ${percentage(llamaAggregate.avgFinalQuality)} | avg latency: ${percentage(llamaAggregate.avgLatencyMs)}ms`);
  console.log(`Report written to: ${outputPath}`);
}

run().catch((error) => {
  console.error('Comparison script failed:', error.message);
  process.exit(1);
});
