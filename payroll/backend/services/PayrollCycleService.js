const crypto = require('crypto');
const PayrollCycle = require('../models/PayrollCycle');
const PayrollRun = require('../models/PayrollRun');
const PayrollApprovalPolicy = require('../models/PayrollApprovalPolicy');
const PayrollProfile = require('../models/PayrollProfile');
const PayrollSequence = require('../models/PayrollSequence');
const PayrollDelivery = require('../models/PayrollDelivery');
const PayrollArtifact = require('../models/PayrollArtifact');
const PayrollEngineService = require('./PayrollEngineService');
const employerEntityService = require('./PayrollEmployerEntityService');
const organizationCurrencyService = require('./OrganizationCurrencyService');
const currencyService = require('./CurrencyService');
const payrollFinalizationService = require('./PayrollFinalizationService');
const payrollRetractionService = require('./PayrollRetractionService');
const { queuePayrollReadyEvent } = require('./automationEventService');

function cycleError(message, statusCode = 400, code = 'PAYROLL_CYCLE_INVALID', details) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  if (details) error.details = details;
  return error;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = stableValue(value[key]);
      return result;
    }, {});
  }
  return value;
}

function hash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex');
}

function periodFromInput(input = {}) {
  const month = Number(input.month);
  const year = Number(input.year);
  if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || year < 2000 || year > 2200) {
    throw cycleError('Month must be 1 to 12 and year must be 2000 to 2200.', 400, 'PAYROLL_CYCLE_PERIOD_INVALID');
  }
  const startDate = new Date(Date.UTC(year, month - 1, 1));
  const endDate = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
  const paymentDate = input.paymentDate ? new Date(input.paymentDate) : endDate;
  if (Number.isNaN(paymentDate.getTime())) throw cycleError('Payment date is invalid.', 400, 'PAYROLL_CYCLE_PAYMENT_DATE_INVALID');
  return { type: 'monthly', month, year, startDate, endDate, paymentDate };
}

function runTotals(run) {
  const summary = run?.summary || {};
  return {
    runId: String(run?._id || ''),
    revision: Number(run?.calculationRevision || 1),
    currency: summary.currency || run?.employerEntitySnapshot?.currency || '',
    employees: Number(summary.processedCount || 0),
    gross: Number(summary.totalGrossPayroll || 0),
    deductions: Number(summary.totalDeductions || 0),
    net: Number(summary.totalNetPayroll || 0),
    employerCost: Number(summary.totalEmployerCost || 0),
    errors: Number(summary.errorCount || 0),
  };
}

class PayrollCycleService {
  constructor(dependencies = {}) {
    this.PayrollCycle = dependencies.PayrollCycle || PayrollCycle;
    this.PayrollRun = dependencies.PayrollRun || PayrollRun;
    this.PayrollApprovalPolicy = dependencies.PayrollApprovalPolicy || PayrollApprovalPolicy;
    this.PayrollProfile = dependencies.PayrollProfile || PayrollProfile;
    this.engine = dependencies.engine || new PayrollEngineService();
    this.employers = dependencies.employers || employerEntityService;
    this.currency = dependencies.currency || organizationCurrencyService;
    this.exchange = dependencies.exchange || currencyService;
    this.finalization = dependencies.finalization || payrollFinalizationService;
    this.retraction = dependencies.retraction || payrollRetractionService;
    this.PayrollDelivery = dependencies.PayrollDelivery || PayrollDelivery;
    this.PayrollArtifact = dependencies.PayrollArtifact || PayrollArtifact;
  }

  async getPolicy(organizationId, requestedId, actor = {}, employerEntityIds = []) {
    if (requestedId) {
      const selected = await this.PayrollApprovalPolicy.findOne({ _id: requestedId, organizationId, active: true });
      if (!selected) throw cycleError('Approval policy not found.', 404, 'PAYROLL_APPROVAL_POLICY_NOT_FOUND');
      return selected;
    }
    let policy = null;
    if (employerEntityIds.length === 1) {
      policy = await this.PayrollApprovalPolicy.findOne({ organizationId, employerEntityId: employerEntityIds[0], active: true });
    }
    if (!policy) policy = await this.PayrollApprovalPolicy.findOne({ organizationId, isDefault: true, active: true, employerEntityId: null });
    if (!policy) {
      policy = await this.PayrollApprovalPolicy.create({
        organizationId,
        name: 'Default payroll approval',
        isDefault: true,
        requireSeparationOfDuties: true,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      });
    }
    return policy;
  }

