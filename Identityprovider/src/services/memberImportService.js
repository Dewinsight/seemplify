/**
 * Bulk member creation and deactivation from an uploaded CSV or Excel sheet.
 *
 * The service never writes anything. It turns a spreadsheet into rows an
 * administrator can check one by one, resolving free text ("People Operations",
 * "HR Manager", "Payroll, Leave") against the organization's own departments,
 * teams, roles, and apps. Committing a reviewed row still goes through the
 * single-record invitation and member endpoints, so permissions, webhooks, and
 * audit history behave exactly as they do for a manual change.
 */
import XLSX from 'xlsx'

import {
  APP_ACCESS_MODE_ALL,
  APP_ACCESS_MODE_SELECTED
} from '../utils/appAccess.js'
import {
  buildCsv,
  detectColumnMap,
  extractRowsFromSource,
  normalizeColumnMap,
  normalizeHeader,
  rowsToRecords,
  summarizeRows
} from '../utils/tabularUpload.js'

export const MEMBER_IMPORT_CREATION = 'creation'
export const MEMBER_IMPORT_DEACTIVATION = 'deactivation'
export const MEMBER_IMPORT_TYPES = [MEMBER_IMPORT_CREATION, MEMBER_IMPORT_DEACTIVATION]

export const IMPORTABLE_ROLES = ['admin', 'hr_manager', 'recruiter', 'interviewer', 'staff']

export const ROLE_LABELS = {
  owner: 'Owner',
  admin: 'Admin',
  hr_manager: 'HR Manager',
  recruiter: 'Recruiter',
  interviewer: 'Interviewer',
  staff: 'Staff'
}

export const MEMBER_CREATION_FIELDS = [
  {
    key: 'email',
    label: 'Email address',
    required: true,
    example: 'ada.lovelace@example.com',
    description: 'Where the invitation is sent. One person per row.'
  },
  {
    key: 'fullName',
    label: 'Full name',
    example: 'Ada Lovelace',
    description: 'Shown while you review the batch. People set their own profile name when they accept.'
  },
  {
    key: 'role',
    label: 'Organization role',
    example: 'Staff',
    description: `Admin, HR Manager, Recruiter, Interviewer, or Staff. Blank rows become Staff. Owner cannot be assigned by import.`
  },
  {
    key: 'designation',
    label: 'Designation',
    example: 'Software Engineer',
    description: 'Job title shown on the member record.'
  },
  {
    key: 'employeeId',
    label: 'Employee ID',
    example: 'EMP-0042',
    description: 'Must be unique across the organization and the batch.'
  },
  {
    key: 'department',
    label: 'Department',
    example: 'Engineering',
    description: 'Matched by name. Left blank, it follows the team.'
  },
  {
    key: 'team',
    label: 'Team',
    required: true,
    example: 'Platform',
    description: 'Matched by name. Every invitation needs a team; pick one during review if the name does not match.'
  },
  {
    key: 'apps',
    label: 'App access',
    example: 'All apps',
    description: 'Comma-separated app names, or "All apps". Blank rows inherit all apps available to your plan.'
  }
]

export const MEMBER_DEACTIVATION_FIELDS = [
  {
    key: 'email',
    label: 'Email address',
    example: 'ada.lovelace@example.com',
    description: 'Identifies the member. Either email or employee ID is required.'
  },
  {
    key: 'employeeId',
    label: 'Employee ID',
    example: 'EMP-0042',
    description: 'Used when the email is missing, and cross-checked when both are present.'
  },
  {
    key: 'reason',
    label: 'Reason',
    example: 'Resigned',
    description: 'Shown while you review the batch. It is not stored on the member record.'
  }
]

const CREATION_ALIASES = {
  email: ['email', 'emailaddress', 'workemail', 'officialemail', 'staffemail', 'companyemail', 'mail', 'e', 'usermail', 'username'],
  fullName: ['fullname', 'name', 'staffname', 'employeename', 'membername', 'displayname'],
  role: ['role', 'accessrole', 'organizationrole', 'organisationrole', 'userrole', 'systemrole', 'accesslevel', 'permission', 'permissions'],
  designation: ['designation', 'jobtitle', 'title', 'position', 'jobrole', 'grade'],
  employeeId: ['employeeid', 'employeeno', 'employeenumber', 'staffid', 'staffno', 'staffnumber', 'empid', 'personnelnumber', 'payrollid'],
  department: ['department', 'dept', 'division', 'function', 'businessunit'],
  team: ['team', 'teamname', 'unit', 'subunit', 'subteam', 'group'],
  apps: ['apps', 'app', 'applications', 'appaccess', 'products', 'productaccess', 'modules', 'entitlements']
}

