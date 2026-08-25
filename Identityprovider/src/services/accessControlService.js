import { Account } from '../models/Account.js'
import { Organization } from '../models/Organization.js'
import { AccessControlPolicy } from '../models/AccessControlPolicy.js'
import { AccessControlAuditEvent } from '../models/AccessControlAuditEvent.js'
import {
  ACCESS_CONTROL_SCHEMA_VERSION,
  DEFAULT_ACCESS_ROLES,
  PRODUCT_PERMISSION_CATALOG,
  getKnownAppIds,
  getKnownPermissionIds,
  getPermissionDefinition
} from '../config/accessControlCatalog.js'
import { normalizeAppAccess } from '../utils/appAccess.js'

const ROLE_KEY_PATTERN = /^[a-z][a-z0-9_-]{1,63}$/
const PROTECTED_ASSIGNMENT_ROLE_KEYS = new Set(['organization_owner', 'organization_admin'])
const PROTECTED_OWNER_PERMISSIONS = new Set([
  'identity:access.manage',
  'identity:roles.assign',
  'identity:organization.delete',
  'identity:owner.transfer'
])

function toId(value) {
  return value?._id?.toString?.() || value?.toString?.() || ''
}

function uniqueStrings(values = []) {
  return Array.from(new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean)))
}

function clonePermissionRows(rows = []) {
  return (rows || []).map((row) => ({
    appId: String(row.appId || ''),
    permissions: [...(row.permissions || [])]
  }))
}

function cloneRole(role) {
  return {
    key: role.key,
    name: role.name,
    description: role.description || '',
    sourceOrganizationRoles: [...(role.sourceOrganizationRoles || [])],
    sourceTeamRoles: [...(role.sourceTeamRoles || [])],
    grants: clonePermissionRows(role.grants),
    denies: clonePermissionRows(role.denies),
    locked: role.locked === true,
    isActive: role.isActive !== false,
    createdAt: role.createdAt || new Date(),
    updatedAt: role.updatedAt || new Date(),
    updatedBy: role.updatedBy || null
  }
}

function roleKey(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (!ROLE_KEY_PATTERN.test(normalized)) {
    const error = new Error('Role keys must start with a letter and contain only lowercase letters, numbers, hyphens, or underscores.')
    error.code = 'INVALID_ROLE_KEY'
    throw error
  }
  return normalized
}

function sanitizePermissionRows(rows = [], options = {}) {
  const knownApps = new Set(getKnownAppIds())
  const byApp = new Map()

  for (const rawRow of Array.isArray(rows) ? rows : []) {
    const appId = String(rawRow?.appId || '').trim()
    if (!knownApps.has(appId)) {
      const error = new Error(`Unknown product '${appId}'.`)
      error.code = 'UNKNOWN_PRODUCT'
      throw error
    }

    const knownPermissions = new Set(getKnownPermissionIds(appId))
    const values = uniqueStrings(rawRow?.permissions)
    for (const permissionId of values) {
      if (permissionId === '*' && options.allowWildcard) continue
      const definition = getPermissionDefinition(appId, permissionId)
      if (!knownPermissions.has(permissionId)) {
        const error = new Error(`Unknown permission '${permissionId}' for ${appId}.`)
        error.code = 'UNKNOWN_PERMISSION'
        throw error
      }
      if (options.delegableOnly && definition?.delegable === false) {
        const error = new Error(`Permission '${permissionId}' is controlled by the IdP platform policy and cannot be delegated by an organization.`)
        error.code = 'NON_DELEGABLE_PERMISSION'
        throw error
      }
    }

    if (!byApp.has(appId)) byApp.set(appId, new Set())
    values.forEach((permissionId) => byApp.get(appId).add(permissionId))
  }

  return Array.from(byApp.entries())
    .map(([appId, permissions]) => ({ appId, permissions: Array.from(permissions).sort() }))
    .filter((row) => row.permissions.length > 0)
    .sort((left, right) => left.appId.localeCompare(right.appId))
}

