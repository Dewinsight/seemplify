import { memberCanAccessApp } from './appAccess.js'

const APP = 'performance-management'
const ACTIONS = ['feedback:send', 'feedback:request', 'recognition:create']
const id = value => String(value?._id || value?.id || value || '')
const denied = () => Object.assign(new Error('Performance colleague discovery is not permitted.'), { status: 403 })

// Collaboration pickers expose contact labels only. They never expand the
// separate Performance directory's appraisal, manager or team authority.
export function buildPerformanceColleagues({ organization, actorId, authorization, q, userId, action, limit = 10 }) {
  const active = (organization?.members || []).filter(member => member.status === 'active' && member.account?.isActive !== false &&
    typeof member.account?.email === 'string' && member.account.email.trim())
  const actor = active.find(member => id(member.account) === id(actorId))
  const permissions = authorization?.permissionsByApp?.[APP] || []
  if (!actor || !memberCanAccessApp(actor.appAccess, APP) ||
      (action !== undefined ? !ACTIONS.includes(action) || !permissions.includes(action) : !ACTIONS.some(candidate => permissions.includes(candidate)))) throw denied()
  const exact = userId !== undefined
  if (exact && (typeof userId !== 'string' || !userId.trim() || userId.trim().length > 256)) {
    throw Object.assign(new Error('A valid colleague ID is required.'), { status: 400 })
  }
  if (!exact && (typeof q !== 'string' || q.trim().length < 2 || q.trim().length > 120)) {
    throw Object.assign(new Error('Search must contain between 2 and 120 characters.'), { status: 400 })
  }
  const needle = exact ? userId.trim() : q.trim().toLowerCase()
  const maximum = Math.min(25, Math.max(1, Number.parseInt(limit, 10) || 10))
  const members = active.filter(member => memberCanAccessApp(member.appAccess, APP) &&
    (!exact || (member.account.sub || id(member.account)) === needle)).map(member => {
    const account = member.account
    const name = typeof account.profile?.name === 'string' && account.profile.name.trim() ? account.profile.name.trim() : account.email
    const jobTitle = typeof member.designation === 'string' ? member.designation.trim() : ''
    return { userId: account.sub || id(account), name, email: account.email, ...(jobTitle ? { jobTitle } : {}) }
  }).filter(member => member.userId && (exact || `${member.name} ${member.email}`.toLowerCase().includes(needle)))
    .sort((a, b) => a.name.localeCompare(b.name)).slice(0, maximum)
  return { organizationId: id(organization), members }
}
