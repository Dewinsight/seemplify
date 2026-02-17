export const APP_ACCESS_MODE_ALL = 'all'
export const APP_ACCESS_MODE_SELECTED = 'selected'

export function buildValidAppIdSet(apps = []) {
  return new Set(
    (Array.isArray(apps) ? apps : [])
      .map(app => String(app?.appId || '').trim())
      .filter(Boolean)
  )
}

export function normalizeAppIdList(appIds = [], validAppIds = null) {
  const source = Array.isArray(appIds) ? appIds : []
  const normalized = []
  const seen = new Set()

  for (const item of source) {
    const appId = String(item || '').trim()
    if (!appId || seen.has(appId)) continue
    if (validAppIds && !validAppIds.has(appId)) continue
    seen.add(appId)
    normalized.push(appId)
  }

  return normalized
}

export function normalizeAppAccess(input = null, validAppIds = null) {
  const source = input && typeof input === 'object' ? input : {}
  const rawMode = typeof source.mode === 'string' ? source.mode.trim().toLowerCase() : APP_ACCESS_MODE_ALL
  const mode = rawMode === APP_ACCESS_MODE_SELECTED ? APP_ACCESS_MODE_SELECTED : APP_ACCESS_MODE_ALL
  const appIds = normalizeAppIdList(source.appIds, validAppIds)

  return {
    mode,
    appIds: mode === APP_ACCESS_MODE_SELECTED ? appIds : []
  }
}

export function memberCanAccessApp(appAccess, appId) {
  const normalized = normalizeAppAccess(appAccess)
  if (normalized.mode !== APP_ACCESS_MODE_SELECTED) return true

  const targetAppId = String(appId || '').trim()
  if (!targetAppId) return false
  return normalized.appIds.includes(targetAppId)
}