const DEACTIVATION_ALIASES = {
  email: CREATION_ALIASES.email,
  employeeId: CREATION_ALIASES.employeeId,
  reason: ['reason', 'deactivationreason', 'exitreason', 'note', 'notes', 'comment', 'comments', 'remarks']
}

const ROLE_ALIASES = {
  admin: ['admin', 'administrator', 'orgadmin', 'organizationadmin', 'organisationadmin', 'systemadmin'],
  hr_manager: ['hrmanager', 'hr', 'humanresources', 'humanresource', 'hrmgr', 'peoplemanager', 'peopleops', 'hrbusinesspartner'],
  recruiter: ['recruiter', 'talentacquisition', 'ta', 'talent', 'hiring'],
  interviewer: ['interviewer', 'panelist', 'panellist', 'assessor'],
  staff: ['staff', 'employee', 'member', 'user', 'standard', 'basic', 'general', 'none']
}

const ALL_APPS_TOKENS = new Set(['all', 'allapps', 'everything', 'any', 'full', 'fullaccess', 'default'])
const NO_APPS_TOKENS = new Set(['none', 'noapps', 'nil', 'na'])

const EMAIL_PATTERN = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i

// Invitations are rate limited to 50 per hour, and the paste flow caps a batch
// at the same number, so a creation upload is capped to a batch that can
// actually be sent. Deactivation calls no rate-limited endpoint.
export const MEMBER_IMPORT_ROW_LIMITS = {
  [MEMBER_IMPORT_CREATION]: 50,
  [MEMBER_IMPORT_DEACTIVATION]: 500
}
export const MEMBER_IMPORT_ROW_LIMIT = MEMBER_IMPORT_ROW_LIMITS[MEMBER_IMPORT_CREATION]

// Excel reads a CSV as the system codepage unless the file starts with a BOM.
const UTF8_BOM = String.fromCharCode(0xfeff)

export function getMemberImportFields(type = MEMBER_IMPORT_CREATION) {
  return type === MEMBER_IMPORT_DEACTIVATION ? MEMBER_DEACTIVATION_FIELDS : MEMBER_CREATION_FIELDS
}

function getAliases(type = MEMBER_IMPORT_CREATION) {
  return type === MEMBER_IMPORT_DEACTIVATION ? DEACTIVATION_ALIASES : CREATION_ALIASES
}

export function normalizeImportType(value = '') {
  const type = String(value || '').trim().toLowerCase()
  return type === MEMBER_IMPORT_DEACTIVATION ? MEMBER_IMPORT_DEACTIVATION : MEMBER_IMPORT_CREATION
}

function normalizeEmail(value = '') {
  return String(value || '').trim().toLowerCase()
}

export function isValidEmail(value = '') {
  const email = normalizeEmail(value)
  if (!email || email.length > 254) return false
  const [localPart] = email.split('@')
  if (!localPart || localPart.length > 64) return false
  if (localPart.startsWith('.') || localPart.endsWith('.') || localPart.includes('..')) return false
  return EMAIL_PATTERN.test(email)
}

function normalizeKey(value = '') {
  return normalizeHeader(value)
}

export function resolveRole(value = '') {
  const raw = String(value || '').trim()
  if (!raw) return { role: 'staff', matched: true, defaulted: true }

  const normalized = normalizeKey(raw)
  if (normalized === 'owner') {
    return { role: 'staff', matched: false, reason: 'owner' }
  }

  for (const [role, aliases] of Object.entries(ROLE_ALIASES)) {
    if (normalizeKey(role) === normalized || aliases.includes(normalized)) {
      return { role, matched: true, defaulted: false }
    }
  }

  return { role: 'staff', matched: false, reason: 'unknown' }
}

function splitList(value = '') {
  return String(value || '')
    .split(/[,;|\n]/)
    .map((entry) => entry.trim())
    .filter(Boolean)
}

