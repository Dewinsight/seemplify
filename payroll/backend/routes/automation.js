const express = require('express');
const PayrollRun = require('../models/PayrollRun');
const Payslip = require('../models/Payslip');
const payrollFinalizationService = require('../services/PayrollFinalizationService');
const employerEntityService = require('../services/PayrollEmployerEntityService');
const { createVerifier } = require('../services/automationHubSecurity');
const { exactApprovalCompensation, exactApprovalMarker, hasExactApproval, revision, totalsHash } = require('../services/payrollAutomationContract');

const router = express.Router();
router.use(createVerifier());

function blockingIssues(run = {}) {
  const issues = [];
  if ((run.errors || []).length) issues.push(`${run.errors.length} calculation error(s)`);
  if ((run.employees || []).some(item => item?.status === 'error')) issues.push('employee calculation failures');
  if (Number(run.summary?.errorCount || 0) > 0) issues.push('summary errors');
  return issues;
}

router.post('/payroll.finalize_run', async (req, res) => {
  try {
    const organizationId = String(req.body?.organizationId || '');
    const actorId = String(req.body?.actorId || '');
    const input = req.body?.input || {};
    if (!organizationId || !actorId || String(input.runId || '') !== String(req.body?.subjectId || '') || !input.approvalId) {
      return res.status(400).json({ error: 'The protected payroll action is incomplete.', code: 'AUTOMATION_INPUT_INVALID' });
    }
    let run = await PayrollRun.findOne({ _id: input.runId, organizationId });
    if (!run) return res.status(404).json({ error: 'Payroll run not found', code: 'PAYROLL_RUN_NOT_FOUND' });
    const approvalMarker = exactApprovalMarker(input.approvalId);
    const existingExactApproval = hasExactApproval(run, approvalMarker);
    if (['exported', 'paid'].includes(run.status) && existingExactApproval) {
      return res.json({ outcomeId: `payroll:${run._id}:${run.status}`, state: run.status, idempotent: true });
    }
    const canResumeFinalization = run.status === 'approved' && existingExactApproval;
    if (run.status !== 'pending_approval' && !canResumeFinalization) return res.status(409).json({ error: `Cannot automate a payroll run in ${run.status}.`, code: 'PAYROLL_RUN_NOT_READY' });
    if (!existingExactApproval && (String(input.runRevision) !== revision(run) || String(input.totalsHash) !== totalsHash(run))) {
      return res.status(409).json({ error: 'Payroll totals or revision changed after approval was requested.', code: 'PAYROLL_APPROVAL_STALE' });
    }
    if (actorId === String(run.createdBy || '')) return res.status(403).json({ error: 'Maker-checker policy prevents the run creator from finalizing it.', code: 'PAYROLL_MAKER_CHECKER_REQUIRED' });
    const issues = blockingIssues(run);
    if (issues.length) return res.status(409).json({ error: `Payroll has blocking issues: ${issues.join(', ')}.`, code: 'PAYROLL_RUN_HAS_BLOCKING_ERRORS' });
    const role = String(req.body?.authorizationContext?.role || '');
    if (!['owner', 'admin'].includes(role)) return res.status(403).json({ error: 'Payroll finalization requires an organization administrator.', code: 'PAYROLL_ROLE_DENIED' });
    const employer = await employerEntityService.assertRunEntity(run.employerEntityId, organizationId, run.payPeriod?.paymentDate);
    if (!employer.readiness.payrollRunnable) return res.status(409).json({ error: `Payroll cannot be finalized: ${employer.readiness.blockingIssues.join(' ')}`, code: 'PAYROLL_EMPLOYER_NOT_RUNNABLE' });
    let approvalAdded = false;
    if (!existingExactApproval) {
      run.addApproval('approved', actorId, 'Automation reviewer', role, approvalMarker);
      await run.save();
      approvalAdded = true;
    }
    if (run.status !== 'approved') return res.status(409).json({ error: 'Additional Payroll approval levels are still required.', code: 'PAYROLL_MORE_APPROVALS_REQUIRED' });
    await Payslip.updateMany({ payrollRunId: run._id, organizationId }, { status: 'approved' });
    try {
      run = await payrollFinalizationService.finalizeRun({
        runId: run._id, organizationId, adminId: actorId, adminName: 'Automation reviewer', comments: approvalMarker,
        assertRunReady: async current => {
          if (blockingIssues(current).length) throw Object.assign(new Error('Payroll blocking issues changed.'), { statusCode: 409, code: 'PAYROLL_RUN_HAS_BLOCKING_ERRORS' });
          const currentEmployer = await employerEntityService.assertRunEntity(current.employerEntityId, organizationId, current.payPeriod?.paymentDate);
          if (!currentEmployer.readiness.payrollRunnable) throw Object.assign(new Error(`Payroll cannot be finalized: ${currentEmployer.readiness.blockingIssues.join(' ')}`), { statusCode: 409, code: 'PAYROLL_EMPLOYER_NOT_RUNNABLE' });
        },
      });
    } catch (error) {
      if (approvalAdded) {
        const reverted = await PayrollRun.findOneAndUpdate(
          { _id: run._id, organizationId, status: 'approved' },
          exactApprovalCompensation(approvalMarker),
          { new: true }
        );
        if (reverted) await Payslip.updateMany({ payrollRunId: run._id, organizationId, status: 'approved' }, { status: 'pending_approval' });
      }
      throw error;
    }
    return res.json({ outcomeId: `payroll:${run._id}:${run.status}`, state: run.status, runRevision: revision(run) });
  } catch (error) {
    console.error('Payroll automation action failed:', error.message);
    return res.status(error.statusCode || 500).json({ error: error.message, code: error.code || 'PAYROLL_AUTOMATION_FAILED', retryable: error.retryable === true });
  }
});

module.exports = router;
