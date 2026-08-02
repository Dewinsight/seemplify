export const ONBOARDING_STATUS_VALUES = ['not_started', 'pending', 'in_progress', 'completed', 'cancelled']

export function normalizeOnboardingStatus(value, fallback = 'not_started') {
  const normalized = String(value || '').trim().toLowerCase()
  return ONBOARDING_STATUS_VALUES.includes(normalized) ? normalized : fallback
}

export function normalizeManualOnboardingStatus(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (!normalized || normalized === 'auto' || normalized === 'clear') {
    return null
  }

  return ONBOARDING_STATUS_VALUES.includes(normalized) ? normalized : null
}

function resolveMemberId(value) {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (typeof value.toString === 'function') return value.toString()
  return String(value || '')
}

export function buildOnboardingStateMap({ members = [], assignments = [], workflowType = 'onboarding' } = {}) {
  const latestAssignmentByMember = new Map()

  const sortedAssignments = Array.isArray(assignments)
    ? [...assignments].sort((a, b) => {
        const aTime = new Date(a?.updatedAt || a?.createdAt || 0).getTime()
        const bTime = new Date(b?.updatedAt || b?.createdAt || 0).getTime()
        return bTime - aTime
      })
    : []

  sortedAssignments.forEach((assignment) => {
    const assignmentWorkflowType = String(assignment?.workflowType || 'onboarding').trim().toLowerCase() || 'onboarding'
    const memberId = resolveMemberId(assignment?.member?._id || assignment?.member)

    if (!memberId || latestAssignmentByMember.has(memberId)) {
      return
    }

    if (workflowType !== 'all' && assignmentWorkflowType !== workflowType) {
      return
    }

    latestAssignmentByMember.set(memberId, assignment)
  })

  const stateByMember = new Map()
  members.forEach((member) => {
    const memberId = resolveMemberId(member?.account?._id || member?.account || member?._id || member?.id)
    if (!memberId) return

    const manualStatus = normalizeManualOnboardingStatus(member?.onboardingStatusOverride)
    const latestAssignment = latestAssignmentByMember.get(memberId) || null
    const assignmentStatus = latestAssignment
      ? normalizeOnboardingStatus(latestAssignment.status)
      : 'not_started'

    stateByMember.set(memberId, {
      status: manualStatus || assignmentStatus,
      source: manualStatus ? 'manual' : (latestAssignment ? 'assignment' : 'none'),
      manualStatus,
      latestAssignment
    })
  })

  return stateByMember
}

export function getMemberOnboardingState(memberId, onboardingStateByMember = new Map()) {
  const resolvedMemberId = resolveMemberId(memberId)
  return onboardingStateByMember.get(resolvedMemberId) || {
    status: 'not_started',
    source: 'none',
    manualStatus: null,
    latestAssignment: null
  }
}

export function isOnboardingCompleted(value) {
  return normalizeOnboardingStatus(value) === 'completed'
}
