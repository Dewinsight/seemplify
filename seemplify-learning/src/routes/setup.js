import express from 'express'
import bcrypt from 'bcrypt'
import crypto from 'crypto'
import mongoose from 'mongoose'
import { requireAuth } from '../middleware/auth.js'
import { Account } from '../models/Account.js'
import { Organization } from '../models/Organization.js'
import { Team } from '../models/Team.js'

const router = express.Router()

const ORG_ROLES = new Set(['owner', 'admin', 'hr_manager', 'recruiter', 'interviewer', 'staff'])
const TEAM_ROLES = new Set(['member', 'team_lead', 'line_manager'])

const toId = (value) => (value ? String(value) : '')
const createSub = () => `sl_${crypto.randomUUID().replace(/-/g, '')}`

const getMembershipOrgIds = (account) => {
  return (account.organizations || [])
    .filter((membership) => membership?.isActive && membership?.organization)
    .map((membership) => membership.organization)
}

const buildOrganizationLabelMap = async (orgIds) => {
  if (!orgIds.length) return new Map()
  const organizations = await Organization.find({ _id: { $in: orgIds } })
    .select('name')
    .lean()

  return new Map(organizations.map((organization) => [toId(organization._id), organization.name || 'Organization']))
}

const ensureCurrentOrganization = async (account) => {
  if (account.currentOrganization) {
    return account.currentOrganization
  }

  const firstActiveMembership = (account.organizations || []).find((membership) => membership?.isActive && membership?.organization)
  if (!firstActiveMembership?.organization) {
    return null
  }

  account.currentOrganization = firstActiveMembership.organization
  await account.save()
  return account.currentOrganization
}

router.get('/', requireAuth, async (req, res) => {
  try {
    const activeOrgIds = getMembershipOrgIds(req.user)
    const organizationNameById = await buildOrganizationLabelMap(activeOrgIds)

    const currentOrganizationId = await ensureCurrentOrganization(req.user)
    const currentOrgIdStr = toId(currentOrganizationId)

    const [currentOrganization, teams] = await Promise.all([
      currentOrgIdStr
        ? Organization.findById(currentOrgIdStr).lean()
        : Promise.resolve(null),
      currentOrgIdStr
        ? Team.find({ organization: currentOrgIdStr }).sort({ createdAt: -1 }).lean()
        : Promise.resolve([])
    ])

    const currentMemberIds = (currentOrganization?.members || [])
      .filter((member) => member?.status === 'active' && member?.account)
      .map((member) => member.account)

    const memberAccounts = currentMemberIds.length > 0
      ? await Account.find({ _id: { $in: currentMemberIds } }).select('email profile.name').lean()
      : []
    const memberAccountById = new Map(memberAccounts.map((account) => [toId(account._id), account]))

    const members = (currentOrganization?.members || [])
      .filter((member) => member?.status === 'active' && member?.account)
      .map((member) => {
        const account = memberAccountById.get(toId(member.account))
        return {
          accountId: toId(member.account),
          name: account?.profile?.name || account?.email || 'Member',
          email: account?.email || '-',
          role: member.role || 'staff'
        }
      })

    const organizations = (req.user.organizations || [])
      .filter((membership) => membership?.isActive && membership?.organization)
      .map((membership) => ({
        id: toId(membership.organization),
        role: membership.role || 'staff',
        name: organizationNameById.get(toId(membership.organization)) || 'Organization',
        isCurrent: toId(membership.organization) === currentOrgIdStr
      }))

    res.render('setup', {
      title: 'Seemplify Learning - Workspace Setup',
      user: req.user,
      organizations,
      currentOrganization,
      members,
      teams,
      success: String(req.query.success || ''),
      error: String(req.query.error || '')
    })
  } catch (error) {
    console.error('Setup page load error:', error)
    res.redirect('/simple-lms?error=Failed to load workspace setup')
  }
})