  async preflight({ organizationId, employerEntityIds, month, year, paymentDate, reportingCurrency, workInputsByEmployer = {} }) {
    const period = periodFromInput({ month, year, paymentDate });
    const ids = [...new Set((employerEntityIds || []).map(String).filter(Boolean))];
    if (!ids.length) throw cycleError('Select at least one legal employer.', 422, 'PAYROLL_CYCLE_EMPLOYERS_REQUIRED');
    const targetReportingCurrency = reportingCurrency
      ? await this.currency.assertReportingCurrency(organizationId, reportingCurrency)
      : null;
    const entities = [];
    for (const id of ids) {
      try {
        const context = await this.employers.assertRunEntity(id, organizationId, period.paymentDate);
        const duplicate = await this.PayrollRun.existsForPeriod(organizationId, period.year, period.month, {
          type: 'monthly', employerEntityId: id,
        });
        const assignedProfiles = await this.PayrollProfile.find({ organizationId, employerEntityId: id, isActive: true })
          .select('userId workTerms payrollFlags').lean();
        const eligibleProfiles = assignedProfiles.filter(profile => profile.payrollFlags?.excludeFromNextRun !== true && profile.payrollFlags?.holdPayment !== true);
        const suppliedInputs = new Map((workInputsByEmployer?.[id] || []).map(value => [String(value?.userId || ''), value]));
        const missingVariableInputs = eligibleProfiles.filter(profile => {
          const basis = profile.workTerms?.payBasis;
          const supplied = suppliedInputs.get(String(profile.userId));
          return (basis === 'hourly' && !(Number(supplied?.regularHours) > 0))
            || (basis === 'daily' && !(Number(supplied?.daysWorked) > 0));
        }).map(profile => ({ userId: profile.userId, payBasis: profile.workTerms?.payBasis }));
        const blockers = [...(context.readiness.blockingIssues || [])];
        if (duplicate) blockers.push('An active payroll run already exists for this employer and period.');
        if (missingVariableInputs.length) blockers.push(`${missingVariableInputs.length} variable-paid worker(s) require approved period inputs.`);
        const warnings = [...(context.readiness.warnings || [])];
        if (targetReportingCurrency && targetReportingCurrency !== context.entity.defaultCurrency) {
          try {
            await this.exchange.convert(organizationId, 1, context.entity.defaultCurrency, targetReportingCurrency, period.paymentDate);
            warnings.push(`Native ${context.entity.defaultCurrency} totals will also be available in ${targetReportingCurrency} reporting views.`);
          } catch (error) {
            warnings.push(`No ${context.entity.defaultCurrency}/${targetReportingCurrency} rate is available on the payment date. Statutory calculation can continue, but consolidated reporting totals will remain unavailable.`);
          }
        }
        entities.push({
          employerEntityId: id,
          legalName: context.entity.legalName,
          countryCode: context.entity.countryCode,
          currency: context.entity.defaultCurrency,
          assignedEmployeeCount: assignedProfiles.length,
          employeeCount: eligibleProfiles.length,
          excludedEmployeeCount: assignedProfiles.length - eligibleProfiles.length,
          missingVariableInputs,
          jurisdictionCode: context.entity.jurisdictionCode,
          taxPack: context.readiness.taxPack,
          ready: blockers.length === 0,
          blockers,
          warnings,
        });
      } catch (error) {
        entities.push({ employerEntityId: id, ready: false, blockers: [error.message], warnings: [] });
      }
    }
    return {
      period,
      reportingCurrency: targetReportingCurrency,
      ready: entities.every(entity => entity.ready),
      entities,
      blockers: entities.flatMap(entity => entity.blockers.map(message => ({ employerEntityId: entity.employerEntityId, message }))),
      warnings: entities.flatMap(entity => entity.warnings.map(message => ({ employerEntityId: entity.employerEntityId, message }))),
    };
  }