function permissionRowsToMap(rows = []) {
  const result = new Map()
  for (const row of rows || []) {
    const appId = String(row?.appId || '').trim()
    if (!appId) continue
    if (!result.has(appId)) result.set(appId, new Set())
    const target = result.get(appId)
    for (const permissionId of row.permissions || []) {
      if (permissionId === '*') {
        getKnownPermissionIds(appId).forEach((knownId) => target.add(knownId))
      } else if (getPermissionDefinition(appId, permissionId)) {
        target.add(permissionId)
      }
    }
  }
  return result
}

function addPermissionRows(target, rows = []) {
  const incoming = permissionRowsToMap(rows)
  for (const [appId, permissions] of incoming.entries()) {
    if (!target.has(appId)) target.set(appId, new Set())
    permissions.forEach((permissionId) => target.get(appId).add(permissionId))
  }
}

function removePermissionRows(target, rows = []) {
  const incoming = permissionRowsToMap(rows)
  for (const [appId, permissions] of incoming.entries()) {
    if (!target.has(appId)) continue
    permissions.forEach((permissionId) => target.get(appId).delete(permissionId))
  }
}

function permissionMapToObject(permissionMap) {
  return Object.fromEntries(Array.from(permissionMap.entries())
    .map(([appId, permissions]) => [appId, Array.from(permissions).sort()]))
}

export function mergeDefaultRoles(existingRoles = [], { refreshLocked = false } = {}) {
  const roles = (existingRoles || []).map((role) => cloneRole(role.toObject ? role.toObject() : role))
  for (const defaultRole of DEFAULT_ACCESS_ROLES) {
    const existingIndex = roles.findIndex((role) => role.key === defaultRole.key)
    if (existingIndex < 0) {
      roles.push(cloneRole(defaultRole))
      continue
    }
    if (!refreshLocked || defaultRole.locked !== true) continue
    const existing = roles[existingIndex]
    roles[existingIndex] = {
      ...cloneRole(defaultRole),
      createdAt: existing.createdAt,
      updatedAt: new Date(),
      updatedBy: existing.updatedBy
    }
  }
  return roles
}

export async function getOrCreateGlobalAccessPolicy() {
  let policy = await AccessControlPolicy.findOne({ key: 'global' })
  if (!policy) {
    try {
      policy = await AccessControlPolicy.create({
        key: 'global',
        schemaVersion: ACCESS_CONTROL_SCHEMA_VERSION,
        revision: 1,
        roles: DEFAULT_ACCESS_ROLES.map(cloneRole)
      })
    } catch (error) {
      if (error?.code !== 11000) throw error
      policy = await AccessControlPolicy.findOne({ key: 'global' })
    }
  }

  const schemaUpgrade = policy.schemaVersion !== ACCESS_CONTROL_SCHEMA_VERSION
  const mergedRoles = mergeDefaultRoles(policy.roles, { refreshLocked: schemaUpgrade })
  if (mergedRoles.length !== policy.roles.length || schemaUpgrade) {
    policy.roles = mergedRoles
    policy.schemaVersion = ACCESS_CONTROL_SCHEMA_VERSION
    policy.revision += 1
    await policy.save()
    if (schemaUpgrade) await bumpAccountAuthorizationRevisions()
  }
  return policy
}

function findCanonicalMember(organization, accountId) {
  const targetId = toId(accountId)
  return (organization?.members || []).find((member) =>
    toId(member.account) === targetId && member.status === 'active'
  ) || null
}

function roleMatchesContext(role, context) {
  if (context.explicitRoleKeys.has(role.key)) return true
  if ((role.sourceOrganizationRoles || []).includes(context.organizationRole)) return true
  return (role.sourceTeamRoles || []).some((sourceRole) => context.teamRoles.has(sourceRole))
}