export function resolveAppAccess(value = '', apps = []) {
  const entries = splitList(value)
  if (entries.length === 0) {
    return { appAccess: { mode: APP_ACCESS_MODE_ALL, appIds: [] }, unmatched: [], defaulted: true }
  }

  const normalizedEntries = entries.map(normalizeKey)
  if (normalizedEntries.some((entry) => ALL_APPS_TOKENS.has(entry))) {
    return { appAccess: { mode: APP_ACCESS_MODE_ALL, appIds: [] }, unmatched: [], defaulted: false }
  }
  if (normalizedEntries.every((entry) => NO_APPS_TOKENS.has(entry))) {
    return { appAccess: { mode: APP_ACCESS_MODE_SELECTED, appIds: [] }, unmatched: [], defaulted: false }
  }

  const byKey = new Map()
  apps.forEach((app) => {
    const appId = String(app?.appId || '').trim()
    if (!appId) return
    byKey.set(normalizeKey(appId), appId)
    byKey.set(normalizeKey(app?.name || ''), appId)
  })

  const appIds = []
  const unmatched = []
  entries.forEach((entry) => {
    const appId = byKey.get(normalizeKey(entry))
    if (!appId) {
      if (!NO_APPS_TOKENS.has(normalizeKey(entry))) unmatched.push(entry)
      return
    }
    if (!appIds.includes(appId)) appIds.push(appId)
  })

  return {
    appAccess: { mode: APP_ACCESS_MODE_SELECTED, appIds },
    unmatched,
    defaulted: false
  }
}

function indexByName(entries = [], nameKey = 'name') {
  const index = new Map()
  entries.forEach((entry) => {
    const key = normalizeKey(entry?.[nameKey] || '')
    if (!key) return
    const bucket = index.get(key)
    if (bucket) bucket.push(entry)
    else index.set(key, [entry])
  })
  return index
}

function buildContext(context = {}) {
  const departments = Array.isArray(context.departments) ? context.departments : []
  const teams = Array.isArray(context.teams) ? context.teams : []
  const apps = Array.isArray(context.apps) ? context.apps : []
  const members = Array.isArray(context.members) ? context.members : []
  const pendingInvites = Array.isArray(context.pendingInvites) ? context.pendingInvites : []

  return {
    departments,
    teams,
    apps,
    members,
    pendingInvites,
    canAssignRoles: context.canAssignRoles !== false,
    canAssignApps: context.canAssignApps !== false,
    currentAccountId: context.currentAccountId ? String(context.currentAccountId) : '',
    departmentsByName: indexByName(departments),
    teamsByName: indexByName(teams),
    membersByEmail: new Map(members
      .filter((member) => normalizeEmail(member?.email))
      .map((member) => [normalizeEmail(member.email), member])),
    membersByEmployeeId: new Map(members
      .filter((member) => normalizeKey(member?.employeeId))
      .map((member) => [normalizeKey(member.employeeId), member])),
    inviteEmails: new Set(pendingInvites
      .map((invite) => normalizeEmail(invite?.email))
      .filter(Boolean)),
    inviteEmployeeIds: new Set(pendingInvites
      .map((invite) => normalizeKey(invite?.employeeId))
      .filter(Boolean))
  }
}

function issue(field, severity, message) {
  return { field, severity, message }
}

function statusFromIssues(issues = []) {
  if (issues.some((entry) => entry.severity === 'error')) return 'blocked'
  if (issues.some((entry) => entry.severity === 'warning')) return 'needs_attention'
  return 'ready'
}

