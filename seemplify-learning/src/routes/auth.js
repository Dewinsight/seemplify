import express from 'express'
import bcrypt from 'bcrypt'
import crypto from 'crypto'
import { Account } from '../models/Account.js'
import { optionalAuth } from '../middleware/auth.js'
import { resolveBranding } from '../utils/branding.js'

const router = express.Router()

const LEARNING_INTENTS = ['learn', 'teach']

const sanitizeReturnTo = (value) => {
  const normalized = String(value || '').trim()
  if (!normalized.startsWith('/')) return '/simple-lms'
  if (normalized.startsWith('//')) return '/simple-lms'
  return normalized
}

const sanitizeIntent = (value, fallback = 'learn') => {
  const normalized = String(value || '').trim().toLowerCase()
  if (LEARNING_INTENTS.includes(normalized)) return normalized
  return fallback
}

const sanitizeIntentSource = (value, fallback = 'direct') => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return normalized || fallback
}

const appendQuery = (path, entries = {}) => {
  const params = new URLSearchParams()
  Object.entries(entries).forEach(([key, rawValue]) => {
    const value = String(rawValue || '').trim()
    if (value) params.set(key, value)
  })
  const query = params.toString()
  if (!query) return path
  return `${path}${path.includes('?') ? '&' : '?'}${query}`
}

const createSub = () => `sl_${crypto.randomUUID().replace(/-/g, '')}`

router.get('/login', optionalAuth, async (req, res) => {
  const branding = resolveBranding(req.hostname || req.get('host'))
  const returnTo = sanitizeReturnTo(req.query.return_to)
  const loginMode = String(req.query.mode || '').trim().toLowerCase() === 'admin' ? 'admin' : 'workspace'
  if (req.user) {
    return res.redirect(returnTo || '/simple-lms')
  }

  const registerIntent = sanitizeIntent(
    req.query.intent || (returnTo.startsWith('/teach') ? 'teach' : 'learn'),
    'learn'
  )
  const registerSource = sanitizeIntentSource(
    req.query.source || (registerIntent === 'teach' ? 'teach_login' : 'login'),
    registerIntent === 'teach' ? 'teach_login' : 'login'
  )

  res.render('login', {
    title: `${branding.learningName} - Sign in`,
    returnTo,
    loginMode,
    registerUrl: appendQuery('/register', {
      return_to: returnTo,
      intent: registerIntent,
      source: registerSource
    }),
    error: String(req.query.error || ''),
    success: String(req.query.success || '')
  })
})

router.get('/admin/login', optionalAuth, async (req, res) => {
  const branding = resolveBranding(req.hostname || req.get('host'))
  const returnTo = sanitizeReturnTo(req.query.return_to || '/admin')
  if (req.user) {
    return res.redirect(returnTo || '/admin')
  }

  res.render('login', {
    title: `${branding.learningName} - Admin Sign in`,
    returnTo,
    loginMode: 'admin',
    registerUrl: appendQuery('/register', {
      return_to: returnTo,
      intent: 'learn',
      source: 'admin_login'
    }),
    error: String(req.query.error || ''),
    success: String(req.query.success || '')
  })
})

router.post('/login', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase()
    const password = String(req.body.password || '')
    const returnTo = sanitizeReturnTo(req.body.return_to)

    if (!email || !password) {
      return res.redirect(`/login?error=${encodeURIComponent('Email and password are required')}&return_to=${encodeURIComponent(returnTo)}`)
    }

    const account = await Account.findOne({ email })
    if (!account || !account.passwordHash) {
      return res.redirect(`/login?error=${encodeURIComponent('Invalid credentials')}&return_to=${encodeURIComponent(returnTo)}`)
    }

    const isMatch = await bcrypt.compare(password, account.passwordHash)
    if (!isMatch) {
      return res.redirect(`/login?error=${encodeURIComponent('Invalid credentials')}&return_to=${encodeURIComponent(returnTo)}`)
    }

    req.session.accountId = account.sub
    res.redirect(returnTo || '/simple-lms')
  } catch (error) {
    console.error('Login error:', error)
    res.redirect(`/login?error=${encodeURIComponent('Failed to sign in')}`)
  }
})

