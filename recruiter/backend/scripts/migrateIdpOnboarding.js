/**
 * Migration: IdP onboarding  ->  recruiter "People Transitions"
 *
 * Moves legacy IdP onboarding data (db `identity`) into the recruiter app
 * (db `smart_hr_db`) so the recruiter app can be the single onboarding engine.
 *
 * Both DBs live on the same cluster, so this connects to each directly:
 *  - default mongoose connection -> recruiter (MONGO_URI, smart_hr_db) for writes
 *  - a secondary connection      -> IdP (IDP_MONGO_URI or derived) for reads
 *
 * Cloudinary is shared across both apps, so signed PDFs and uploads are
 * referenced by URL/publicId rather than re-uploaded.
 *
 * Idempotent: every created record is recorded in `onboarding_migration_map`
 * keyed by its IdP id, so re-runs report "0 new" and --rollback removes only
 * migration-created records (never shared Cloudinary assets).
 *
 * Usage:
 *   node scripts/migrateIdpOnboarding.js --dry-run            # preview only
 *   node scripts/migrateIdpOnboarding.js                      # migrate all linked orgs
 *   node scripts/migrateIdpOnboarding.js --org=<idpOrgId>     # one org
 *   node scripts/migrateIdpOnboarding.js --rollback           # undo migration-created records
 *   node scripts/migrateIdpOnboarding.js --rollback --org=<idpOrgId>
 */

const mongoose = require('mongoose');
const dotenv = require('dotenv');

const Organization = require('../models/Organization');
const User = require('../models/User');
const Candidate = require('../models/Candidate');
const CandidateOnboarding = require('../models/CandidateOnboarding');
const OnboardingTemplate = require('../models/OnboardingTemplate');
const OnboardingFormTemplate = require('../models/OnboardingFormTemplate');
const OnboardingFormSubmission = require('../models/OnboardingFormSubmission');
const OnboardingDocument = require('../models/OnboardingDocument');
const OnboardingEnvelope = require('../models/OnboardingEnvelope');
const OnboardingWorkflowItem = require('../models/OnboardingWorkflowItem');

dotenv.config();

const DRY_RUN = process.argv.includes('--dry-run');
const ROLLBACK = process.argv.includes('--rollback');
const orgArg = process.argv.find((a) => a.startsWith('--org='));
const ONLY_ORG = orgArg ? orgArg.split('=')[1] : null;

const stats = {
  organizations: 0,
  employees: 0,
  templates: 0,
  assignments: 0,
  formSubmissions: 0,
  envelopes: 0,
  skipped: 0,
  failed: 0,
  rolledBack: 0
};

function log(message, level = 'info') {
  const prefix = { info: 'ℹ️', success: '✅', warning: '⚠️', error: '❌', debug: '🔍' }[level] || 'ℹ️';
  console.log(`${prefix} [${new Date().toISOString()}] ${message}`);
}

function deriveIdpUri() {
  if (process.env.IDP_MONGO_URI) return process.env.IDP_MONGO_URI;
  const uri = process.env.MONGO_URI || '';
  // Same cluster, different db name.
  if (/\/smart_hr_db(\?|$)/.test(uri)) return uri.replace(/\/smart_hr_db(\?|$)/, '/identity$1');
  throw new Error('Set IDP_MONGO_URI (could not derive the identity DB URI from MONGO_URI)');
}

function buildIdpModels(conn) {
  const loose = new mongoose.Schema({}, { strict: false });
  return {
    IdpOrganization: conn.model('AiinOrganization', loose, 'aiinorganizations'),
    IdpAccount: conn.model('AiinAccount', loose, 'aiinaccounts'),
    IdpTemplate: conn.model('AiinOnboardingTemplate', loose, 'aiinonboardingtemplates'),
    IdpAssignment: conn.model('AiinOnboardingAssignment', loose, 'aiinonboardingassignments')
  };
}

