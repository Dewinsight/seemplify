import crypto from 'crypto'
import express from 'express'
import mongoose from 'mongoose'
import { Account } from '../models/Account.js'
import { Organization } from '../models/Organization.js'
import { Team } from '../models/Team.js'
import { MembershipOperation } from '../models/MembershipOperation.js'
import { ScheduledMembershipAction } from '../models/ScheduledMembershipAction.js'
import { normalizeAppAccess } from '../utils/appAccess.js'
import { serializeReconciliationTeams } from '../utils/reconciliationTeams.js'
import { subscriptionService } from '../services/subscriptionService.js'
import { emailService } from '../services/emailService.js'
import { resolveInternalMembershipSecret } from '../services/internalMembershipAuthService.js'
import { forceUserLogout, sendWebhook } from '../services/webhookService.js'
import { invalidateClaimsCache } from '../index.js'

const router = express.Router()
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000
const VALID_ROLES = new Set(['owner', 'admin', 'hr_manager', 'recruiter', 'interviewer', 'staff'])

function requestHash(body) {
  return crypto.createHash('sha256').update(JSON.stringify(body || {})).digest('hex')
}

function serviceAuth(req, res, next) {
  const serviceId = String(req.get('x-service-id') || 'unknown-service')
  const secret = resolveInternalMembershipSecret(serviceId)
  if (!secret) {
    if (process.env.NODE_ENV === 'production') return res.status(503).json({ error: 'Internal service authentication is not configured' })
    return next()
  }
  const timestamp = String(req.get('x-service-timestamp') || '')
  const received = String(req.get('x-service-signature') || '').replace(/^sha256=/, '')
  const timestampMs = Date.parse(timestamp)
  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > MAX_CLOCK_SKEW_MS) {
    return res.status(401).json({ error: 'Expired or invalid service timestamp' })
  }
  const expected = crypto.createHmac('sha256', secret)
    .update(`${timestamp}.${JSON.stringify(req.body || {})}`)
    .digest('hex')
  if (!/^[a-f0-9]{64}$/i.test(received) || !crypto.timingSafeEqual(Buffer.from(received, 'hex'), Buffer.from(expected, 'hex'))) {
    return res.status(401).json({ error: 'Invalid service signature' })
  }
  req.serviceId = serviceId
  next()
}

router.use(serviceAuth)

router.post('/reconcile', async (req, res) => {
  const organization = await Organization.findById(req.body?.organizationId)
    .populate('members.account', 'sub email profile')
  if (!organization) return res.status(404).json({ error: 'Organization not found' })
  const [teams, scheduledDeactivations] = await Promise.all([
    Team.find({ organization: organization._id })
      .select('name description parentTeam department manager members')
      .lean(),
    ScheduledMembershipAction.find({
      organizationId: organization._id,
      operation: 'deactivate',
      status: { $in: ['pending', 'failed', 'processing'] },
    }).select('accountId effectiveAt').lean(),
  ])
  const scheduledByAccount = new Map(scheduledDeactivations.map(action => [String(action.accountId), action.effectiveAt]))
  const memberships = (organization.members || []).map((member) => {
    const accountId = member.account?._id?.toString() || member.account?.toString()
    const activeTeams = teams.filter(team => team.members.some(item => String(item.account) === accountId && item.status === 'active'))
    const directTeam = activeTeams[0]
    return memberData(member.account, organization, member, {
      status: member.status,
      teamIds: activeTeams.map(team => team._id.toString()),
      teamAssignments: activeTeams.map(team => ({
        teamId: team._id.toString(),
        name: team.name,
        departmentId: team.department?.toString?.() || null,
        managerId: team.manager?.toString?.() || null,
      })),
      managerId: directTeam?.manager?.toString?.() || null,
      departmentId: member.department?.toString?.() || directTeam?.department?.toString?.() || null,
      effectiveExitAt: scheduledByAccount.get(accountId) || null,
      reconciledAt: new Date().toISOString(),
    })
  })
  res.json({
    schemaVersion: '1.0',
    organizationId: organization._id,
    organization: { id: organization._id.toString(), name: organization.name },
    generatedAt: new Date(),
    memberships,
    teams: serializeReconciliationTeams(teams, organization)
  })
})

