const CompensationApprovalPolicy = require('../models/CompensationApprovalPolicy');
const CompensationRequest = require('../models/CompensationRequest');
const PayrollApprovalPolicy = require('../models/PayrollApprovalPolicy');
const PayrollProfile = require('../models/PayrollProfile');

function defaultCompensationPolicy(organizationId, actorId = 'system:default-policy-seed') {
  return {
    organizationId,
    approvalRequired: true,
    requireSeparationOfDuties: true,
    defaultOvertimeMultiplier: 1.5,
    allowMultiplierOverride: false,
    requireEvidenceReference: false,
    preventTimesheetOverlap: true,
    maximumHoursPerRequest: 24,
    approverRoles: ['hr_admin'],
    createdBy: actorId,
    updatedBy: actorId,
  };
}

async function getOrCreateCompensationPolicy(organizationId, actorId) {
  if (!organizationId) throw new Error('organizationId is required');
  return CompensationApprovalPolicy.findOneAndUpdate(
    { organizationId },
    { $setOnInsert: defaultCompensationPolicy(organizationId, actorId) },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
  );
}

async function seedDefaultCompensationPolicies({ organizationIds, actorId = 'system:default-policy-seed' } = {}) {
  const discovered = organizationIds || [
    ...await CompensationApprovalPolicy.distinct('organizationId'),
    ...await CompensationRequest.distinct('organizationId'),
    ...await PayrollApprovalPolicy.distinct('organizationId'),
    ...await PayrollProfile.distinct('organizationId'),
  ];
  const ids = [...new Set(discovered.map(String).filter(Boolean))];
  let created = 0;
  for (const organizationId of ids) {
    const exists = await CompensationApprovalPolicy.exists({ organizationId });
    if (!exists) {
      await getOrCreateCompensationPolicy(organizationId, actorId);
      created += 1;
    }
  }
  return { organizations: ids.length, created };
}

module.exports = {
  defaultCompensationPolicy,
  getOrCreateCompensationPolicy,
  seedDefaultCompensationPolicies,
};
