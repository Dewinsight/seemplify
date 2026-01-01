const rateLimit = require('express-rate-limit');

// Leave request creation: 10 per hour per user
const createLeaveRequestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  message: {
    error: 'Too many leave requests created, please try again later',
    code: 'RATE_LIMIT_EXCEEDED',
    retryAfter: '1 hour',
  },
  keyGenerator: (req) => `${req.user?.id || req.ip}-create-leave`,
  standardHeaders: true,
  legacyHeaders: false,
});

// Approval actions: 50 per hour per approver
const approvalLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 50,
  message: {
    error: 'Too many approval actions, please try again later',
    code: 'RATE_LIMIT_EXCEEDED',
    retryAfter: '1 hour',
  },
  keyGenerator: (req) => `${req.user?.id || req.ip}-approve`,
  standardHeaders: true,
  legacyHeaders: false,
});

// Balance updates: 20 per hour per admin
const balanceUpdateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20,
  message: {
    error: 'Too many balance updates, please try again later',
    code: 'RATE_LIMIT_EXCEEDED',
    retryAfter: '1 hour',
  },
  keyGenerator: (req) => `${req.user?.id || req.ip}-balance-update`,
  standardHeaders: true,
  legacyHeaders: false,
});

// General API rate limiter
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: {
    error: 'Too many requests, please try again later',
    code: 'RATE_LIMIT_EXCEEDED',
    retryAfter: '15 minutes',
  },
  keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
});

// Auth endpoints rate limiter (stricter)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  message: {
    error: 'Too many authentication attempts, please try again later',
    code: 'RATE_LIMIT_EXCEEDED',
    retryAfter: '15 minutes',
  },
  keyGenerator: (req) => req.ip,
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = {
  createLeaveRequestLimiter,
  approvalLimiter,
  balanceUpdateLimiter,
  generalLimiter,
  authLimiter,
};
