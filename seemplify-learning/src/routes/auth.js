import express from 'express'
import bcrypt from 'bcrypt'
import crypto from 'crypto'
import { Account } from '../models/Account.js'
import { Organization } from '../models/Organization.js'
import { optionalAuth } from '../middleware/auth.js'

const router = express.Router()

const sanitizeReturnTo = (value) => {
  const normalized = String(value || '').trim()
  if (!normalized.startsWith('/')) return '/simple-lms'
  if (normalized.startsWith('//')) return '/simple-lms'
  return normalized
}

const createSub = () => `sl_${crypto.randomUUID().replace(/-/g, '')}`

router.get('/login', optionalAuth, async (req, res) => {
  if (req.user) {
    return res.redirect('/simple-lms')
  }

  res.render('login', {
    title: 'Seemplify Learning - Sign in',
    returnTo: sanitizeReturnTo(req.query.return_to),
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

    if (!account.currentOrganization && Array.isArray(account.organizations) && account.organizations.length > 0) {
      const activeMembership = account.organizations.find((membership) => membership.isActive)
      if (activeMembership?.organization) {
        account.currentOrganization = activeMembership.organization
        await account.save()
      }
    }

    req.session.accountId = account.sub
    res.redirect(returnTo || '/simple-lms')
  } catch (error) {
    console.error('Login error:', error)
    res.redirect(`/login?error=${encodeURIComponent('Failed to sign in')}`)
  }
})

router.get('/register', optionalAuth, async (req, res) => {
  if (req.user) {
    return res.redirect('/simple-lms')
  }

  res.render('register', {
    title: 'Seemplify Learning - Register',
    error: String(req.query.error || '')
  })
})

router.post('/register', async (req, res) => {
  try {
    const name = String(req.body.name || '').trim()
    const email = String(req.body.email || '').trim().toLowerCase()
    const password = String(req.body.password || '')
    const organizationName = String(req.body.organizationName || '').trim()

    if (!name || !email || !password) {
      return res.redirect(`/register?error=${encodeURIComponent('Name, email, and password are required')}`)
    }

    if (password.length < 8) {
      return res.redirect(`/register?error=${encodeURIComponent('Password must be at least 8 characters')}`)
    }

    const existingAccount = await Account.findOne({ email }).select('_id').lean()
    if (existingAccount) {
      return res.redirect(`/register?error=${encodeURIComponent('Email already exists')}`)
    }

    const passwordHash = await bcrypt.hash(password, 12)
    const account = await Account.create({
      sub: createSub(),
      email,
      passwordHash,
      emailVerified: true,
      profile: {
        name,
        preferred_username: name
      },
      organizations: [],
      teams: []
    })

    const normalizedOrganizationName = organizationName || `${name.split(' ')[0] || 'My'} Organization`
    const organization = await Organization.create({
      name: normalizedOrganizationName,
      owner: account._id,
      members: [{
        account: account._id,
        role: 'owner',
        status: 'active',
        appAccess: {
          mode: 'all',
          appIds: []
        }
      }],
      settings: {
        simpleLms: {
          defaultCurrency: 'NGN',
          allowedCurrencies: ['NGN']
        }
      }
    })

    account.organizations.push({
      organization: organization._id,
      role: 'owner',
      appAccess: {
        mode: 'all',
        appIds: []
      },
      joinedAt: new Date(),
      isActive: true
    })
    account.currentOrganization = organization._id
    await account.save()

    req.session.accountId = account.sub

    res.redirect('/setup?success=Welcome to Seemplify Learning. Your workspace is ready.')
  } catch (error) {
    console.error('Registration error:', error)
    res.redirect(`/register?error=${encodeURIComponent('Failed to register account')}`)
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
