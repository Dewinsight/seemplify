const crypto = require('crypto');
const PayrollCycle = require('../models/PayrollCycle');
const PayrollRun = require('../models/PayrollRun');
const PayrollProfile = require('../models/PayrollProfile');
const Payslip = require('../models/Payslip');
const PayrollArtifact = require('../models/PayrollArtifact');
const PayrollDelivery = require('../models/PayrollDelivery');
const PayrollAccountingContact = require('../models/PayrollAccountingContact');
const { buildPayrollRegisterCsv } = require('./payrollExportService');
const { emailService } = require('./emailService');

function deliveryError(message, statusCode = 400, code = 'PAYROLL_DELIVERY_INVALID') {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

class PayrollAccountingDeliveryService {
  constructor(dependencies = {}) {
    this.Cycle = dependencies.Cycle || PayrollCycle;
    this.Run = dependencies.Run || PayrollRun;
    this.Profile = dependencies.Profile || PayrollProfile;
    this.Payslip = dependencies.Payslip || Payslip;
    this.Artifact = dependencies.Artifact || PayrollArtifact;
    this.Delivery = dependencies.Delivery || PayrollDelivery;
    this.Contact = dependencies.Contact || PayrollAccountingContact;
    this.mail = dependencies.mail || emailService;
  }

  storeArtifact(payload) {
    return this.Artifact.findOneAndUpdate(
      { organizationId: payload.organizationId, cycleId: payload.cycleId, kind: payload.kind, payrollRunId: payload.payrollRunId || null },
      { $setOnInsert: payload },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }

  async ensureArtifacts(cycle, actorId) {
    const existing = await this.Artifact.find({ organizationId: cycle.organizationId, cycleId: cycle._id, revokedAt: null }).lean();
    if (existing.length) return existing;
    const runs = await this.Run.find({ cycleId: cycle._id, organizationId: cycle.organizationId }).lean();
    const artifacts = [];
    for (const run of runs) {
      const payslips = await this.Payslip.find({ payrollRunId: run._id, organizationId: cycle.organizationId }).lean();
      const userIds = [...new Set(payslips.map(item => String(item.userId || '')).filter(Boolean))];
      const profiles = await this.Profile.find({ organizationId: cycle.organizationId, userId: { $in: userIds } })
        .select('userId currency employeeInfo bankAccounts').lean();
      const { csv } = buildPayrollRegisterCsv({
        payslips,
        runById: new Map([[String(run._id), run]]),
        profileByUserId: new Map(profiles.map(profile => [String(profile.userId), profile])),
      });
      const content = Buffer.from(csv, 'utf8');
      artifacts.push(await this.storeArtifact({
        organizationId: cycle.organizationId,
        cycleId: cycle._id,
        payrollRunId: run._id,
        kind: 'payroll_register',
        fileName: `payroll-register-${run.runNumber}-${run.summary?.currency || run.employerEntitySnapshot?.currency || 'NATIVE'}.csv`,
        contentType: 'text/csv; charset=utf-8',
        currency: run.summary?.currency || run.employerEntitySnapshot?.currency,
        byteLength: content.length,
        checksum: sha256(content),
        content,
        createdBy: actorId,
      }));
    }
    const manifestContent = Buffer.from(JSON.stringify({
      cycleNumber: cycle.cycleNumber,
      period: cycle.payPeriod,
      revision: cycle.revision,
      totalsHash: cycle.totalsHash,
      reportingSummary: cycle.reportingSummary,
      nativeSummaries: cycle.nativeSummaries,
      generatedAt: new Date().toISOString(),
      files: artifacts.map(artifact => ({ fileName: artifact.fileName, currency: artifact.currency, checksum: artifact.checksum, byteLength: artifact.byteLength })),
    }, null, 2), 'utf8');
    artifacts.push(await this.storeArtifact({
      organizationId: cycle.organizationId,
      cycleId: cycle._id,
      kind: 'cycle_manifest',
      fileName: `${cycle.cycleNumber}-manifest.json`,
      contentType: 'application/json; charset=utf-8',
      byteLength: manifestContent.length,
      checksum: sha256(manifestContent),
      content: manifestContent,
      createdBy: actorId,
    }));
    return artifacts;
  }

  async send(cycleId, organizationId, actorId, requestKey) {
    const cycle = await this.Cycle.findOne({ _id: cycleId, organizationId });
    if (!cycle) throw deliveryError('Payroll cycle not found.', 404, 'PAYROLL_CYCLE_NOT_FOUND');
    if (cycle.status !== 'released') throw deliveryError('Accounting files are delivered only after release.', 409, 'PAYROLL_CYCLE_NOT_RELEASED');
    const normalizedRequestKey = String(requestKey || `release:${cycle.revision}`).trim();
    const contacts = await this.Contact.find({ organizationId, active: true, 'deliveryPreferences.notifyOnRelease': { $ne: false } });
    if (!contacts.length) return { deliveries: [], warning: 'No active accounting contacts are configured.' };
    const existingBatch = await this.Delivery.find({ organizationId, cycleId: cycle._id, requestKey: normalizedRequestKey }).select('-tokenHash');
    const existingRecipients = new Set(existingBatch.map(delivery => delivery.recipientEmail));
    if (contacts.every(contact => existingRecipients.has(contact.email))) return { deliveries: existingBatch, idempotent: true };
    const artifacts = await this.ensureArtifacts(cycle, actorId);
    const baseUrl = String(process.env.PAYROLL_API_URL || process.env.BACKEND_URL || 'http://localhost:5006').replace(/\/$/, '');
    const deliveries = [...existingBatch];
    for (const contact of contacts) {
      if (existingRecipients.has(contact.email)) continue;
      const scopedEmployerIds = [contact.employerEntityId, ...(contact.employerEntityIds || [])].filter(Boolean);
      const eligible = artifacts.filter(artifact => {
        if (!scopedEmployerIds.length) return true;
        if (artifact.kind === 'cycle_manifest') return false;
        const child = cycle.childRuns.find(value => String(value.payrollRunId) === String(artifact.payrollRunId));
        return child && scopedEmployerIds.some(id => String(id) === String(child.employerEntityId));
      });
      const token = crypto.randomBytes(32).toString('base64url');
      const tokenHash = sha256(token);
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await this.Delivery.updateMany(
        { organizationId, cycleId: cycle._id, recipientEmail: contact.email, requestKey: { $ne: normalizedRequestKey }, status: { $in: ['pending', 'sent', 'failed', 'delivered'] } },
        { $set: { status: 'revoked', revokedAt: new Date(), revokedBy: actorId }, $push: { audit: { action: 'revoked', actorId, at: new Date() } } }
      );
      const delivery = await this.Delivery.create({
        organizationId, cycleId: cycle._id, requestKey: normalizedRequestKey, contactId: contact._id, recipientEmail: contact.email,
        artifactIds: eligible.map(item => item._id), tokenHash, expiresAt,
        audit: [{ action: 'created', actorId }],
      });
      const link = `${baseUrl}/api/payroll/accounting-deliveries/${delivery._id}/download?token=${encodeURIComponent(token)}`;
      try {
        const result = await this.mail.sendEmail({
          to: contact.email,
          subject: `Payroll accounting files: ${cycle.cycleNumber}`,
          html: `<p>${escapeHtml(contact.name || 'Hello')},</p><p>The payroll accounting files for <strong>${escapeHtml(cycle.cycleNumber)}</strong> are ready.</p><p><a href="${link}">Download files</a></p><p>This private link expires in seven days.</p>`,
          text: `Payroll accounting files for ${cycle.cycleNumber}: ${link}\nThis private link expires in seven days.`,
        });
        delivery.status = result?.skipped ? 'failed' : 'sent';
        delivery.failureCode = result?.skipped ? 'EMAIL_NOT_CONFIGURED' : '';
        delivery.providerMessageId = String(result?.messageId || result?.id || '');
        delivery.nextRetryAt = result?.skipped ? new Date(Date.now() + 15 * 60 * 1000) : undefined;
        delivery.sentAt = result?.skipped ? undefined : new Date();
        delivery.audit.push({ action: result?.skipped ? 'failed' : 'sent', actorId });
      } catch (error) {
        delivery.status = 'failed';
        delivery.failureCode = error.code || 'EMAIL_SEND_FAILED';
        delivery.nextRetryAt = new Date(Date.now() + 15 * 60 * 1000);
        delivery.audit.push({ action: 'failed', actorId });
      }
      delivery.attemptCount += 1;
      delivery.lastAttemptAt = new Date();
      await delivery.save();
      deliveries.push(delivery);
    }
    return { deliveries };
  }

  async download(deliveryId, token, artifactId) {
    const delivery = await this.Delivery.findOne({ _id: deliveryId }).select('+tokenHash');
    const supplied = Buffer.from(sha256(String(token || '')), 'hex');
    const expected = delivery?.tokenHash ? Buffer.from(delivery.tokenHash, 'hex') : Buffer.alloc(32);
    if (!delivery || supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
      throw deliveryError('Download link is invalid.', 404, 'PAYROLL_DELIVERY_LINK_INVALID');
    }
    if (delivery.status === 'revoked' || delivery.revokedAt) throw deliveryError('Download link was revoked.', 410, 'PAYROLL_DELIVERY_REVOKED');
    if (delivery.expiresAt < new Date()) {
      delivery.status = 'expired';
      delivery.audit.push({ action: 'expired', actorId: 'system-expiry' });
      await delivery.save();
      throw deliveryError('Download link has expired.', 410, 'PAYROLL_DELIVERY_EXPIRED');
    }
    if (!artifactId) {
      const artifacts = await this.Artifact.find({ _id: { $in: delivery.artifactIds }, organizationId: delivery.organizationId, revokedAt: null })
        .select('fileName contentType byteLength checksum currency kind').lean();
      delivery.status = 'delivered';
      delivery.openedAt = delivery.openedAt || new Date();
      delivery.audit.push({ action: 'opened', actorId: `recipient:${sha256(delivery.recipientEmail).slice(0, 12)}` });
      await delivery.save();
      return { delivery, artifacts };
    }
    const selectedId = artifactId;
    if (!delivery.artifactIds.some(id => String(id) === String(selectedId))) throw deliveryError('File is unavailable.', 404, 'PAYROLL_ARTIFACT_NOT_FOUND');
    const artifact = await this.Artifact.findOne({ _id: selectedId, organizationId: delivery.organizationId, revokedAt: null }).select('+content');
    if (!artifact) throw deliveryError('File is unavailable.', 404, 'PAYROLL_ARTIFACT_NOT_FOUND');
    delivery.audit.push({ action: 'downloaded', actorId: `recipient:${sha256(delivery.recipientEmail).slice(0, 12)}` });
    delivery.status = 'delivered';
    delivery.downloadedAt = new Date();
    await delivery.save();
    return { delivery, artifact };
  }
}

module.exports = new PayrollAccountingDeliveryService();
module.exports.PayrollAccountingDeliveryService = PayrollAccountingDeliveryService;
module.exports.sha256 = sha256;
