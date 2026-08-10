export function claimsCacheEnabled(source = process.env) {
  if (String(source.NODE_ENV || '').trim().toLowerCase() === 'production') return false
  const explicit = String(source.IDP_CLAIMS_CACHE_ENABLED || '').trim().toLowerCase()
  if (explicit) return ['1', 'true', 'yes', 'on'].includes(explicit)
  // This cache is process-local. Enabling it by default in a multi-replica
  // production deployment can resurrect recently revoked app access from a
  // different replica. Development keeps the latency optimization.
  return true
}

export default claimsCacheEnabled
