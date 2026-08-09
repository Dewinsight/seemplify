export const DEFAULT_HUB_PINNED_APP_IDS = Object.freeze([
  'smarthr',
  'leave-management'
])

export const EXTERNAL_HUB_PINNED_APP_IDS = Object.freeze([
  'experience-management'
])

export const MAX_HUB_PINNED_APP_IDS = 24

function toAppIdSet(appIds = []) {
  if (appIds instanceof Set) return appIds

  return new Set(
    (Array.isArray(appIds) ? appIds : [])
      .map(appId => String(appId || '').trim())
      .filter(Boolean)
  )
}

export function buildKnownHubPinAppIdSet(apps = [], externalAppIds = EXTERNAL_HUB_PINNED_APP_IDS) {
  return new Set([
    ...(Array.isArray(apps) ? apps : [])
      .map(app => String(app?.appId || '').trim())
      .filter(Boolean),
    ...(Array.isArray(externalAppIds) ? externalAppIds : [])
      .map(appId => String(appId || '').trim())
      .filter(Boolean)
  ])
}

export function sanitizeHubPinnedAppIds(
  appIds,
  {
    knownAppIds = null,
    visibleAppIds = null,
    maxItems = MAX_HUB_PINNED_APP_IDS
  } = {}
) {
  if (!Array.isArray(appIds)) return []

  const known = knownAppIds ? toAppIdSet(knownAppIds) : null
  const visible = visibleAppIds ? toAppIdSet(visibleAppIds) : null
  const normalized = []
  const seen = new Set()
  const limit = Math.max(0, Math.min(MAX_HUB_PINNED_APP_IDS, Number(maxItems) || 0))

  for (const item of appIds) {
    if (normalized.length >= limit) break
    if (typeof item !== 'string') continue

    const appId = item.trim()
    if (!appId || seen.has(appId)) continue
    if (known && !known.has(appId)) continue
    if (visible && !visible.has(appId)) continue

    seen.add(appId)
    normalized.push(appId)
  }

  return normalized
}

function getOrganizationPreferenceStore(account) {
  return account?.hubPreferences?.pinnedAppsByOrganization || null
}

function readStoredPreference(store, organizationId) {
  if (!store || !organizationId) return { exists: false, value: null }

  if (typeof store.has === 'function' && typeof store.get === 'function') {
    return {
      exists: store.has(organizationId),
      value: store.get(organizationId)
    }
  }

  if (typeof store === 'object' && Object.prototype.hasOwnProperty.call(store, organizationId)) {
    return {
      exists: true,
      value: store[organizationId]
    }
  }

  return { exists: false, value: null }
}

export function getHubPinPreference(account, organizationId) {
  const normalizedOrganizationId = String(organizationId || '').trim()
  const stored = readStoredPreference(
    getOrganizationPreferenceStore(account),
    normalizedOrganizationId
  )

  return {
    exists: stored.exists,
    pinnedAppIds: Array.isArray(stored.value?.pinnedAppIds)
      ? stored.value.pinnedAppIds
      : []
  }
}

export function resolveHubPinnedAppIds({
  account,
  organizationId,
  knownAppIds,
  visibleAppIds,
  defaultPinnedAppIds = DEFAULT_HUB_PINNED_APP_IDS
} = {}) {
  const preference = getHubPinPreference(account, organizationId)
  const source = preference.exists ? preference.pinnedAppIds : defaultPinnedAppIds

  return sanitizeHubPinnedAppIds(source, {
    knownAppIds,
    visibleAppIds
  })
}

export function validateHubPinsPayload(payload) {
  const pinnedAppIds = payload?.pinnedAppIds

  if (!Array.isArray(pinnedAppIds)) {
    return {
      valid: false,
      error: 'pinnedAppIds must be an array'
    }
  }

  if (pinnedAppIds.length > MAX_HUB_PINNED_APP_IDS) {
    return {
      valid: false,
      error: `You can pin at most ${MAX_HUB_PINNED_APP_IDS} applications`
    }
  }

  if (pinnedAppIds.some(appId => typeof appId !== 'string')) {
    return {
      valid: false,
      error: 'pinnedAppIds must contain only strings'
    }
  }

  return {
    valid: true,
    pinnedAppIds
  }
}
