let xlsx;
try {
  // Preferred: supports cell styling for colored headers and section highlights.
  xlsx = require('xlsx-js-style');
} catch {
  // Fallback: standard SheetJS (styles may be limited, data export remains intact).
  xlsx = require('xlsx');
}
const prisma = require('../db/client');

const MAX_SHEET_NAME_LENGTH = 31;
const INVALID_SHEET_CHARS = /[:\\/?*\[\]]/g;

const COLORS = {
  brandBlue: '1E3A8A',
  brandIndigo: '4338CA',
  sectionBlue: 'EFF6FF',
  sectionSlate: 'F8FAFC',
  white: 'FFFFFF',
  good: '16A34A',
  warn: 'CA8A04',
  bad: 'DC2626'
};

function toText(value) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.filter(Boolean).join(', ');
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return '';
    }
  }
  return String(value);
}

function toDate(value, withTime = true) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return withTime ? d.toLocaleString() : d.toLocaleDateString();
}

function toName(person) {
  if (!person) return 'N/A';
  const profileName = `${person.profile?.firstName || ''} ${person.profile?.lastName || ''}`.trim();
  if (profileName) return profileName;
  const directName = `${person.firstName || ''} ${person.lastName || ''}`.trim();
  if (directName) return directName;
  return person.email || 'N/A';
}

function toCandidateName(candidate) {
  if (!candidate) return 'Unknown Candidate';
  return `${candidate.firstName || ''} ${candidate.lastName || ''}`.trim() || candidate.name || 'Unknown Candidate';
}

function normalizePercent(value) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (Number.isNaN(n)) return null;
  return Math.max(0, Math.min(100, n));
}

function interviewScore(interview) {
  const structured = normalizePercent(interview?.structuredFeedback?.overallScore);
  if (structured !== null) return structured;
  const direct = normalizePercent(interview?.score);
  if (direct !== null) return direct;
  if (interview?.feedback?.rating !== undefined && interview?.feedback?.rating !== null) {
    return normalizePercent(Number(interview.feedback.rating) * 20);
  }
  return null;
}

function durationDays(start, end = new Date()) {
  if (!start) return '';
  const first = new Date(start);
  const second = new Date(end);
  if (Number.isNaN(first.getTime()) || Number.isNaN(second.getTime())) return '';
  return Math.max(0, Math.round((second.getTime() - first.getTime()) / (1000 * 60 * 60 * 24)));
}

function statusLabel(status, mode = 'pipeline') {
  const value = (status || '').toLowerCase();
  const shortlistMap = {
    shortlisted: 'Shortlisted',
    moved_to_pipeline: 'Moved to Pipeline',
    rejected: 'Rejected'
  };
  const pipelineMap = {
    applied: 'Applied',
    reviewing: 'Reviewing',
    shortlisted: 'Shortlisted',
    interviewing: 'Interviewing',
    keep_in_view: 'Keep in View',
    offered: 'Offered',
    hired: 'Hired',
    rejected: 'Rejected'
  };
  return (mode === 'shortlist' ? shortlistMap : pipelineMap)[value] || status || 'N/A';
}

function safeSheetName(name, used) {
  let clean = toText(name).replace(INVALID_SHEET_CHARS, '').trim();
  if (!clean) clean = 'Sheet';
  if (clean.length > MAX_SHEET_NAME_LENGTH) {
    clean = clean.slice(0, MAX_SHEET_NAME_LENGTH);
  }

  let finalName = clean;
  let i = 2;
  while (used.has(finalName)) {
    const suffix = `_${i}`;
    finalName = `${clean.slice(0, MAX_SHEET_NAME_LENGTH - suffix.length)}${suffix}`;
    i += 1;
  }
  used.add(finalName);
  return finalName;
}