const MigrationMap = mongoose.model('OnboardingMigrationMap', new mongoose.Schema({
  idpId: { type: String, index: true },
  kind: { type: String, index: true },
  recruiterId: { type: mongoose.Schema.Types.ObjectId },
  organization: { type: mongoose.Schema.Types.ObjectId },
  status: String,
  error: String
}, { timestamps: true }), 'onboarding_migration_map');

async function recordMap(kind, idpId, recruiterId, organization) {
  if (DRY_RUN) return;
  await MigrationMap.updateOne(
    { kind, idpId: String(idpId) },
    { $set: { recruiterId, organization, status: 'migrated', error: '' } },
    { upsert: true }
  );
}

async function existingMapping(kind, idpId) {
  return MigrationMap.findOne({ kind, idpId: String(idpId) });
}

function splitName(name = '') {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] || '', lastName: parts.slice(1).join(' ') };
}

// IdP statuses map 1:1 onto recruiter statuses.
function mapAssignmentStatus(status) {
  return ['pending', 'in_progress', 'completed', 'cancelled'].includes(status) ? status : 'pending';
}

async function resolveSystemUser(orgId) {
  const owner = await User.findOne({
    'organizationMemberships.organization': orgId,
    'organizationMemberships.role': { $in: ['owner', 'admin', 'hr_manager'] }
  });
  if (owner) return owner._id;
  // Fall back to any user in THIS org (never an arbitrary global user, which
  // would leak a cross-org reference into migrated records).
  const any = await User.findOne({ currentOrganization: orgId })
    || await User.findOne({ 'organizationMemberships.organization': orgId });
  if (!any) throw new Error(`No recruiter User available in org ${orgId} to own migrated records`);
  return any._id;
}

// ---------------------------------------------------------------- employees
async function migrateEmployee(idpAccount, org) {
  const idpAccountId = String(idpAccount._id);
  const email = String(idpAccount.email || '').trim().toLowerCase();
  // Candidate.email is required + format-validated; an account without one
  // cannot be represented, so skip it (its assignments are reported failed).
  if (!email) {
    log(`Skipping employee ${idpAccountId}: no email on the IdP account`, 'warning');
    stats.skipped += 1;
    return null;
  }
  const existing = await Candidate.findOne({ organization: org._id, idpAccountId })
    || await Candidate.findOne({ organization: org._id, email, isInternalCandidate: true });
  if (existing) {
    await recordMap('employee', idpAccountId, existing._id, org._id);
    return existing;
  }
  const { firstName, lastName } = splitName(idpAccount.profile?.name);
  stats.employees += 1;
  if (DRY_RUN) return { _id: null, email };
  const candidate = await Candidate.create({
    organization: org._id,
    firstName: firstName || (email ? email.split('@')[0] : 'Employee'),
    lastName,
    email,
    isInternalCandidate: true,
    idpAccountId,
    idpMemberId: idpAccountId,
    idpOrganizationId: String(org.idpOrganizationId),
    status: 'Hired',
    source: 'Internal'
  });
  await recordMap('employee', idpAccountId, candidate._id, org._id);
  return candidate;
}

