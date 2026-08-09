/* eslint-disable no-console */
require('dotenv').config();
const crypto = require('crypto');
const mongoose = require('mongoose');
const OKR = require('../models/OKR');
const GoalPeriod = require('../models/GoalPeriod');
const Appraisal = require('../models/Appraisal');
const AppraisalCycle = require('../models/AppraisalCycle');
const ReviewCycle = require('../models/ReviewCycle');
const { PerformanceReview } = require('../models/PerformanceReview');
const User = require('../models/User');
const { buildGoalSnapshots, parseLegacyPeriod } = require('../services/appraisalGoalSnapshotService');

const APPLY = process.argv.includes('--apply');

function safeCode(value) {
  const base = String(value || 'custom').toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32);
  const hash = crypto.createHash('sha1').update(String(value || 'custom')).digest('hex').slice(0, 8);
  return `${base || 'CUSTOM'}-${hash}`;
}

function customPeriod(label, referenceDate) {
  const reference = referenceDate ? new Date(referenceDate) : new Date();
  const year = Number.isNaN(reference.getTime()) ? new Date().getUTCFullYear() : reference.getUTCFullYear();
  return {
    label: String(label || 'Legacy custom period'),
    startDate: new Date(Date.UTC(year, 0, 1)),
    endDate: new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999))
  };
}

async function migrateGoalPeriods(report) {
  const goals = await OKR.find({ periodId: null }).select('_id organizationId period createdAt').lean();
  const cache = new Map();
  for (const goal of goals) {
    const organizationId = String(goal.organizationId || '');
    if (!organizationId) {
      report.skippedGoals += 1;
      continue;
    }
    const label = String(goal.period || '').trim() || 'Legacy custom period';
    const key = `${organizationId}:${label}`;
    let period = cache.get(key);
    if (!period) {
      const parsed = parseLegacyPeriod(label) || customPeriod(label, goal.createdAt);
      const quarter = /^Q([1-4])\s+(\d{4})$/i.exec(label);
      const code = quarter ? `FY${quarter[2]}-Q${quarter[1]}` : safeCode(label);
      period = await GoalPeriod.findOne({ organizationId, code });
      if (!period && APPLY) {
        period = await GoalPeriod.create({
          organizationId,
          name: parsed.label || label,
          code,
          type: quarter ? 'fiscal_quarter' : 'custom',
          fiscalYear: quarter ? Number(quarter[2]) : undefined,
          fiscalQuarter: quarter ? Number(quarter[1]) : undefined,
          fiscalYearStartMonth: quarter ? 1 : undefined,
          startDate: parsed.startDate,
          endDate: parsed.endDate,
          status: parsed.endDate < new Date() ? 'closed' : (parsed.startDate > new Date() ? 'upcoming' : 'open'),
          timezone: 'UTC',
          createdBy: { userId: 'migration', name: 'Performance migration', role: 'system' },
          updatedBy: { userId: 'migration', name: 'Performance migration', role: 'system' }
        });
        report.createdPeriods += 1;
      }
      cache.set(key, period || { _id: null, name: parsed.label || label });
    }
    if (APPLY) {
      await OKR.updateOne(
        { _id: goal._id, organizationId },
        {
          $set: {
            ...(period?._id ? { periodId: period._id } : {}),
            creationSource: 'legacy'
          }
        }
      );
    }
    report.migratedGoals += 1;
  }
}

function cycleStatus(status) {
  if (status === 'closed') return 'completed';
  if (['active', 'calibration'].includes(status)) return 'active';
  return 'draft';
}

function appraisalStatus(review) {
  if (review.status === 'completed') return 'completed';
  if (review.managerEvaluation?.submittedAt) return 'manager_review_submitted';
  if (review.selfEvaluation?.submittedAt || review.status === 'submitted') return 'manager_review_pending';
  return review.selfEvaluation?.content ? 'self_assessment_in_progress' : 'self_assessment_pending';
}

async function identity(userId) {
  const value = String(userId || '');
  const filters = [{ idpSub: value }, { email: value.toLowerCase() }];
  if (mongoose.isValidObjectId(value)) filters.push({ _id: value });
  const user = await User.findOne({ $or: filters }).select('email profile').lean();
  const name = user?.profile?.displayName || [user?.profile?.firstName, user?.profile?.lastName].filter(Boolean).join(' ');
  return {
    userId: value,
    name: name || `Legacy user ${value.slice(-6)}`,
    email: user?.email || `${value.replace(/[^a-zA-Z0-9]/g, '').slice(-24) || 'unknown'}@legacy.invalid`
  };
}

