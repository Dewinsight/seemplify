'use strict';
const crypto = require('node:crypto');
const Job = require('../models/AppraisalCurrentAssessment');
const Appraisal = require('../models/Appraisal');
const evidence = require('./appraisalAnalysisEvidenceService');
const deep = require('./deepAppraisalAIService');
const scope = (appraisal, identity) => ({ organizationId: String(appraisal.organizationId), appraisalId: appraisal._id, userId: identity.sub });
const active = job => job?.state === 'processing' && job.leaseUntil > new Date();

async function view(appraisal, identity, profile) {
  const [job, source] = await Promise.all([Job.findOne(scope(appraisal, identity)).lean(), evidence.collect(appraisal, profile)]);
  const matches = job?.sourceHash === source.sourceHash;
  const retained = evidence.retainedSnapshot(job?.coverage, source.coverage);
  return { state: job ? (job.state === 'ready' && !matches ? 'stale' : job.state) : 'not_generated', enabled: Boolean(job?.enabled),
    content: matches || retained ? job?.content : undefined, isCurrent: matches, generatedAt: job?.generatedAt, model: job?.model, reasoningEffort: job?.reasoningEffort,
    requestedModel: deep.MODEL, requestedReasoningEffort: deep.EFFORT, coverage: source.coverage, observedHash: source.sourceHash,
    errorCode: job?.errorCode, history: (job?.history || []).map(item => ({ number: item.number, generatedAt: item.generatedAt, phase: item.phase, model: item.model, counts: item.counts })),
    phase: appraisal.status, cancelled: appraisal.status === 'cancelled' };
}
async function start(appraisal, identity, profile, { force = false } = {}) {
  if (!identity?.sub || !identity?.email || (identity.organizationId && identity.organizationId !== String(appraisal.organizationId))) throw Object.assign(new Error('Sign in with your personal account in this organization.'), { statusCode: 403 });
  if (appraisal.status === 'cancelled') throw Object.assign(new Error('This appraisal was cancelled. Its assessment is read-only.'), { statusCode: 409 });
  if (appraisal.cycleId?.settings?.enableAiAssist === false) throw Object.assign(new Error('AI assistance is disabled for this cycle.'), { statusCode: 409 });
  const current = await Job.findOne(scope(appraisal, identity));
  if (active(current)) return current;
  return Job.findOneAndUpdate(scope(appraisal, identity), { $set: { enabled: true, state: 'pending', identity, profile, attempts: 0, nextCheckAt: new Date() },
    $inc: { revision: 1 }, $unset: { leaseUntil: 1, leaseToken: 1, errorCode: 1, ...(force ? { sourceHash: 1 } : {}) } }, { upsert: true, new: true });
}
async function pause(appraisal, identity) {
  await Job.updateOne(scope(appraisal, identity), { $set: { enabled: false, state: 'paused' }, $inc: { revision: 1 }, $unset: { leaseUntil: 1, leaseToken: 1 } });
}
async function invalidate(appraisalId, organizationId) {
  if (!appraisalId) return;
  await Job.updateMany({ appraisalId, organizationId: String(organizationId), enabled: true, state: { $ne: 'processing' } }, { $set: { nextCheckAt: new Date() } });
}
async function processOne() {
  const job = await Job.findOneAndUpdate({ enabled: true, attempts: { $lt: 3 }, nextCheckAt: { $lte: new Date() },
    $or: [{ state: { $in: ['pending', 'ready', 'failed'] } }, { state: 'processing', leaseUntil: { $lt: new Date() } }] },
  { $set: { state: 'processing', leaseUntil: new Date(Date.now() + 600000), leaseToken: crypto.randomUUID() }, $inc: { attempts: 1 } }, { new: true, sort: { nextCheckAt: 1 } }).select('+identity +profile');
  if (!job) return;
  const fence = { _id: job._id, revision: job.revision, leaseToken: job.leaseToken, enabled: true };
  try {
    const appraisal = await Appraisal.findOne({ _id: job.appraisalId, organizationId: job.organizationId, status: { $ne: 'cancelled' } }).populate({ path: 'cycleId', match: { organizationId: job.organizationId } });
    if (!appraisal) throw Object.assign(new Error('Appraisal unavailable.'), { code: 'APPRAISAL_UNAVAILABLE' });
    if (appraisal.cycleId?.settings?.enableAiAssist === false) throw Object.assign(new Error('AI disabled.'), { code: 'AI_DISABLED' });
    const source = await evidence.collect(appraisal, job.profile);
    const finishCheck = () => Job.updateOne(fence, { $set: { state: 'ready', attempts: 0, nextCheckAt: new Date(Date.now() + 60000) }, $unset: { leaseUntil: 1, leaseToken: 1, errorCode: 1 } });
    if (source.sourceHash === job.sourceHash && job.content) { await finishCheck(); return; }
    // Coalesce saves during an AI conversation rather than generating at every keystroke.
    if (job.generatedAt && Date.now() - job.generatedAt.getTime() < 180000 && job.sourceHash) {
      await Job.updateOne(fence, { $set: { state: 'pending', attempts: 0, nextCheckAt: new Date(job.generatedAt.getTime() + 180000) }, $unset: { leaseUntil: 1, leaseToken: 1 } }); return;
    }
    const previous = new Map((job.coverage?.sources || []).map(item => [item.id, item]));
    const reference = item => ({ ref: item.ref, title: item.title, category: item.category });
    const present = new Set(source.coverage.sources.map(item => item.id));
    const changes = { added: source.coverage.sources.filter(item => !previous.has(item.id)).map(reference),
      changed: source.coverage.sources.filter(item => previous.has(item.id) && previous.get(item.id).sha256 !== item.sha256).map(reference),
      removedCategories: [...previous.values()].filter(item => !present.has(item.id)).map(item => item.category) };
    const response = await deep.generate(job.identity, [{ role: 'system', content: deep.SYSTEM }, { role: 'user', content: `Current phase: ${appraisal.status}\nEvidence coverage: ${JSON.stringify(source.coverage)}\nEvidence changes since the last assessment (changes in evidence are not proof of changes in performance): ${JSON.stringify(changes)}\n\n${source.text}` }]);
    const content = response.choices?.[0]?.message?.content?.trim();
    if (!content) throw Object.assign(new Error('Empty assessment.'), { code: 'AI_ASSESSMENT_EMPTY' });
    const fresh = await Appraisal.findOne({ _id: appraisal._id, organizationId: appraisal.organizationId, status: { $ne: 'cancelled' } });
    const freshSource = fresh ? await evidence.collect(fresh, job.profile) : null;
    if (!freshSource || (freshSource.sourceHash !== source.sourceHash && !evidence.retainedSnapshot(source.coverage, freshSource.coverage))) {
      await Job.updateOne(fence, { $set: { state: 'pending', nextCheckAt: new Date() }, $unset: { leaseUntil: 1, leaseToken: 1 } }); return;
    }
    const number = (job.history?.at(-1)?.number || 0) + 1;
    await Job.updateOne(fence, { $set: { state: 'ready', attempts: 0, content: content.slice(0, 60000), sourceHash: source.sourceHash, generatedAt: new Date(),
      phase: appraisal.status, coverage: source.coverage, model: response.model, reasoningEffort: deep.EFFORT, nextCheckAt: new Date(Date.now() + 60000) },
    $push: { history: { $each: [{ number, generatedAt: new Date(), phase: appraisal.status, model: response.model, counts: source.coverage.counts }], $slice: -10 } },
    $unset: { leaseUntil: 1, leaseToken: 1, errorCode: 1 } });
  } catch (error) {
    await Job.updateOne(fence, { $set: { state: 'failed', errorCode: String(error.code || 'AI_ASSESSMENT_FAILED').slice(0, 100), nextCheckAt: new Date(Date.now() + 300000) },
      $unset: { leaseUntil: 1, leaseToken: 1 } });
  }
}
async function processDue() {
  await Job.updateMany({ state: 'processing', attempts: { $gte: 3 }, leaseUntil: { $lt: new Date() } }, { $set: { state: 'failed', errorCode: 'ASSESSMENT_WORKER_INTERRUPTED' }, $unset: { leaseUntil: 1, leaseToken: 1 } });
  await Promise.allSettled([processOne(), processOne()]);
}
function worker() {
  let running = false;
  const tick = async () => { if (running) return; running = true; try { await processDue(); } finally { running = false; } };
  const timer = setInterval(() => void tick(), 30000); timer.unref(); return timer;
}
module.exports = { view, start, pause, invalidate, processDue, worker };