router.get('/register', optionalAuth, async (req, res) => {
  const branding = resolveBranding(req.hostname || req.get('host'))
  const pendingIntent = req.session?.pendingRegistrationIntent || null

  const intent = sanitizeIntent(req.query.intent || pendingIntent?.intent || 'learn', 'learn')
  const source = sanitizeIntentSource(
    req.query.source || pendingIntent?.source || (intent === 'teach' ? 'teach_landing' : 'direct'),
    intent === 'teach' ? 'teach_landing' : 'direct'
  )
  const returnTo = sanitizeReturnTo(
    req.query.return_to || pendingIntent?.returnTo || (intent === 'teach' ? '/teach/get-started' : '/simple-lms')
  )

  if (req.session?.pendingRegistrationIntent) {
    delete req.session.pendingRegistrationIntent
  }

  if (req.user) {
    return res.redirect(returnTo || '/simple-lms')
  }

  res.render('register', {
    title: `${branding.learningName} - Register`,
    error: String(req.query.error || ''),
    intent,
    source,
    returnTo,
    loginUrl: appendQuery('/login', {
      return_to: returnTo,
      intent,
      source
    })
  })
})

router.post('/register', async (req, res) => {
  try {
    const branding = resolveBranding(req.hostname || req.get('host'))
    const intent = sanitizeIntent(req.body.intent || 'learn', 'learn')
    const source = sanitizeIntentSource(
      req.body.source || (intent === 'teach' ? 'teach_landing' : 'direct'),
      intent === 'teach' ? 'teach_landing' : 'direct'
    )
    const returnTo = sanitizeReturnTo(req.body.return_to || (intent === 'teach' ? '/teach/get-started' : '/simple-lms'))
    const name = String(req.body.name || '').trim()
    const email = String(req.body.email || '').trim().toLowerCase()
    const password = String(req.body.password || '')

    const registerRedirect = (errorMessage) => (
      appendQuery('/register', {
        error: errorMessage,
        intent,
        source,
        return_to: returnTo
      })
    )

    if (!name || !email || !password) {
      return res.redirect(registerRedirect('Name, email, and password are required'))
    }

    if (password.length < 8) {
      return res.redirect(registerRedirect('Password must be at least 8 characters'))
    }

    const existingAccount = await Account.findOne({ email }).select('_id').lean()
    if (existingAccount) {
      return res.redirect(registerRedirect('Email already exists'))
    }

    const passwordHash = await bcrypt.hash(password, 12)
    const hasExistingSuperAdmin = await Account.exists({
      $or: [
        { isSuperAdmin: true },
        { learningRole: 'super_admin' }
      ]
    })
    const bootstrapAsSuperAdmin = !hasExistingSuperAdmin
    const roleFromIntent = 'learner'

    const account = await Account.create({
      sub: createSub(),
      email,
      passwordHash,
      emailVerified: true,
      profile: {
        name,
        preferred_username: name
      },
      learningRole: bootstrapAsSuperAdmin ? 'super_admin' : roleFromIntent,
      learningProfile: {
        registrationIntent: intent,
        intentSource: source,
        instructorActivatedAt: intent === 'teach' || bootstrapAsSuperAdmin ? new Date() : null,
        instructorOnboardingCompleted: bootstrapAsSuperAdmin ? true : false
      },
      isSystemAdmin: bootstrapAsSuperAdmin,
      isSuperAdmin: bootstrapAsSuperAdmin,
      organizations: [],
      teams: []
    })

    req.session.accountId = account.sub
    if (req.session?.pendingRegistrationIntent) {
      delete req.session.pendingRegistrationIntent
    }

    const successMessage = bootstrapAsSuperAdmin
      ? `Welcome to ${branding.learningName}. Your account was bootstrapped as Super Admin.`
      : `Welcome to ${branding.learningName}. Your account is ready.`

    const destination = bootstrapAsSuperAdmin
      ? '/simple-lms'
      : (returnTo || (intent === 'teach' ? '/teach/get-started' : '/simple-lms'))

    res.redirect(appendQuery(destination, { success: successMessage }))
  } catch (error) {
    console.error('Registration error:', error)
    const fallbackIntent = sanitizeIntent(req.body.intent || 'learn', 'learn')
    const fallbackSource = sanitizeIntentSource(
      req.body.source || (fallbackIntent === 'teach' ? 'teach_landing' : 'direct'),
      fallbackIntent === 'teach' ? 'teach_landing' : 'direct'
    )
    const fallbackReturnTo = sanitizeReturnTo(
      req.body.return_to || (fallbackIntent === 'teach' ? '/teach/get-started' : '/simple-lms')
    )
    res.redirect(appendQuery('/register', {
      error: 'Failed to register account',
      intent: fallbackIntent,
      source: fallbackSource,
      return_to: fallbackReturnTo
    }))
  }
})

router.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('seemplify_learning_session')
    res.redirect('/login?success=Signed out successfully')
  })
})

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('seemplify_learning_session')
    res.redirect('/login?success=Signed out successfully')
  })
})

export default router
