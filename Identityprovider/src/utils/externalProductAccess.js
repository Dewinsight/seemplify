const EXTERNAL_PRODUCT_ENTRY_RULES = Object.freeze({
  openwebui: Object.freeze({
    appId: 'openwebui',
    permission: 'chat.use'
  }),
  outline: Object.freeze({
    appId: 'outline',
    permission: 'documents.read'
  })
})

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
 * Open WebUI and Outline do not natively understand Seemplify's complete
 * product permission matrix. Enforce their minimum entry permission at the
 * IdP account/token boundary so a direct OIDC URL cannot bypass Hub product
 * assignment. First-party clients and Automation retain their existing
 * downstream authorization contracts.
 */
export function externalProductAccessDecision({ clientId, claims }) {
  const normalizedClientId = String(clientId || '').trim()
  const rule = EXTERNAL_PRODUCT_ENTRY_RULES[normalizedClientId]
  if (!rule) return { applicable: false, allowed: true }

  const matrix = permissionMatrix(claims)
  if (!matrix || !Object.prototype.hasOwnProperty.call(matrix, rule.appId)) {
    return {
      applicable: true,
      allowed: false,
      appId: rule.appId,
      permission: rule.permission,
      code: 'PRODUCT_NOT_ASSIGNED'
    }
  }

  const permissions = Array.isArray(matrix[rule.appId]) ? matrix[rule.appId] : []
  const allowed = permissions.includes('*') || permissions.includes(rule.permission)
  return {
    applicable: true,
    allowed,
    appId: rule.appId,
    permission: rule.permission,
    code: allowed ? 'PRODUCT_ACCESS_GRANTED' : 'PRODUCT_PERMISSION_DENIED'
  }
}
