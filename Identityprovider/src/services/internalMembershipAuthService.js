export function resolveInternalMembershipSecret(serviceId, env = process.env) {
  const normalizedServiceId = String(serviceId || '').trim().toLowerCase()

  if (normalizedServiceId === 'time-attendance') {
    return env.TIME_ATTENDANCE_IDP_SERVICE_SECRET
      || env.ATTENDANCE_HUB_SECRET
      || env.INTERNAL_SERVICE_SECRET
      || ''
  }

  if (normalizedServiceId === 'recruiter') {
    return env.RECRUITER_IDP_SERVICE_SECRET
      || env.INTERNAL_SERVICE_SECRET
      || ''
  }

  if (normalizedServiceId === 'leave-management'
    || normalizedServiceId === 'messaging'
    || normalizedServiceId === 'workspace') {
    return env.MESSAGING_IDP_SERVICE_SECRET
      || env.INTERNAL_SERVICE_SECRET
      || ''
  }

  return env.INTERNAL_SERVICE_SECRET
    || env.MESSAGING_IDP_SERVICE_SECRET
    || env.RECRUITER_IDP_SERVICE_SECRET
    || ''
}