function buildRoleCatalog(policy, organization) {
  const roles = new Map()
  for (const globalRole of policy.roles || []) {
    if (globalRole.isActive === false) continue
    roles.set(globalRole.key, cloneRole(globalRole.toObject ? globalRole.toObject() : globalRole))
  }

  for (const override of organization?.accessControl?.roleOverrides || []) {
    if (override.isActive === false) {
      roles.delete(override.roleKey)
      continue
    }
    const current = roles.get(override.roleKey) || {
      key: override.roleKey,
      name: override.name || override.roleKey,
      description: override.description || '',
      sourceOrganizationRoles: [],
      sourceTeamRoles: [],
      grants: [],
      denies: [],
      locked: false,
      isActive: true
    }
    roles.set(override.roleKey, {
      ...current,
      name: override.name || current.name,
      description: override.description || current.description,
      grants: [...clonePermissionRows(current.grants), ...clonePermissionRows(override.grants)],
      denies: [...clonePermissionRows(current.denies), ...clonePermissionRows(override.denies)]
    })
  }
  return roles
}

function accessibleAppIds(member) {
  const access = normalizeAppAccess(member?.appAccess)
  if (access.mode !== 'selected') return new Set(getKnownAppIds())
  const knownApps = new Set(getKnownAppIds())
  return new Set(['identity', ...access.appIds.filter((appId) => knownApps.has(appId))])
}

function contextualRoles(account, organization) {
  const organizationId = toId(organization)
  const roles = new Set()
  for (const team of account?.teams || []) {
    if (team.isActive === false || toId(team.organization) !== organizationId) continue
    if (team.role) roles.add(String(team.role))
  }
  const isDepartmentHead = (organization?.departments || []).some((department) =>
    toId(department.headAccount) === toId(account)
  )
  if (isDepartmentHead) roles.add('department_head')
  return roles
}

export async function resolveOrganizationAuthorization({ account, organization, member = null, policy = null }) {
  const canonicalMember = member || findCanonicalMember(organization, account?._id)
  if (!canonicalMember) return null
  const globalPolicy = policy || await getOrCreateGlobalAccessPolicy()
  const roleCatalog = buildRoleCatalog(globalPolicy, organization)
  const explicitRoleKeys = new Set(uniqueStrings(canonicalMember.accessControl?.roleKeys))
  const context = {
    organizationRole: String(canonicalMember.role || ''),
    teamRoles: contextualRoles(account, organization),
    explicitRoleKeys
  }

  const matchedRoles = Array.from(roleCatalog.values()).filter((role) => roleMatchesContext(role, context))
  const grants = new Map()
  const denies = new Map()
  for (const role of matchedRoles) {
    addPermissionRows(grants, role.grants)
    addPermissionRows(denies, role.denies)
  }
  addPermissionRows(grants, canonicalMember.accessControl?.grants)
  addPermissionRows(denies, canonicalMember.accessControl?.denies)
  removePermissionRows(grants, Array.from(denies.entries()).map(([appId, permissions]) => ({
    appId,
    permissions: Array.from(permissions)
  })))

  // The canonical owner must always retain the controls required to recover
  // the organization from a bad override.
  if (canonicalMember.role === 'owner') {
    if (!grants.has('identity')) grants.set('identity', new Set())
    for (const token of PROTECTED_OWNER_PERMISSIONS) {
      const [, permissionId] = token.split(':')
      grants.get('identity').add(permissionId)
    }
  }

  const allowedApps = accessibleAppIds(canonicalMember)
  for (const appId of Array.from(grants.keys())) {
    if (!allowedApps.has(appId)) grants.delete(appId)
  }
  // Keep explicitly assigned products in the signed matrix even when every
  // permission was denied. Consumers use the presence of an empty array to
  // distinguish an authoritative denial from a pre-matrix legacy token.
  for (const appId of allowedApps) {
    if (!grants.has(appId)) grants.set(appId, new Set())
  }

  const permissionsByApp = permissionMapToObject(grants)
  const permissionScopesByApp = Object.fromEntries(Object.entries(permissionsByApp).map(([appId, permissions]) => [
    appId,
    Object.fromEntries(permissions.map((permissionId) => [
      permissionId,
      getPermissionDefinition(appId, permissionId)?.scope || 'organization'
    ]))
  ]))

  return {
    schemaVersion: ACCESS_CONTROL_SCHEMA_VERSION,
    policyRevision: globalPolicy.revision,
    organizationRevision: organization?.accessControl?.revision || 1,
    roleKeys: matchedRoles.map((role) => role.key),
    roleNames: matchedRoles.map((role) => role.name),
    permissionsByApp,
    permissionScopesByApp
  }
}