function memberData(account, organization, member, extra = {}) {
  return {
    userId: account._id.toString(),
    subjectId: account._id.toString(),
    idpSubject: account.sub,
    email: account.email,
    name: account.profile?.name,
    organizationId: organization._id.toString(),
    organization: { id: organization._id.toString(), name: organization.name },
    role: member?.role,
    employeeId: member?.employeeId,
    departmentId: member?.department?.toString?.() || member?.department,
    appAccess: member?.appAccess,
    ...extra,
  }
}

function cleanText(value) {
  return String(value ?? '').trim()
}

function applyPayrollSync(account, payrollSync = {}) {
  if (!payrollSync || typeof payrollSync !== 'object') return false
  const profile = account.profile?.toObject?.() || account.profile || {}
  const personal = payrollSync.personalInfo || {}
  const emergency = personal.emergencyContact || {}
  const banking = payrollSync.banking || {}
  const accounts = Array.isArray(banking.accounts) ? banking.accounts : []
  const declaration = payrollSync.dependentsDeclaration || {}

  account.profile = {
    ...profile,
    name: cleanText(payrollSync.name) || profile.name || account.email,
    personalInfo: {
      ...(profile.personalInfo || {}),
      dateOfBirth: personal.dateOfBirth || profile.personalInfo?.dateOfBirth,
      mailingAddress: {
        ...(profile.personalInfo?.mailingAddress || {}),
        ...(personal.mailingAddress || {}),
      },
      phoneNumbers: {
        ...(profile.personalInfo?.phoneNumbers || {}),
        ...(personal.phoneNumbers || {}),
      },
      emergencyContacts: cleanText(emergency.name) || cleanText(emergency.phone)
        ? [{ ...emergency, isPrimary: true }]
        : (profile.personalInfo?.emergencyContacts || []),
    },
    taxInfo: {
      ...(profile.taxInfo || {}),
      ...(payrollSync.taxInfo || {}),
      lastUpdated: new Date(),
    },
    banking: {
      ...(profile.banking || {}),
      country: cleanText(banking.country) || profile.banking?.country || 'Other',
      accounts: accounts.length
        ? accounts.map(item => ({ ...item, updatedAt: new Date() }))
        : (profile.banking?.accounts || []),
    },
    dependentsDeclaration: {
      ...(profile.dependentsDeclaration || {}),
      status: ['none', 'provided'].includes(declaration.status) ? declaration.status : 'pending',
      count: Math.max(0, Number(declaration.count || 0)),
      confirmedAt: declaration.confirmedAt || new Date(),
      lastUpdated: new Date(),
    },
  }
  account.markModified('profile')
  return true
}

async function revokeProviderSessions(account) {
  const modelNames = ['oidc_Session', 'oidc_Grant', 'oidc_AccessToken', 'oidc_RefreshToken', 'oidc_Interaction']
  await Promise.all(modelNames.map(async (name) => {
    const model = mongoose.models[name]
    if (model) await model.deleteMany({ $or: [{ 'payload.accountId': account.sub }, { 'payload.sub': account.sub }] })
  }))
  await forceUserLogout(account._id.toString(), 'organization_membership_deactivated')
}

async function executeScheduledDeactivation(action) {
  const [organization, account] = await Promise.all([
    Organization.findById(action.organizationId),
    Account.findById(action.accountId),
  ])
  if (!organization || !account) throw new Error('Scheduled deactivation subject no longer exists')
  const member = organization.members.find(item => item.account.toString() === account._id.toString())
  if (!member) throw new Error('Scheduled membership no longer exists')
  if (member.status === 'active') await organization.removeMember(account._id)
  await revokeProviderSessions(account)
  const data = memberData(account, organization, member, {
    effectiveAt: action.effectiveAt,
    reason: action.payload?.reason || 'scheduled_people_transition',
    scheduledActionId: action._id.toString(),
    transitionId: action.payload?.transitionId,
    correlationId: action.payload?.correlationId,
    idempotencyKey: action.idempotencyKey,
  })
  await sendWebhook('organization.member.deactivated', data)
  invalidateClaimsCache(account.sub)
  return data
}