async function migrateLegacyReviews(report) {
  const legacyCycles = await ReviewCycle.find({}).lean();
  for (const legacy of legacyCycles) {
    let cycle = await AppraisalCycle.findOne({ 'migration.legacyReviewCycleId': legacy._id });
    if (!cycle && APPLY) {
      const selfStart = legacy.phases?.selfReviewStart || legacy.startDate;
      const selfEnd = legacy.phases?.selfReviewEnd || legacy.endDate;
      const managerStart = legacy.phases?.managerReviewStart || selfEnd;
      const managerEnd = legacy.phases?.managerReviewEnd || legacy.endDate;
      cycle = await AppraisalCycle.create({
        name: legacy.title,
        description: legacy.description,
        organizationId: legacy.organizationId,
        cycleType: 'adhoc',
        periodStart: legacy.startDate,
        periodEnd: legacy.endDate,
        phases: {
          selfAssessment: { startDate: selfStart, endDate: selfEnd },
          managerReview: { startDate: managerStart, endDate: managerEnd },
          ...(legacy.phases?.calibrationStart ? {
            calibration: { startDate: legacy.phases.calibrationStart, endDate: legacy.phases.calibrationEnd || legacy.endDate }
          } : {}),
          finalReview: { startDate: managerEnd, endDate: legacy.endDate }
        },
        currentPhase: legacy.status === 'closed' ? 'completed' : 'draft',
        status: cycleStatus(legacy.status),
        okrWeight: legacy.settings?.includeOKRProgress === false ? 0 : 40,
        settings: {
          enablePeerFeedback: Boolean(legacy.settings?.requirePeerReview),
          enable360Feedback: legacy.type === '360',
          enableAiAssist: true,
          enableChat: true,
          requireSignOff: true
        },
        createdBy: { userId: legacy.createdBy, name: 'Legacy cycle owner' },
        migration: { legacyReviewCycleId: legacy._id, migratedAt: new Date() }
      });
      report.createdCycles += 1;
    }
    if (!cycle) {
      report.wouldCreateCycles += 1;
      continue;
    }

    const reviews = await PerformanceReview.find({ cycleId: legacy._id }).lean();
    for (const review of reviews) {
      const existing = await Appraisal.findOne({ 'migration.legacyPerformanceReviewId': review._id });
      if (existing) {
        report.existingAppraisals += 1;
        continue;
      }
      const [employee, manager] = await Promise.all([identity(review.userId), identity(review.managerId)]);
      if (APPLY) {
        const status = appraisalStatus(review);
        const finalRating = review.status === 'completed' && Number.isFinite(Number(review.managerEvaluation?.rating))
          ? {
            overall: Number(review.managerEvaluation.rating),
            ratingLabel: 'Migrated rating',
            justification: 'Migrated from the legacy performance review engine.',
            finalizedAt: review.managerEvaluation?.submittedAt || new Date(),
            finalizedBy: { userId: manager.userId, name: manager.name }
          }
          : undefined;
        await Appraisal.create({
          cycleId: cycle._id,
          organizationId: legacy.organizationId,
          employee,
          manager,
          status,
          selfAssessment: {
            overallSummary: { achievements: review.selfEvaluation?.content || '' },
            overallSelfRating: review.selfEvaluation?.rating,
            submittedAt: review.selfEvaluation?.submittedAt
          },
          managerReview: {
            overallSummary: { achievements: review.managerEvaluation?.content || '' },
            overallManagerRating: review.managerEvaluation?.rating,
            submittedAt: review.managerEvaluation?.submittedAt
          },
          finalRating,
          migration: { legacyPerformanceReviewId: review._id, migratedAt: new Date() }
        });
      }
      report.createdAppraisals += 1;
    }
  }
}

async function backfillSnapshots(report) {
  const appraisals = await Appraisal.find({
    $or: [{ goalSnapshots: { $exists: false } }, { goalSnapshots: { $size: 0 } }],
    status: { $nin: ['cancelled'] }
  }).populate('cycleId');
  for (const appraisal of appraisals) {
    if (!appraisal.cycleId) {
      report.skippedSnapshots += 1;
      continue;
    }
    try {
      const snapshot = await buildGoalSnapshots({
        organizationId: appraisal.organizationId,
        employeeId: appraisal.employee.userId,
        cycle: appraisal.cycleId
      });
      if (APPLY) {
        appraisal.goals = snapshot.goalIds;
        appraisal.goalSnapshots = snapshot.snapshots.map((item) => ({ ...item, legacySnapshot: true }));
        appraisal.goalEvidenceSummary = snapshot.evidenceSummary;
        appraisal.addAuditLog('legacy_goal_snapshots_backfilled', {
          id: 'migration',
          name: 'Performance migration',
          role: 'system'
        }, { snapshotCount: snapshot.snapshots.length });
        await appraisal.save();
      }
      report.backfilledSnapshots += 1;
    } catch (error) {
      report.skippedSnapshots += 1;
      report.warnings.push(`Snapshot ${appraisal._id}: ${error.message}`);
    }
  }
}

async function main() {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) throw new Error('MONGO_URI is required');
  await mongoose.connect(mongoUri);
  const report = {
    mode: APPLY ? 'apply' : 'dry-run',
    createdPeriods: 0,
    migratedGoals: 0,
    skippedGoals: 0,
    createdCycles: 0,
    wouldCreateCycles: 0,
    createdAppraisals: 0,
    existingAppraisals: 0,
    backfilledSnapshots: 0,
    skippedSnapshots: 0,
    warnings: []
  };
  await migrateGoalPeriods(report);
  await migrateLegacyReviews(report);
  await backfillSnapshots(report);
  console.log(JSON.stringify(report, null, 2));
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