// ---------------------------------------------------------------- templates
async function migrateTemplate(idpTemplate, org, systemUserId) {
  const idpId = String(idpTemplate._id);
  const mapped = await existingMapping('template', idpId);
  if (mapped) { stats.skipped += 1; return mapped.recruiterId; }

  const workflowType = ['onboarding', 'agreement', 'policy', 'general'].includes(idpTemplate.workflowType)
    ? idpTemplate.workflowType : 'onboarding';

  const formTemplateIds = [];
  const documentIds = [];
  const workflowItems = [];

  for (const [index, item] of (idpTemplate.items || []).entries()) {
    const order = (index + 1) * 10;
    if (item.type === 'form') {
      const fields = (item.config?.fields || []).map((field, i) => ({
        id: String(field.key || `field-${i + 1}`),
        key: String(field.key || `field${i + 1}`),
        label: String(field.label || field.key || `Field ${i + 1}`),
        type: ['text', 'textarea', 'email', 'phone', 'date', 'number', 'select', 'checkbox', 'bank_account', 'routing_number', 'tax_id', 'address', 'file', 'image']
          .includes(field.type === 'tel' ? 'phone' : field.type) ? (field.type === 'tel' ? 'phone' : field.type) : 'text',
        required: Boolean(field.required),
        options: Array.isArray(field.options) ? field.options : []
      }));
      let formTemplateId = null;
      if (!DRY_RUN) {
        const ft = await OnboardingFormTemplate.create({
          organization: org._id, name: item.title || 'Migrated form', fields, isSystem: false, createdBy: systemUserId
        });
        formTemplateId = ft._id;
        formTemplateIds.push(ft._id);
      }
      workflowItems.push({ id: `form-${index + 1}`, type: 'form', title: item.title || 'Form', order, required: item.required !== false });
    } else if (item.type === 'esign') {
      const doc = item.config?.document || {};
      let documentId = null;
      if (!DRY_RUN && (doc.url || doc.publicId)) {
        const od = await OnboardingDocument.create({
          organization: org._id,
          title: item.title || 'Migrated document',
          sourceType: 'uploaded_pdf',
          originalFile: { url: doc.url, publicId: doc.publicId, originalName: doc.fileName, mimeType: doc.mimeType, bytes: doc.size },
          pdfSnapshot: { url: doc.url, publicId: doc.publicId, originalName: doc.fileName, mimeType: doc.mimeType, bytes: doc.size },
          createdBy: systemUserId,
          metadata: { idpItemId: item._id ? String(item._id) : undefined, idpSignatureFields: item.config?.signatureFields || [] }
        });
        documentId = od._id;
        documentIds.push(od._id);
      }
      workflowItems.push({ id: `document-${index + 1}`, type: 'document', title: item.title || 'Document', order, required: item.required !== false });
    } else if (item.type === 'upload') {
      // Recruiter has no native upload item; preserve as a task.
      workflowItems.push({ id: `task-${index + 1}`, type: 'task', title: item.title || 'Upload', order, required: item.required !== false, metadata: { kind: 'upload', accept: item.config?.accept } });
    }
  }

  stats.templates += 1;
  if (DRY_RUN) return null;
  const template = await OnboardingTemplate.create({
    organization: org._id,
    name: idpTemplate.name || 'Migrated packet',
    description: idpTemplate.description || '',
    category: workflowType,
    processType: 'onboarding',
    workflowType,
    isSystem: false,
    formTemplates: formTemplateIds,
    documents: documentIds,
    workflowItems,
    createdBy: systemUserId,
    updatedBy: systemUserId
  });
  await recordMap('template', idpId, template._id, org._id);
  return template._id;
}

