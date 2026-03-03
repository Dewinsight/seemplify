import { Account } from '../models/Account.js'

export async function resolveAuthenticatedAccount(req) {
  const sessionAccountId = String(req.session?.accountId || '').trim()
  if (!sessionAccountId) {
    return null
  }

  const account = await Account.findOne({ sub: sessionAccountId })
  return account || null
}

export async function requireAuth(req, res, next) {
  try {
    const account = await resolveAuthenticatedAccount(req)
    if (!account) {
      return res.redirect(`/login?return_to=${encodeURIComponent(req.originalUrl || '/simple-lms')}`)
    }

    req.user = account
    res.locals.user = account
    next()
  } catch (error) {
    console.error('Auth middleware error:', error)
    res.redirect('/login')
  }
}

export async function optionalAuth(req, res, next) {
  try {
    const account = await resolveAuthenticatedAccount(req)
    if (account) {
      req.user = account
      res.locals.user = account
    }
    next()
  } catch (error) {
    console.error('Optional auth middleware error:', error)
    next()
  }
}