function resolveCreationRow(record, columnMap, context, rowNumber, seen) {
  const read = (field) => String(record[columnMap[field] || ''] || '').trim()
  const issues = []

  const rawEmail = read('email')
  const email = normalizeEmail(rawEmail)
  if (!email) {
    issues.push(issue('email', 'error', 'This row has no email address.'))
  } else if (!isValidEmail(email)) {
    issues.push(issue('email', 'error', `“${rawEmail}” is not a valid email address.`))
  } else if (seen.emails.has(email)) {
    issues.push(issue('email', 'error', `${email} appears earlier in this file (row ${seen.emails.get(email)}).`))
  } else {
    seen.emails.set(email, rowNumber)
    if (context.membersByEmail.has(email)) {
      issues.push(issue('email', 'error', 'This person is already an active member.'))
    } else if (context.inviteEmails.has(email)) {
      issues.push(issue('email', 'error', 'An invitation is already pending for this address.'))
    }
  }

  const employeeId = read('employeeId')
  const employeeIdKey = normalizeKey(employeeId)
  if (employeeIdKey) {
    if (seen.employeeIds.has(employeeIdKey)) {
      issues.push(issue('employeeId', 'error', `Employee ID “${employeeId}” appears earlier in this file (row ${seen.employeeIds.get(employeeIdKey)}).`))
    } else {
      seen.employeeIds.set(employeeIdKey, rowNumber)
      const holder = context.membersByEmployeeId.get(employeeIdKey)
      if (holder) {
        issues.push(issue('employeeId', 'error', `Employee ID “${employeeId}” already belongs to ${holder.name || holder.email || 'another member'}.`))
      } else if (context.inviteEmployeeIds.has(employeeIdKey)) {
        issues.push(issue('employeeId', 'error', `Employee ID “${employeeId}” is pending on another invitation.`))
      }
    }
  }

  const rawRole = read('role')
  const roleResult = resolveRole(rawRole)
  let role = roleResult.role
  if (!roleResult.matched && roleResult.reason === 'owner') {
    issues.push(issue('role', 'warning', 'Owner cannot be assigned by import. This row is set to Staff.'))
  } else if (!roleResult.matched) {
    issues.push(issue('role', 'warning', `“${rawRole}” is not an organization role. This row is set to Staff.`))
  }
  if (role !== 'staff' && !context.canAssignRoles) {
    issues.push(issue('role', 'warning', 'You cannot assign organization roles, so this row is set to Staff.'))
    role = 'staff'
  }

  const rawDepartment = read('department')
  const departmentMatches = rawDepartment ? (context.departmentsByName.get(normalizeKey(rawDepartment)) || []) : []
  let department = departmentMatches.length === 1 ? departmentMatches[0] : null
  if (rawDepartment && departmentMatches.length === 0) {
    issues.push(issue('department', 'warning', `No department is named “${rawDepartment}”. Choose one during review.`))
  } else if (departmentMatches.length > 1) {
    issues.push(issue('department', 'warning', `More than one department is named “${rawDepartment}”. Choose one during review.`))
    department = null
  }

  const rawTeam = read('team')
  let team = null
  if (!rawTeam) {
    issues.push(issue('team', 'warning', 'No team in this row. Pick a team during review — invitations need one.'))
  } else {
    const teamMatches = context.teamsByName.get(normalizeKey(rawTeam)) || []
    const scopedMatches = department
      ? teamMatches.filter((candidate) => String(candidate.departmentId || '') === String(department.id))
      : teamMatches

    if (teamMatches.length === 0) {
      issues.push(issue('team', 'warning', `No team is named “${rawTeam}”. Pick a team during review, or create one.`))
    } else if (scopedMatches.length === 1) {
      team = scopedMatches[0]
    } else if (scopedMatches.length === 0) {
      issues.push(issue('team', 'warning', `“${rawTeam}” is not a team in ${department?.name || 'that department'}. Pick a team during review.`))
    } else {
      issues.push(issue('team', 'warning', `More than one team is named “${rawTeam}”. Pick the right one during review.`))
    }
  }

  if (team) {
    const teamDepartment = context.departments.find((entry) => String(entry.id) === String(team.departmentId)) || null
    if (department && teamDepartment && String(teamDepartment.id) !== String(department.id)) {
      issues.push(issue('department', 'warning', `${team.name} belongs to ${teamDepartment.name}, so the department was set from the team.`))
    }
    department = teamDepartment || department
  }

  const rawApps = read('apps')
  const appResult = resolveAppAccess(rawApps, context.apps)
  let appAccess = appResult.appAccess
  if (appResult.unmatched.length > 0) {
    issues.push(issue('apps', 'warning', `No app named ${appResult.unmatched.map((entry) => `“${entry}”`).join(', ')}. Check app access during review.`))
  }
  if (!context.canAssignApps) {
    appAccess = { mode: APP_ACCESS_MODE_SELECTED, appIds: [] }
  } else if (appAccess.mode === APP_ACCESS_MODE_SELECTED && appAccess.appIds.length === 0) {
    issues.push(issue('apps', 'warning', 'No apps were matched for this row. Choose app access during review.'))
  }

  const status = statusFromIssues(issues)
  return {
    rowNumber,
    email,
    fullName: read('fullName'),
    role,
    designation: read('designation'),
    employeeId,
    departmentId: department ? String(department.id) : '',
    departmentName: department?.name || '',
    teamId: team ? String(team.id) : '',
    teamName: team?.name || '',
    appAccess,
    issues,
    status,
    selected: status !== 'blocked'
  }
}