// -------------------------------------------------------------- assignments
async function migrateAssignment(idpAssignment, org, systemUserId, IdpAccount) {
  const idpId = String(idpAssignment._id);
  const mapped = await existingMapping('assignment', idpId);
  if (mapped) { stats.skipped += 1; return; }

  // Resolve / create the internal employee candidate for this assignment.
  const memberAccount = await IdpAccount.findById(idpAssignment.member).lean();
  if (!memberAccount) { stats.failed += 1; log(`Assignment ${idpId}: member account missing`, 'warning'); return; }
  const candidate = await migrateEmployee(memberAccount, org);
  if (DRY_RUN) { stats.assignments += 1; return; }
  if (!candidate?._id) { stats.failed += 1; log(`Assignment ${idpId}: employee could not be migrated (no email?)`, 'warning'); return; }

  const workflowType = ['onboarding', 'agreement', 'policy', 'general'].includes(idpAssignment.workflowType)
    ? idpAssignment.workflowType : 'onboarding';
  const status = mapAssignmentStatus(idpAssignment.status);

  const onboarding = await CandidateOnboarding.create({
    organization: org._id,
    candidate: candidate._id,
    processType: 'onboarding',
    workflowType,
    audience: 'internal',
    status,
    title: `Migrated ${workflowType} - ${candidate.email}`,
    templateSnapshot: { migratedFromIdp: true, idpAssignmentId: idpId, items: idpAssignment.items || [] },
    startedBy: systemUserId,
    startedAt: idpAssignment.createdAt || new Date(),
    completedAt: idpAssignment.completedAt,
    cancelledAt: idpAssignment.cancelledAt,
    metadata: { idpAssignmentId: idpId }
  });

  // Record the mapping immediately so a mid-loop failure can't produce a
  // duplicate onboarding on re-run (clean orphans with --rollback).
  await recordMap('assignment', idpId, onboarding._id, org._id);

  const formIds = [];
  const envelopeIds = [];
  const workflowItemIds = [];

  for (const [index, item] of (idpAssignment.items || []).entries()) {
    const order = (index + 1) * 10;
    if (item.type === 'form') {
      const values = Object.entries(item.data?.form || {}).map(([key, value]) => ({
        fieldId: key, key, label: key, type: 'text', sensitive: false, value: String(value ?? '')
      }));
      const submission = await OnboardingFormSubmission.create({
        organization: org._id, onboarding: onboarding._id, candidate: candidate._id,
        title: item.title || 'Migrated form',
        status: item.status === 'completed' ? 'submitted' : 'draft',
        values
      });
      formIds.push(submission._id);
      stats.formSubmissions += 1;
      const wi = await OnboardingWorkflowItem.create({
        organization: org._id, onboarding: onboarding._id, type: 'form', title: item.title || 'Form',
        status: item.status === 'completed' ? 'completed' : 'pending', order,
        sourceType: 'form_submission', sourceId: submission._id
      });
      workflowItemIds.push(wi._id);
    } else if (item.type === 'esign') {
      const esign = item.data?.esign || {};
      const doc = item.config?.document || {};
      // OnboardingEnvelope.documents[].document is a required ref, so create the
      // backing document record (referencing the same shared Cloudinary asset).
      const documentRecord = await OnboardingDocument.create({
        organization: org._id,
        title: item.title || 'Migrated document',
        sourceType: 'uploaded_pdf',
        originalFile: { url: doc.url, publicId: doc.publicId, originalName: doc.fileName, mimeType: doc.mimeType },
        pdfSnapshot: { url: doc.url, publicId: doc.publicId, originalName: doc.fileName, mimeType: doc.mimeType },
        createdBy: systemUserId
      });
      // The already-signed PDF is the legal artifact; reference it as-is.
      const envelope = await OnboardingEnvelope.create({
        organization: org._id, onboarding: onboarding._id, candidate: candidate._id,
        title: item.title || 'Migrated document',
        status: item.status === 'completed' ? 'completed' : 'sent',
        createdBy: systemUserId,
        documents: [{
          document: documentRecord._id,
          title: item.title || 'Document',
          status: item.status === 'completed' ? 'completed' : 'pending',
          pdfSnapshot: { url: doc.url, publicId: doc.publicId, originalName: doc.fileName, mimeType: doc.mimeType },
          signedPdf: esign.signedUrl ? { url: esign.signedUrl, publicId: esign.signedPublicId, originalName: esign.signedFileName, mimeType: esign.signedMimeType } : undefined,
          signatureFields: [],
          signedAt: esign.signedAt
        }],
        signers: (esign.signers || []).map((signer, i) => ({
          key: `signer-${i + 1}`,
          role: 'candidate',
          name: signer.name || signer.signerName || '',
          email: signer.email || candidate.email,
          order: i + 1,
          status: signer.status === 'signed' ? 'signed' : 'pending',
          signedAt: signer.signedAt
        })),
        completedAt: item.status === 'completed' ? (esign.signedAt || idpAssignment.completedAt) : undefined,
        metadata: { idpItemId: item._id ? String(item._id) : undefined, idpSignatureFields: item.config?.signatureFields || [] }
      });
      envelopeIds.push(envelope._id);
      stats.envelopes += 1;
      const wi = await OnboardingWorkflowItem.create({
        organization: org._id, onboarding: onboarding._id, type: 'document', title: item.title || 'Document',
        status: item.status === 'completed' ? 'completed' : 'pending', order,
        sourceType: 'envelope', sourceId: envelope._id
      });
      workflowItemIds.push(wi._id);
    }
  }

  onboarding.forms = formIds;
  onboarding.envelopes = envelopeIds;
  onboarding.workflowItems = workflowItemIds;
  await onboarding.save();

  await recordMap('assignment', idpId, onboarding._id, org._id);
  stats.assignments += 1;
}