router.post('/organization', requireAuth, async (req, res) => {
  try {
    const name = String(req.body.name || '').trim()
    const description = String(req.body.description || '').trim()

    if (!name) {
      return res.redirect('/setup?error=Organization name is required')
    }

    const organization = await Organization.create({
      name,
      description,
      owner: req.user._id,
      members: [{
        account: req.user._id,
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

    req.user.organizations.push({
      organization: organization._id,
      role: 'owner',
      appAccess: {
        mode: 'all',
        appIds: []
      },
      joinedAt: new Date(),
      isActive: true
    })
    req.user.currentOrganization = organization._id
    await req.user.save()

    res.redirect('/setup?success=Organization created and selected')
  } catch (error) {
    console.error('Create organization error:', error)
    res.redirect('/setup?error=Failed to create organization')
  }
})

router.post('/switch-organization', requireAuth, async (req, res) => {
  try {
    const organizationId = String(req.body.organizationId || '').trim()

    if (!mongoose.Types.ObjectId.isValid(organizationId)) {
      return res.redirect('/setup?error=Invalid organization selected')
    }

    const hasMembership = (req.user.organizations || []).some((membership) => (
      membership?.isActive && toId(membership.organization) === organizationId
    ))

    if (!hasMembership) {
      return res.redirect('/setup?error=You do not belong to the selected organization')
    }

    req.user.currentOrganization = organizationId
    await req.user.save()
    res.redirect('/setup?success=Organization switched')
  } catch (error) {
    console.error('Switch organization error:', error)
    res.redirect('/setup?error=Failed to switch organization')
  }
})

router.post('/member', requireAuth, async (req, res) => {
  try {
    const organizationId = toId(req.user.currentOrganization)
    if (!organizationId) {
      return res.redirect('/setup?error=Select an organization first')
    }

    const email = String(req.body.email || '').trim().toLowerCase()
    const name = String(req.body.name || '').trim()
    const role = String(req.body.role || 'staff').trim()

    if (!email) {
      return res.redirect('/setup?error=Member email is required')
    }

    if (!ORG_ROLES.has(role)) {
      return res.redirect('/setup?error=Invalid organization role')
    }

    const organization = await Organization.findById(organizationId)
    if (!organization) {
      return res.redirect('/setup?error=Organization not found')
    }

    const currentUserMemberRecord = (organization.members || []).find((member) => (
      member.status === 'active' && toId(member.account) === toId(req.user._id)
    ))

    if (!currentUserMemberRecord || !['owner', 'admin', 'hr_manager'].includes(currentUserMemberRecord.role)) {
      return res.redirect('/setup?error=Only owner, admin, or HR manager can add members')
    }

    let targetAccount = await Account.findOne({ email })
    if (!targetAccount) {
      const temporaryPassword = crypto.randomBytes(18).toString('hex')
      targetAccount = await Account.create({
        sub: createSub(),
        email,
        passwordHash: await bcrypt.hash(temporaryPassword, 12),
        emailVerified: false,
        profile: {
          name: name || email.split('@')[0],
          preferred_username: name || email.split('@')[0]
        },
        organizations: [],
        teams: []
      })
    }

    const existingOrgMember = (organization.members || []).find((member) => (
      toId(member.account) === toId(targetAccount._id)
    ))

    if (existingOrgMember) {
      existingOrgMember.status = 'active'
      existingOrgMember.role = role
      existingOrgMember.updatedAt = new Date()
      existingOrgMember.updatedBy = req.user._id
    } else {
      organization.members.push({
        account: targetAccount._id,
        role,
        status: 'active',
        invitedBy: req.user._id,
        joinedAt: new Date(),
        appAccess: {
          mode: 'all',
          appIds: []
        }
      })
    }

    await organization.save()

    const existingAccountMembership = (targetAccount.organizations || []).find((membership) => (
      toId(membership.organization) === organizationId
    ))

    if (existingAccountMembership) {
      existingAccountMembership.isActive = true
      existingAccountMembership.role = role
    } else {
      targetAccount.organizations.push({
        organization: organization._id,
        role,
        joinedAt: new Date(),
        isActive: true,
        appAccess: {
          mode: 'all',
          appIds: []
        }
      })
    }

    if (!targetAccount.currentOrganization) {
      targetAccount.currentOrganization = organization._id
    }

    await targetAccount.save()

    res.redirect('/setup?success=Member added to organization')
  } catch (error) {
    console.error('Add member error:', error)
    res.redirect('/setup?error=Failed to add member')
  }
})

router.post('/team', requireAuth, async (req, res) => {
  try {
    const organizationId = toId(req.user.currentOrganization)
    if (!organizationId) {
      return res.redirect('/setup?error=Select an organization first')
    }

    const name = String(req.body.name || '').trim()
    const description = String(req.body.description || '').trim()
    const parentTeamId = String(req.body.parentTeamId || '').trim()
    const managerAccountId = String(req.body.managerAccountId || '').trim()

    if (!name) {
      return res.redirect('/setup?error=Team name is required')
    }

    const teamPayload = {
      organization: organizationId,
      name,
      description,
      parentTeam: null,
      members: []
    }

    if (parentTeamId && mongoose.Types.ObjectId.isValid(parentTeamId)) {
      const parentTeam = await Team.findOne({ _id: parentTeamId, organization: organizationId }).select('_id').lean()
      if (parentTeam) {
        teamPayload.parentTeam = parentTeam._id
      }
    }

    const team = await Team.create(teamPayload)

    let managerId = ''
    if (managerAccountId && mongoose.Types.ObjectId.isValid(managerAccountId)) {
      managerId = managerAccountId
    }

    if (!managerId && req.body.addSelfAsManager === 'on') {
      managerId = toId(req.user._id)
    }

    if (managerId) {
      await team.addMember(managerId, 'line_manager')
      await team.setManager(managerId)
    }

    res.redirect('/setup?success=Team created')
  } catch (error) {
    console.error('Create team error:', error)
    res.redirect('/setup?error=Failed to create team')
  }
})

router.post('/team-member', requireAuth, async (req, res) => {
  try {
    const organizationId = toId(req.user.currentOrganization)
    if (!organizationId) {
      return res.redirect('/setup?error=Select an organization first')
    }

    const teamId = String(req.body.teamId || '').trim()
    const accountId = String(req.body.accountId || '').trim()
    const role = String(req.body.role || 'member').trim()
    const setAsManager = req.body.setAsManager === 'on'

    if (!mongoose.Types.ObjectId.isValid(teamId) || !mongoose.Types.ObjectId.isValid(accountId)) {
      return res.redirect('/setup?error=Select a valid team and member')
    }

    if (!TEAM_ROLES.has(role)) {
      return res.redirect('/setup?error=Invalid team role selected')
    }

    const team = await Team.findOne({ _id: teamId, organization: organizationId })
    if (!team) {
      return res.redirect('/setup?error=Team not found')
    }

    await team.addMember(accountId, role)

    if (setAsManager && role === 'line_manager') {
      await team.setManager(accountId)
    }

    res.redirect('/setup?success=Member assigned to team')
  } catch (error) {
    console.error('Assign team member error:', error)
    res.redirect('/setup?error=Failed to assign member to team')
  }
})

export default router