  async create(input, actor) {
    const idempotencyKey = String(input.idempotencyKey || '').trim();
    if (!idempotencyKey) throw cycleError('An idempotency key is required.', 400, 'PAYROLL_CYCLE_IDEMPOTENCY_KEY_REQUIRED');
    const existing = await this.PayrollCycle.findOne({ organizationId: actor.organizationId, idempotencyKey });
    if (existing) return { cycle: existing, idempotent: true };
    const preflight = await this.preflight({ organizationId: actor.organizationId, ...input });
    if (!preflight.ready) throw cycleError('Cycle preflight has blocking issues.', 422, 'PAYROLL_CYCLE_PREFLIGHT_BLOCKED', preflight);
    const policy = await this.getPolicy(actor.organizationId, input.approvalPolicyId, actor, preflight.entities.map(entity => entity.employerEntityId));
    const sequence = await PayrollSequence.reserve(`payroll-cycle:${actor.organizationId}:${preflight.period.year}-${String(preflight.period.month).padStart(2, '0')}`, 1);
    let cycle;
    try {
      cycle = await this.PayrollCycle.create({
        organizationId: actor.organizationId,
        cycleNumber: `PC-${preflight.period.year}-${String(preflight.period.month).padStart(2, '0')}-${String(sequence).padStart(3, '0')}`,
        idempotencyKey,
        payPeriod: preflight.period,
        reportingCurrency: preflight.reportingCurrency || preflight.entities[0]?.currency,
        approvalPolicyId: policy._id,
        approvalPolicySnapshot: {
          approvalRequired: policy.approvalRequired,
          requireSeparationOfDuties: policy.requireSeparationOfDuties,
          allowedApproverUserIds: policy.allowedApproverUserIds,
          automaticRelease: policy.automaticRelease,
          deliverAccountingOnRelease: policy.deliverAccountingOnRelease,
          levels: policy.levels,
        },
        childRuns: preflight.entities.map(entity => ({ ...entity, status: 'pending', blockers: undefined, warnings: undefined, ready: undefined, employeeCount: undefined })),
        createdBy: actor.userId,
        createdByName: actor.name,
      });
    } catch (error) {
      if (error?.code === 11000) {
        const raced = await this.PayrollCycle.findOne({ organizationId: actor.organizationId, idempotencyKey });
        if (raced) return { cycle: raced, idempotent: true };
      }
      throw error;
    }
    await this.calculatePending(cycle, input, actor);
    return { cycle: await this.get(cycle._id, actor.organizationId), idempotent: false };
  }