// ------------------------------------------------------------------ rollback
async function rollback() {
  const query = ONLY_ORG ? { organization: await recruiterOrgIdForIdp(ONLY_ORG) } : {};
  // Delete in reverse dependency order using the mapping collection.
  const maps = await MigrationMap.find(query.organization ? { organization: query.organization } : {});
  const byKind = (k) => maps.filter((m) => m.kind === k).map((m) => m.recruiterId);

  const assignments = byKind('assignment');
  for (const onboardingId of assignments) {
    await OnboardingWorkflowItem.deleteMany({ onboarding: onboardingId });
    await OnboardingFormSubmission.deleteMany({ onboarding: onboardingId });
    await OnboardingEnvelope.deleteMany({ onboarding: onboardingId });
    await CandidateOnboarding.deleteOne({ _id: onboardingId });
    stats.rolledBack += 1;
  }
  await OnboardingTemplate.deleteMany({ _id: { $in: byKind('template') } });
  // Internal candidates created by migration are left in place by default (they
  // may now back live onboarding); uncomment to remove:
  // await Candidate.deleteMany({ _id: { $in: byKind('employee') }, isInternalCandidate: true });
  await MigrationMap.deleteMany(query.organization ? { organization: query.organization } : {});
  log(`Rollback complete: removed ${stats.rolledBack} migrated transitions`, 'success');
}

async function recruiterOrgIdForIdp(idpOrgId) {
  const org = await Organization.findOne({ idpOrganizationId: String(idpOrgId) });
  return org?._id;
}

// ---------------------------------------------------------------------- main
async function main() {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required');
  await mongoose.connect(process.env.MONGO_URI);
  log(`Connected to recruiter DB${DRY_RUN ? ' (DRY RUN)' : ''}`, 'success');

  if (ROLLBACK) {
    await rollback();
    await mongoose.disconnect();
    return;
  }

  const idpConn = await mongoose.createConnection(deriveIdpUri()).asPromise();
  const { IdpOrganization, IdpAccount, IdpTemplate, IdpAssignment } = buildIdpModels(idpConn);
  log('Connected to IdP (identity) DB', 'success');

  const recruiterOrgs = await Organization.find(
    ONLY_ORG ? { idpOrganizationId: String(ONLY_ORG) } : { idpOrganizationId: { $exists: true, $ne: null } }
  );

  for (const org of recruiterOrgs) {
    const idpOrgId = org.idpOrganizationId;
    const idpOrg = await IdpOrganization.findById(idpOrgId).lean();
    if (!idpOrg) { log(`Recruiter org ${org._id} -> IdP org ${idpOrgId} not found, skipping`, 'warning'); continue; }
    stats.organizations += 1;
    log(`Org "${org.name}" (idp ${idpOrgId})`);

    const systemUserId = await resolveSystemUser(org._id);

    const templates = await IdpTemplate.find({ organization: idpOrgId }).lean();
    for (const t of templates) {
      try { await migrateTemplate(t, org, systemUserId); }
      catch (error) { stats.failed += 1; log(`Template ${t._id}: ${error.message}`, 'error'); }
    }

    const assignments = await IdpAssignment.find({ organization: idpOrgId }).lean();
    for (const a of assignments) {
      try { await migrateAssignment(a, org, systemUserId, IdpAccount); }
      catch (error) { stats.failed += 1; log(`Assignment ${a._id}: ${error.message}`, 'error'); }
    }
  }

  await idpConn.close();
  await mongoose.disconnect();

  log('--- Migration summary ---', 'success');
  Object.entries(stats).forEach(([k, v]) => log(`  ${k}: ${v}`));
  if (DRY_RUN) log('DRY RUN — no records were written', 'warning');
}

main().catch((error) => {
  log(error.stack || error.message, 'error');
  process.exit(1);
});