function resolveDeactivationRow(record, columnMap, context, rowNumber, seen) {
  const read = (field) => String(record[columnMap[field] || ''] || '').trim()
  const issues = []

  const rawEmail = read('email')
  const email = normalizeEmail(rawEmail)
  const employeeId = read('employeeId')
  const employeeIdKey = normalizeKey(employeeId)

  if (rawEmail && !isValidEmail(email)) {
    issues.push(issue('email', 'error', `“${rawEmail}” is not a valid email address.`))
  }

  const byEmail = email && isValidEmail(email) ? context.membersByEmail.get(email) || null : null
  const byEmployeeId = employeeIdKey ? context.membersByEmployeeId.get(employeeIdKey) || null : null

  let member = byEmail || byEmployeeId
  if (!rawEmail && !employeeId) {
    issues.push(issue('email', 'error', 'This row has no email address or employee ID, so no member can be matched.'))
  } else if (byEmail && byEmployeeId && String(byEmail.id) !== String(byEmployeeId.id)) {
    issues.push(issue('employeeId', 'error', `The email and employee ID in this row belong to different members (${byEmail.email} and ${byEmployeeId.email}).`))
    member = null
  } else if (!member) {
    const identifier = rawEmail || employeeId
    issues.push(issue('email', 'error', `No active member matches “${identifier}”.`))
  }

  if (member) {
    const memberKey = String(member.id)
    if (seen.memberIds.has(memberKey)) {
      issues.push(issue('email', 'error', `This member appears earlier in this file (row ${seen.memberIds.get(memberKey)}).`))
      member = null
    } else {
      seen.memberIds.set(memberKey, rowNumber)
    }
  }

  if (member?.isOwner) {
    issues.push(issue('role', 'warning', 'This member is an owner. Transfer ownership first, or confirm this row deliberately.'))
  }
  if (member && context.currentAccountId && String(member.id) === context.currentAccountId) {
    issues.push(issue('email', 'warning', 'This is your own account. Deactivating it removes your access to this organization.'))
  }

  const status = statusFromIssues(issues)
  return {
    rowNumber,
    email: email || member?.email || '',
    employeeId,
    reason: read('reason'),
    memberId: member ? String(member.id) : '',
    memberName: member?.name || '',
    memberEmail: member?.email || '',
    memberRole: member?.role || '',
    memberDepartmentName: member?.departmentName || '',
    memberTeamNames: Array.isArray(member?.teamNames) ? member.teamNames : [],
    issues,
    status,
    selected: status === 'ready'
  }
}

function readUpload({ buffer, csvText, sourceFileName, sheetName }) {
  const extracted = extractRowsFromSource({ buffer, csvText, sourceFileName, sheetName })
  const summary = summarizeRows(extracted.rows)
  return { extracted, summary }
}

/**
 * First pass: show the administrator which columns we found and how we plan to
 * match them, before anything is resolved against the organization.
 */
