'use strict';
const rateLimit = require('express-rate-limit');
const auth = require('./authorizationService');
const { DomainError, handle } = require('../../contracts/competency');
function createUploadBudget({ max = 20, windowMs = 15 * 60 * 1000, maxConcurrent = 4 } = {}) {
  let active = 0;
  const limiter = rateLimit({ windowMs, max, standardHeaders: 'draft-7', legacyHeaders: false,
    keyGenerator: req => `${req.competencyContext.organizationId}:${req.competencyContext.actor.userId}`,
    handler: (_req, res) => res.status(429).json({ error: { code: 'UPLOAD_RATE_LIMIT', message: 'Too many uploads. Continue with manual notes or try again later.' } }) });
  return handle(async (req, res, next) => {
    if (req.method !== 'POST' || !req.is('multipart/form-data') || !/^\/(imports|assessments\/[a-f\d]{24}\/evidence)\/?$/i.test(req.path)) return next();
    const ctx = await auth.context(req);
    if (req.path.startsWith('/imports')) {
      if (!auth.hasAction(ctx, 'role.manage') && !auth.hasAction(ctx, 'framework.manage')) auth.requireAction(ctx, 'role.manage');
    } else {
      const record = await require('./assessmentService').get(ctx, req.path.split('/')[2], 'evidence.create');
      require('./assessmentService').assertEditable(record);
    }
    await limiter(req, res, error => {
      if (error) return next(error);
      if (active >= maxConcurrent) return res.status(429).json({ error: { code: 'UPLOAD_BUSY', message: 'File processing is busy. Your edits are retained; try the upload again shortly.' } });
      active++; let released = false;
      const release = () => { if (!released) { released = true; active--; } };
      res.once('finish', release); res.once('close', release); next();
    });
  });
}
module.exports = { createUploadBudget };