let scheduledWorkerTimer = null
let scheduledWorkerRunning = false
export async function processScheduledMembershipActions(limit = 20) {
  if (scheduledWorkerRunning) return { skipped: true }
  scheduledWorkerRunning = true
  let processed = 0
  try {
    for (; processed < limit; processed += 1) {
      const now = new Date()
      const action = await ScheduledMembershipAction.findOneAndUpdate(
        {
          $or: [
            { status: { $in: ['pending', 'failed'] }, effectiveAt: { $lte: now }, nextAttemptAt: { $lte: now }, $or: [{ leaseUntil: null }, { leaseUntil: { $exists: false } }, { leaseUntil: { $lt: now } }] },
            { status: 'processing', leaseUntil: { $lt: now } },
          ],
        },
        { $set: { status: 'processing', leaseUntil: new Date(now.getTime() + 120000) }, $inc: { attempts: 1 } },
        { sort: { effectiveAt: 1 }, new: true }
      )
      if (!action) break
      try {
        await executeScheduledDeactivation(action)
        action.status = 'completed'
        action.completedAt = new Date()
        action.lastError = ''
      } catch (error) {
        action.status = action.attempts >= action.maxAttempts ? 'dead' : 'failed'
        action.lastError = String(error.message || error).slice(0, 4000)
        action.nextAttemptAt = new Date(Date.now() + Math.min(60 * 60 * 1000, 15000 * (2 ** Math.max(0, action.attempts - 1))))
      }
      action.leaseUntil = undefined
      await action.save()
    }
    return { processed }
  } finally {
    scheduledWorkerRunning = false
  }
}

export function startScheduledMembershipWorker() {
  if (scheduledWorkerTimer) return
  scheduledWorkerTimer = setInterval(() => processScheduledMembershipActions().catch(error => console.error('Scheduled membership worker error:', error)), 15000)
  scheduledWorkerTimer.unref?.()
  processScheduledMembershipActions().catch(error => console.error('Scheduled membership worker startup error:', error))
}

async function findAccount(body) {
  if (body.idpAccountId && mongoose.isValidObjectId(body.idpAccountId)) {
    const byId = await Account.findById(body.idpAccountId)
    if (byId) return byId
  }
  if (body.idpSubject) {
    const bySubject = await Account.findOne({ sub: String(body.idpSubject) })
    if (bySubject) return bySubject
  }
  if (body.email) return Account.findOne({ email: String(body.email).trim().toLowerCase() })
  return null
}

async function executeIdempotently(operation, req, res, handler) {
  const key = String(req.get('idempotency-key') || req.body?.idempotencyKey || '').trim()
  if (!key) return res.status(400).json({ error: 'Idempotency-Key is required' })
  const requiredEnvelope = ['schemaVersion', 'eventId', 'organizationId', 'subjectId', 'occurredAt', 'correlationId', 'idempotencyKey']
  const missingEnvelope = requiredEnvelope.filter(field => req.body?.[field] === undefined || req.body?.[field] === null || req.body?.[field] === '')
  if (missingEnvelope.length) return res.status(400).json({ error: `Missing integration envelope fields: ${missingEnvelope.join(', ')}` })
  if (req.body.schemaVersion !== '1.0' || Number.isNaN(Date.parse(req.body.occurredAt))) {
    return res.status(400).json({ error: 'Unsupported schemaVersion or invalid occurredAt' })
  }
  if (String(req.body.idempotencyKey) !== key) return res.status(400).json({ error: 'Body and header idempotency keys must match' })
  const hash = requestHash(req.body)
  let record = await MembershipOperation.findOne({ idempotencyKey: key })
  if (record && (record.requestHash !== hash || record.operation !== operation)) {
    return res.status(409).json({ error: 'Idempotency key was already used for a different request' })
  }
  if (record?.status === 'completed') return res.json({ ...record.response, idempotentReplay: true })
  if (record?.status === 'processing' && Date.now() - record.updatedAt.getTime() < 60000) {
    return res.status(202).json({ status: 'processing', operationId: record._id })
  }
  if (!record) {
    try {
      record = await MembershipOperation.create({
        idempotencyKey: key,
        operation,
        organizationId: req.body.organizationId,
        subjectId: req.body.idpAccountId || req.body.email,
        requestedBy: req.serviceId,
        requestHash: hash,
      })
    } catch (error) {
      if (error.code === 11000) return executeIdempotently(operation, req, res, handler)
      throw error
    }
  } else {
    record.status = 'processing'
    record.error = ''
    record.attempts += 1
    await record.save()
  }
  try {
    const response = await handler()
    record.status = 'completed'
    record.response = response
    record.completedAt = new Date()
    await record.save()
    return res.json(response)
  } catch (error) {
    record.status = 'failed'
    record.error = String(error.message || error).slice(0, 4000)
    await record.save()
    const status = error.statusCode || (/not found/i.test(error.message) ? 404 : /seat|already|invalid|required/i.test(error.message) ? 409 : 500)
    return res.status(status).json({ error: error.message || 'Membership operation failed', operationId: record._id })
  }
}

