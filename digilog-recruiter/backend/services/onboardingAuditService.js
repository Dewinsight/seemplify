const OnboardingAuditEvent = require('../models/OnboardingAuditEvent');

const requestContext = (req) => ({
  ip: req?.ip || req?.headers?.['x-forwarded-for'] || undefined,
  userAgent: req?.headers?.['user-agent'] || undefined
});

async function logOnboardingEvent({
  req,
  organization,
  onboarding,
  envelope,
  document,
  candidate,
  actorType = 'system',
  actorUser,
  actorCandidateAccount,
  actorEmail,
  action,
  metadata = {}
}) {
  if (!organization || !action) {
    return null;
  }

  const ctx = requestContext(req);
  return OnboardingAuditEvent.create({
    organization,
    onboarding,
    envelope,
    document,
    candidate,
    actorType,
    actorUser,
    actorCandidateAccount,
    actorEmail,
    action,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    metadata
  });
}

module.exports = {
  logOnboardingEvent
};