export function authorizationHasPermission(authorization, appId, permissionId) {
  return (authorization?.permissionsByApp?.[appId] || []).includes(permissionId)
}

async function bumpAccountAuthorizationRevisions(accountIds = null) {
  const filter = accountIds
    ? { _id: { $in: uniqueStrings(accountIds) } }
    : {}
  await Account.updateMany(filter, {
    $inc: { authorizationRevision: 1 },
    $set: { updatedAt: new Date() }
  })
}

async function audit({ scope, organization = null, actor, action, targetType, targetKey, summary, revision, metadata = {} }) {
  return AccessControlAuditEvent.create({
    scope,
    organization: organization?._id || organization || null,
    actor: actor._id,
    actorEmail: actor.email,
    action,
    targetType,
    targetKey,
    summary,
    revision,
    metadata
  })
}

function sanitizeRoleInput(input, options = {}) {
  return {
    key: roleKey(input.key),
    name: String(input.name || '').trim().slice(0, 100),
    description: String(input.description || '').trim().slice(0, 500),
    sourceOrganizationRoles: uniqueStrings(input.sourceOrganizationRoles),
    sourceTeamRoles: uniqueStrings(input.sourceTeamRoles),
    grants: sanitizePermissionRows(input.grants, options),
    denies: sanitizePermissionRows(input.denies, options),
    isActive: input.isActive !== false
  }
}

function ensureRoleSafety(role) {
  const grants = permissionRowsToMap(role.grants)
  removePermissionRows(grants, role.denies)
  if (role.key === 'organization_owner') {
    const identityPermissions = grants.get('identity') || new Set()
    for (const token of PROTECTED_OWNER_PERMISSIONS) {
      const [, permissionId] = token.split(':')
      if (!identityPermissions.has(permissionId)) {
        const error = new Error(`Organization Owner must retain '${permissionId}'.`)
        error.code = 'PROTECTED_OWNER_PERMISSION'
        throw error
      }
    }
  }
  if (role.key === 'organization_admin' && !(grants.get('identity') || new Set()).has('access.manage')) {
    const error = new Error("Organization Admin must retain 'access.manage'.")
    error.code = 'PROTECTED_ADMIN_PERMISSION'
    throw error
  }
}

export async function saveGlobalRole(input, actor) {
  const policy = await getOrCreateGlobalAccessPolicy()
  const expectedRevision = Number(input.expectedRevision)
  if (Number.isFinite(expectedRevision) && expectedRevision !== policy.revision) {
    const error = new Error('The global permission policy changed while you were editing. Refresh and review the latest version.')
    error.code = 'POLICY_VERSION_CONFLICT'
    error.statusCode = 409
    throw error
  }
  const normalized = sanitizeRoleInput(input, { allowWildcard: true })
  const existingIndex = policy.roles.findIndex((role) => role.key === normalized.key)
  const existing = existingIndex >= 0 ? policy.roles[existingIndex] : null
  const role = {
    ...normalized,
    locked: existing?.locked === true,
    createdAt: existing?.createdAt || new Date(),
    updatedAt: new Date(),
    updatedBy: actor._id
  }
  if (existing?.locked) {
    role.sourceOrganizationRoles = [...(existing.sourceOrganizationRoles || [])]
    role.sourceTeamRoles = [...(existing.sourceTeamRoles || [])]
  }
  ensureRoleSafety(role)

  if (existingIndex >= 0) policy.roles.splice(existingIndex, 1, role)
  else policy.roles.push(role)
  policy.revision += 1
  policy.updatedBy = actor._id
  await policy.save()
  await bumpAccountAuthorizationRevisions()
  await audit({
    scope: 'global', actor, action: existing ? 'role.updated' : 'role.created',
    targetType: 'role', targetKey: role.key,
    summary: `${existing ? 'Updated' : 'Created'} global role ${role.name}.`,
    revision: policy.revision
  })
  return policy
}

