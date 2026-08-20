const express = require('express');
const PayrollApprovalPolicy = require('../models/PayrollApprovalPolicy');
const PayrollAccountingContact = require('../models/PayrollAccountingContact');
const PayrollDelivery = require('../models/PayrollDelivery');
const cycleService = require('../services/PayrollCycleService');
const deliveryService = require('../services/PayrollAccountingDeliveryService');
const employerEntityService = require('../services/PayrollEmployerEntityService');
const { emailService } = require('../services/emailService');
const { requireHRAdmin } = require('../middleware/rbac');

const router = express.Router();
const ADMIN_ROLES = new Set(['owner', 'admin']);

function actor(req) {
  return {
    userId: req.session?.user?.sub || req.session?.user?.id,
    organizationId: req.currentOrganization?.id || req.session?.currentOrganizationId,
    name: req.session?.user?.name,
    role: req.currentOrganization?.role || req.session?.user?.currentRole,
  };
}

function requireOrganizationAdmin(req, res, next) {
  const role = req.currentOrganization?.role || req.session?.user?.currentRole;
  if (!ADMIN_ROLES.has(role)) return res.status(403).json({ error: 'Organization owner or admin access is required.' });
  next();
}

function errorResponse(res, error) {
  return res.status(error.statusCode || 500).json({ error: error.message || 'Payroll cycle request failed.', code: error.code, details: error.details });
}

