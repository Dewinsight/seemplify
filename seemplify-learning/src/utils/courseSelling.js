const SELL_THROUGH_DEFAULTS = Object.freeze({
  enabled: false,
  creatorSharePercent: 70,
  partnerSharePercent: 20
})

const ACTIVE_ASSIGNMENT_STATUSES = new Set(['active'])

const toIdString = (value) => {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'object' && value._id) return String(value._id)
  return String(value)
}

const normalizeRevenuePercent = (value, fallback = 0) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return Math.min(100, Math.max(0, Number(fallback) || 0))
  return Math.min(100, Math.max(0, Math.round(parsed * 100) / 100))
}

const buildPlatformSharePercent = ({ creatorSharePercent, partnerSharePercent }) => (
  Math.max(0, Math.round((100 - creatorSharePercent - partnerSharePercent) * 100) / 100)
)

const normalizePartnerSelling = (raw = {}, fallback = SELL_THROUGH_DEFAULTS) => {
  const enabled = Boolean(raw?.enabled)
  const creatorSharePercent = normalizeRevenuePercent(
    raw?.creatorSharePercent,
    fallback?.creatorSharePercent ?? SELL_THROUGH_DEFAULTS.creatorSharePercent
  )
  const partnerSharePercent = normalizeRevenuePercent(
    raw?.partnerSharePercent,
    fallback?.partnerSharePercent ?? SELL_THROUGH_DEFAULTS.partnerSharePercent
  )
  if ((creatorSharePercent + partnerSharePercent) > 100) {
    throw new Error('Creator share and partner share cannot exceed 100%.')
  }
  return {
    enabled,
    creatorSharePercent,
    partnerSharePercent,
    platformSharePercent: buildPlatformSharePercent({ creatorSharePercent, partnerSharePercent })
  }
}

const normalizeSellingOrganizationAssignment = (raw = {}, fallback = SELL_THROUGH_DEFAULTS) => {
  const organizationId = toIdString(raw?.organization)
  if (!organizationId) return null

  const creatorSharePercent = normalizeRevenuePercent(
    raw?.creatorSharePercent,
    fallback?.creatorSharePercent ?? SELL_THROUGH_DEFAULTS.creatorSharePercent
  )
  const partnerSharePercent = normalizeRevenuePercent(
    raw?.partnerSharePercent,
    fallback?.partnerSharePercent ?? SELL_THROUGH_DEFAULTS.partnerSharePercent
  )
  if ((creatorSharePercent + partnerSharePercent) > 100) {
    throw new Error('Assigned creator share and partner share cannot exceed 100%.')
  }

  const status = String(raw?.status || 'active').trim().toLowerCase() === 'inactive'
    ? 'inactive'
    : 'active'

  return {
    organization: organizationId,
    organizationName: String(raw?.organizationName || '').trim().slice(0, 200),
    partnerType: ['partner', 'channel_partner'].includes(String(raw?.partnerType || '').trim().toLowerCase())
      ? String(raw.partnerType).trim().toLowerCase()
      : 'partner',
    status,
    creatorSharePercent,
    partnerSharePercent,
    platformSharePercent: buildPlatformSharePercent({ creatorSharePercent, partnerSharePercent }),
    assignedBy: raw?.assignedBy || null,
    assignedAt: raw?.assignedAt || new Date(),
    updatedAt: raw?.updatedAt || new Date()
  }
}

const getCourseSellingAssignments = (course, { onlyActive = false } = {}) => {
  const assignments = Array.isArray(course?.sellingOrganizations) ? course.sellingOrganizations : []
  return assignments
    .map((assignment) => normalizeSellingOrganizationAssignment(assignment, course?.partnerSelling || SELL_THROUGH_DEFAULTS))
    .filter(Boolean)
    .filter((assignment) => !onlyActive || ACTIVE_ASSIGNMENT_STATUSES.has(assignment.status))
}

const findCourseSellingAssignment = (course, organizationId, { onlyActive = false } = {}) => {
  const normalizedOrganizationId = toIdString(organizationId)
  if (!normalizedOrganizationId) return null
  return getCourseSellingAssignments(course, { onlyActive }).find((assignment) => (
    toIdString(assignment.organization) === normalizedOrganizationId
  )) || null
}

const getCourseOwnerOrganizationId = (course) => toIdString(course?.organization)

const courseIsSellableByOrganization = (course, organizationId) => {
  const normalizedOrganizationId = toIdString(organizationId)
  if (!normalizedOrganizationId || !course) return false
  if (getCourseOwnerOrganizationId(course) === normalizedOrganizationId) return true
  return Boolean(findCourseSellingAssignment(course, normalizedOrganizationId, { onlyActive: true }))
}