router.post('/provision', (req, res) => executeIdempotently('provision', req, res, async () => {
  const body = req.body || {}
  const organization = await Organization.findById(body.organizationId)
  if (!organization) throw new Error('Organization not found')
  if (!body.email) throw new Error('Email is required')
  const role = VALID_ROLES.has(body.role) ? body.role : 'staff'
  let account = await findAccount(body)
  if (!account) {
    const activeCount = organization.members.filter(member => member.status === 'active').length
    if (process.env.ENFORCE_SUBSCRIPTION_SEATS !== 'false' && !await subscriptionService.canAddMembers(organization._id, activeCount)) {
      const error = new Error('Subscription seat limit prevents provisioning this employee')
      error.statusCode = 409
      throw error
    }
    account = await Account.create({
      sub: new mongoose.Types.ObjectId().toString(),
      email: String(body.email).trim().toLowerCase(),
      emailVerified: false,
      profile: {
        name: String(body.name || body.email).trim(),
        preferred_username: String(body.email).split('@')[0],
      },
      requiresPasswordReset: true,
      authProvider: 'local',
    })
  }
  if (applyPayrollSync(account, body.payrollSync)) await account.save()
  if (account.requiresPasswordReset && !account.emailVerified) {
    const activationToken = crypto.randomBytes(32).toString('hex')
    account.resetPasswordToken = activationToken
    account.resetPasswordExpires = new Date(Date.now() + 24 * 60 * 60 * 1000)
    await account.save()
    await emailService.sendAccountActivationEmail(account.email, activationToken, account.profile?.name)
  }
  const currentMember = organization.members.find(member => member.account.toString() === account._id.toString())
  const wasActive = currentMember?.status === 'active'
  if (!wasActive) {
    const activeCount = organization.members.filter(member => member.status === 'active').length
    if (process.env.ENFORCE_SUBSCRIPTION_SEATS !== 'false' && !await subscriptionService.canAddMembers(organization._id, activeCount)) {
      const error = new Error('Subscription seat limit prevents provisioning this employee')
      error.statusCode = 409
      throw error
    }
    await organization.addMember(account._id, role, null, normalizeAppAccess(body.appAccess), {
      employeeId: body.employeeId,
      designation: body.designation,
      departmentId: body.departmentId,
    })
  } else {
    organization.assertActiveEmployeeIdAvailable(body.employeeId, account._id)
    currentMember.designation = String(body.designation || '').trim() || currentMember.designation
    currentMember.employeeId = String(body.employeeId || '').trim() || currentMember.employeeId
    if (body.departmentId && organization.departments.id(body.departmentId)) currentMember.department = body.departmentId
    if (body.appAccess) currentMember.appAccess = normalizeAppAccess(body.appAccess)
    if (currentMember.role !== 'owner' && role !== 'owner') currentMember.role = role
    currentMember.updatedAt = new Date()
    await organization.save()
    await Account.updateOne(
      { _id: account._id, 'organizations.organization': organization._id },
      { $set: {
        'organizations.$.role': currentMember.role,
        'organizations.$.department': currentMember.department || null,
        'organizations.$.appAccess': currentMember.appAccess,
        'organizations.$.isActive': true,
      } }
    )
  }
  const refreshed = organization.members.find(member => member.account.toString() === account._id.toString())
  const event = !currentMember ? 'organization.member.added' : wasActive ? 'organization.member.updated' : 'organization.member.reactivated'
  const data = memberData(account, organization, refreshed, {
    employmentStartAt: body.startAt || new Date().toISOString(),
    jurisdiction: body.jurisdiction,
    managerId: body.managerId,
    effectiveAt: body.startAt || new Date().toISOString(),
    transitionId: body.transitionId,
    correlationId: body.correlationId,
    idempotencyKey: body.idempotencyKey,
  })
  await sendWebhook(event, data)
  invalidateClaimsCache(account.sub)
  return { status: 'completed', operation: 'provision', account: data, event }
}))