export function previewMemberImport({
  buffer = null,
  csvText = '',
  sourceFileName = '',
  sheetName = '',
  columnMap = {},
  type = MEMBER_IMPORT_CREATION
} = {}) {
  const importType = normalizeImportType(type)
  const { extracted, summary } = readUpload({ buffer, csvText, sourceFileName, sheetName })
  const fields = getMemberImportFields(importType)

  if (summary.headers.length === 0) {
    return {
      type: importType,
      sourceType: extracted.sourceType,
      sourceFileName,
      sheetNames: extracted.sheetNames,
      selectedSheetName: extracted.selectedSheetName,
      headers: [],
      sampleRows: [],
      totalRows: 0,
      columnMap: {},
      fields,
      errors: ['That file has no header row we can read. The first row should name each column.']
    }
  }

  const detected = detectColumnMap(summary.headers, getAliases(importType))
  const requested = normalizeColumnMap(columnMap, summary.headers)
  const effective = Object.keys(requested).length > 0 ? requested : detected

  return {
    type: importType,
    sourceType: extracted.sourceType,
    sourceFileName,
    sheetNames: extracted.sheetNames,
    selectedSheetName: extracted.selectedSheetName,
    headers: summary.headers,
    sampleRows: summary.dataRows.slice(0, 5),
    totalRows: summary.totalRows,
    columnMap: effective,
    detectedColumnMap: detected,
    fields,
    errors: []
  }
}

/**
 * Second pass: with the mapping confirmed, resolve every row against the
 * organization so each one can be checked and edited before it is committed.
 */
export function resolveMemberImportRows({
  buffer = null,
  csvText = '',
  sourceFileName = '',
  sheetName = '',
  columnMap = {},
  type = MEMBER_IMPORT_CREATION,
  context = {},
  limit = null
} = {}) {
  const importType = normalizeImportType(type)
  const { extracted, summary } = readUpload({ buffer, csvText, sourceFileName, sheetName })
  const resolvedContext = buildContext(context)

  if (summary.headers.length === 0) {
    return {
      type: importType,
      sourceType: extracted.sourceType,
      sourceFileName,
      sheetNames: extracted.sheetNames,
      selectedSheetName: extracted.selectedSheetName,
      columnMap: {},
      rows: [],
      summary: { totalRows: 0, ready: 0, needsAttention: 0, blocked: 0, truncated: 0 },
      errors: ['That file has no header row we can read. The first row should name each column.']
    }
  }

  const effectiveColumnMap = normalizeColumnMap(columnMap, summary.headers)
  if (importType === MEMBER_IMPORT_CREATION && !effectiveColumnMap.email) {
    return {
      type: importType,
      sourceType: extracted.sourceType,
      sourceFileName,
      sheetNames: extracted.sheetNames,
      selectedSheetName: extracted.selectedSheetName,
      columnMap: effectiveColumnMap,
      rows: [],
      summary: { totalRows: summary.totalRows, ready: 0, needsAttention: 0, blocked: 0, truncated: 0 },
      errors: ['Match a column to the email address before continuing.']
    }
  }
  if (importType === MEMBER_IMPORT_DEACTIVATION && !effectiveColumnMap.email && !effectiveColumnMap.employeeId) {
    return {
      type: importType,
      sourceType: extracted.sourceType,
      sourceFileName,
      sheetNames: extracted.sheetNames,
      selectedSheetName: extracted.selectedSheetName,
      columnMap: effectiveColumnMap,
      rows: [],
      summary: { totalRows: summary.totalRows, ready: 0, needsAttention: 0, blocked: 0, truncated: 0 },
      errors: ['Match a column to the email address or the employee ID before continuing.']
    }
  }

  const effectiveLimit = Number.isFinite(limit) && limit > 0
    ? limit
    : MEMBER_IMPORT_ROW_LIMITS[importType]
  const usableRows = summary.dataRows.slice(0, effectiveLimit)
  const truncated = summary.dataRows.length - usableRows.length
  const records = rowsToRecords(usableRows, summary.headers)
  const seen = { emails: new Map(), employeeIds: new Map(), memberIds: new Map() }

  const rows = records.map((record, index) => {
    // Row 1 is the header, so the first data row is row 2 in the operator's sheet.
    const rowNumber = index + 2
    return importType === MEMBER_IMPORT_DEACTIVATION
      ? resolveDeactivationRow(record, effectiveColumnMap, resolvedContext, rowNumber, seen)
      : resolveCreationRow(record, effectiveColumnMap, resolvedContext, rowNumber, seen)
  })

  return {
    type: importType,
    sourceType: extracted.sourceType,
    sourceFileName,
    sheetNames: extracted.sheetNames,
    selectedSheetName: extracted.selectedSheetName,
    columnMap: effectiveColumnMap,
    rows,
    summary: {
      totalRows: summary.totalRows,
      ready: rows.filter((row) => row.status === 'ready').length,
      needsAttention: rows.filter((row) => row.status === 'needs_attention').length,
      blocked: rows.filter((row) => row.status === 'blocked').length,
      truncated: truncated > 0 ? truncated : 0,
      limit: effectiveLimit
    },
    errors: []
  }
}