const buildOrganizationSellableCourseFilter = (organizationId, extraFilter = {}) => {
  const normalizedOrganizationId = toIdString(organizationId)
  return {
    ...extraFilter,
    $or: [
      { organization: normalizedOrganizationId },
      {
        sellingOrganizations: {
          $elemMatch: {
            organization: normalizedOrganizationId,
            status: 'active'
          }
        }
      }
    ]
  }
}

const resolveCourseSaleContext = ({ course, requestedOrganizationId = '' }) => {
  const ownerOrganizationId = getCourseOwnerOrganizationId(course)
  const normalizedRequestedOrganizationId = toIdString(requestedOrganizationId)

  if (normalizedRequestedOrganizationId) {
    if (ownerOrganizationId && ownerOrganizationId === normalizedRequestedOrganizationId) {
      return {
        saleMode: 'org_owned',
        sellingOrganizationId: ownerOrganizationId,
        assignment: null
      }
    }

    const assignment = findCourseSellingAssignment(course, normalizedRequestedOrganizationId, { onlyActive: true })
    if (assignment) {
      return {
        saleMode: 'assigned_partner',
        sellingOrganizationId: normalizedRequestedOrganizationId,
        assignment
      }
    }
  }

  if (ownerOrganizationId) {
    return {
      saleMode: 'org_owned',
      sellingOrganizationId: ownerOrganizationId,
      assignment: null
    }
  }

  return {
    saleMode: 'direct_creator',
    sellingOrganizationId: '',
    assignment: null
  }
}

const resolveCourseRevenueSplit = ({
  course,
  amountMinor = 0,
  defaultCreatorCommissionRate = 70,
  sellingOrganizationId = ''
}) => {
  const amount = Math.max(0, Math.round(Number(amountMinor || 0)))
  const saleContext = resolveCourseSaleContext({ course, requestedOrganizationId: sellingOrganizationId })
  const defaultCreatorRate = normalizeRevenuePercent(defaultCreatorCommissionRate, 70)

  if (saleContext.saleMode === 'assigned_partner' && saleContext.assignment) {
    const creatorSharePercent = normalizeRevenuePercent(
      saleContext.assignment.creatorSharePercent,
      course?.partnerSelling?.creatorSharePercent ?? SELL_THROUGH_DEFAULTS.creatorSharePercent
    )
    const partnerSharePercent = normalizeRevenuePercent(
      saleContext.assignment.partnerSharePercent,
      course?.partnerSelling?.partnerSharePercent ?? SELL_THROUGH_DEFAULTS.partnerSharePercent
    )
    const creatorCommissionMinor = Math.max(0, Math.round((amount * creatorSharePercent) / 100))
    const partnerShareMinor = Math.max(0, Math.round((amount * partnerSharePercent) / 100))
    const platformShareMinor = Math.max(0, amount - creatorCommissionMinor - partnerShareMinor)
    return {
      ...saleContext,
      creatorSharePercent,
      partnerSharePercent,
      platformSharePercent: buildPlatformSharePercent({ creatorSharePercent, partnerSharePercent }),
      creatorCommissionMinor,
      partnerShareMinor,
      platformShareMinor
    }
  }

  if (saleContext.saleMode === 'org_owned') {
    const creatorSharePercent = defaultCreatorRate
    const creatorCommissionMinor = Math.max(0, Math.round((amount * creatorSharePercent) / 100))
    const partnerShareMinor = Math.max(0, amount - creatorCommissionMinor)
    return {
      ...saleContext,
      creatorSharePercent,
      partnerSharePercent: Math.max(0, Math.round(((partnerShareMinor / Math.max(amount, 1)) * 100) * 100) / 100),
      platformSharePercent: 0,
      creatorCommissionMinor,
      partnerShareMinor,
      platformShareMinor: 0
    }
  }

  const creatorSharePercent = defaultCreatorRate
  const creatorCommissionMinor = Math.max(0, Math.round((amount * creatorSharePercent) / 100))
  return {
    ...saleContext,
    creatorSharePercent,
    partnerSharePercent: 0,
    platformSharePercent: buildPlatformSharePercent({ creatorSharePercent, partnerSharePercent: 0 }),
    creatorCommissionMinor,
    partnerShareMinor: 0,
    platformShareMinor: Math.max(0, amount - creatorCommissionMinor)
  }
}

export {
  SELL_THROUGH_DEFAULTS,
  normalizeRevenuePercent,
  normalizePartnerSelling,
  normalizeSellingOrganizationAssignment,
  getCourseSellingAssignments,
  findCourseSellingAssignment,
  courseIsSellableByOrganization,
  buildOrganizationSellableCourseFilter,
  resolveCourseSaleContext,
  resolveCourseRevenueSplit,
  toIdString as toCourseSellingIdString
}