  async calculatePending(cycle, input, actor) {
    for (const child of cycle.childRuns) {
      if (child.payrollRunId && child.status !== 'failed') continue;
      try {
        const context = await this.employers.assertRunEntity(child.employerEntityId, actor.organizationId, cycle.payPeriod.paymentDate);
        child.status = 'calculating';
        await cycle.save();
        let run = child.payrollRunId ? await this.PayrollRun.findOne({ _id: child.payrollRunId, organizationId: actor.organizationId }) : null;
        if (!run) {
          const runNumber = await this.PayrollRun.generateRunNumber(actor.organizationId, cycle.payPeriod.year, cycle.payPeriod.month);
          run = await this.PayrollRun.create({
            runNumber,
            organizationId: actor.organizationId,
            cycleId: cycle._id,
            employerEntityId: context.entity._id,
            employerEntitySnapshot: {
              code: context.entity.code, legalName: context.entity.legalName, employerType: context.entity.employerType,
              countryCode: context.entity.countryCode, jurisdictionCode: context.entity.jurisdictionCode,
              currency: context.entity.defaultCurrency, taxJurisdictionConfigId: context.entity.taxJurisdictionConfigId,
              taxJurisdictionVersionId: context.entity.taxJurisdictionVersionId, taxAdapterCandidateId: context.entity.taxAdapterCandidateId,
              taxPackContentHash: context.readiness.taxPack?.contentHash || '', payrollRunnableAtCreation: context.readiness.payrollRunnable,
              blockingIssuesAtCreation: context.readiness.blockingIssues,
            },
            payPeriod: cycle.payPeriod,
            status: 'calculating',
            settings: {
              includeAllowances: input.settings?.includeAllowances !== false, includeBonuses: input.settings?.includeBonuses !== false,
              includeOvertime: input.settings?.includeOvertime !== false, includeCommissions: input.settings?.includeCommissions !== false,
              processStatutoryDeductions: input.settings?.processStatutoryDeductions !== false, processLoans: input.settings?.processLoans !== false,
              processUnpaidLeave: true, calculateTax: input.settings?.calculateTax !== false, prorate: input.settings?.prorate !== false,
              departments: input.settings?.departments || [], teams: input.settings?.teams || [], employmentTypes: input.settings?.employmentTypes || [],
              reportingCurrency: context.entity.defaultCurrency,
            },
            workInputs: (input.workInputsByEmployer?.[String(child.employerEntityId)] || []).map(value => ({
              userId: String(value?.userId || '').trim(), employeeName: String(value?.employeeName || '').trim(),
              regularHours: Math.max(0, Number(value?.regularHours) || 0), daysWorked: Math.max(0, Number(value?.daysWorked) || 0),
              notes: String(value?.notes || '').trim(), enteredBy: actor.userId, enteredAt: new Date(),
            })).filter(value => value.userId),
            requiredApprovalLevels: Math.max(1, cycle.approvalPolicySnapshot.levels.length),
            createdBy: actor.userId,
            createdByName: actor.name,
          });
          child.payrollRunId = run._id;
          await cycle.save();
        } else {
          run.status = 'calculating';
          run.calculationRevision = Number(run.calculationRevision || 1) + 1;
          run.submittedRevision = undefined;
          run.submittedTotalsHash = undefined;
          run.approvals = [];
          run.currentApprovalLevel = 0;
          await run.save();
        }
        const result = await this.engine.calculateRun(run._id, actor.organizationId);
        const calculated = result.run || await this.PayrollRun.findById(run._id);
        calculated.calculationTotalsHash = hash(runTotals(calculated));
        await calculated.save();
        child.status = calculated.status === 'calculated' ? 'calculated' : 'failed';
        child.errorCode = '';
        child.errorMessage = '';
      } catch (error) {
        child.status = 'failed';
        child.errorCode = error.code || 'PAYROLL_CYCLE_CHILD_FAILED';
        child.errorMessage = error.message;
        if (child.payrollRunId) await this.PayrollRun.updateOne({ _id: child.payrollRunId }, { $set: { status: 'pending_review' } });
      }
      await cycle.save();
    }
    await this.refresh(cycle);
    return cycle;
  }

  async refresh(cycle) {
    const runs = await this.PayrollRun.find({ _id: { $in: cycle.childRuns.map(child => child.payrollRunId).filter(Boolean) } });
    cycle.totalsHash = hash(runs.map(runTotals));
    cycle.nativeSummaries = runs.map(run => {
      const child = cycle.childRuns.find(value => String(value.payrollRunId) === String(run._id));
      const totals = runTotals(run);
      return {
        employerEntityId: child?.employerEntityId,
        legalName: child?.legalName,
        currency: totals.currency,
        employeeCount: totals.employees,
        totalGrossPayroll: totals.gross,
        totalDeductions: totals.deductions,
        totalNetPayroll: totals.net,
        totalEmployerCost: totals.employerCost,
      };
    });
    const reportingTotals = { totalGrossPayroll: 0, totalDeductions: 0, totalNetPayroll: 0, totalEmployerCost: 0 };
    const missingRates = [];
    for (const summary of cycle.nativeSummaries) {
      try {
        for (const key of Object.keys(reportingTotals)) {
          const result = await this.exchange.convert(cycle.organizationId, summary[key], summary.currency, cycle.reportingCurrency, cycle.payPeriod.paymentDate);
          reportingTotals[key] += Number(result.convertedAmount || 0);
        }
      } catch (error) {
        missingRates.push(`${summary.currency}/${cycle.reportingCurrency}`);
      }
    }
    cycle.reportingSummary = {
      currency: cycle.reportingCurrency,
      available: missingRates.length === 0,
      ...(missingRates.length === 0 ? reportingTotals : {}),
      missingRates: [...new Set(missingRates)],
    };
    if (cycle.childRuns.some(child => child.status === 'failed')) cycle.status = 'needs_attention';
    else if (cycle.childRuns.every(child => child.status === 'released')) cycle.status = 'released';
    else if (!['pending_approval', 'rejected', 'releasing', 'release_failed'].includes(cycle.status)) cycle.status = 'calculated';
    await cycle.save();
  }

