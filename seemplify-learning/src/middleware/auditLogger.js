import { logAuditEvent } from '../utils/auditLog.js'

export function auditLogger(action, options = {}) {
  return (req, res, next) => {
    const performedBy = req.user?._id || null
    if (!action || !performedBy) return next()

    const onlyOnSuccess = options.onlyOnSuccess !== false

    res.on('finish', () => {
      if (onlyOnSuccess && res.statusCode >= 400) return
      const metadata = typeof options.metadata === 'function'
        ? options.metadata(req, res)
        : (options.metadata || {})

      void logAuditEvent({
        action,
        performedBy,
        targetAccount: metadata?.targetAccount || null,
        targetOrganization: metadata?.targetOrganization || null,
        metadata: {
          ...metadata,
          statusCode: res.statusCode,
          method: req.method,
          path: req.originalUrl
        },
        req
      })
    })

    next()
  }
}

export default auditLogger