export async function deleteGlobalRole(key, actor, expectedRevisionInput = undefined) {
  const normalizedKey = roleKey(key)
  const policy = await getOrCreateGlobalAccessPolicy()
  const expectedRevision = Number(expectedRevisionInput)
  if (Number.isFinite(expectedRevision) && expectedRevision !== policy.revision) {
    const error = new Error('The global permission policy changed while you were editing. Refresh and review the latest version.')
    error.code = 'POLICY_VERSION_CONFLICT'
    error.statusCode = 409
    throw error
  }
  const existing = policy.roles.find((role) => role.key === normalizedKey)
  if (!existing) return policy
  if (existing.locked) {
    const error = new Error('Built-in roles cannot be deleted.')
    error.code = 'ROLE_LOCKED'
    throw error
  }
  policy.roles = policy.roles.filter((role) => role.key !== normalizedKey)
  policy.revision += 1
  policy.updatedBy = actor._id
  await policy.save()
  await Organization.updateMany({}, { $pull: { 'members.$[].accessControl.roleKeys': normalizedKey } })
  await bumpAccountAuthorizationRevisions()
  await audit({
    scope: 'global', actor, action: 'role.deleted', targetType: 'role', targetKey: normalizedKey,
    summary: `Deleted global role ${existing.name}.`, revision: policy.revision
  })
  return policy
}

export async function saveOrganizationRoleOverride({ organization, input, actor }) {
  const policy = await getOrCreateGlobalAccessPolicy()
  const expectedRevision = Number(input.expectedRevision)
  const currentRevision = organization.accessControl?.revision || 1
  if (Number.isFinite(expectedRevision) && expectedRevision !== currentRevision) {
    const error = new Error('The organization permission policy changed while you were editing. Refresh and review the latest version.')
    error.code = 'POLICY_VERSION_CONFLICT'
    error.statusCode = 409
    throw error
  }
  const key = roleKey(input.roleKey || input.key)
  const globalRole = policy.roles.find((role) => role.key === key)
  const sanitized = {
    roleKey: key,
    name: String(input.name || globalRole?.name || key).trim().slice(0, 100),
    description: String(input.description || globalRole?.description || '').trim().slice(0, 500),
    grants: sanitizePermissionRows(input.grants, { delegableOnly: true }),
    denies: sanitizePermissionRows(input.denies),
    isActive: input.isActive !== false,
    updatedAt: new Date(),
    updatedBy: actor._id
  }
  const overrides = organization.accessControl?.roleOverrides || []
  const index = overrides.findIndex((override) => override.roleKey === key)
  if (index >= 0) overrides.splice(index, 1, sanitized)
  else overrides.push(sanitized)
  organization.accessControl = organization.accessControl || {}
  organization.accessControl.roleOverrides = overrides
  organization.accessControl.revision = (organization.accessControl.revision || 1) + 1
  organization.accessControl.updatedAt = new Date()
  organization.accessControl.updatedBy = actor._id
  await organization.save()
  await bumpAccountAuthorizationRevisions((organization.members || []).map((member) => toId(member.account)))
  await audit({
    scope: 'organization', organization, actor, action: index >= 0 ? 'role_override.updated' : 'role_override.created',
    targetType: 'role', targetKey: key,
    summary: `${index >= 0 ? 'Updated' : 'Created'} ${sanitized.name} for ${organization.name}.`,
    revision: organization.accessControl.revision
  })
  return organization
}