  async get(id, organizationId) {
    return this.PayrollCycle.findOne({ _id: id, organizationId })
      .populate('childRuns.payrollRunId')
      .populate('approvalPolicyId', 'name levels requireSeparationOfDuties')
      .lean();
  }

  list(organizationId, filters = {}) {
    const query = { organizationId };
    if (filters.year) query['payPeriod.year'] = Number(filters.year);
    if (filters.status) query.status = filters.status;
    return this.PayrollCycle.find(query).sort({ 'payPeriod.year': -1, 'payPeriod.month': -1, createdAt: -1 }).limit(Number(filters.limit) || 24).lean();
  }

  async recalculateFailed(id, actor, input = {}) {
    const cycle = await this.PayrollCycle.findOne({ _id: id, organizationId: actor.organizationId });
    if (!cycle) throw cycleError('Payroll cycle not found.', 404, 'PAYROLL_CYCLE_NOT_FOUND');
    if (['releasing', 'released'].includes(cycle.status)) throw cycleError('A released cycle cannot be recalculated.', 409, 'PAYROLL_CYCLE_LOCKED');
    if (!cycle.childRuns.some(child => child.status === 'failed') && cycle.status === 'calculated') {
      return this.get(id, actor.organizationId);
    }
    cycle.revision += 1;
    cycle.submittedRevision = undefined;
    cycle.submittedTotalsHash = undefined;
    cycle.currentApprovalLevel = 0;
    cycle.approvals.push({ action: 'revised', actorId: actor.userId, actorName: actor.name, actorRole: actor.role, revision: cycle.revision });
    cycle.childRuns.forEach(child => { if (child.status === 'failed') child.status = 'pending'; });
    cycle.status = 'calculating';
    await cycle.save();
    await this.calculatePending(cycle, input, actor);
    return this.get(id, actor.organizationId);
  }

  async submit(id, actor, comments) {
    const cycle = await this.PayrollCycle.findOne({ _id: id, organizationId: actor.organizationId });
    if (!cycle) throw cycleError('Payroll cycle not found.', 404, 'PAYROLL_CYCLE_NOT_FOUND');
    if (cycle.status === 'pending_approval') return cycle;
    if (cycle.status !== 'calculated' || cycle.childRuns.some(child => child.status !== 'calculated')) {
      throw cycleError('Every legal employer must calculate successfully before submission.', 409, 'PAYROLL_CYCLE_NOT_READY');
    }
    const runs = await this.PayrollRun.find({ cycleId: cycle._id, organizationId: actor.organizationId });
    if (runs.some(run => Number(run.summary?.errorCount || 0) > 0 || (run.errors || []).length > 0)) {
      throw cycleError('Resolve all child-run calculation errors before submission.', 409, 'PAYROLL_CYCLE_HAS_ERRORS');
    }
    cycle.totalsHash = hash(runs.map(runTotals));
    cycle.submittedRevision = cycle.revision;
    cycle.submittedTotalsHash = cycle.totalsHash;
    cycle.submittedBy = actor.userId;
    cycle.submittedAt = new Date();
    cycle.status = 'pending_approval';
    cycle.currentApprovalLevel = 0;
    cycle.approvals.push({ action: 'submitted', actorId: actor.userId, actorName: actor.name, actorRole: actor.role, revision: cycle.revision, totalsHash: cycle.totalsHash, comments });
    for (const run of runs) {
      run.status = 'pending_approval';
      run.submittedRevision = run.calculationRevision;
      run.submittedTotalsHash = run.calculationTotalsHash || hash(runTotals(run));
      run.addApproval('submitted', actor.userId, actor.name, actor.role, comments);
      await run.save();
      try { await queuePayrollReadyEvent(run, actor.userId); }
      catch (error) { console.error('Cycle child submitted; Automation Hub outbox reconciliation will retry:', error.message); }
    }
    cycle.childRuns.forEach(child => { child.status = 'submitted'; });
    await cycle.save();
    return cycle;
  }

