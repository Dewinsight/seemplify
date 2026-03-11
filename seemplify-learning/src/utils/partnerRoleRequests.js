import { Organization } from '../models/Organization.js'
import { RoleApprovalRequest } from '../models/RoleApprovalRequest.js'
import { logAuditEvent } from './auditLog.js'
import {
  isPartnerRegistrationIntent,
  resolvePartnerTypeForIntent,
  resolveRequestedRoleForIntent
} from './learningRoles.js'

export const sanitizePartnerOrganizationName = (value) => String(value || '').trim().slice(0, 160)

const ensureAccountPartnerMembership = async ({ account, organization }) => {
  if (!account?._id || !organization?._id) return

  const hasMembership = Array.isArray(account.organizations)
    && account.organizations.some((membership) => String(membership.organization) === String(organization._id))

  if (!hasMembership) {
    account.organizations = Array.isArray(account.organizations) ? account.organizations : []
    account.organizations.push({
      organization: organization._id,
      role: 'partner_admin',
      appAccess: {
        mode: 'all',
        appIds: []
      },
      joinedAt: new Date(),
      isActive: true
    })
  }

  account.partnerOrganization = organization._id
  await account.save()
}

export const createPartnerOrganizationForRequest = async ({ account, intent, organizationName }) => {
  const normalizedOrgName = sanitizePartnerOrganizationName(organizationName)
  if (!normalizedOrgName) return null

  const partnerType = resolvePartnerTypeForIntent(intent)
  if (partnerType === 'none') return null

  const existingPartnerOrganizationId = String(account?.partnerOrganization || '').trim()
  if (existingPartnerOrganizationId) {
    const existingOrganization = await Organization.findById(existingPartnerOrganizationId)
    if (existingOrganization) {
      const isOwnedByAccount = String(existingOrganization.owner) === String(account._id)
      const samePartnerType = String(existingOrganization.partnerType || 'none') === partnerType
      if (!isOwnedByAccount || !samePartnerType) {
        throw new Error('This account is already linked to another partner organization.')
      }

      existingOrganization.name = normalizedOrgName
      existingOrganization.description = `${partnerType === 'channel_partner' ? 'Channel partner' : 'Partner'} application`
      existingOrganization.partnerType = partnerType
      existingOrganization.partnerSettings = {
        ...(existingOrganization.partnerSettings || {}),
        partnerStatus: 'pending',
        maxAgents: existingOrganization.partnerSettings?.maxAgents ?? null,
        defaultAgentCommissionRate: existingOrganization.partnerSettings?.defaultAgentCommissionRate ?? 10,
        agentInviteApproval: existingOrganization.partnerSettings?.agentInviteApproval ?? true
      }

      const membership = Array.isArray(existingOrganization.members)
        ? existingOrganization.members.find((member) => String(member.account) === String(account._id))
        : null

      if (membership) {
        membership.role = 'partner_admin'
        membership.status = 'active'
        membership.updatedAt = new Date()
        membership.updatedBy = account._id
      } else {
        existingOrganization.members = Array.isArray(existingOrganization.members) ? existingOrganization.members : []
        existingOrganization.members.push({
          account: account._id,
          role: 'partner_admin',
          appAccess: {
            mode: 'all',
            appIds: []
          },
          joinedAt: new Date(),
          invitedBy: account._id,
          status: 'active',
          updatedAt: new Date(),
          updatedBy: account._id
        })
      }

      await existingOrganization.save()
      await ensureAccountPartnerMembership({ account, organization: existingOrganization })
      return existingOrganization
    }
  }

  const organization = await Organization.create({
    name: normalizedOrgName,
    description: `${partnerType === 'channel_partner' ? 'Channel partner' : 'Partner'} application`,
    owner: account._id,
    partnerType,
    members: [{
      account: account._id,
      role: 'partner_admin',
      appAccess: {
        mode: 'all',
        appIds: []
      },
      joinedAt: new Date(),
      invitedBy: account._id,
      status: 'active'
    }],
    partnerSettings: {
      partnerStatus: 'pending',
      maxAgents: null,
      defaultAgentCommissionRate: 10,
      agentInviteApproval: true
    }
  })

  await ensureAccountPartnerMembership({ account, organization })
  return organization
}

export const createPartnerApprovalRequest = async ({
  account,
  intent,
  source,
  organizationName,
  req
}) => {
  if (!isPartnerRegistrationIntent(intent)) return null
  if (!account?._id) {
    throw new Error('A valid account is required before creating a partner application.')
  }

  const requestedRole = resolveRequestedRoleForIntent(intent)
  if (!requestedRole) return null

  const existingPendingRequest = await RoleApprovalRequest.findOne({
    account: account._id,
    requestType: 'partner_role_activation',
    status: 'pending'
  }).lean()
  if (existingPendingRequest) {
    throw new Error('You already have a pending partner application under review.')
  }

  const organization = await createPartnerOrganizationForRequest({
    account,
    intent,
    organizationName
  })

  const request = await RoleApprovalRequest.create({
    account: account._id,
    requestType: 'partner_role_activation',
    registrationIntent: intent,
    requestedRole,
    partnerType: resolvePartnerTypeForIntent(intent),
    organizationName: sanitizePartnerOrganizationName(organizationName),
    organization: organization?._id || null,
    status: 'pending',
    metadata: {
      source: String(source || 'direct').trim() || 'direct'
    }
  })

  await logAuditEvent({
    action: 'approval.request.create',
    performedBy: account._id,
    targetAccount: account._id,
    targetOrganization: organization?._id || null,
    metadata: {
      requestId: request._id,
      requestedRole,
      registrationIntent: intent
    },
    req
  })

  return request
}

export default createPartnerApprovalRequest
