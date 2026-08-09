/*
 * Canonical IDP onboarding -> Recruiter PeopleTransition migration.
 *
 * Dry-run is the default. Required environment:
 *   IDP_MONGODB_URI       source IDP database
 *   MONGO_URI             target Recruiter database
 *
 * Usage:
 *   node scripts/migrateIdpOnboardingToPeopleTransitions.js
 *   node scripts/migrateIdpOnboardingToPeopleTransitions.js --apply [--verify-files]
 *   node scripts/migrateIdpOnboardingToPeopleTransitions.js --rollback <manifest.json>
 */
require('dotenv').config();
const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const mongoose = require('mongoose');
const { EJSON } = require('bson');

const apply = process.argv.includes('--apply');
const verifyFiles = process.argv.includes('--verify-files');
const rollbackIndex = process.argv.indexOf('--rollback');
const sourceUri = process.env.IDP_MONGODB_URI;
const targetUri = process.env.MONGO_URI || process.env.MONGODB_URI;

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object' && !(value instanceof Date) && !value._bsontype) {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}
function checksum(value) { return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex'); }
function objectId(value) { return value instanceof mongoose.Types.ObjectId ? value : new mongoose.Types.ObjectId(String(value)); }
function processType(value) { return ['onboarding', 'agreement', 'policy', 'general'].includes(value) ? value : 'general'; }
function transitionStatus(value) {
  return ({ pending: 'pending', in_progress: 'in_progress', completed: 'completed', cancelled: 'cancelled' })[value] || 'pending';
}
function itemStatus(value) {
  return ({ pending: 'pending', submitted: 'in_progress', completed: 'completed' })[value] || 'pending';
}
function targetItemType(value) { return value === 'form' ? 'form' : 'document'; }
function fileSnapshot(file = {}) {
  return {
    url: file.url, downloadUrl: file.url, publicId: file.publicId,
    bytes: file.size, originalName: file.fileName, mimeType: file.mimeType,
  };
}

async function remoteChecksum(url) {
  if (!verifyFiles || !/^https:\/\//i.test(String(url || ''))) return null;
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Document download failed (${response.status})`);
  return crypto.createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex');
}

async function upsertPreservingId(collection, sourceId, document, rollback) {
  const existing = await collection.findOne({ _id: objectId(sourceId) });
  const marker = existing?.migration || existing?.metadata?.migration || existing?.variables?.migration;
  if (existing && (marker?.sourceSystem !== 'idp' || String(marker?.sourceId) !== String(sourceId))) {
    throw new Error(`Migration ID collision in ${collection.collectionName}: ${sourceId} already belongs to non-IDP data`);
  }
  document.migration = {
    ...(document.migration || {}),
    sourceSystem: 'idp',
    sourceId: String(sourceId),
  };
  rollback.push({ collection: collection.collectionName, id: String(sourceId), existed: Boolean(existing), previous: existing || null });
  await collection.updateOne({ _id: objectId(sourceId) }, { $set: document, $setOnInsert: { _id: objectId(sourceId) } }, { upsert: true });
}

async function rollbackMigration(targetDb, manifestPath) {
  const manifest = EJSON.parse(await fs.readFile(manifestPath, 'utf8'));
  for (const record of [...manifest.rollback].reverse()) {
    const collection = targetDb.collection(record.collection);
    if (record.existed) await collection.replaceOne({ _id: objectId(record.id) }, record.previous, { upsert: true });
    else await collection.deleteOne({ _id: objectId(record.id) });
  }
  return { restored: manifest.rollback.length, migrationId: manifest.migrationId };
}

async function run() {
  if (!sourceUri || !targetUri) throw new Error('IDP_MONGODB_URI and MONGO_URI (or MONGODB_URI) are required');
  const source = await mongoose.createConnection(sourceUri).asPromise();
  const target = await mongoose.createConnection(targetUri).asPromise();
  try {
    if (rollbackIndex >= 0) {
      if (!process.argv[rollbackIndex + 1]) throw new Error('--rollback requires a manifest path');
      console.log(JSON.stringify(await rollbackMigration(target.db, process.argv[rollbackIndex + 1]), null, 2));
      return;
    }

    const sourceCollections = {
      templates: source.db.collection('aiinonboardingtemplates'),
      assignments: source.db.collection('aiinonboardingassignments'),
      activities: source.db.collection('aiinonboardingactivities'),
      accounts: source.db.collection('aiinaccounts'),
    };
    const targetCollections = {
      organizations: target.db.collection('organizations'), users: target.db.collection('users'),
      templates: target.db.collection('onboardingtemplates'), transitions: target.db.collection('candidateonboardings'),
      workflowItems: target.db.collection('onboardingworkflowitems'), forms: target.db.collection('onboardingformsubmissions'),
      documents: target.db.collection('onboardingdocuments'), envelopes: target.db.collection('onboardingenvelopes'),
      audit: target.db.collection('onboardingauditevents'),
    };
    const [templates, assignments, activities] = await Promise.all([
      sourceCollections.templates.find({}).toArray(), sourceCollections.assignments.find({}).toArray(), sourceCollections.activities.find({}).toArray(),
    ]);
    const sourceOrgIds = [...new Set([...templates, ...assignments].map(item => String(item.organization)))];
    const targetOrgs = await targetCollections.organizations.find({ idpOrganizationId: { $in: sourceOrgIds } }).toArray();
    const orgMap = new Map(targetOrgs.map(org => [String(org.idpOrganizationId), org]));
    const missingOrganizations = sourceOrgIds.filter(id => !orgMap.has(id));
    if (missingOrganizations.length) throw new Error(`Recruiter organizations are missing IDP mappings: ${missingOrganizations.join(', ')}`);

    const accountIds = [...new Set(assignments.flatMap(item => [item.member, item.createdBy]).filter(Boolean).map(String))];
    const accounts = await sourceCollections.accounts.find({ _id: { $in: accountIds.map(objectId) } }).toArray();
    const accountMap = new Map(accounts.map(account => [String(account._id), account]));
    const userEmails = accounts.map(account => String(account.email || '').toLowerCase()).filter(Boolean);
    const targetUsers = await targetCollections.users.find({ email: { $in: userEmails } }).toArray();
    const userByEmail = new Map(targetUsers.map(user => [String(user.email).toLowerCase(), user]));
    const rollback = [];
    const counts = { templates: 0, transitions: 0, workflowItems: 0, forms: 0, documents: 0, envelopes: 0, auditEvents: 0 };
    const documentChecksums = [];

    for (const template of templates) {
      const org = orgMap.get(String(template.organization));
      const creator = userByEmail.get(String(accountMap.get(String(template.createdBy))?.email || '').toLowerCase()) || await targetCollections.users.findOne({ 'organizationMemberships.organization': org._id, 'organizationMemberships.isActive': true });
      if (!creator) throw new Error(`No Recruiter user can own migrated template ${template._id}`);
      const document = {
        organization: org._id, name: template.name, description: template.description,
        category: 'idp-migrated', processType: processType(template.workflowType), status: 'active', version: 1,
        workflowItems: (template.items || []).map((item, index) => ({
          id: String(item._id), type: targetItemType(item.type), title: item.title, description: item.description,
          ownerType: 'user', order: index, required: item.required !== false,
          metadata: { sourceSystem: 'idp', sourceId: String(item._id), idpType: item.type, config: item.config },
        })),
        createdBy: creator._id, updatedBy: creator._id, createdAt: template.createdAt, updatedAt: template.updatedAt,
        migration: { sourceSystem: 'idp', sourceId: String(template._id), sourceChecksum: checksum(template) },
      };
      counts.templates += 1;
      if (apply) await upsertPreservingId(targetCollections.templates, template._id, document, rollback);
    }

    for (const assignment of assignments) {
      const org = orgMap.get(String(assignment.organization));
      const member = accountMap.get(String(assignment.member));
      const creatorAccount = accountMap.get(String(assignment.createdBy));
      const creator = userByEmail.get(String(creatorAccount?.email || '').toLowerCase()) || await targetCollections.users.findOne({ 'organizationMemberships.organization': org._id, 'organizationMemberships.isActive': true });
      if (!member || !creator) throw new Error(`Assignment ${assignment._id} is missing its member or Recruiter owner mapping`);
      const sourceChecksum = checksum(assignment);
      const workflowIds = (assignment.items || []).map(item => item._id);
      const formIds = (assignment.items || []).filter(item => item.type === 'form').map(item => item._id);
      const documentIds = (assignment.items || []).filter(item => item.type !== 'form').map(item => item._id);
      const envelopeIds = (assignment.items || []).filter(item => item.type === 'esign').map(item => item._id);
      const transition = {
        organization: org._id,
        subject: { type: 'idp_member', idpAccountId: member.sub || String(member._id), email: member.email, name: member.profile?.name || member.email, snapshot: { sourceAccountId: String(member._id) } },
        processType: processType(assignment.workflowType), status: transitionStatus(assignment.status), title: assignment.title || `${assignment.workflowType || 'Onboarding'} workflow`,
        template: assignment.template, templateSnapshot: { sourceSystem: 'idp', sourceAssignment: assignment },
        progress: { totalItems: assignment.items?.length || 0, completedItems: (assignment.items || []).filter(item => item.status === 'completed').length, percent: assignment.items?.length ? Math.round((assignment.items.filter(item => item.status === 'completed').length / assignment.items.length) * 100) : 0 },
        dueAt: assignment.dueAt, startedBy: creator._id, startedAt: assignment.createdAt,
        completedAt: assignment.completedAt, cancelledAt: assignment.cancelledAt,
        workflowItems: workflowIds, forms: formIds, documents: documentIds, envelopes: envelopeIds,
        identityAction: { mode: 'manual', status: 'not_ready' },
        migration: { sourceSystem: 'idp', sourceId: String(assignment._id), sourceChecksum, migratedAt: new Date(), reconciliationStatus: verifyFiles ? 'pending' : 'verified' },
        createdAt: assignment.createdAt, updatedAt: assignment.updatedAt,
      };
      counts.transitions += 1;
      if (apply) await upsertPreservingId(targetCollections.transitions, assignment._id, transition, rollback);

      for (let index = 0; index < (assignment.items || []).length; index += 1) {
        const item = assignment.items[index];
        const workflow = {
          organization: org._id, onboarding: assignment._id, type: targetItemType(item.type), title: item.title,
          description: item.description, status: itemStatus(item.status), ownerType: 'user', required: item.required !== false,
          order: index, dueAt: assignment.dueAt, sourceType: item.type === 'form' ? 'form_submission' : item.type === 'esign' ? 'envelope' : 'document', sourceId: item._id,
          completedAt: item.status === 'completed' ? item.data?.esign?.signedAt || item.data?.upload?.uploadedAt || assignment.updatedAt : null,
          metadata: { sourceSystem: 'idp', sourceId: String(item._id), idpType: item.type, config: item.config }, createdAt: assignment.createdAt, updatedAt: assignment.updatedAt,
        };
        counts.workflowItems += 1;
        if (apply) await upsertPreservingId(targetCollections.workflowItems, item._id, workflow, rollback);

        if (item.type === 'form') {
          const fields = item.config?.fields || [];
          const values = Object.entries(item.data?.form || {}).map(([key, value]) => {
            const field = fields.find(candidate => candidate.key === key) || {};
            return { fieldId: key, key, label: field.label || key, type: field.type || 'text', sensitive: false, value, updatedAt: assignment.updatedAt };
          });
          const form = { organization: org._id, onboarding: assignment._id, title: item.title, status: item.status === 'completed' ? 'approved' : item.status === 'submitted' ? 'submitted' : 'draft', templateSnapshot: { sourceSystem: 'idp', config: item.config }, values, submittedAt: item.status !== 'pending' ? assignment.updatedAt : null, createdAt: assignment.createdAt, updatedAt: assignment.updatedAt };
          counts.forms += 1; if (apply) await upsertPreservingId(targetCollections.forms, item._id, form, rollback);
        } else {
          const original = item.type === 'upload' ? item.data?.upload || {} : { ...(item.config?.document || {}), url: item.data?.esign?.originalUrl || item.config?.document?.url };
          const signed = item.data?.esign ? { url: item.data.esign.signedUrl, publicId: item.data.esign.signedPublicId, fileName: item.data.esign.signedFileName, mimeType: item.data.esign.signedMimeType } : null;
          const originalHash = await remoteChecksum(original.url).catch(error => `ERROR:${error.message}`) || checksum(original);
          const signedHash = signed?.url ? await remoteChecksum(signed.url).catch(error => `ERROR:${error.message}`) || checksum(signed) : null;
          documentChecksums.push({ sourceItemId: String(item._id), originalUrl: original.url, originalHash, signedUrl: signed?.url, signedHash, verification: verifyFiles ? 'content' : 'reference' });
          const document = { organization: org._id, title: item.title, description: item.description, sourceType: 'uploaded_pdf', status: item.status === 'completed' ? 'archived' : 'sent', originalFile: fileSnapshot(original), pdfSnapshot: fileSnapshot(original), lockedAt: item.status === 'completed' ? assignment.updatedAt : null, createdBy: creator._id, updatedBy: creator._id, variables: { migration: { sourceSystem: 'idp', sourceId: String(item._id), originalHash, signedHash } }, createdAt: assignment.createdAt, updatedAt: assignment.updatedAt };
          counts.documents += 1; if (apply) await upsertPreservingId(targetCollections.documents, item._id, document, rollback);
          if (item.type === 'esign') {
            const signers = (item.data?.esign?.signers || item.config?.signers || []).map((signer, signerIndex) => ({ key: String(signer.member || signerIndex), role: 'internal', name: signer.signerName || signer.name, email: signer.email || signer.signerEmail || member.email, order: signerIndex + 1, status: signer.status === 'signed' || signer.signedAt ? 'signed' : 'pending', signedAt: signer.signedAt }));
            if (!signers.length) signers.push({ key: 'assignee', role: 'internal', name: member.profile?.name, email: member.email, order: 1, status: item.data?.esign?.signedAt ? 'signed' : 'pending', signedAt: item.data?.esign?.signedAt });
            const envelope = { organization: org._id, onboarding: assignment._id, contextType: 'candidate_transition', processType: processType(assignment.workflowType), title: item.title, status: item.data?.esign?.signedAt ? 'completed' : 'sent', documents: [{ document: item._id, title: item.title, status: item.data?.esign?.signedAt ? 'signed' : 'pending', pdfSnapshot: fileSnapshot(original), signedPdf: fileSnapshot(signed || {}), signedAt: item.data?.esign?.signedAt }], signers, createdBy: creator._id, sentAt: assignment.createdAt, completedAt: item.data?.esign?.signedAt, createdAt: assignment.createdAt, updatedAt: assignment.updatedAt };
            counts.envelopes += 1; if (apply) await upsertPreservingId(targetCollections.envelopes, item._id, envelope, rollback);
          }
        }
      }
    }

    for (const activity of activities) {
      const org = orgMap.get(String(activity.organization)); if (!org) continue;
      const actor = accountMap.get(String(activity.actor)); const actorUser = userByEmail.get(String(actor?.email || '').toLowerCase());
      const event = { organization: org._id, onboarding: activity.assignment, actorType: actorUser ? 'user' : 'system', actorUser: actorUser?._id, actorEmail: actor?.email, action: activity.type, metadata: { ...activity.metadata, sourceSystem: 'idp', sourceId: String(activity._id), sourceChecksum: checksum(activity) }, createdAt: activity.createdAt };
      counts.auditEvents += 1; if (apply) await upsertPreservingId(targetCollections.audit, activity._id, event, rollback);
    }

    const migrationId = `idp-people-transitions-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    const targetActual = apply ? {
      templates: await targetCollections.templates.countDocuments({ _id: { $in: templates.map(item => item._id) } }),
      transitions: await targetCollections.transitions.countDocuments({ _id: { $in: assignments.map(item => item._id) } }),
      workflowItems: await targetCollections.workflowItems.countDocuments({ _id: { $in: assignments.flatMap(item => (item.items || []).map(child => child._id)) } }),
      forms: await targetCollections.forms.countDocuments({ _id: { $in: assignments.flatMap(item => (item.items || []).filter(child => child.type === 'form').map(child => child._id)) } }),
      documents: await targetCollections.documents.countDocuments({ _id: { $in: assignments.flatMap(item => (item.items || []).filter(child => child.type !== 'form').map(child => child._id)) } }),
      envelopes: await targetCollections.envelopes.countDocuments({ _id: { $in: assignments.flatMap(item => (item.items || []).filter(child => child.type === 'esign').map(child => child._id)) } }),
      auditEvents: await targetCollections.audit.countDocuments({ _id: { $in: activities.map(item => item._id) } }),
    } : null;
    const countsAgree = !apply || Object.entries(counts).every(([key, value]) => targetActual[key] === value);
    const allDocumentHashesVerified = verifyFiles && documentChecksums.every(item => item.originalHash && !String(item.originalHash).startsWith('ERROR:') && (!item.signedUrl || (item.signedHash && !String(item.signedHash).startsWith('ERROR:'))));
    if (apply) await targetCollections.transitions.updateMany(
      { _id: { $in: assignments.map(item => item._id) } },
      { $set: { 'migration.reconciliationStatus': countsAgree && allDocumentHashesVerified ? 'verified' : 'mismatch' } }
    );
    const reconciliation = {
      source: { templates: templates.length, transitions: assignments.length, auditEvents: activities.length, embeddedItems: assignments.reduce((sum, item) => sum + (item.items?.length || 0), 0) },
      targetPlanned: counts,
      targetActual,
      countsAgree,
      sourceChecksum: checksum({ templates, assignments, activities }),
      documentChecksums,
      allDocumentHashesVerified,
    };
    const manifest = { migrationId, dryRun: !apply, createdAt: new Date(), counts, reconciliation, rollback };
    if (apply) {
      const outputDir = process.env.TRANSITION_MIGRATION_MANIFEST_DIR || path.join(__dirname, '..', 'migration-manifests');
      await fs.mkdir(outputDir, { recursive: true });
      const outputPath = path.join(outputDir, `${migrationId}.json`);
      await fs.writeFile(outputPath, EJSON.stringify(manifest, null, 2), { mode: 0o600 });
      console.log(JSON.stringify({ applied: true, outputPath, reconciliation }, null, 2));
    } else console.log(JSON.stringify({ dryRun: true, reconciliation }, null, 2));
  } finally {
    await Promise.all([source.close(), target.close()]);
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
