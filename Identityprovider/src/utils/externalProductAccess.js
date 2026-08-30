export const N8N_EDITOR_PERMISSION_BUNDLE = Object.freeze([
  'automations.read',
  'automations.create',
  'automations.edit',
  'automations.delete',
  'automations.run',
  'executions.read',
  'executions.manage',
  'connections.read',
  'connections.manage',
  'settings.manage'
])

const EXTERNAL_PRODUCT_ENTRY_RULES = Object.freeze({
  openwebui: Object.freeze({
    appId: 'openwebui',
    permission: 'chat.use'
  }),
  outline: Object.freeze({
    appId: 'outline',
    permission: 'documents.read'
  }),
  'n8n-workspace-node': Object.freeze({
    appId: 'automation-hub',
    permissions: N8N_EDITOR_PERMISSION_BUNDLE
  })
})

function environmentFlagEnabled(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase())
}

function permissionMatrix(claims) {
  const currentOrganization = claims?.current_organization || claims?.currentOrganization || null
  const authorization = currentOrganization?.authorization || claims?.authorization || null
  if (authorization?.permissionsByApp && typeof authorization.permissionsByApp === 'object') {
    return authorization.permissionsByApp
  }
  if (claims?.product_permissions && typeof claims.product_permissions === 'object') {
    return claims.product_permissions
  }
  if (currentOrganization?.appPermissions && typeof currentOrganization.appPermissions === 'object') {
    return currentOrganization.appPermissions
  }
  return null
}

/**
 * External editors do not natively understand Seemplify's complete
 * product permission matrix. Enforce each product's entry permission set at
 * the IdP account/token boundary so a direct OIDC URL cannot bypass Hub product
 * assignment. The private n8n Workspace-node OAuth client requires the complete
 * coarse editor bundle; every node call is then authorized again by Workspace.
 */
export function externalProductAccessDecision({ clientId, claims, env = process.env }) {
  const normalizedClientId = String(clientId || '').trim()
  const rule = EXTERNAL_PRODUCT_ENTRY_RULES[normalizedClientId]
  if (!rule) return { applicable: false, allowed: true }
  const requiredPermissions = Array.isArray(rule.permissions) ? rule.permissions : [rule.permission]

  if (rule.appId === 'automation-hub' && !environmentFlagEnabled(env.N8N_INTEGRATION_ENABLED)) {
    return {
      applicable: true,
      allowed: false,
      appId: rule.appId,
      permission: requiredPermissions[0],
      permissions: requiredPermissions,
      code: 'PRODUCT_DISABLED'
    }
  }

  const matrix = permissionMatrix(claims)
  if (!matrix || !Object.prototype.hasOwnProperty.call(matrix, rule.appId)) {
    return {
      applicable: true,
      allowed: false,
      appId: rule.appId,
      permission: requiredPermissions[0],
      permissions: requiredPermissions,
      code: 'PRODUCT_NOT_ASSIGNED'
    }
  }

  const permissions = Array.isArray(matrix[rule.appId]) ? matrix[rule.appId] : []
  const missingPermissions = permissions.includes('*')
    ? []
    : requiredPermissions.filter((permission) => !permissions.includes(permission))
  const allowed = missingPermissions.length === 0
  return {
    applicable: true,
    allowed,
    appId: rule.appId,
    permission: requiredPermissions[0],
    permissions: requiredPermissions,
    missingPermissions,
    code: allowed ? 'PRODUCT_ACCESS_GRANTED' : 'PRODUCT_PERMISSION_DENIED'
  }
}