function buildTemplateRows(type, context = {}) {
  const fields = getMemberImportFields(type)
  const headers = fields.map((field) => field.label)
  const teams = Array.isArray(context.teams) ? context.teams : []
  const departments = Array.isArray(context.departments) ? context.departments : []
  const members = Array.isArray(context.members) ? context.members : []

  if (type === MEMBER_IMPORT_DEACTIVATION) {
    const samples = members.slice(0, 2)
    const exampleRows = samples.length > 0
      ? samples.map((member) => [member.email || '', member.employeeId || '', 'Resigned'])
      : [
          ['ada.lovelace@example.com', 'EMP-0042', 'Resigned'],
          ['grace.hopper@example.com', 'EMP-0043', 'Contract ended']
        ]
    return [headers, ...exampleRows]
  }

  const sampleTeam = teams[0] || null
  const sampleDepartment = sampleTeam
    ? departments.find((entry) => String(entry.id) === String(sampleTeam.departmentId)) || null
    : departments[0] || null

  return [
    headers,
    [
      'ada.lovelace@example.com',
      'Ada Lovelace',
      'Staff',
      'Software Engineer',
      'EMP-0042',
      sampleDepartment?.name || 'Engineering',
      sampleTeam?.name || 'Platform',
      'All apps'
    ],
    [
      'grace.hopper@example.com',
      'Grace Hopper',
      'HR Manager',
      'People Lead',
      'EMP-0043',
      sampleDepartment?.name || 'Engineering',
      sampleTeam?.name || 'Platform',
      (Array.isArray(context.apps) ? context.apps : []).slice(0, 2).map((app) => app.name).join(', ') || 'Recruiter, Payroll'
    ]
  ]
}

function buildGuideRows(type, context = {}) {
  const fields = getMemberImportFields(type)
  const rows = [
    ['Column', 'Required', 'What to put in it'],
    ...fields.map((field) => [field.label, field.required ? 'Yes' : 'Optional', field.description])
  ]

  if (type === MEMBER_IMPORT_CREATION) {
    rows.push([], ['Accepted organization roles'], ...IMPORTABLE_ROLES.map((role) => [ROLE_LABELS[role]]))

    const departments = Array.isArray(context.departments) ? context.departments : []
    if (departments.length > 0) {
      rows.push([], ['Departments in this organization'], ...departments.map((entry) => [entry.name]))
    }

    const teams = Array.isArray(context.teams) ? context.teams : []
    if (teams.length > 0) {
      const departmentNameById = new Map(departments.map((entry) => [String(entry.id), entry.name]))
      rows.push([], ['Teams in this organization', 'Department'], ...teams.map((entry) => [
        entry.name,
        departmentNameById.get(String(entry.departmentId)) || ''
      ]))
    }

    const apps = Array.isArray(context.apps) ? context.apps : []
    if (apps.length > 0) {
      rows.push([], ['Apps you can grant'], ...apps.map((app) => [app.name]))
    }
  }

  return rows
}

export function buildMemberImportTemplate({ type = MEMBER_IMPORT_CREATION, format = 'xlsx', context = {} } = {}) {
  const importType = normalizeImportType(type)
  const templateRows = buildTemplateRows(importType, context)
  const baseName = importType === MEMBER_IMPORT_DEACTIVATION
    ? 'bulk-user-deactivation-template'
    : 'bulk-user-creation-template'

  if (String(format || '').trim().toLowerCase() === 'csv') {
    return {
      fileName: `${baseName}.csv`,
      contentType: 'text/csv; charset=utf-8',
      body: Buffer.from(`${UTF8_BOM}${buildCsv(templateRows)}\r\n`, 'utf-8')
    }
  }

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(templateRows),
    importType === MEMBER_IMPORT_DEACTIVATION ? 'Deactivate' : 'Create'
  )
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(buildGuideRows(importType, context)),
    'How to fill this in'
  )

  return {
    fileName: `${baseName}.xlsx`,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    body: XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
  }
}
