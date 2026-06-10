/**
 * Kill switch for the legacy IdP onboarding feature.
 *
 * Env (read at request time so flipping back to legacy needs no redeploy):
 *  - ONBOARDING_MODE          : 'legacy' (default) | 'redirect'
 *  - ONBOARDING_FREEZE_WRITES : 'true' to 410 mutating onboarding API calls
 *  - RECRUITER_PORTAL_URL     : deep-link base (see recruiterLinks.js)
 *
 * Flipping ONBOARDING_MODE back to 'legacy' is the universal rollback.
 */

import { recruiterMyTransitionsUrl } from '../utils/recruiterLinks.js'

export function getOnboardingMode() {
  return String(process.env.ONBOARDING_MODE || 'legacy').trim().toLowerCase() === 'redirect'
    ? 'redirect'
    : 'legacy'
}

export function isRedirectMode() {
  return getOnboardingMode() === 'redirect'
}

export function writesFrozen() {
  // Redirect mode implies frozen writes; the explicit flag lets you freeze
  // before flipping the UI during a staged rollout.
  if (isRedirectMode()) return true
  return String(process.env.ONBOARDING_FREEZE_WRITES || '').trim().toLowerCase() === 'true'
}

/**
 * Page-route middleware: in redirect mode, send users to the recruiter app.
 * @param {string|function(req):string} targetResolver - URL or resolver
 */
export function redirectPageMiddleware(targetResolver) {
  return (req, res, next) => {
    if (!isRedirectMode()) return next()
    let url = ''
    try {
      url = typeof targetResolver === 'function' ? targetResolver(req) : targetResolver
    } catch (error) {
      url = ''
    }
    if (url) return res.redirect(302, url)
    return next()
  }
}

/**
 * API-route middleware: when writes are frozen, reject mutating onboarding calls
 * with 410 Gone and a redirect hint instead of mutating retired data.
 */
export function freezeWritesMiddleware(req, res, next) {
  if (!writesFrozen()) return next()
  return res.status(410).json({
    error: 'Onboarding has moved to the recruiter app.',
    redirectUrl: recruiterMyTransitionsUrl()
  })
}