export async function deleteOrganizationRoleOverride({ organization, key, actor, expectedRevision: expectedRevisionInput }) {
  const normalizedKey = roleKey(key)
  const expectedRevision = Number(expectedRevisionInput)
  const currentRevision = organization.accessControl?.revision || 1
  if (Number.isFinite(expectedRevision) && expectedRevision !== currentRevision) {
    const error = new Error('The organization permission policy changed while you were editing. Refresh and review the latest version.')
    error.code = 'POLICY_VERSION_CONFLICT'
    error.statusCode = 409
    throw error
  }
  organization.accessControl = organization.accessControl || {}
  organization.accessControl.roleOverrides = (organization.accessControl.roleOverrides || [])
    .filter((override) => override.roleKey !== normalizedKey)
  for (const member of organization.members || []) {
    member.accessControl = member.accessControl || {}
    member.accessControl.roleKeys = (member.accessControl.roleKeys || [])
      .filter((candidate) => candidate !== normalizedKey)
  }
  organization.accessControl.revision = (organization.accessControl.revision || 1) + 1
  organization.accessControl.updatedAt = new Date()
  organization.accessControl.updatedBy = actor._id
  await organization.save()
  await bumpAccountAuthorizationRevisions((organization.members || []).map((member) => toId(member.account)))
  await audit({
    scope: 'organization', organization, actor, action: 'role_override.deleted',
    targetType: 'role', targetKey: normalizedKey,
    summary: `Removed the ${normalizedKey} organization override.`,
    revision: organization.accessControl.revision
  })
  return organization
}

export async function saveMemberAccessControl({ organization, accountId, input, actor }) {
  const expectedRevision = Number(input.expectedRevision)
  const currentRevision = organization.accessControl?.revision || 1
  if (Number.isFinite(expectedRevision) && expectedRevision !== currentRevision) {
    const error = new Error('The organization permission policy changed while you were editing. Refresh and review the latest version.')
    error.code = 'POLICY_VERSION_CONFLICT'
    error.statusCode = 409
    throw error
  }
  const member = findCanonicalMember(organization, accountId)
  if (!member) {
    const error = new Error('Active organization member not found.')
    error.code = 'MEMBER_NOT_FOUND'
    throw error
  }
  const policy = await getOrCreateGlobalAccessPolicy()
  const validRoleKeys = new Set([
    ...(policy.roles || []).filter((role) => role.isActive !== false).map((role) => role.key),
    ...(organization.accessControl?.roleOverrides || []).filter((role) => role.isActive !== false).map((role) => role.roleKey)
  ])
  const requestedRoleKeys = uniqueStrings(input.roleKeys).map(roleKey)
  for (const key of requestedRoleKeys) {
    if (!validRoleKeys.has(key)) {
      const error = new Error(`Unknown role '${key}'.`)
      error.code = 'UNKNOWN_ROLE'
      throw error
    }
    if (PROTECTED_ASSIGNMENT_ROLE_KEYS.has(key)) {
      const error = new Error(`${key} is assigned through the canonical organization role, not as an additional role.`)
      error.code = 'PROTECTED_ROLE_ASSIGNMENT'
      throw error
    }
  }
  member.accessControl = {
    roleKeys: requestedRoleKeys,
    grants: sanitizePermissionRows(input.grants, { delegableOnly: true }),
    denies: sanitizePermissionRows(input.denies),
    updatedAt: new Date(),
    updatedBy: actor._id
  }
  organization.accessControl = organization.accessControl || {}
  organization.accessControl.revision = (organization.accessControl.revision || 1) + 1
  organization.accessControl.updatedAt = new Date()
  organization.accessControl.updatedBy = actor._id
  await organization.save()
  await bumpAccountAuthorizationRevisions([toId(member.account)])
  await audit({
    scope: 'organization', organization, actor, action: 'member_access.updated',
    targetType: 'member', targetKey: toId(member.account),
    summary: `Updated role and permission assignments for an organization member.`,
    revision: organization.accessControl.revision,
    metadata: { roleKeys: requestedRoleKeys }
  })
  return member
}

