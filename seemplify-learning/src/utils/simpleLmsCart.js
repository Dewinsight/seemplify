const MAX_CART_ITEMS = 50

const isValidObjectIdString = (value) => /^[a-f\d]{24}$/i.test(String(value || '').trim())

const normalizeCourseId = (value) => {
  const normalized = String(value || '').trim()
  return isValidObjectIdString(normalized) ? normalized : ''
}

const normalizeCourseIdList = (values = []) => {
  if (!Array.isArray(values)) return []

  const deduped = []
  const seen = new Set()

  for (const value of values) {
    const courseId = normalizeCourseId(value)
    if (!courseId || seen.has(courseId)) continue
    seen.add(courseId)
    deduped.push(courseId)
    if (deduped.length >= MAX_CART_ITEMS) break
  }

  return deduped
}

export const getSessionCartCourseIds = (req) => {
  const raw = Array.isArray(req?.session?.simpleLmsCart) ? req.session.simpleLmsCart : []
  const normalized = normalizeCourseIdList(raw)

  if (!req.session) return normalized
  if (raw.length !== normalized.length || raw.some((value, index) => String(value) !== normalized[index])) {
    req.session.simpleLmsCart = normalized
  }

  return normalized
}

export const setSessionCartCourseIds = (req, values = []) => {
  const normalized = normalizeCourseIdList(values)
  if (req?.session) {
    req.session.simpleLmsCart = normalized
  }
  return normalized
}

export const addSessionCartCourseId = (req, courseId) => {
  const normalizedCourseId = normalizeCourseId(courseId)
  if (!normalizedCourseId) return getSessionCartCourseIds(req)

  const cart = getSessionCartCourseIds(req)
  const next = [normalizedCourseId, ...cart.filter((entry) => entry !== normalizedCourseId)]
  return setSessionCartCourseIds(req, next)
}

export const removeSessionCartCourseId = (req, courseId) => {
  const normalizedCourseId = normalizeCourseId(courseId)
  const cart = getSessionCartCourseIds(req)
  if (!normalizedCourseId) return cart
  return setSessionCartCourseIds(req, cart.filter((entry) => entry !== normalizedCourseId))
}

export const clearSessionCart = (req) => setSessionCartCourseIds(req, [])

export const hasSessionCartCourse = (req, courseId) => {
  const normalizedCourseId = normalizeCourseId(courseId)
  if (!normalizedCourseId) return false
  return getSessionCartCourseIds(req).includes(normalizedCourseId)
}
