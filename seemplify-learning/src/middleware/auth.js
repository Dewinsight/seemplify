import mongoose from 'mongoose'
import { Account } from '../models/Account.js'
import { resolveAccessProfile } from '../utils/accessProfile.js'
import { resolveLearningRole } from '../utils/learningRoles.js'

const findAccountBySessionIdentifier = async (identifier) => {
  const normalized = String(identifier || '').trim()
  if (!normalized) return null

  const accountBySub = await Account.findOne({ sub: normalized })
  if (accountBySub) return accountBySub

  if (mongoose.Types.ObjectId.isValid(normalized)) {
    return Account.findById(normalized)
  }

  return null
}

export async function resolveAuthenticatedAccount(req) {
  const sessionAccountId = String(req.session?.accountId || '').trim()
  if (!sessionAccountId) {
    return null
  }

  const account = await findAccountBySessionIdentifier(sessionAccountId)
  return account || null
}

export async function requireAuth(req, res, next) {
  try {
    const account = await resolveAuthenticatedAccount(req)
    if (!account) {
      return res.redirect(`/login?return_to=${encodeURIComponent(req.originalUrl || '/simple-lms')}`)
    }

    const learningRole = resolveLearningRole(account)
    const accessProfile = await resolveAccessProfile(account)
    req.user = account
    req.learningRole = learningRole
    req.accessProfile = accessProfile
    res.locals.user = account
    res.locals.learningRole = learningRole
    res.locals.accessProfile = accessProfile
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
      const learningRole = resolveLearningRole(account)
      const accessProfile = await resolveAccessProfile(account)
      req.user = account
      req.learningRole = learningRole
      req.accessProfile = accessProfile
      res.locals.user = account
      res.locals.learningRole = learningRole
      res.locals.accessProfile = accessProfile
    }
    next()
  } catch (error) {
    console.error('Optional auth middleware error:', error)
    next()
  }
}
