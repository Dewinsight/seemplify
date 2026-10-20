'use strict';
const crypto = require('node:crypto');
const Job = require('../models/AppraisalAIReport');
const Appraisal = require('../models/Appraisal');
const FINAL = ['completed', 'employee_acknowledged'];
const scope = appraisal => ({ appraisalId: appraisal._id, organizationId: String(appraisal.organizationId) });

async function evidence(appraisal) {
  const source = await require('./appraisalAnalysisEvidenceService').collect(appraisal, { shared: true });
  const manifest = source.coverage.sources;
  const meetings = manifest.filter(item => item.category === 'meetings');
  const missing = meetings.filter(item => item.state === 'transcript_missing');
  return { ...source, coverage: { ...source.coverage, meetings: meetings.length, transcripts: meetings.length - missing.length,
    missingTranscripts: missing.map(item => item.title), missingTranscriptMeetings: missing.map(item => ({ id: item.id.slice('meetings:'.length), title: item.title })),
    documents: source.coverage.counts.documents || 0, pendingDocuments: manifest.filter(item => item.category === 'documents' && item.state === 'pending').length,
    roleResults: source.coverage.counts.role_assessment || 0, excerptedCategories: [...new Set(manifest.filter(item => item.includedCharacters < item.characters).map(item => item.category))] } };
}

async function queue(appraisal, identity) {
  if (!FINAL.includes(appraisal.status)) throw Object.assign(new Error('Complete the appraisal before generating its final AI report.'), { statusCode: 409 });
  if (!identity?.sub || !identity?.email) throw Object.assign(new Error('Connect your personal ChatGPT account to generate this report.'), { statusCode: 401 });
  if (identity.organizationId && String(identity.organizationId) !== String(appraisal.organizationId)) throw Object.assign(new Error('The report must use your current organization.'), { statusCode: 403 });
  if (appraisal.cycleId?.settings?.enableAiAssist === false) throw Object.assign(new Error('AI assistance is disabled for this cycle.'), { statusCode: 409 });
  const existing = await Job.findOne(scope(appraisal));
  if (existing?.state === 'pending' || (existing?.state === 'processing' && existing.leaseUntil > new Date())) return existing;
  return Job.findOneAndUpdate(scope(appraisal), { $set: { state: 'pending', identity, attempts: 0, nextAttemptAt: new Date() },
    $inc: { revision: 1 }, $unset: { leaseUntil: 1, leaseToken: 1, errorCode: 1, sourceHash: 1 } }, { upsert: true, new: true });
}

async function invalidate(appraisalId, organizationId) {
  if (!appraisalId) return;
  await require('./appraisalCurrentAssessmentService').invalidate(appraisalId, organizationId);
  await Job.updateOne({ appraisalId, organizationId: String(organizationId) }, { $set: { state: 'pending', attempts: 0, nextAttemptAt: new Date() }, $inc: { revision: 1 }, $unset: { leaseUntil: 1, leaseToken: 1 } });
}

async function view(appraisal) {
  const job = await Job.findOne(scope(appraisal)).lean();
  const current = await evidence(appraisal);
  if (!job) return { state: 'not_generated', coverage: current.coverage };
  const state = job.state === 'ready' && job.sourceHash !== current.sourceHash ? 'stale' : job.state;
  return { state, content: state === 'ready' ? job.content : undefined, generatedAt: job.generatedAt, model: job.model,
    coverage: state === 'ready' ? job.coverage : current.coverage, errorCode: job.errorCode,
    retryScheduled: state === 'failed' && job.attempts < 3 };
}

async function processDue() {
  await Job.updateMany({ state: 'processing', attempts: { $gte: 3 }, leaseUntil: { $lt: new Date() } }, { $set: { state: 'failed', errorCode: 'REPORT_WORKER_INTERRUPTED' }, $unset: { leaseUntil: 1, leaseToken: 1 } });
  for (let count = 0; count < 2; count++) {
    const now = new Date(), token = crypto.randomUUID();
    const job = await Job.findOneAndUpdate({ attempts: { $lt: 3 }, $or: [
      { state: { $in: ['pending', 'failed'] }, nextAttemptAt: { $lte: now } },
      { state: 'processing', leaseUntil: { $lt: now } }
    ] }, { $set: { state: 'processing', leaseUntil: new Date(Date.now() + 600000), leaseToken: token }, $inc: { attempts: 1 } }, { new: true, sort: { nextAttemptAt: 1 } }).select('+identity');
    if (!job) break;
    const fence = { _id: job._id, revision: job.revision, leaseToken: token };
    try {
      const appraisal = await Appraisal.findOne({ _id: job.appraisalId, organizationId: job.organizationId, status: { $in: FINAL } }).populate({ path: 'cycleId', match: { organizationId: job.organizationId } });
      if (!appraisal) throw Object.assign(new Error('Appraisal is no longer published.'), { code: 'APPRAISAL_UNAVAILABLE' });
      if (appraisal.cycleId?.settings?.enableAiAssist === false) throw Object.assign(new Error('AI is disabled.'), { code: 'AI_DISABLED' });
      const source = await evidence(appraisal);
      if (job.content && job.sourceHash === source.sourceHash) {
        await Job.updateOne(fence, { $set: { state: 'ready' }, $unset: { leaseUntil: 1, leaseToken: 1, errorCode: 1 } });
        continue;
      }
      const deep = require('./deepAppraisalAIService');
      const response = await deep.generate(job.identity, [
        { role: 'system', content: `${deep.SYSTEM} This is the final published appraisal report shared with the employee and reviewer. Preserve its human final rating exactly.` },
        { role: 'user', content: `Evidence coverage:\n${JSON.stringify(source.coverage)}\n\n${source.text}` }
      ]);
      const content = response.choices?.[0]?.message?.content?.trim();
      if (!content) throw Object.assign(new Error('The AI report was empty.'), { code: 'AI_REPORT_EMPTY' });
      // Do not publish old evidence if a transcript, permissions or outcome
      // changed while the external AI request was running.
      const fresh = await Appraisal.findOne({ _id: appraisal._id, organizationId: appraisal.organizationId, status: { $in: FINAL } }).populate({ path: 'cycleId', match: { organizationId: job.organizationId } });
      if (!fresh || (await evidence(fresh)).sourceHash !== source.sourceHash) {
        await Job.updateOne(fence, { $set: { state: 'pending', attempts: 0, nextAttemptAt: new Date() }, $unset: { leaseUntil: 1, leaseToken: 1 } });
        continue;
      }
      await Job.updateOne(fence, { $set: { state: 'ready', content: content.slice(0, 40000), sourceHash: source.sourceHash, coverage: source.coverage,
        generatedAt: new Date(), model: String(response.model || 'unknown') }, $unset: { leaseUntil: 1, leaseToken: 1, errorCode: 1 } });
    } catch (error) {
      await Job.updateOne(fence, { $set: { state: 'failed', errorCode: String(error.code || 'AI_REPORT_FAILED').slice(0, 100), nextAttemptAt: new Date(Date.now() + 300000) }, $unset: { leaseUntil: 1, leaseToken: 1 } });
    }
  }
}
function start() {
  let running = false;
  const tick = async () => { if (running) return; running = true; try { await processDue(); } catch { console.error('Final appraisal report worker failed; retrying next interval.'); } finally { running = false; } };
  const timer = setInterval(() => void tick(), 30000); timer.unref(); void tick(); return timer;
}
module.exports = { evidence, queue, invalidate, view, processDue, start };