// Token-authenticated recipient route. The opaque token, not a user session, grants access.
router.get('/accounting-deliveries/:id/download', async (req, res) => {
  try {
    const result = await deliveryService.download(req.params.id, req.query.token, req.query.artifactId);
    if (!result.artifact) {
      const token = encodeURIComponent(String(req.query.token || ''));
      const rows = result.artifacts.map(artifact => `<li><a href="?token=${token}&artifactId=${encodeURIComponent(String(artifact._id))}">${String(artifact.fileName).replace(/[&<>"']/g, value => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[value]))}</a> <small>${artifact.byteLength} bytes · SHA-256 ${artifact.checksum}</small></li>`).join('');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'");
      res.setHeader('X-Content-Type-Options', 'nosniff');
      return res.send(`<!doctype html><html><head><meta charset="utf-8"><title>Payroll accounting files</title><style>body{font:16px system-ui;max-width:800px;margin:48px auto;padding:0 20px;color:#18181b}li{margin:16px 0}small{display:block;color:#71717a;margin-top:4px}</style></head><body><h1>Payroll accounting files</h1><p>This private link expires ${new Date(result.delivery.expiresAt).toUTCString()}.</p><ul>${rows}</ul></body></html>`);
    }
    const { artifact } = result;
    res.setHeader('Content-Type', artifact.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${String(artifact.fileName).replace(/["\r\n]/g, '')}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(artifact.content);
  } catch (error) {
    errorResponse(res, error);
  }
});

router.post('/cycles/preflight', requireHRAdmin, async (req, res) => {
  try { res.json(await cycleService.preflight({ organizationId: actor(req).organizationId, ...req.body })); }
  catch (error) { errorResponse(res, error); }
});

router.post('/cycles', requireHRAdmin, async (req, res) => {
  try {
    const result = await cycleService.create({ ...req.body, idempotencyKey: req.get('Idempotency-Key') || req.body?.idempotencyKey }, actor(req));
    res.status(result.idempotent ? 200 : 201).json({ success: true, ...result });
  } catch (error) { errorResponse(res, error); }
});

router.get('/cycles', requireHRAdmin, async (req, res) => {
  try { res.json(await cycleService.list(actor(req).organizationId, req.query)); }
  catch (error) { errorResponse(res, error); }
});

router.get('/cycles/:id', requireHRAdmin, async (req, res) => {
  try {
    const currentActor = actor(req);
    const cycle = await cycleService.get(req.params.id, currentActor.organizationId);
    if (!cycle) return res.status(404).json({ error: 'Payroll cycle not found.' });
    const deliveries = await PayrollDelivery.find({ organizationId: currentActor.organizationId, cycleId: req.params.id })
      .select('-tokenHash').sort({ createdAt: -1 }).lean();
    res.json({
      ...cycle,
      deliveries,
      approvalCapabilities: {
        canFullyApprove: ADMIN_ROLES.has(currentActor.role),
        canOverrideSeparationOfDuties: ADMIN_ROLES.has(currentActor.role),
      },
    });
  } catch (error) { errorResponse(res, error); }
});

router.post('/cycles/:id/recalculate-failed', requireHRAdmin, async (req, res) => {
  try { res.json({ success: true, cycle: await cycleService.recalculateFailed(req.params.id, actor(req), req.body) }); }
  catch (error) { errorResponse(res, error); }
});

router.post('/cycles/:id/submit', requireHRAdmin, async (req, res) => {
  try {
    const currentActor = actor(req);
    let cycle = await cycleService.submit(req.params.id, currentActor, req.body?.comments);
    let released = false;
    let delivery = null;
    if (cycle.approvalPolicySnapshot?.approvalRequired === false && cycle.approvalPolicySnapshot?.automaticRelease !== false) {
      const result = await cycleService.approveAndRelease(
        req.params.id,
        { ...currentActor, userId: `system-release:${currentActor.userId}`, name: 'Automatic payroll release' },
        req.body?.comments,
        async run => {
          const context = await employerEntityService.assertRunEntity(run.employerEntityId, currentActor.organizationId, run.payPeriod?.paymentDate);
          if (!context.readiness.payrollRunnable) {
            const error = new Error(`Payroll cannot be released: ${context.readiness.blockingIssues.join(' ')}`);
            error.statusCode = 409; error.code = 'PAYROLL_EMPLOYER_NOT_RUNNABLE'; throw error;
          }
        }
      );
      cycle = result.cycle;
      released = result.released === true;
      if (released && cycle.approvalPolicySnapshot?.deliverAccountingOnRelease !== false) {
        delivery = await deliveryService.send(req.params.id, currentActor.organizationId, currentActor.userId, `release:${cycle.revision}`);
      }
    }
    res.json({ success: true, cycle, released, delivery });
  }
  catch (error) { errorResponse(res, error); }
});

router.post('/cycles/:id/approve-and-release', requireHRAdmin, async (req, res) => {
  try {
    const currentActor = actor(req);
    const result = await cycleService.approveAndRelease(
      req.params.id,
      currentActor,
      req.body?.comments,
      async run => {
        const context = await employerEntityService.assertRunEntity(run.employerEntityId, currentActor.organizationId, run.payPeriod?.paymentDate);
        if (!context.readiness.payrollRunnable) {
          const error = new Error(`Payroll cannot be released: ${context.readiness.blockingIssues.join(' ')}`);
          error.statusCode = 409;
          error.code = 'PAYROLL_EMPLOYER_NOT_RUNNABLE';
          throw error;
        }
      }
    );
    let delivery = null;
    if (result.released && result.cycle.approvalPolicySnapshot?.deliverAccountingOnRelease !== false) delivery = await deliveryService.send(req.params.id, currentActor.organizationId, currentActor.userId, `release:${result.cycle.revision}`);
    res.json({ success: true, ...result, delivery });
  } catch (error) { errorResponse(res, error); }
});

router.post('/cycles/:id/reject', requireHRAdmin, async (req, res) => {
  try { res.json({ success: true, cycle: await cycleService.reject(req.params.id, actor(req), req.body?.comments) }); }
  catch (error) { errorResponse(res, error); }
});

router.post('/cycles/:id/retract', requireHRAdmin, requireOrganizationAdmin, async (req, res) => {
  try {
    res.json({ success: true, ...(await cycleService.retractChildren(req.params.id, actor(req), req.body?.runIds, req.body?.comments)) });
  } catch (error) { errorResponse(res, error); }
});

router.post('/cycles/:id/resend-accounting', requireHRAdmin, async (req, res) => {
  try {
    const currentActor = actor(req);
    const requestKey = String(req.get('Idempotency-Key') || req.body?.idempotencyKey || '').trim();
    if (!requestKey) return res.status(400).json({ error: 'An Idempotency-Key is required for accounting resend.', code: 'PAYROLL_DELIVERY_IDEMPOTENCY_KEY_REQUIRED' });
    res.json({ success: true, ...(await deliveryService.send(req.params.id, currentActor.organizationId, currentActor.userId, requestKey)) });
  } catch (error) { errorResponse(res, error); }
});

router.post('/accounting-deliveries/:id/revoke', requireHRAdmin, requireOrganizationAdmin, async (req, res) => {
  try {
    const currentActor = actor(req);
    const delivery = await PayrollDelivery.findOneAndUpdate(
      { _id: req.params.id, organizationId: currentActor.organizationId, status: { $ne: 'revoked' } },
      { $set: { status: 'revoked', revokedAt: new Date(), revokedBy: currentActor.userId }, $push: { audit: { action: 'revoked', actorId: currentActor.userId, at: new Date() } } },
      { new: true }
    );
    if (!delivery) return res.status(404).json({ error: 'Active accounting delivery not found.' });
    res.json({ success: true, delivery });
  } catch (error) { errorResponse(res, error); }
});

router.get('/approval-policies', requireHRAdmin, async (req, res) => {
  try { res.json(await PayrollApprovalPolicy.find({ organizationId: actor(req).organizationId }).sort({ isDefault: -1, name: 1 }).lean()); }
  catch (error) { errorResponse(res, error); }
});

router.post('/approval-policies', requireHRAdmin, requireOrganizationAdmin, async (req, res) => {
  try {
    const currentActor = actor(req);
    if (req.body?.isDefault) await PayrollApprovalPolicy.updateMany({ organizationId: currentActor.organizationId }, { $set: { isDefault: false } });
    const policy = await PayrollApprovalPolicy.create({ ...req.body, organizationId: currentActor.organizationId, createdBy: currentActor.userId, updatedBy: currentActor.userId });
    res.status(201).json(policy);
  } catch (error) { errorResponse(res, error); }
});

router.put('/approval-policies/:id', requireHRAdmin, requireOrganizationAdmin, async (req, res) => {
  try {
    const currentActor = actor(req);
    if (req.body?.isDefault) await PayrollApprovalPolicy.updateMany({ organizationId: currentActor.organizationId, _id: { $ne: req.params.id } }, { $set: { isDefault: false } });
    const policy = await PayrollApprovalPolicy.findOneAndUpdate(
      { _id: req.params.id, organizationId: currentActor.organizationId },
      { $set: { ...req.body, organizationId: currentActor.organizationId, updatedBy: currentActor.userId } },
      { new: true, runValidators: true }
    );
    if (!policy) return res.status(404).json({ error: 'Approval policy not found.' });
    res.json(policy);
  } catch (error) { errorResponse(res, error); }
});

router.delete('/approval-policies/:id', requireHRAdmin, requireOrganizationAdmin, async (req, res) => {
  try {
    const policy = await PayrollApprovalPolicy.findOneAndUpdate(
      { _id: req.params.id, organizationId: actor(req).organizationId, isDefault: false },
      { $set: { active: false } }, { new: true }
    );
    if (!policy) return res.status(409).json({ error: 'The default policy cannot be removed.' });
    res.json({ success: true, policy });
  } catch (error) { errorResponse(res, error); }
});

router.get('/accounting-contacts', requireHRAdmin, async (req, res) => {
  try { res.json(await PayrollAccountingContact.find({ organizationId: actor(req).organizationId }).sort({ name: 1 }).lean()); }
  catch (error) { errorResponse(res, error); }
});

router.post('/accounting-contacts', requireHRAdmin, requireOrganizationAdmin, async (req, res) => {
  try {
    const currentActor = actor(req);
    res.status(201).json(await PayrollAccountingContact.create({ ...req.body, organizationId: currentActor.organizationId, createdBy: currentActor.userId, updatedBy: currentActor.userId }));
  } catch (error) { errorResponse(res, error); }
});

router.put('/accounting-contacts/:id', requireHRAdmin, requireOrganizationAdmin, async (req, res) => {
  try {
    const currentActor = actor(req);
    const contact = await PayrollAccountingContact.findOneAndUpdate(
      { _id: req.params.id, organizationId: currentActor.organizationId },
      { $set: { ...req.body, organizationId: currentActor.organizationId, updatedBy: currentActor.userId } },
      { new: true, runValidators: true }
    );
    if (!contact) return res.status(404).json({ error: 'Accounting contact not found.' });
    res.json(contact);
  } catch (error) { errorResponse(res, error); }
});

router.delete('/accounting-contacts/:id', requireHRAdmin, requireOrganizationAdmin, async (req, res) => {
  try {
    const contact = await PayrollAccountingContact.findOneAndUpdate(
      { _id: req.params.id, organizationId: actor(req).organizationId }, { $set: { active: false } }, { new: true }
    );
    if (!contact) return res.status(404).json({ error: 'Accounting contact not found.' });
    res.json({ success: true, contact });
  } catch (error) { errorResponse(res, error); }
});

router.post('/accounting-contacts/:id/test', requireHRAdmin, requireOrganizationAdmin, async (req, res) => {
  try {
    const contact = await PayrollAccountingContact.findOne({ _id: req.params.id, organizationId: actor(req).organizationId, active: true });
    if (!contact) return res.status(404).json({ error: 'Active accounting contact not found.' });
    const result = await emailService.sendEmail({
      to: contact.email,
      subject: 'Seemplify Payroll accounting delivery test',
      html: '<p>Your Seemplify Payroll accounting delivery contact is configured correctly.</p>',
      text: 'Your Seemplify Payroll accounting delivery contact is configured correctly.',
    });
    if (result?.skipped) return res.status(503).json({ error: 'Email delivery is not configured.', code: 'PAYROLL_EMAIL_NOT_CONFIGURED' });
    contact.verifiedAt = new Date();
    contact.verifiedBy = actor(req).userId;
    await contact.save();
    res.json({ success: true });
  } catch (error) { errorResponse(res, error); }
});

module.exports = router;
