const authMiddleware = require('./authMiddleware');
const capabilityService = require('../services/publicFeedbackCapabilityService');

function notFound(res) {
  return res.status(404).json({
    code: 'PUBLIC_FEEDBACK_ACCESS_NOT_FOUND',
    msg: 'Public feedback access was not found'
  });
}

async function authorize(req, res, next) {
  try {
    const interviewId = req.params.interviewId;
    const candidateId = req.params.id;
    const token = req.get('X-Public-Feedback-Token') || req.query?.accessToken;
    let interview;

    // An emailed capability is an independent bearer credential. Browser API
    // helpers may also attach an expired or wrong-tenant login token; that must
    // not override a valid interview-scoped capability.
    if (token) {
      interview = await capabilityService.verify(interviewId, token, { candidateId });
      if (!interview) return notFound(res);
    } else if (req.user?.currentOrganization) {
      const Interview = require('../models/Interview');
      interview = await Interview.findById(interviewId).select('candidateId organizationId jobId status publicFeedbackRevokedAt');
      if (
        !interview
        || interview.status === 'cancelled'
        || interview.publicFeedbackRevokedAt
        || !(await capabilityService.hasActiveCandidate(interview))
        || (candidateId && String(interview.candidateId || '') !== String(candidateId))
        || !(await capabilityService.belongsToOrganization(interview, req.user.currentOrganization))
      ) return notFound(res);
    } else {
      return notFound(res);
    }

    req.publicFeedbackInterview = interview;
    return next();
  } catch {
    return notFound(res);
  }
}

function requirePublicFeedbackAccess(req, res, next) {
  if (req.get('X-Public-Feedback-Token') || req.query?.accessToken) {
    return authorize(req, res, next);
  }
  if (req.get('Authorization')) {
    return authMiddleware(req, res, () => authorize(req, res, next));
  }
  return authorize(req, res, next);
}

module.exports = requirePublicFeedbackAccess;
