/**
 * Onboarding handoff executor.
 *
 * Fills the gap where recruiter onboarding completes for an internal employee:
 * pushes the collected profile/banking data into the IdP (the source of truth
 * for employee identity) and marks the member onboarded. Other handoff targets
 * (exit/asset/IT/payroll closeout) remain internal and are not handled here.
 *
 * The executor never throws — it records running/completed/failed on the
 * OnboardingHandoff so a candidate-triggered completion is never blocked and a
 * failed push can be retried via POST /api/onboarding/handoffs/run.
 */

const OnboardingHandoff = require('../models/OnboardingHandoff');
const CandidateOnboarding = require('../models/CandidateOnboarding');
const Candidate = require('../models/Candidate');
const Organization = require('../models/Organization');
const OnboardingFormSubmission = require('../models/OnboardingFormSubmission');
const idpService = require('./idpService');
const { decryptValue } = require('./onboardingSecurityService');
const { buildIdpProfilePayload } = require('../config/idpProfileMapping');
const { logOnboardingEvent } = require('./onboardingAuditService');

// Handoff targets that should be pushed to the Identity Provider.
const IDP_HANDOFF_TARGETS = new Set(['internal_employee_profile', 'identity_provider']);

// Stop retrying a handoff after this many attempts.
const MAX_HANDOFF_ATTEMPTS = 5;

function isIdpTarget(target) {
  return IDP_HANDOFF_TARGETS.has(target);
}

// Flatten an onboarding's form submissions into { [key]: plainValue },
// decrypting sensitive values in-memory only.
async function collectFormValues(onboardingId) {
  const submissions = await OnboardingFormSubmission.find({ onboarding: onboardingId });
  const values = {};
  for (const submission of submissions) {
    for (const entry of submission.values || []) {
      if (!entry?.key) continue;
      let plain = '';
      if (entry.sensitive && entry.encryptedValue) {
        try {
          plain = decryptValue(entry.encryptedValue);
        } catch (error) {
          plain = '';
        }
      } else if (entry.value !== undefined && entry.value !== null) {
        plain = entry.value;
      }
      // Last non-empty value for a key wins (defaults are filled first).
      if (plain !== '' && plain !== undefined) values[entry.key] = plain;
      else if (!(entry.key in values)) values[entry.key] = plain;
    }
  }
  return values;
}

// Resolve the IdP member id for a candidate. Prefers the stored idpAccountId;
// otherwise looks the member up by employeeId/email via the IdP members API.
async function resolveMemberId({ candidate, idpOrganizationId, userId }) {
  if (candidate?.idpAccountId) return candidate.idpAccountId;

  try {
    const payload = await idpService.getOrganizationMembers(idpOrganizationId, userId);
    const members = Array.isArray(payload?.members) ? payload.members : [];
    const email = String(candidate?.email || '').trim().toLowerCase();
    const employeeId = String(candidate?.employeeId || '').trim();
    const match = members.find((member) =>
      (employeeId && String(member.employeeId || '').trim() === employeeId) ||
      (email && String(member.email || '').trim().toLowerCase() === email)
    );
    return match ? String(match.id || match.sub || '') : null;
  } catch (error) {
    return null;
  }
}

/**
 * Execute a single IdP-bound handoff.
 * @param {string} handoffId
 * @param {Object} options
 * @param {string} [options.userId] - recruiter User id to authenticate the IdP call
 * @param {Object} [options.req] - request for audit logging
 * @returns {Promise<Object|null>} the updated handoff (or null if not found)
 */
async function executeHandoff(handoffId, { userId, req } = {}) {
  const handoff = await OnboardingHandoff.findById(handoffId);
  if (!handoff) return null;
  if (!isIdpTarget(handoff.target)) return handoff;
  if (handoff.status === 'completed') return handoff;
  if (handoff.attempts >= MAX_HANDOFF_ATTEMPTS) return handoff;

  // Mark running first so concurrent runs don't double-fire (combined with the
  // unique {onboarding, target} index on the model).
  handoff.status = 'running';
  handoff.attempts += 1;
  await handoff.save();

  try {
    const onboarding = await CandidateOnboarding.findById(handoff.onboarding);
    if (!onboarding) throw new Error('Onboarding not found');

    const authUserId = userId || onboarding.startedBy;
    if (!authUserId) throw new Error('No recruiter user available to authenticate the IdP call');

    const [candidate, organization] = await Promise.all([
      Candidate.findById(handoff.candidate || onboarding.candidate),
      Organization.findById(handoff.organization || onboarding.organization)
    ]);
    if (!organization?.idpOrganizationId) {
      throw new Error('Organization is not linked to the Identity Provider');
    }

    const memberId = await resolveMemberId({
      candidate,
      idpOrganizationId: organization.idpOrganizationId,
      userId: authUserId
    });
    if (!memberId) {
      throw new Error('Could not resolve the employee in the Identity Provider');
    }

    const values = await collectFormValues(onboarding._id);
    const profilePayload = buildIdpProfilePayload(values);

    if (Object.keys(profilePayload).length) {
      await idpService.updateEmployeeProfile(organization.idpOrganizationId, memberId, profilePayload, authUserId);
    }
    await idpService.setMemberOnboardingStatus(organization.idpOrganizationId, memberId, 'completed', authUserId);

    handoff.status = 'completed';
    handoff.completedAt = new Date();
    handoff.lastError = '';
    await handoff.save();

    await logOnboardingEvent({
      req,
      organization: handoff.organization,
      onboarding: handoff.onboarding,
      candidate: handoff.candidate,
      actorType: 'system',
      action: 'idp_handoff_completed',
      metadata: { target: handoff.target, memberId, pushedProfile: Object.keys(profilePayload) }
    });
  } catch (error) {
    handoff.status = 'failed';
    handoff.lastError = String(error?.message || error || 'Handoff failed').slice(0, 500);
    await handoff.save();

    await logOnboardingEvent({
      req,
      organization: handoff.organization,
      onboarding: handoff.onboarding,
      candidate: handoff.candidate,
      actorType: 'system',
      action: 'idp_handoff_failed',
      metadata: { target: handoff.target, error: handoff.lastError }
    }).catch(() => {});
  }

  return handoff;
}

/**
 * Run all pending/failed IdP-bound handoffs for an organization (retry runner).
 */
async function executePendingHandoffs(organizationId, { userId, limit = 50 } = {}) {
  const handoffs = await OnboardingHandoff.find({
    organization: organizationId,
    target: { $in: Array.from(IDP_HANDOFF_TARGETS) },
    status: { $in: ['pending', 'failed', 'running'] },
    attempts: { $lt: MAX_HANDOFF_ATTEMPTS }
  })
    .sort({ updatedAt: 1 })
    .limit(limit);

  let completed = 0;
  let failed = 0;
  for (const handoff of handoffs) {
    const result = await executeHandoff(handoff._id, { userId });
    if (result?.status === 'completed') completed += 1;
    else failed += 1;
  }
  return { scanned: handoffs.length, completed, failed };
}

module.exports = {
  executeHandoff,
  executePendingHandoffs,
  isIdpTarget,
  IDP_HANDOFF_TARGETS,
  MAX_HANDOFF_ATTEMPTS
};