function setWidthsAndFilter(sheet, rows) {
  if (!sheet || !rows || rows.length === 0) return;

  const widths = [];
  if (Array.isArray(rows[0])) {
    rows.forEach((row) => {
      if (!Array.isArray(row)) return;
      row.forEach((value, idx) => {
        const len = Math.min(60, Math.max(10, toText(value).length + 2));
        widths[idx] = Math.max(widths[idx] || 10, len);
      });
    });
  } else {
    const headers = Object.keys(rows[0] || {});
    headers.forEach((h, idx) => {
      widths[idx] = Math.max(widths[idx] || 10, Math.min(60, h.length + 2));
    });
    rows.forEach((row) => {
      headers.forEach((h, idx) => {
        const len = Math.min(60, Math.max(10, toText(row[h]).length + 2));
        widths[idx] = Math.max(widths[idx] || 10, len);
      });
    });
  }

  sheet['!cols'] = widths.map((w) => ({ wch: w }));
  if (sheet['!ref']) sheet['!autofilter'] = { ref: sheet['!ref'] };
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function ratioPercent(part, total) {
  if (!total) return 0;
  return Math.max(0, Math.min(100, Math.round((toNumber(part) / toNumber(total)) * 100)));
}

function percentBar(percent, width = 18) {
  const safePercent = Math.max(0, Math.min(100, Math.round(toNumber(percent))));
  const filled = Math.round((safePercent / 100) * width);
  return `${'█'.repeat(filled)}${'░'.repeat(Math.max(0, width - filled))} ${safePercent}%`;
}

function fitBand(score) {
  if (score === null || score === undefined || Number.isNaN(Number(score))) return 'Unranked';
  const n = Number(score);
  if (n >= 85) return 'Excellent';
  if (n >= 70) return 'Strong';
  if (n >= 55) return 'Watchlist';
  return 'Needs Review';
}

function applyCellStyle(sheet, rowIndexOneBased, colIndexZeroBased, style) {
  const addr = xlsx.utils.encode_cell({ r: rowIndexOneBased - 1, c: colIndexZeroBased });
  if (!sheet[addr]) return;
  sheet[addr].s = {
    ...(sheet[addr].s || {}),
    ...style
  };
}

function applyRowStyle(sheet, rowIndexOneBased, style) {
  if (!sheet || !sheet['!ref']) return;
  const range = xlsx.utils.decode_range(sheet['!ref']);
  for (let c = range.s.c; c <= range.e.c; c += 1) {
    applyCellStyle(sheet, rowIndexOneBased, c, style);
  }
}

function applyRowsByFirstCellMatch(sheet, rows, options = {}) {
  const {
    equals = [],
    startsWith = [],
    style = {}
  } = options;
  rows.forEach((row, idx) => {
    const first = toText(Array.isArray(row) ? row[0] : '').trim();
    if (!first) return;
    if (equals.includes(first) || startsWith.some((prefix) => first.startsWith(prefix))) {
      applyRowStyle(sheet, idx + 1, style);
    }
  });
}

function applyDefaultHeaderRowStyle(sheet) {
  if (!sheet || !sheet['!ref']) return;
  const range = xlsx.utils.decode_range(sheet['!ref']);
  for (let c = range.s.c; c <= range.e.c; c += 1) {
    applyCellStyle(sheet, 1, c, {
      font: { bold: true, color: { rgb: COLORS.white } },
      fill: { patternType: 'solid', fgColor: { rgb: COLORS.brandBlue } },
      alignment: { horizontal: 'center', vertical: 'center', wrapText: true }
    });
  }
}

function styleHomeSheet(sheet, rows) {
  applyRowsByFirstCellMatch(sheet, rows, {
    equals: ['SMART HR - FULL JOB PIPELINE REPORT'],
    style: {
      font: { bold: true, sz: 14, color: { rgb: COLORS.white } },
      fill: { patternType: 'solid', fgColor: { rgb: COLORS.brandBlue } },
      alignment: { horizontal: 'left', vertical: 'center' }
    }
  });

  applyRowsByFirstCellMatch(sheet, rows, {
    equals: [
      'METRIC',
      'Status',
      'Rank',
      'Stage',
      'PIPELINE STATUS',
      'SHORTLIST STATUS',
      'SOURCE MIX',
      'Status / Stage'
    ],
    style: {
      font: { bold: true, color: { rgb: COLORS.white } },
      fill: { patternType: 'solid', fgColor: { rgb: COLORS.brandIndigo } },
      alignment: { horizontal: 'center', vertical: 'center', wrapText: true }
    }
  });

  applyRowsByFirstCellMatch(sheet, rows, {
    equals: [
      'PIPELINE STATUS DISTRIBUTION',
      'TOP CANDIDATES PREVIEW',
      'STAGE SNAPSHOT',
      'PIPELINE HEALTH INFOGRAPHICS'
    ],
    style: {
      font: { bold: true, color: { rgb: COLORS.brandBlue } },
      fill: { patternType: 'solid', fgColor: { rgb: COLORS.sectionBlue } },
      alignment: { horizontal: 'left', vertical: 'center' }
    }
  });
}

function compositeScore({ applicant, shortlist, scores }) {
  const components = [];
  const p = normalizePercent(applicant?.score);
  const s = shortlist?.relevanceScore !== undefined && shortlist?.relevanceScore !== null
    ? normalizePercent(Number(shortlist.relevanceScore) * 100)
    : null;
  const ai = normalizePercent(applicant?.aiInsights?.confidence);
  const avgInterview = scores.length
    ? normalizePercent(scores.reduce((sum, val) => sum + val, 0) / scores.length)
    : null;

  if (p !== null) components.push({ v: p, w: 0.35 });
  if (avgInterview !== null) components.push({ v: avgInterview, w: 0.35 });
  if (ai !== null) components.push({ v: ai, w: 0.2 });
  if (s !== null) components.push({ v: s, w: 0.1 });
  if (!components.length) return null;

  const totalWeight = components.reduce((sum, c) => sum + c.w, 0);
  const weighted = components.reduce((sum, c) => sum + ((c.w / totalWeight) * c.v), 0);
  return Math.round(weighted);
}

async function buildDetailedPipelineWorkbook({ jobId, organizationId }) {
  const job = await prisma.job.findFirst({ where: { id: jobId, organizationId: organizationId } });

  if (!job) {
    const error = new Error('Job not found');
    error.statusCode = 404;
    throw error;
  }

  // --- Stitch soft refs to mirror the original .populate(...) chain. ---
  const candidateSelect = {
    id: true, firstName: true, lastName: true, email: true, phone: true, position: true,
    experience: true, skills: true, location: true, source: true,
    isInternalCandidate: true, employeeId: true
  };
  const userSelect = { id: true, email: true, profile: true };

  const fetchUser = async (id) => (id ? prisma.user.findUnique({ where: { id: String(id) }, select: userSelect }) : null);
  const fetchUsers = async (ids) => {
    const clean = [...new Set((ids || []).filter(Boolean).map(String))];
    if (!clean.length) return new Map();
    const rows = await prisma.user.findMany({ where: { id: { in: clean } }, select: userSelect });
    return new Map(rows.map((r) => [r.id, r]));
  };
  const fetchCandidates = async (ids) => {
    const clean = [...new Set((ids || []).filter(Boolean).map(String))];
    if (!clean.length) return new Map();
    const rows = await prisma.candidate.findMany({ where: { id: { in: clean } }, select: candidateSelect });
    return new Map(rows.map((r) => [r.id, r]));
  };

  // Job-level refs: department, hiringManager, recruiters[], interviewers[].
  job.department = job.departmentId
    ? await prisma.department.findUnique({ where: { id: job.departmentId }, select: { id: true, name: true } })
    : null;
  job.hiringManager = await fetchUser(job.hiringManagerId);
  const recruiterMap = await fetchUsers(job.recruiterIds);
  job.recruiters = (job.recruiterIds || []).map((id) => recruiterMap.get(String(id))).filter(Boolean);
  const interviewerMap = await fetchUsers(job.interviewerIds);
  job.interviewers = (job.interviewerIds || []).map((id) => interviewerMap.get(String(id))).filter(Boolean);

  if (!Array.isArray(job.shortlist)) job.shortlist = [];
  if (!Array.isArray(job.applicants)) job.applicants = [];

  // Collect ids referenced inside the shortlist/applicants Json arrays.
  const collectId = (ref) => (ref && (ref._id || ref.id || ref)) || null;
  const candidateIds = [];
  const userIds = [];
  job.shortlist.forEach((item) => {
    candidateIds.push(collectId(item.candidate));
    userIds.push(collectId(item.addedBy));
  });
  job.applicants.forEach((item) => {
    candidateIds.push(collectId(item.candidate));
    userIds.push(collectId(item.addedBy));
    (item.statusHistory || []).forEach((h) => userIds.push(collectId(h.changedBy)));
  });
  const candidateMap = await fetchCandidates(candidateIds);
  const userMap = await fetchUsers(userIds);

  const stitchCandidate = (ref) => {
    const id = collectId(ref);
    return id ? (candidateMap.get(String(id)) || null) : null;
  };
  const stitchUser = (ref) => {
    const id = collectId(ref);
    return id ? (userMap.get(String(id)) || null) : null;
  };

  job.shortlist.forEach((item) => {
    item.candidate = stitchCandidate(item.candidate);
    item.addedBy = stitchUser(item.addedBy);
  });
  job.applicants.forEach((item) => {
    item.candidate = stitchCandidate(item.candidate);
    item.addedBy = stitchUser(item.addedBy);
    (item.statusHistory || []).forEach((h) => { h.changedBy = stitchUser(h.changedBy); });
  });

  const stages = await prisma.interviewStage.findMany({
    where: { jobId, isActive: true },
    orderBy: { order: 'asc' }
  });
  const interviews = await prisma.interview.findMany({ where: { jobId } });

  // Stitch interview refs: candidateId, interviewerId, stageId.
  const interviewCandidateMap = await fetchCandidates(interviews.map((i) => i.candidateId));
  const interviewUserMap = await fetchUsers(interviews.map((i) => i.interviewerId));
  const stageMapById = new Map(stages.map((s) => [s.id, s]));
  for (const interview of interviews) {
    interview.candidateId = interview.candidateId
      ? (interviewCandidateMap.get(String(interview.candidateId)) || null)
      : null;
    interview.interviewerId = interview.interviewerId
      ? (interviewUserMap.get(String(interview.interviewerId)) || null)
      : null;
    if (interview.stageId) {
      interview.stageId = stageMapById.get(String(interview.stageId))
        || await prisma.interviewStage.findUnique({ where: { id: String(interview.stageId) }, select: { id: true, name: true, order: true } })
        || null;
    }
  }

  const shortlist = (job.shortlist || []).filter((item) => item.candidate && item.candidate._id);
  const applicants = (job.applicants || []).filter((item) => item.candidate && item.candidate._id);

  const applicantByCandidate = new Map(applicants.map((item) => [String(item.candidate._id), item]));
  const shortlistByCandidate = new Map(shortlist.map((item) => [String(item.candidate._id), item]));
  const stageMap = new Map(stages.map((stage) => [String(stage._id), stage]));
  const interviewsByCandidate = new Map();

  interviews.forEach((interview) => {
    const candidateRef = interview.candidateId?._id || interview.candidateId;
    const candidateId = candidateRef ? String(candidateRef) : '';
    if (!candidateId) return;
    if (!interviewsByCandidate.has(candidateId)) interviewsByCandidate.set(candidateId, []);
    interviewsByCandidate.get(candidateId).push(interview);
  });

  const allCandidates = new Map();
  shortlist.forEach((item) => allCandidates.set(String(item.candidate._id), item.candidate));
  applicants.forEach((item) => allCandidates.set(String(item.candidate._id), item.candidate));

  const analytics = [];
  for (const [candidateId, candidate] of allCandidates.entries()) {
    const applicant = applicantByCandidate.get(candidateId);
    const shortlistItem = shortlistByCandidate.get(candidateId);
    const candidateInterviews = interviewsByCandidate.get(candidateId) || [];
    const scores = candidateInterviews.map(interviewScore).filter((v) => v !== null);
    const avgInterview = scores.length ? Math.round(scores.reduce((s, v) => s + v, 0) / scores.length) : null;

    analytics.push({
      candidateId,
      name: toCandidateName(candidate),
      email: candidate.email || '',
      position: candidate.position || '',
      location: candidate.location || '',
      source: applicant?.applicationType || candidate.source || 'manual',
      shortlistStatus: shortlistItem?.status || '',
      pipelineStatus: applicant?.status || '',
      currentStage: applicant?.currentStage?.stageName || '',
      stageJourney: (applicant?.stageHistory || []).map((h) => h.stageName).filter(Boolean).join(' -> '),
      interviews: candidateInterviews.length,
      interviewAverage: avgInterview,
      aiConfidence: normalizePercent(applicant?.aiInsights?.confidence),
      aiRecommendation: applicant?.aiInsights?.recommendedAction || '',
      pipelineScore: normalizePercent(applicant?.score),
      shortlistScore: shortlistItem?.relevanceScore !== undefined && shortlistItem?.relevanceScore !== null
        ? normalizePercent(Number(shortlistItem.relevanceScore) * 100)
        : null,
      composite: compositeScore({ applicant, shortlist: shortlistItem, scores })
    });
  }

  analytics.sort((a, b) => (b.composite ?? -1) - (a.composite ?? -1));
  const top = analytics.filter((c) => c.composite !== null).slice(0, 20);

  const stageMetrics = stages.map((stage) => {
    const stageId = String(stage._id);
    const current = applicants.filter((a) => String(a.currentStage?.stageId || '') === stageId);
    const entries = applicants.flatMap((a) =>
      (a.stageHistory || [])
        .filter((h) => String(h.stageId || '') === stageId)
        .map((h) => ({
          ...h,
          candidateId: String(a.candidate._id)
        }))
    );
    const completed = entries.filter((e) => e.exitedAt);
    const passed = completed.filter((e) => e.result === 'passed');
    return {
      stageId,
      stageName: stage.name,
      order: stage.order,
      current: current.length,
      everEntered: new Set(entries.map((e) => e.candidateId)).size,
      completed: completed.length,
      passRate: completed.length ? Math.round((passed.length / completed.length) * 100) : 0,
      avgDays: current.length
        ? Math.round(current.reduce((sum, a) => sum + (durationDays(a.currentStage?.enteredAt) || 0), 0) / current.length)
        : 0
    };
  });

  const workbook = xlsx.utils.book_new();
  const usedNames = new Set();
  const now = new Date();
  const pipelineStatusCounts = applicants.reduce((acc, applicant) => {
    const status = applicant.status || 'unknown';
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});

  const shortlistStatusCounts = shortlist.reduce((acc, item) => {
    const status = item.status || 'unknown';
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});

  const sourceCounts = analytics.reduce((acc, item) => {
    const source = toText(item.source || 'manual').toLowerCase();
    acc[source] = (acc[source] || 0) + 1;
    return acc;
  }, {});

  const metricRows = [
    ['Total Shortlisted', shortlist.length],
    ['Shortlist Rejected', shortlistStatusCounts.rejected || 0],
    ['Shortlist Moved to Pipeline', shortlistStatusCounts.moved_to_pipeline || 0],
    ['Total Pipeline Applicants', applicants.length],
    ['Pipeline Keep in View', pipelineStatusCounts.keep_in_view || 0],
    ['Pipeline Rejected', pipelineStatusCounts.rejected || 0],
    ['Pipeline Hired', pipelineStatusCounts.hired || 0],
    ['Stages Configured', stages.length],
    ['Interviews Logged', interviews.length]
  ];
  const metricMax = Math.max(...metricRows.map((row) => toNumber(row[1])), 1);

  const homeRows = [
    ['SMART HR - FULL JOB PIPELINE REPORT'],
    ['Generated At', toDate(now)],
    ['Job Title', toText(job.title)],
    ['Job ID', String(job._id)],
    ['Department', toText(job.department?.name)],
    ['Status', toText(job.status)],
    [''],
    ['METRIC', 'VALUE', 'VISUAL']
  ];

  metricRows.forEach(([label, value]) => {
    homeRows.push([label, value, percentBar(ratioPercent(value, metricMax), 14)]);
  });

  homeRows.push([''], ['PIPELINE STATUS DISTRIBUTION'], ['Status', 'Count', 'Share %', 'Visual']);
  Object.entries(pipelineStatusCounts)
    .sort((a, b) => toNumber(b[1]) - toNumber(a[1]))
    .forEach(([status, count]) => {
      const share = ratioPercent(count, applicants.length || 1);
      homeRows.push([statusLabel(status, 'pipeline'), count, `${share}%`, percentBar(share)]);
    });

  homeRows.push([''], ['SHORTLIST STATUS'], ['Status', 'Count', 'Share %', 'Visual']);
  Object.entries(shortlistStatusCounts)
    .sort((a, b) => toNumber(b[1]) - toNumber(a[1]))
    .forEach(([status, count]) => {
      const share = ratioPercent(count, shortlist.length || 1);
      homeRows.push([statusLabel(status, 'shortlist'), count, `${share}%`, percentBar(share)]);
    });

  homeRows.push([''], ['TOP CANDIDATES PREVIEW'], ['Rank', 'Candidate', 'Composite', 'Fit Band', 'Current Stage', 'Pipeline Status', 'Score Visual']);
  top.slice(0, 10).forEach((candidate, idx) => {
    const score = candidate.composite ?? null;
    homeRows.push([
      idx + 1,
      candidate.name,
      score ?? 'N/A',
      fitBand(score),
      candidate.currentStage || 'N/A',
      statusLabel(candidate.pipelineStatus, 'pipeline'),
      score === null ? '' : percentBar(score)
    ]);
  });

  homeRows.push([''], ['STAGE SNAPSHOT'], ['Stage', 'Current', 'Completed', 'Pass Rate', 'Avg Days', 'Pipeline Load', 'Load Visual']);
  stageMetrics.forEach((metric) => {
    const load = ratioPercent(metric.current, applicants.length || 1);
    homeRows.push([
      metric.stageName,
      metric.current,
      metric.completed,
      `${metric.passRate}%`,
      metric.avgDays,
      `${load}%`,
      percentBar(load)
    ]);
  });

  homeRows.push([''], ['PIPELINE HEALTH INFOGRAPHICS'], ['Status / Stage', 'Count', 'Visual']);
  Object.entries(pipelineStatusCounts)
    .sort((a, b) => toNumber(b[1]) - toNumber(a[1]))
    .forEach(([status, count]) => {
      const share = ratioPercent(count, applicants.length || 1);
      homeRows.push([`Pipeline: ${statusLabel(status, 'pipeline')}`, count, percentBar(share)]);
    });
  stageMetrics
    .sort((a, b) => b.current - a.current)
    .forEach((metric) => {
      const share = ratioPercent(metric.current, applicants.length || 1);
      homeRows.push([`Stage: ${metric.stageName}`, metric.current, percentBar(share)]);
    });

  const homeSheet = xlsx.utils.aoa_to_sheet(homeRows);
  setWidthsAndFilter(homeSheet, homeRows);
  styleHomeSheet(homeSheet, homeRows);
  xlsx.utils.book_append_sheet(workbook, homeSheet, safeSheetName('Home Overview', usedNames));

  const infographicRows = [
    ['PIPELINE VISUAL DASHBOARD'],
    ['Generated At', toDate(now)],
    [''],
    ['PIPELINE STATUS', 'COUNT', 'SHARE %', 'VISUAL']
  ];
  Object.entries(pipelineStatusCounts)
    .sort((a, b) => toNumber(b[1]) - toNumber(a[1]))
    .forEach(([status, count]) => {
      const share = ratioPercent(count, applicants.length || 1);
      infographicRows.push([statusLabel(status, 'pipeline'), count, `${share}%`, percentBar(share, 22)]);
    });

  infographicRows.push([''], ['SHORTLIST STATUS', 'COUNT', 'SHARE %', 'VISUAL']);
  Object.entries(shortlistStatusCounts)
    .sort((a, b) => toNumber(b[1]) - toNumber(a[1]))
    .forEach(([status, count]) => {
      const share = ratioPercent(count, shortlist.length || 1);
      infographicRows.push([statusLabel(status, 'shortlist'), count, `${share}%`, percentBar(share, 22)]);
    });

  infographicRows.push([''], ['SOURCE MIX', 'COUNT', 'SHARE %', 'VISUAL']);
  Object.entries(sourceCounts)
    .sort((a, b) => toNumber(b[1]) - toNumber(a[1]))
    .forEach(([source, count]) => {
      const share = ratioPercent(count, analytics.length || 1);
      infographicRows.push([source, count, `${share}%`, percentBar(share, 22)]);
    });

  infographicRows.push([''], ['STAGE LOAD MAP', 'CURRENT', 'PASS RATE', 'LOAD VISUAL']);
  stageMetrics
    .sort((a, b) => a.order - b.order)
    .forEach((metric) => {
      const load = ratioPercent(metric.current, applicants.length || 1);
      infographicRows.push([metric.stageName, metric.current, `${metric.passRate}%`, percentBar(load, 22)]);
    });

  const infographicSheet = xlsx.utils.aoa_to_sheet(infographicRows);
  setWidthsAndFilter(infographicSheet, infographicRows);
  styleHomeSheet(infographicSheet, infographicRows);
  xlsx.utils.book_append_sheet(workbook, infographicSheet, safeSheetName('Infographics', usedNames));

  const detailsRows = [
    ['JOB DETAILS'],
    ['Title', toText(job.title)],
    ['Department', toText(job.department?.name)],
    ['Location', toText(job.location)],
    ['Type', toText(job.type)],
    ['Level', toText(job.level)],
    ['Priority', toText(job.priority)],
    ['Remote', job.remote ? 'Yes' : 'No'],
    ['Status', toText(job.status)],
    ['Openings', toText(job.openings)],
    ['Salary', (job.salary?.min || job.salary?.max) ? `${job.salary?.currency || ''} ${job.salary?.min || 0} - ${job.salary?.max || 0} (${job.salary?.period || 'annually'})` : 'Not specified'],
    ['Experience Requirement', toText(job.experience)],
    ['Education Requirement', toText(job.education)],
    ['Application Deadline', toDate(job.applicationDeadline, false)],
    ['Start Date', toDate(job.startDate, false)],
    ['Created At', toDate(job.createdAt)],
    ['Hiring Manager', toName(job.hiringManager)],
    ['Recruiters', toText((job.recruiters || []).map(toName))],
    ['Interviewers', toText((job.interviewers || []).map(toName))],
    [''],
    ['Description', toText(job.description)],
    [''],
    ['Requirements', toText(job.requirements)],
    [''],
    ['Responsibilities', toText(job.responsibilities)],
    [''],
    ['Benefits', toText(job.benefits)],
  ];
  const detailsSheet = xlsx.utils.aoa_to_sheet(detailsRows);
  setWidthsAndFilter(detailsSheet, detailsRows);
  applyRowsByFirstCellMatch(detailsSheet, detailsRows, {
    equals: ['JOB DETAILS'],
    style: {
      font: { bold: true, sz: 13, color: { rgb: COLORS.white } },
      fill: { patternType: 'solid', fgColor: { rgb: COLORS.brandBlue } }
    }
  });
  applyRowsByFirstCellMatch(detailsSheet, detailsRows, {
    equals: ['Description', 'Requirements', 'Responsibilities', 'Benefits'],
    style: {
      font: { bold: true, color: { rgb: COLORS.brandBlue } },
      fill: { patternType: 'solid', fgColor: { rgb: COLORS.sectionBlue } }
    }
  });
  xlsx.utils.book_append_sheet(workbook, detailsSheet, safeSheetName('Job Details', usedNames));

  const shortlistRows = shortlist.map((s) => {
    const candidateId = String(s.candidate._id);
    const app = applicantByCandidate.get(candidateId);
    return {
      Candidate: toCandidateName(s.candidate),
      Email: toText(s.candidate.email),
      Phone: toText(s.candidate.phone),
      Position: toText(s.candidate.position),
      Source: toText(s.candidate.source || app?.applicationType || 'manual'),
      'Internal Candidate': s.candidate.isInternalCandidate ? 'Yes' : 'No',
      'Employee ID': toText(s.candidate.employeeId),
      'Shortlist Status': statusLabel(s.status, 'shortlist'),
      'Relevance Score (%)': s.relevanceScore !== undefined && s.relevanceScore !== null ? Math.round(Number(s.relevanceScore) * 100) : 'N/A',
      'Added At': toDate(s.addedAt),
      'Added By': toName(s.addedBy),
      'Moved To Pipeline At': toDate(s.movedToPipelineAt),
      'Pipeline Status': statusLabel(app?.status, 'pipeline'),
      'Pipeline Stage': toText(app?.currentStage?.stageName || 'N/A')
    };
  });
  const shortlistSheet = xlsx.utils.json_to_sheet(shortlistRows);
  setWidthsAndFilter(shortlistSheet, shortlistRows);
  applyDefaultHeaderRowStyle(shortlistSheet);
  xlsx.utils.book_append_sheet(workbook, shortlistSheet, safeSheetName('Shortlist', usedNames));

  const pipelineRows = applicants.map((a) => {
    const candidateId = String(a.candidate._id);
    const interviewList = interviewsByCandidate.get(candidateId) || [];
    const scores = interviewList.map(interviewScore).filter((v) => v !== null);
    const avg = scores.length ? Math.round(scores.reduce((sum, v) => sum + v, 0) / scores.length) : null;
    const candidateRank = analytics.findIndex((c) => c.candidateId === candidateId) + 1;
    return {
      Candidate: toCandidateName(a.candidate),
      Email: toText(a.candidate.email),
      'Application Type': toText(a.applicationType || a.candidate.source || 'manual'),
      'Pipeline Status': statusLabel(a.status, 'pipeline'),
      'Current Stage': toText(a.currentStage?.stageName || 'N/A'),
      'Current Stage Entered': toDate(a.currentStage?.enteredAt),
      'Days In Current Stage': durationDays(a.currentStage?.enteredAt),
      'Applied At': toDate(a.appliedAt),
      'Manual Score': normalizePercent(a.score) ?? 'N/A',
      'AI Confidence': normalizePercent(a.aiInsights?.confidence) ?? 'N/A',
      'AI Recommendation': toText(a.aiInsights?.recommendedAction || 'N/A'),
      Interviews: interviewList.length,
      'Interview Avg': avg ?? 'N/A',
      'Composite Score': analytics.find((c) => c.candidateId === candidateId)?.composite ?? 'N/A',
      'Candidate Rank': candidateRank > 0 ? candidateRank : 'N/A',
      'Stage Journey': (a.stageHistory || []).map((h) => h.stageName).filter(Boolean).join(' -> ')
    };
  });
  const pipelineSheet = xlsx.utils.json_to_sheet(pipelineRows);
  setWidthsAndFilter(pipelineSheet, pipelineRows);
  applyDefaultHeaderRowStyle(pipelineSheet);
  xlsx.utils.book_append_sheet(workbook, pipelineSheet, safeSheetName('Pipeline Summary', usedNames));

  const movementRows = [];
  applicants.forEach((a) => {
    (a.stageHistory || []).forEach((h, index) => {
      const stageId = String(h.stageId || '');
      const next = (a.stageHistory || [])[index + 1];
      movementRows.push({
        Candidate: toCandidateName(a.candidate),
        Email: toText(a.candidate.email),
        Stage: toText(h.stageName || stageMap.get(stageId)?.name),
        'Stage Order': stageMap.get(stageId)?.order ?? 'N/A',
        'Entered At': toDate(h.enteredAt),
        'Exited At': toDate(h.exitedAt),
        'Duration (Days)': durationDays(h.enteredAt, h.exitedAt || new Date()),
        Result: toText(h.result || 'In Progress'),
        Feedback: toText(h.feedback),
        'Moved To': toText(next?.stageName || ''),
        'Current Stage?': a.currentStage?.stageId && String(a.currentStage.stageId) === stageId ? 'Yes' : 'No',
        'Pipeline Status': statusLabel(a.status, 'pipeline')
      });
    });
  });
  const movementSheet = xlsx.utils.json_to_sheet(movementRows);
  setWidthsAndFilter(movementSheet, movementRows);
  applyDefaultHeaderRowStyle(movementSheet);
  xlsx.utils.book_append_sheet(workbook, movementSheet, safeSheetName('Stage Movement Log', usedNames));

  const statusRows = [];
  applicants.forEach((a) => {
    (a.statusHistory || []).forEach((h) => {
      statusRows.push({
        Candidate: toCandidateName(a.candidate),
        Email: toText(a.candidate.email),
        'Changed At': toDate(h.changedAt),
        'Previous Status': statusLabel(h.previousStatus, 'pipeline'),
        'New Status': statusLabel(h.status, 'pipeline'),
        'Changed By': toName(h.changedBy),
        Notes: toText(h.notes)
      });
    });
  });
  const statusSheet = xlsx.utils.json_to_sheet(statusRows);
  setWidthsAndFilter(statusSheet, statusRows);
  applyDefaultHeaderRowStyle(statusSheet);
  xlsx.utils.book_append_sheet(workbook, statusSheet, safeSheetName('Status History', usedNames));

  const interviewRows = interviews.map((i) => ({
    Candidate: toCandidateName(i.candidateId),
    Email: toText(i.candidateId?.email),
    Stage: toText(i.stageName || i.stageId?.name || 'N/A'),
    'Stage Order': i.stageOrder ?? i.stageId?.order ?? 'N/A',
    'Scheduled At': toDate(i.scheduledAt),
    Duration: i.duration ? `${i.duration} min` : '',
    Status: toText(i.status),
    Type: toText(i.type),
    Location: toText(i.location),
    'Meeting Link': toText(i.meetingLink),
    Interviewer: toName(i.interviewerId),
    'Overall Score': interviewScore(i) ?? 'N/A',
    Recommendation: toText(i.structuredFeedback?.recommendation || i.feedback?.recommendation || 'N/A')
  }));
  const interviewsSheet = xlsx.utils.json_to_sheet(interviewRows);
  setWidthsAndFilter(interviewsSheet, interviewRows);
  applyDefaultHeaderRowStyle(interviewsSheet);
  xlsx.utils.book_append_sheet(workbook, interviewsSheet, safeSheetName('Interviews', usedNames));

  const rejectedRows = [];
  const seenRejected = new Set();
  applicants.filter((a) => a.status === 'rejected').forEach((a) => {
    const candidateId = String(a.candidate._id);
    seenRejected.add(candidateId);
    const rejection = [...(a.statusHistory || [])].reverse().find((h) => h.status === 'rejected');
    const failedStage = [...(a.stageHistory || [])].reverse().find((h) => h.result === 'failed');
    rejectedRows.push({
      Candidate: toCandidateName(a.candidate),
      Email: toText(a.candidate.email),
      Source: 'Pipeline',
      'Rejected At': toDate(rejection?.changedAt || failedStage?.exitedAt),
      Stage: toText(failedStage?.stageName || a.currentStage?.stageName || 'N/A'),
      Reason: toText(rejection?.notes || failedStage?.feedback),
      'Composite Score': analytics.find((c) => c.candidateId === candidateId)?.composite ?? 'N/A'
    });
  });
  shortlist.filter((s) => s.status === 'rejected').forEach((s) => {
    const candidateId = String(s.candidate._id);
    if (seenRejected.has(candidateId)) return;
    rejectedRows.push({
      Candidate: toCandidateName(s.candidate),
      Email: toText(s.candidate.email),
      Source: 'Shortlist',
      'Rejected At': toDate(s.updatedAt || s.addedAt),
      Stage: 'Shortlist',
      Reason: '',
      'Composite Score': analytics.find((c) => c.candidateId === candidateId)?.composite ?? 'N/A'
    });
  });
  const rejectedSheet = xlsx.utils.json_to_sheet(rejectedRows);
  setWidthsAndFilter(rejectedSheet, rejectedRows);
  applyDefaultHeaderRowStyle(rejectedSheet);
  xlsx.utils.book_append_sheet(workbook, rejectedSheet, safeSheetName('Rejected', usedNames));

  const topRows = analytics
    .filter((a) => a.composite !== null)
    .slice(0, 50)
    .map((a, index) => ({
      Rank: index + 1,
      Candidate: a.name,
      Email: a.email,
      Position: a.position,
      Location: a.location,
      'Composite Score': a.composite,
      'Pipeline Score': a.pipelineScore ?? 'N/A',
      'Shortlist Score': a.shortlistScore ?? 'N/A',
      'Interview Avg': a.interviewAverage ?? 'N/A',
      'AI Confidence': a.aiConfidence ?? 'N/A',
      'Fit Band': fitBand(a.composite),
      'Score Visual': percentBar(a.composite, 14),
      'Current Stage': a.currentStage || 'N/A',
      'Pipeline Status': statusLabel(a.pipelineStatus, 'pipeline'),
      'AI Recommendation': a.aiRecommendation || 'N/A',
      'Stage Journey': a.stageJourney || 'N/A'
    }));
  const topSheet = xlsx.utils.json_to_sheet(topRows);
  setWidthsAndFilter(topSheet, topRows);
  applyDefaultHeaderRowStyle(topSheet);
  xlsx.utils.book_append_sheet(workbook, topSheet, safeSheetName('Top Candidates', usedNames));

  for (const stage of stages) {
    const stageId = String(stage._id);
    const stageRows = [
      [`STAGE REPORT - ${toText(stage.name)}`],
      ['Stage Order', toText(stage.order)],
      ['Stage Type', toText(stage.type)],
      ['Current Candidates', stageMetrics.find((m) => m.stageId === stageId)?.current || 0],
      ['Pass Rate', `${stageMetrics.find((m) => m.stageId === stageId)?.passRate || 0}%`],
      ['Pass Rate Visual', percentBar(stageMetrics.find((m) => m.stageId === stageId)?.passRate || 0, 20)],
      [''],
      ['Candidate', 'Email', 'Current Stage', 'In Stage Now', 'Entered At', 'Exited At', 'Duration (Days)', 'Result', 'Feedback', 'Pipeline Status']
    ];

    const entries = applicants.flatMap((a) =>
      (a.stageHistory || [])
        .filter((h) => String(h.stageId || '') === stageId)
        .map((h) => ({
          candidate: toCandidateName(a.candidate),
          email: a.candidate.email || '',
          currentStage: a.currentStage?.stageName || 'N/A',
          inStageNow: a.currentStage?.stageId && String(a.currentStage.stageId) === stageId ? 'Yes' : 'No',
          enteredAt: toDate(h.enteredAt),
          exitedAt: toDate(h.exitedAt),
          duration: durationDays(h.enteredAt, h.exitedAt || new Date()),
          result: toText(h.result || 'In Progress'),
          feedback: toText(h.feedback),
          pipelineStatus: statusLabel(a.status, 'pipeline')
        }))
    );

    if (!entries.length) {
      stageRows.push(['No candidates have entered this stage yet.']);
    } else {
      entries.forEach((e) => {
        stageRows.push([e.candidate, e.email, e.currentStage, e.inStageNow, e.enteredAt, e.exitedAt, e.duration, e.result, e.feedback, e.pipelineStatus]);
      });
    }

    const sheet = xlsx.utils.aoa_to_sheet(stageRows);
    setWidthsAndFilter(sheet, stageRows);
    applyRowsByFirstCellMatch(sheet, stageRows, {
      startsWith: ['STAGE REPORT - '],
      style: {
        font: { bold: true, sz: 12, color: { rgb: COLORS.white } },
        fill: { patternType: 'solid', fgColor: { rgb: COLORS.brandBlue } }
      }
    });
    applyRowsByFirstCellMatch(sheet, stageRows, {
      equals: ['Candidate'],
      style: {
        font: { bold: true, color: { rgb: COLORS.white } },
        fill: { patternType: 'solid', fgColor: { rgb: COLORS.brandIndigo } }
      }
    });
    xlsx.utils.book_append_sheet(workbook, sheet, safeSheetName(`Stage ${stage.order} - ${stage.name}`, usedNames));
  }

  const slug = toText(job.title).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'job';
  const datePart = new Date().toISOString().split('T')[0];
  const fileName = `${slug}_pipeline_full_report_${datePart}.xlsx`;
  const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx', cellStyles: true });

  return { buffer, fileName, workbookMeta: { sheets: workbook.SheetNames.length } };
}

module.exports = {
  buildDetailedPipelineWorkbook
};

