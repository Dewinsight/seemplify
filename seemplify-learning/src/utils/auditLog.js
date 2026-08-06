import { AuditLog } from '../models/AuditLog.js'

const resolveIpAddress = (req) => {
  if (!req) return ''
  const forwarded = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim()
  return forwarded || String(req.ip || req.connection?.remoteAddress || '').trim()
}

export async function logAuditEvent({
  action,
  performedBy,
  targetAccount = null,
  targetOrganization = null,
  metadata = {},
  req = null
} = {}) {
  if (!action || !performedBy) return null

  try {
    return await AuditLog.create({
      action,
      performedBy,
      targetAccount: targetAccount || null,
      targetOrganization: targetOrganization || null,
      metadata,
      ipAddress: resolveIpAddress(req),
      userAgent: String(req?.get('user-agent') || '').slice(0, 500)
    })
  } catch (error) {
    console.error('Audit log write failed:', error)
    return null
  }
}

export default logAuditEvent