router.post('/deactivate', (req, res) => executeIdempotently('deactivate', req, res, async () => {
  const body = req.body || {}
  const organization = await Organization.findById(body.organizationId)
  if (!organization) throw new Error('Organization not found')
  const account = await findAccount(body)
  if (!account) throw new Error('Account not found')
  const member = organization.members.find(item => item.account.toString() === account._id.toString())
  if (!member) throw new Error('Membership not found')
  const effectiveAt = new Date(body.effectiveAt || Date.now())
  if (Number.isNaN(effectiveAt.getTime())) throw new Error('Invalid effectiveAt')
  if (effectiveAt > new Date() && !body.emergency) {
    await ScheduledMembershipAction.findOneAndUpdate(
      { idempotencyKey: String(req.get('idempotency-key') || body.idempotencyKey) },
      { $setOnInsert: {
        operation: 'deactivate',
        organizationId: organization._id,
        accountId: account._id,
        effectiveAt,
        payload: { reason: body.reason, requestedBy: req.serviceId, transitionId: body.transitionId, correlationId: body.correlationId },
      } },
      { upsert: true, new: true }
    )
    await sendWebhook('organization.member.updated', memberData(account, organization, member, {
      effectiveExitAt: effectiveAt,
      deactivationScheduled: true,
      transitionId: body.transitionId,
      correlationId: body.correlationId,
      idempotencyKey: body.idempotencyKey,
    }))
    return { status: 'scheduled', operation: 'deactivate', effectiveAt, accountId: account._id }
  }
  if (member.status === 'active') await organization.removeMember(account._id)
  await revokeProviderSessions(account)
  const data = memberData(account, organization, member, {
    effectiveAt,
    reason: body.reason || (body.emergency ? 'emergency_immediate_revoke' : 'people_transition'),
    emergency: body.emergency === true,
    transitionId: body.transitionId,
    correlationId: body.correlationId,
    idempotencyKey: body.idempotencyKey,
  })
  await sendWebhook('organization.member.deactivated', data)
  invalidateClaimsCache(account.sub)
  return { status: 'completed', operation: 'deactivate', account: data }
}))

router.post('/reactivate', (req, res) => executeIdempotently('reactivate', req, res, async () => {
  const body = req.body || {}
  const organization = await Organization.findById(body.organizationId)
  if (!organization) throw new Error('Organization not found')
  const account = await findAccount(body)
  if (!account) throw new Error('Account not found')
  const member = organization.members.find(item => item.account.toString() === account._id.toString())
  if (!member) throw new Error('Membership not found')
  await ScheduledMembershipAction.updateMany(
    { organizationId: organization._id, accountId: account._id, status: { $in: ['pending', 'failed'] } },
    { $set: { status: 'cancelled' } }
  )
  if (member.status !== 'active') {
    const activeCount = organization.members.filter(item => item.status === 'active').length
    if (process.env.ENFORCE_SUBSCRIPTION_SEATS !== 'false' && !await subscriptionService.canAddMembers(organization._id, activeCount)) {
      const error = new Error('Subscription seat limit prevents reactivating this employee')
      error.statusCode = 409
      throw error
    }
    await organization.addMember(account._id, VALID_ROLES.has(body.role) ? body.role : member.role, null, body.appAccess || member.appAccess, {
      employeeId: body.employeeId || member.employeeId,
      designation: body.designation || member.designation,
      departmentId: body.departmentId || member.department,
    })
  }
  const refreshed = organization.members.find(item => item.account.toString() === account._id.toString())
  const data = memberData(account, organization, refreshed, {
    effectiveAt: body.effectiveAt || new Date().toISOString(),
    jurisdiction: body.jurisdiction,
    transitionId: body.transitionId,
    correlationId: body.correlationId,
    idempotencyKey: body.idempotencyKey,
  })
  await sendWebhook('organization.member.reactivated', data)
  invalidateClaimsCache(account.sub)
  return { status: 'completed', operation: 'reactivate', account: data }
}))

export default router