export async function getGlobalAccessControlView() {
  const policy = await getOrCreateGlobalAccessPolicy()
  const auditEvents = await AccessControlAuditEvent.find({ scope: 'global' })
    .sort({ createdAt: -1 })
    .limit(30)
    .lean()
  return {
    schemaVersion: ACCESS_CONTROL_SCHEMA_VERSION,
    revision: policy.revision,
    catalog: PRODUCT_PERMISSION_CATALOG,
    roles: (policy.roles || []).map((role) => cloneRole(role.toObject ? role.toObject() : role)),
    auditEvents
  }
}

export async function getOrganizationAccessControlView({ organization, account = null }) {
  const policy = await getOrCreateGlobalAccessPolicy()
  const viewerAuthorization = account
    ? await resolveOrganizationAuthorization({ account, organization, policy })
    : null
  const hasPlatformAccess = account?.hasAdminAccess?.() || account?.isSystemAdmin || account?.isSuperAdmin
  const canViewMemberAccess = hasPlatformAccess ||
    authorizationHasPermission(viewerAuthorization, 'identity', 'access.manage') ||
    authorizationHasPermission(viewerAuthorization, 'identity', 'members.view')
  const canReadAudit = hasPlatformAccess ||
    authorizationHasPermission(viewerAuthorization, 'identity', 'audit.read')
  const auditEvents = canReadAudit
    ? await AccessControlAuditEvent.find({ organization: organization._id })
      .sort({ createdAt: -1 })
      .limit(30)
      .lean()
    : []
  const members = []
  const visibleMembers = canViewMemberAccess
    ? (organization.members || []).filter((member) => member.status === 'active')
    : []
  const accountIds = visibleMembers.map((member) => member.account)
  const accounts = await Account.find({ _id: { $in: accountIds } }).select('email profile teams organizations').lean()
  const accountById = new Map(accounts.map((candidate) => [toId(candidate), candidate]))
  for (const member of visibleMembers) {
    const memberAccount = accountById.get(toId(member.account))
    members.push({
      accountId: toId(member.account),
      email: memberAccount?.email || '',
      name: memberAccount?.profile?.name || memberAccount?.email || 'Member',
      organizationRole: member.role,
      accessControl: {
        roleKeys: uniqueStrings(member.accessControl?.roleKeys),
        grants: clonePermissionRows(member.accessControl?.grants),
        denies: clonePermissionRows(member.accessControl?.denies)
      },
      effective: await resolveOrganizationAuthorization({
        account: memberAccount || { _id: member.account, teams: [] },
        organization,
        member,
        policy
      })
    })
  }
  return {
    schemaVersion: ACCESS_CONTROL_SCHEMA_VERSION,
    policyRevision: policy.revision,
    organizationRevision: organization.accessControl?.revision || 1,
    organization: { id: toId(organization), name: organization.name },
    catalog: PRODUCT_PERMISSION_CATALOG,
    globalRoles: (policy.roles || []).filter((role) => role.isActive !== false).map((role) => cloneRole(role.toObject ? role.toObject() : role)),
    roleOverrides: (organization.accessControl?.roleOverrides || []).map((override) => ({
      roleKey: override.roleKey,
      name: override.name,
      description: override.description,
      grants: clonePermissionRows(override.grants),
      denies: clonePermissionRows(override.denies),
      isActive: override.isActive !== false
    })),
    members,
    canViewMemberAccess,
    auditEvents,
    canReadAudit,
    viewerAccountId: account ? toId(account) : null
  }
}

export async function canManageOrganizationAccess(account, organization) {
  if (account?.hasAdminAccess?.() || account?.isSystemAdmin || account?.isSuperAdmin) return true
  const authorization = await resolveOrganizationAuthorization({ account, organization })
  return authorizationHasPermission(authorization, 'identity', 'access.manage')
}

export async function canViewOrganizationAccess(account, organization) {
  if (account?.hasAdminAccess?.() || account?.isSystemAdmin || account?.isSuperAdmin) return true
  const authorization = await resolveOrganizationAuthorization({ account, organization })
  return authorizationHasPermission(authorization, 'identity', 'access.read') ||
    authorizationHasPermission(authorization, 'identity', 'access.manage')
}

export { sanitizePermissionRows }