  async approveAndRelease(id, actor, comments, assertRunReady) {
    const cycle = await this.PayrollCycle.findOne({ _id: id, organizationId: actor.organizationId });
    if (!cycle) throw cycleError('Payroll cycle not found.', 404, 'PAYROLL_CYCLE_NOT_FOUND');
    if (cycle.status === 'released') return { cycle, idempotent: true };
    const releaseRetry = cycle.status === 'release_failed';
    if (!releaseRetry && cycle.status !== 'pending_approval') throw cycleError(`Cannot approve a cycle with status ${cycle.status}.`, 409, 'PAYROLL_CYCLE_NOT_APPROVABLE');
    const runs = await this.PayrollRun.find({ cycleId: cycle._id, organizationId: actor.organizationId });
    const currentTotalsHash = hash(runs.map(runTotals));
    if (cycle.submittedRevision !== cycle.revision || cycle.submittedTotalsHash !== currentTotalsHash) {
      throw cycleError('This cycle changed after submission. Recalculate and submit the current revision.', 409, 'PAYROLL_CYCLE_REVISION_CHANGED');
    }
    const approvalRequired = cycle.approvalPolicySnapshot.approvalRequired !== false;
    if (!releaseRetry && approvalRequired && cycle.approvalPolicySnapshot.requireSeparationOfDuties && String(cycle.submittedBy) === String(actor.userId)) {
      throw cycleError('The submitter cannot approve this payroll cycle.', 403, 'PAYROLL_SEPARATION_OF_DUTIES');
    }
    if (!releaseRetry && approvalRequired) {
      const explicitlyAllowed = cycle.approvalPolicySnapshot.allowedApproverUserIds || [];
      if (explicitlyAllowed.length && !explicitlyAllowed.includes(actor.userId)) throw cycleError('You are not an assigned payroll approver.', 403, 'PAYROLL_APPROVER_USER_REQUIRED');
      const level = cycle.approvalPolicySnapshot.levels[cycle.currentApprovalLevel];
      if (!level) throw cycleError('Approval policy has no remaining level.', 409, 'PAYROLL_APPROVAL_POLICY_INVALID');
      if (level.roles?.length && !level.roles.includes(actor.role)) throw cycleError('Your role cannot approve this level.', 403, 'PAYROLL_APPROVER_ROLE_REQUIRED');
      const alreadyApproved = cycle.approvals.some(entry => entry.action === 'approved' && entry.level === cycle.currentApprovalLevel + 1 && entry.revision === cycle.revision && entry.actorId === actor.userId);
      if (!alreadyApproved) cycle.approvals.push({ action: 'approved', actorId: actor.userId, actorName: actor.name, actorRole: actor.role, level: cycle.currentApprovalLevel + 1, revision: cycle.revision, totalsHash: cycle.totalsHash, comments });
      const approvalsAtLevel = new Set(cycle.approvals.filter(entry => entry.action === 'approved' && entry.level === cycle.currentApprovalLevel + 1 && entry.revision === cycle.revision).map(entry => entry.actorId)).size;
      if (approvalsAtLevel < (level.minimumApprovals || 1)) { await cycle.save(); return { cycle, released: false, idempotent: alreadyApproved }; }
      cycle.currentApprovalLevel += 1;
      if (cycle.currentApprovalLevel < cycle.approvalPolicySnapshot.levels.length) { await cycle.save(); return { cycle, released: false }; }
    }
    cycle.status = 'releasing';
    await cycle.save();
    let failed = null;
    for (const run of runs) {
      try {
        if (run.status === 'pending_approval') {
          run.addApproval('approved', actor.userId, actor.name, actor.role, comments);
          run.status = 'approved';
          await run.save();
        }
        if (!['exported', 'paid'].includes(run.status)) await this.finalization.finalizeRun({ runId: run._id, organizationId: actor.organizationId, adminId: actor.userId, adminName: actor.name, comments, assertRunReady });
        const child = cycle.childRuns.find(value => String(value.payrollRunId) === String(run._id));
        if (child) child.status = 'released';
      } catch (error) {
        failed = error;
        const child = cycle.childRuns.find(value => String(value.payrollRunId) === String(run._id));
        if (child) { child.status = 'failed'; child.errorCode = error.code || 'PAYROLL_RELEASE_FAILED'; child.errorMessage = error.message; }
        break;
      }
      await cycle.save();
    }
    cycle.status = failed ? 'release_failed' : 'released';
    if (!failed) {
      cycle.releasedAt = new Date();
      cycle.approvals.push({ action: 'released', actorId: actor.userId, actorName: actor.name, actorRole: actor.role, revision: cycle.revision, totalsHash: cycle.totalsHash });
    }
    await cycle.save();
    if (failed) throw cycleError(`Payroll release stopped: ${failed.message}`, failed.statusCode || 500, failed.code || 'PAYROLL_CYCLE_RELEASE_FAILED');
    return { cycle, released: true };
  }

