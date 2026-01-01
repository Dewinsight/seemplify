const { requireAuth, optionalAuth, refreshUserInfo } = require('./auth');
const {
  requireOrganization,
  requireLeavePermission,
  canApproveLeaveForUser,
  requireApprovalPermission,
} = require('./organization');
const { validateHubToken, generateHubToken } = require('./hubAuth');
const {
  createLeaveRequestLimiter,
  approvalLimiter,
  balanceUpdateLimiter,
  generalLimiter,
  authLimiter,
} = require('./rateLimiter');
const { AppError, errorHandler, asyncHandler, notFoundHandler } = require('./errorHandler');

module.exports = {
  // Auth
  requireAuth,
  optionalAuth,
  refreshUserInfo,

  // Organization
  requireOrganization,
  requireLeavePermission,
  canApproveLeaveForUser,
  requireApprovalPermission,

  // Hub
  validateHubToken,
  generateHubToken,

  // Rate limiting
  createLeaveRequestLimiter,
  approvalLimiter,
  balanceUpdateLimiter,
  generalLimiter,
  authLimiter,

  // Error handling
  AppError,
  errorHandler,
  asyncHandler,
  notFoundHandler,
};
