'use strict';
const Settings = require('../../models/CompetencySettings');
const { DomainError, cleanObject, hash } = require('../../contracts/competency');
const { requireAction, audit } = require('./authorizationService');
const defaults = { revision: 0, callEvidenceEnabled: false, aiDraftsEnabled: false, mediaRetentionDays: null, evidenceRetentionDays: null, exportRetentionHours: 24, noticeText: '', noticeVersion: '', policyVersion: '' };
async function getSettings(organizationId) {
  const saved = await Settings.findOne({ organizationId }).select('-_id -__v').lean();
  return { organizationId, ...defaults, ...(saved || {}) };
}
async function updateSettings(ctx, input, revision) {
  requireAction(ctx, 'retention.manage');
  if (!ctx.organizationWide) throw new DomainError(403, 'ORGANIZATION_SETTINGS_DENIED', 'An organisation administrator or HR manager must configure these settings.');
  cleanObject(input, ['callEvidenceEnabled', 'aiDraftsEnabled', 'mediaRetentionDays', 'evidenceRetentionDays', 'exportRetentionHours', 'noticeText']);
  const previous = await getSettings(ctx.organizationId);
  if (previous.revision !== revision) throw new DomainError(409, 'REVISION_CONFLICT', 'These settings changed. Reload them before saving.');
  const value = Object.fromEntries(Object.keys(defaults).filter(key => key !== 'revision' && !['policyVersion', 'noticeVersion'].includes(key)).map(key => [key, input[key] === undefined ? previous[key] : input[key]]));
  for (const key of ['callEvidenceEnabled', 'aiDraftsEnabled']) if (typeof value[key] !== 'boolean') throw new DomainError(422, 'INVALID_SETTINGS', 'Choose whether calls and AI drafts are enabled.');
  for (const key of ['mediaRetentionDays', 'evidenceRetentionDays']) if (value[key] !== null && (!Number.isInteger(value[key]) || value[key] < 1 || value[key] > 3650)) throw new DomainError(422, 'INVALID_RETENTION', 'Retention must be between one and 3,650 days.');
  if (!Number.isInteger(value.exportRetentionHours) || value.exportRetentionHours < 1 || value.exportRetentionHours > 168) throw new DomainError(422, 'INVALID_EXPORT_RETENTION', 'PDF download retention must be between one and 168 hours.');
  if (typeof value.noticeText !== 'string' || value.noticeText.length > 10000) throw new DomainError(422, 'INVALID_NOTICE', 'Enter an assessment processing notice of at most 10,000 characters.');
  value.noticeText = value.noticeText.trim();
  if ((value.callEvidenceEnabled || value.aiDraftsEnabled) && (!value.noticeText || (value.callEvidenceEnabled && !value.mediaRetentionDays))) throw new DomainError(422, 'NOTICE_REQUIRED', 'Set the processing notice and recording retention before enabling call evidence.');
  if (value.aiDraftsEnabled && !value.evidenceRetentionDays) throw new DomainError(422, 'AI_RETENTION_REQUIRED', 'Set evidence retention before enabling AI drafts.');
  const policyVersion = hash(value), noticeVersion = value.noticeText ? hash({ text: value.noticeText, mediaRetentionDays: value.mediaRetentionDays }) : '';
  let result;
  try {
    if (!previous.revision) result = await Settings.create({ organizationId: ctx.organizationId, ...value, policyVersion, noticeVersion, revision: 1, updatedBy: ctx.actor });
    else result = await Settings.findOneAndUpdate({ organizationId: ctx.organizationId, revision }, { $set: { ...value, policyVersion, noticeVersion, updatedBy: ctx.actor }, $inc: { revision: 1 } }, { new: true, runValidators: true });
  } catch (error) { if (error.code === 11000) throw new DomainError(409, 'REVISION_CONFLICT', 'These settings changed. Reload them before saving.'); throw error; }
  if (!result) throw new DomainError(409, 'REVISION_CONFLICT', 'These settings changed. Reload them before saving.');
  await audit(ctx, 'settings.updated', 'settings', null, { beforeHash: previous.policyVersion, afterHash: policyVersion, revision: result.revision });
  return getSettings(ctx.organizationId);
}
module.exports = { getSettings, updateSettings };