  async reject(id, actor, comments) {
    if (!String(comments || '').trim()) throw cycleError('A rejection reason is required.', 400, 'PAYROLL_REJECTION_REASON_REQUIRED');
    const cycle = await this.PayrollCycle.findOne({ _id: id, organizationId: actor.organizationId });
    if (!cycle) throw cycleError('Payroll cycle not found.', 404, 'PAYROLL_CYCLE_NOT_FOUND');
    if (cycle.status === 'rejected') return cycle;
    if (cycle.status !== 'pending_approval') throw cycleError('Only a pending cycle can be rejected.', 409, 'PAYROLL_CYCLE_NOT_APPROVABLE');
    cycle.status = 'rejected';
    cycle.currentApprovalLevel = 0;
    cycle.approvals.push({ action: 'rejected', actorId: actor.userId, actorName: actor.name, actorRole: actor.role, revision: cycle.revision, totalsHash: cycle.totalsHash, comments });
    await this.PayrollRun.updateMany({ cycleId: cycle._id, organizationId: actor.organizationId }, { $set: { status: 'pending_review', currentApprovalLevel: 0 } });
    await cycle.save();
    return cycle;
  }

  async retractChildren(id, actor, runIds, comments) {
    const selected = [...new Set((runIds || []).map(String).filter(Boolean))];
    if (!selected.length) throw cycleError('Select at least one child run to retract.', 400, 'PAYROLL_CYCLE_RETRACTION_SELECTION_REQUIRED');
    if (!String(comments || '').trim()) throw cycleError('A retraction reason is required.', 400, 'PAYROLL_RETRACTION_REASON_REQUIRED');
    const cycle = await this.PayrollCycle.findOne({ _id: id, organizationId: actor.organizationId });
    if (!cycle) throw cycleError('Payroll cycle not found.', 404, 'PAYROLL_CYCLE_NOT_FOUND');
    const allowed = new Set(cycle.childRuns.map(child => String(child.payrollRunId)).filter(Boolean));
    if (selected.some(runId => !allowed.has(runId))) throw cycleError('A selected run does not belong to this payroll cycle.', 422, 'PAYROLL_CYCLE_CHILD_INVALID');
    const results = [];
    for (const runId of selected) {
      const run = await this.retraction.retractRun({ runId, organizationId: actor.organizationId, adminId: actor.userId, adminName: actor.name, comments });
      const child = cycle.childRuns.find(value => String(value.payrollRunId) === runId);
      if (child) child.status = 'failed';
      results.push(run);
    }
    cycle.status = selected.length === allowed.size ? 'cancelled' : 'partially_failed';
    await cycle.save();
    const now = new Date();
    await this.PayrollDelivery.updateMany(
      { organizationId: actor.organizationId, cycleId: cycle._id, status: { $nin: ['revoked', 'expired'] } },
      { $set: { status: 'revoked', revokedAt: now, revokedBy: actor.userId }, $push: { audit: { action: 'revoked', actorId: actor.userId, at: now } } }
    );
    await this.PayrollArtifact.updateMany(
      { organizationId: actor.organizationId, cycleId: cycle._id, revokedAt: null },
      { $set: { revokedAt: now, revokedBy: actor.userId } }
    );
    return { cycle, runs: results };
  }
}

module.exports = new PayrollCycleService();
module.exports.PayrollCycleService = PayrollCycleService;
module.exports.hash = hash;
module.exports.runTotals = runTotals;
module.exports.periodFromInput = periodFromInput;
