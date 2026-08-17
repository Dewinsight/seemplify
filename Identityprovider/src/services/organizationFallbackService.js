function toIdString(value) {
  if (!value) return ''
  return value._id?.toString?.() || value.toString?.() || ''
}

export function selectNextAvailableOrganizationId(memberships = [], removedOrganizationId) {
  const removedId = toIdString(removedOrganizationId)
  const normalized = memberships.map((membership, index) => ({
    id: toIdString(membership?.organization),
    isActive: membership?.isActive !== false,
    index
  }))
  const removedIndex = normalized.findIndex((membership) => membership.id === removedId)
  const available = normalized.filter((membership) => (
    membership.id && membership.id !== removedId && membership.isActive
  ))

  if (available.length === 0) return null
  if (removedIndex < 0) return available[0].id

  return available.find((membership) => membership.index > removedIndex)?.id
    || available[0].id
}
