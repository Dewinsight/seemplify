'use strict';

const { toOrganizationId } = require('./performanceOrganizationAccess');

function normalizeIdentifier(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function getRequestUserId(req) {
  const user = req?.session?.user || req?.user || {};
  return normalizeIdentifier(user.id || user.sub);
}

function getCurrentOrganizationId(req) {
  const user = req?.session?.user || req?.user || {};
  return toOrganizationId(
    req?.currentOrganization
      || req?.session?.currentOrganizationId
      || user.currentOrganization
      || user.userinfo?.currentOrganization
      || user.userinfo?.current_organization
  );
}

function identifiersMatch(left, right) {
  const normalizedLeft = normalizeIdentifier(left);
  const normalizedRight = normalizeIdentifier(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

function isHRAdmin(req) {
  return String(req?.userRole || '').trim().toLowerCase() === 'hr_admin';
}

function canAccessOneOnOne(req, meeting) {
  const userId = getRequestUserId(req);
  return Boolean(
    meeting
      && (isHRAdmin(req)
        || identifiersMatch(meeting.managerId, userId)
        || identifiersMatch(meeting.employeeId, userId))
  );
}

function canAccessDevelopmentPlan(req, plan) {
  const userId = getRequestUserId(req);
  return Boolean(
    plan
      && (isHRAdmin(req)
        || identifiersMatch(plan.userId, userId)
        || identifiersMatch(plan.managerId, userId))
  );
}

function currentOrganizationRecordFilter(req, recordId) {
  const organizationId = getCurrentOrganizationId(req);
  if (!organizationId) return null;
  return { _id: recordId, organizationId };
}

module.exports = {
  normalizeIdentifier,
  getRequestUserId,
  getCurrentOrganizationId,
  identifiersMatch,
  isHRAdmin,
  canAccessOneOnOne,
  canAccessDevelopmentPlan,
  currentOrganizationRecordFilter
};
