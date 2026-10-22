'use strict';
const Document = require('../models/AppraisalDocument');
const Assessment = require('../models/CompetencyAssessment');
const Evidence = require('../models/CompetencyEvidence');
const { DomainError } = require('../contracts/competency');

// Submission uses the frozen launch policy, never a value supplied by an employee
// or a mutable cycle. Reading a CV is not required to prove a file was uploaded.
async function hasCv(appraisal, now = new Date()) {
  const organizationId = String(appraisal.organizationId), appraisalId = String(appraisal._id);
  const document = await Document.findOne({ organizationId, appraisalId: appraisal._id,
    _id: { $in: appraisal.documents || [] }, category: 'cv', status: 'active',
    visibility: { $in: ['employee_manager', 'all_reviewers'] }, fileType: { $in: ['pdf', 'docx', 'txt'] },
    fileSize: { $gt: 0 }, fileName: { $type: 'string', $ne: '' } }).select('_id').lean();
  if (document) return true;
  const linked = await Assessment.findOne({ organizationId, appraisalId, 'participant.userId': String(appraisal.employee.userId) }).select('_id').lean();
  if (!linked) return false;
  const sources = await Evidence.find({ organizationId, assessmentId: String(linked._id), participantId: String(appraisal.employee.userId),
    documentType: 'cv', kind: 'file', status: 'ready', visibility: 'participant', size: { $gt: 0 },
    storageKey: { $type: 'string', $ne: '' } }).select('+storageKey').lean();
  return sources.some(source => !source.deletedAt && !source.source?.oralSessionId && !source.source?.withdrawnAt
    && !source.source?.sourceWithdrawnAt && !['withdrawn', 'expired', 'source_unavailable'].includes(source.source?.status)
    && (!source.retention?.expiresAt || new Date(source.retention.expiresAt) > now));
}

async function assertSubmissionCv(appraisal) {
  if (appraisal.cycleConfigurationSnapshot?.cvRequired !== true) return;
  if (!await hasCv(appraisal)) throw new DomainError(422, 'CV_REQUIRED', 'Upload your CV in the CV section before submitting this self-assessment. You can still save your draft.');
}

async function statusFor(appraisal) {
  const required = appraisal.cycleConfigurationSnapshot?.cvRequired === true;
  return { required, fulfilled: required ? await hasCv(appraisal) : false };
}

module.exports = { hasCv, assertSubmissionCv, statusFor };
