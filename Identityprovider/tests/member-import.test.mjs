import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

import ejs from 'ejs'
import XLSX from 'xlsx'

import {
  MEMBER_IMPORT_CREATION,
  MEMBER_IMPORT_DEACTIVATION,
  buildMemberImportTemplate,
  previewMemberImport,
  resolveAppAccess,
  resolveMemberImportRows,
  resolveRole
} from '../src/services/memberImportService.js'

const organizationContext = {
  departments: [
    { id: 'department-engineering', name: 'Engineering' },
    { id: 'department-people', name: 'People' }
  ],
  teams: [
    { id: 'team-platform', name: 'Platform', departmentId: 'department-engineering' },
    { id: 'team-people-ops', name: 'People Operations', departmentId: 'department-people' },
    { id: 'team-shared', name: 'Shared', departmentId: 'department-engineering' },
    { id: 'team-shared-people', name: 'Shared', departmentId: 'department-people' }
  ],
  apps: [
    { appId: 'recruiter', name: 'Recruiter' },
    { appId: 'payroll', name: 'Payroll' }
  ],
  members: [
    {
      id: 'account-existing',
      email: 'existing@example.test',
      name: 'Existing Member',
      employeeId: 'EMP-0001',
      role: 'staff',
      isOwner: false,
      departmentName: 'Engineering',
      teamNames: ['Platform']
    },
    {
      id: 'account-owner',
      email: 'owner@example.test',
      name: 'Org Owner',
      employeeId: 'EMP-0002',
      role: 'owner',
      isOwner: true,
      departmentName: 'People',
      teamNames: ['People Operations']
    }
  ],
  pendingInvites: [{ email: 'pending@example.test', employeeId: 'EMP-0003' }],
  canAssignRoles: true,
  canAssignApps: true,
  currentAccountId: 'account-admin'
}

const creationCsv = [
  'Staff Email,Full Name,Access Level,Job Title,Staff ID,Division,Unit,Products',
  'ada@example.test,Ada Lovelace,HR Manager,Head of Engineering,EMP-1001,Engineering,Platform,"Recruiter, Payroll"',
  'grace@example.test,Grace Hopper,,Engineer,EMP-1002,,Platform,All apps',
  'existing@example.test,Existing Member,Staff,Analyst,EMP-1003,Engineering,Platform,',
  'not-an-email,Broken Row,Staff,Analyst,EMP-1004,Engineering,Platform,',
  'ada@example.test,Ada Again,Staff,Analyst,EMP-1005,Engineering,Platform,',
  'linus@example.test,Linus Torvalds,Overlord,Maintainer,EMP-0001,Marketing,Kernel,Timesheets'
].join('\r\n')

test('creation preview detects the operator’s own column names', () => {
  const preview = previewMemberImport({
    csvText: creationCsv,
    sourceFileName: 'new-joiners.csv',
    type: MEMBER_IMPORT_CREATION
  })

  assert.deepEqual(preview.errors, [])
  assert.equal(preview.sourceType, 'csv')
  assert.equal(preview.totalRows, 6)
  assert.deepEqual(preview.columnMap, {
    email: 'Staff Email',
    fullName: 'Full Name',
    role: 'Access Level',
    designation: 'Job Title',
    employeeId: 'Staff ID',
    department: 'Division',
    team: 'Unit',
    apps: 'Products'
  })
  assert.equal(preview.sampleRows.length, 5)
  assert.ok(preview.fields.some((field) => field.key === 'email' && field.required))
})

test('creation rows resolve teams, roles, and apps and flag what a person must fix', () => {
  const preview = previewMemberImport({ csvText: creationCsv, sourceFileName: 'new-joiners.csv' })
  const resolved = resolveMemberImportRows({
    csvText: creationCsv,
    sourceFileName: 'new-joiners.csv',
    columnMap: preview.columnMap,
    type: MEMBER_IMPORT_CREATION,
    context: organizationContext
  })

  assert.deepEqual(resolved.errors, [])
  assert.equal(resolved.rows.length, 6)

  const [ada, grace, existing, malformed, duplicate, unknowns] = resolved.rows

  assert.equal(ada.rowNumber, 2)
  assert.equal(ada.status, 'ready')
  assert.equal(ada.email, 'ada@example.test')
  assert.equal(ada.fullName, 'Ada Lovelace')
  assert.equal(ada.role, 'hr_manager')
  assert.equal(ada.designation, 'Head of Engineering')
  assert.equal(ada.teamId, 'team-platform')
  assert.equal(ada.departmentId, 'department-engineering')
  assert.deepEqual(ada.appAccess, { mode: 'selected', appIds: ['recruiter', 'payroll'] })
  assert.equal(ada.selected, true)

  // A blank role means Staff, and a blank department is taken from the team.
  assert.equal(grace.status, 'ready')
  assert.equal(grace.role, 'staff')
  assert.equal(grace.departmentId, 'department-engineering')
  assert.deepEqual(grace.appAccess, { mode: 'all', appIds: [] })

  assert.equal(existing.status, 'blocked')
  assert.equal(existing.selected, false)
  assert.ok(existing.issues.some((entry) => entry.severity === 'error' && /already an active member/.test(entry.message)))

  assert.equal(malformed.status, 'blocked')
  assert.ok(malformed.issues.some((entry) => /not a valid email address/.test(entry.message)))

  assert.equal(duplicate.status, 'blocked')
  assert.ok(duplicate.issues.some((entry) => /appears earlier in this file \(row 2\)/.test(entry.message)))

  // Unknown role, department, team, app, and a taken employee ID all surface separately.
  assert.equal(unknowns.status, 'blocked')
  assert.equal(unknowns.role, 'staff')
  assert.equal(unknowns.teamId, '')
  assert.ok(unknowns.issues.some((entry) => /“Overlord” is not an organization role/.test(entry.message)))
  assert.ok(unknowns.issues.some((entry) => /No department is named “Marketing”/.test(entry.message)))
  assert.ok(unknowns.issues.some((entry) => /No team is named “Kernel”/.test(entry.message)))
  assert.ok(unknowns.issues.some((entry) => /No app named “Timesheets”/.test(entry.message)))
  assert.ok(unknowns.issues.some((entry) => (
    entry.severity === 'error' && /already belongs to Existing Member/.test(entry.message)
  )))

  assert.deepEqual(
    { ready: resolved.summary.ready, needsAttention: resolved.summary.needsAttention, blocked: resolved.summary.blocked },
    { ready: 2, needsAttention: 0, blocked: 4 }
  )
})

test('a pending invitation blocks a repeat invitation for the same address', () => {
  const csvText = 'Email,Team\npending@example.test,Platform'
  const resolved = resolveMemberImportRows({
    csvText,
    sourceFileName: 'repeat.csv',
    columnMap: { email: 'Email', team: 'Team' },
    context: organizationContext
  })

  assert.equal(resolved.rows[0].status, 'blocked')
  assert.ok(resolved.rows[0].issues.some((entry) => /invitation is already pending/.test(entry.message)))
})

test('an ambiguous team name asks the operator to choose instead of guessing', () => {
  const resolved = resolveMemberImportRows({
    csvText: 'Email,Team\nnew@example.test,Shared',
    sourceFileName: 'ambiguous.csv',
    columnMap: { email: 'Email', team: 'Team' },
    context: organizationContext
  })

  const [row] = resolved.rows
  assert.equal(row.status, 'needs_attention')
  assert.equal(row.teamId, '')
  assert.equal(row.selected, true)
  assert.ok(row.issues.some((entry) => /More than one team is named “Shared”/.test(entry.message)))
})

test('a department in the file gives an ambiguous team name a single answer', () => {
  const resolved = resolveMemberImportRows({
    csvText: 'Email,Department,Team\nnew@example.test,People,Shared',
    sourceFileName: 'scoped.csv',
    columnMap: { email: 'Email', department: 'Department', team: 'Team' },
    context: organizationContext
  })

  assert.equal(resolved.rows[0].status, 'ready')
  assert.equal(resolved.rows[0].teamId, 'team-shared-people')
  assert.equal(resolved.rows[0].departmentId, 'department-people')
})

test('roles and app access are held back when the administrator cannot grant them', () => {
  const resolved = resolveMemberImportRows({
    csvText: 'Email,Role,Team,Apps\nnew@example.test,Admin,Platform,Recruiter',
    sourceFileName: 'restricted.csv',
    columnMap: { email: 'Email', role: 'Role', team: 'Team', apps: 'Apps' },
    context: { ...organizationContext, canAssignRoles: false, canAssignApps: false }
  })

  const [row] = resolved.rows
  assert.equal(row.role, 'staff')
  assert.deepEqual(row.appAccess, { mode: 'selected', appIds: [] })
  assert.ok(row.issues.some((entry) => /cannot assign organization roles/.test(entry.message)))
})

test('owner cannot be granted by import', () => {
  assert.deepEqual(resolveRole('Owner'), { role: 'staff', matched: false, reason: 'owner' })
  assert.equal(resolveRole('hr manager').role, 'hr_manager')
  assert.equal(resolveRole('HR-Manager').role, 'hr_manager')
  assert.equal(resolveRole('').role, 'staff')
})

test('app access accepts names, ids, "all", and "none"', () => {
  const apps = organizationContext.apps
  assert.deepEqual(resolveAppAccess('All apps', apps).appAccess, { mode: 'all', appIds: [] })
  assert.deepEqual(resolveAppAccess('recruiter; Payroll', apps).appAccess, { mode: 'selected', appIds: ['recruiter', 'payroll'] })
  assert.deepEqual(resolveAppAccess('None', apps).appAccess, { mode: 'selected', appIds: [] })
  assert.deepEqual(resolveAppAccess('Recruiter, Ghost', apps).unmatched, ['Ghost'])
})

test('an unmapped email column stops the import before any row is resolved', () => {
  const resolved = resolveMemberImportRows({
    csvText: 'Team\nPlatform',
    sourceFileName: 'no-email.csv',
    columnMap: { team: 'Team' },
    context: organizationContext
  })

  assert.deepEqual(resolved.rows, [])
  assert.match(resolved.errors[0], /Match a column to the email address/)
})

test('an Excel workbook exposes its sheets and imports the one that is chosen', () => {
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['Read this before uploading.']
  ]), 'Read me')
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['Email address', 'Full name', 'Organization role', 'Team'],
    ['ada@example.test', 'Ada Lovelace', 'Recruiter', 'Platform']
  ]), 'Create')
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })

  const preview = previewMemberImport({
    buffer,
    sourceFileName: 'joiners.xlsx',
    sheetName: 'Create'
  })
  assert.equal(preview.sourceType, 'excel')
  assert.deepEqual(preview.sheetNames, ['Read me', 'Create'])
  assert.equal(preview.selectedSheetName, 'Create')
  assert.equal(preview.columnMap.email, 'Email address')

  const resolved = resolveMemberImportRows({
    buffer,
    sourceFileName: 'joiners.xlsx',
    sheetName: 'Create',
    columnMap: preview.columnMap,
    context: organizationContext
  })
  assert.equal(resolved.rows.length, 1)
  assert.equal(resolved.rows[0].status, 'ready')
  assert.equal(resolved.rows[0].role, 'recruiter')
  assert.equal(resolved.rows[0].teamId, 'team-platform')
})

test('deactivation rows match members by email or employee ID and refuse anything ambiguous', () => {
  const csvText = [
    'Email,Employee ID,Reason',
    'existing@example.test,,Resigned',
    ',EMP-0002,Retired',
    'existing@example.test,,Listed twice',
    'ghost@example.test,,Never joined',
    'existing@example.test,EMP-0002,Mismatched pair'
  ].join('\r\n')

  const preview = previewMemberImport({ csvText, sourceFileName: 'leavers.csv', type: MEMBER_IMPORT_DEACTIVATION })
  assert.deepEqual(preview.columnMap, { email: 'Email', employeeId: 'Employee ID', reason: 'Reason' })

  const resolved = resolveMemberImportRows({
    csvText,
    sourceFileName: 'leavers.csv',
    columnMap: preview.columnMap,
    type: MEMBER_IMPORT_DEACTIVATION,
    context: organizationContext
  })

  const [matched, owner, repeat, missing, mismatched] = resolved.rows

  assert.equal(matched.status, 'ready')
  assert.equal(matched.memberId, 'account-existing')
  assert.equal(matched.memberName, 'Existing Member')
  assert.equal(matched.reason, 'Resigned')
  assert.equal(matched.selected, true)

  // Owners still resolve, but they are never pre-selected.
  assert.equal(owner.memberId, 'account-owner')
  assert.equal(owner.status, 'needs_attention')
  assert.equal(owner.selected, false)
  assert.ok(owner.issues.some((entry) => /owner/i.test(entry.message)))

  assert.equal(repeat.status, 'blocked')
  assert.equal(repeat.memberId, '')
  assert.ok(repeat.issues.some((entry) => /appears earlier in this file \(row 2\)/.test(entry.message)))

  assert.equal(missing.status, 'blocked')
  assert.ok(missing.issues.some((entry) => /No active member matches “ghost@example.test”/.test(entry.message)))

  assert.equal(mismatched.status, 'blocked')
  assert.equal(mismatched.memberId, '')
  assert.ok(mismatched.issues.some((entry) => /belong to different members/.test(entry.message)))
})

test('deactivating your own account is flagged before it is confirmed', () => {
  const resolved = resolveMemberImportRows({
    csvText: 'Email\nexisting@example.test',
    sourceFileName: 'self.csv',
    columnMap: { email: 'Email' },
    type: MEMBER_IMPORT_DEACTIVATION,
    context: { ...organizationContext, currentAccountId: 'account-existing' }
  })

  const [row] = resolved.rows
  assert.equal(row.memberId, 'account-existing')
  assert.equal(row.selected, false)
  assert.ok(row.issues.some((entry) => /your own account/.test(entry.message)))
})

test('deactivation needs at least one identifying column', () => {
  const resolved = resolveMemberImportRows({
    csvText: 'Reason\nResigned',
    sourceFileName: 'reason-only.csv',
    columnMap: { reason: 'Reason' },
    type: MEMBER_IMPORT_DEACTIVATION,
    context: organizationContext
  })

  assert.deepEqual(resolved.rows, [])
  assert.match(resolved.errors[0], /email address or the employee ID/)
})

test('creation is capped to a batch the invitation endpoint will accept, deactivation is not', () => {
  const manyRows = (count) => [
    'Email',
    ...Array.from({ length: count }, (_, index) => `person${index}@example.test`)
  ].join(String.fromCharCode(13, 10))

  const creation = resolveMemberImportRows({
    csvText: manyRows(60),
    sourceFileName: 'many.csv',
    columnMap: { email: 'Email' },
    type: MEMBER_IMPORT_CREATION,
    context: organizationContext
  })
  assert.equal(creation.rows.length, 50)
  assert.equal(creation.summary.limit, 50)
  assert.equal(creation.summary.truncated, 10)

  const deactivation = resolveMemberImportRows({
    csvText: manyRows(60),
    sourceFileName: 'many.csv',
    columnMap: { email: 'Email' },
    type: MEMBER_IMPORT_DEACTIVATION,
    context: organizationContext
  })
  assert.equal(deactivation.rows.length, 60)
  assert.equal(deactivation.summary.limit, 500)
  assert.equal(deactivation.summary.truncated, 0)
})

test('long files are read up to the row limit and report the remainder', () => {
  const rows = Array.from({ length: 7 }, (_, index) => `person${index}@example.test,Platform`)
  const resolved = resolveMemberImportRows({
    csvText: ['Email,Team', ...rows].join('\r\n'),
    sourceFileName: 'long.csv',
    columnMap: { email: 'Email', team: 'Team' },
    context: organizationContext,
    limit: 5
  })

  assert.equal(resolved.rows.length, 5)
  assert.equal(resolved.summary.totalRows, 7)
  assert.equal(resolved.summary.truncated, 2)
  assert.equal(resolved.summary.limit, 5)
})

test('the creation template round-trips through its own importer', () => {
  const template = buildMemberImportTemplate({
    type: MEMBER_IMPORT_CREATION,
    format: 'xlsx',
    context: organizationContext
  })

  assert.equal(template.fileName, 'bulk-user-creation-template.xlsx')
  const workbook = XLSX.read(template.body, { type: 'buffer' })
  assert.deepEqual(workbook.SheetNames, ['Create', 'How to fill this in'])

  const guide = XLSX.utils.sheet_to_json(workbook.Sheets['How to fill this in'], { header: 1, defval: '' })
  const guideText = guide.map((row) => row.join(' ')).join('\n')
  assert.match(guideText, /HR Manager/)
  assert.match(guideText, /Engineering/)
  assert.match(guideText, /People Operations/)
  assert.match(guideText, /Recruiter/)

  const preview = previewMemberImport({
    buffer: template.body,
    sourceFileName: template.fileName,
    sheetName: 'Create'
  })
  const fields = ['email', 'fullName', 'role', 'designation', 'employeeId', 'department', 'team', 'apps']
  fields.forEach((field) => assert.ok(preview.columnMap[field], `${field} should map from the template header`))

  const resolved = resolveMemberImportRows({
    buffer: template.body,
    sourceFileName: template.fileName,
    sheetName: 'Create',
    columnMap: preview.columnMap,
    context: organizationContext
  })
  assert.equal(resolved.rows.length, 2)
  resolved.rows.forEach((row) => assert.equal(row.status, 'ready'))
  assert.equal(resolved.rows[0].teamId, 'team-platform')
})

test('the deactivation CSV template opens as UTF-8 and maps back to its own columns', () => {
  const template = buildMemberImportTemplate({
    type: MEMBER_IMPORT_DEACTIVATION,
    format: 'csv',
    context: organizationContext
  })

  assert.equal(template.fileName, 'bulk-user-deactivation-template.csv')
  assert.match(template.contentType, /text\/csv/)
  assert.deepEqual([...template.body.subarray(0, 3)], [0xef, 0xbb, 0xbf])

  const csvText = template.body.toString('utf-8')
  const resolved = resolveMemberImportRows({
    csvText,
    sourceFileName: template.fileName,
    columnMap: previewMemberImport({ csvText, sourceFileName: template.fileName, type: MEMBER_IMPORT_DEACTIVATION }).columnMap,
    type: MEMBER_IMPORT_DEACTIVATION,
    context: organizationContext
  })

  // The template is seeded with real members, so it resolves against them.
  assert.equal(resolved.rows.length, 2)
  assert.equal(resolved.rows[0].memberId, 'account-existing')
})

test('the upload endpoints stay behind the same permissions as the actions they feed', async () => {
  const routeSource = await fs.readFile(
    fileURLToPath(new URL('../src/routes/memberImports.js', import.meta.url)),
    'utf8'
  )

  assert.match(routeSource, /requireAuth,\s*\n\s*requireOrganizationMember,/)
  assert.match(routeSource, /requestHasIdentityPermission\(req, 'members\.remove'\)/)
  assert.match(routeSource, /requestHasIdentityPermission\(req, 'members\.invite'\)/)
  assert.match(routeSource, /requestHasIdentityPermission\(req, 'invitations\.manage'\)/)
  assert.match(routeSource, /member-imports\/template/)
  assert.match(routeSource, /member-imports\/preview/)
  assert.match(routeSource, /member-imports\/rows/)

  // The upload endpoints only read: every write still goes through the
  // single-record invitation and member routes.
  assert.doesNotMatch(routeSource, /OrganizationInvite\.create|removeMember|\.save\(/)

  const appSource = await fs.readFile(
    fileURLToPath(new URL('../src/index.js', import.meta.url)),
    'utf8'
  )
  assert.match(appSource, /app\.use\('\/api\/organizations', memberImportsRouter\)/)
})

const inviteLocals = {
  organization: { _id: 'org-1', name: 'Example Company' },
  invitations: [],
  availableApps: [{ appId: 'workspace', name: 'Workspace' }],
  departments: [{ id: 'department-1', name: 'Administration', parentDepartment: '' }],
  teams: [{ id: 'team-1', name: 'People Operations', departmentId: 'department-1' }],
  canInviteMembers: true,
  canManageInvitations: true,
  canAssignRoles: true,
  canAssignApps: true,
  canManageDepartments: true,
  canManageTeams: true,
  canViewMembers: true,
  canViewAccessControl: true,
  identityPermissions: ['members.view', 'members.invite', 'invitations.manage', 'roles.assign', 'apps.assign'],
  yourRole: 'admin',
  user: {
    _id: 'account-admin',
    email: 'admin@example.com',
    profile: { name: 'Admin User' },
    currentOrganization: { _id: 'org-1', name: 'Example Company', role: 'admin' }
  },
  brand: { name: 'Seemplify', navLogoHtml: '<span>Seemplify</span>' },
  error: null,
  success: null
}

const memberLocals = {
  organization: { _id: 'org-1', name: 'Example Company', departments: [] },
  members: [{
    id: 'account-existing',
    name: 'Existing Member',
    email: 'existing@example.test',
    designation: '',
    employeeId: 'EMP-0001',
    departmentId: 'department-1',
    departmentName: 'Administration',
    branchId: '',
    branchName: '',
    role: 'staff',
    appAccess: { mode: 'all', appIds: [] },
    appAccessLabel: 'All apps',
    appAccessAppNames: [],
    teamIds: ['team-1'],
    teamNames: ['People Operations'],
    joinedAt: new Date('2026-01-01T00:00:00.000Z'),
    isOwner: false,
    onboardingStatus: 'not_started',
    onboardingStatusSource: 'idp'
  }],
  availableApps: [{ appId: 'workspace', name: 'Workspace' }],
  orgMembers: [{
    id: 'account-existing',
    email: 'existing@example.test',
    name: 'Existing Member',
    employeeId: 'EMP-0001',
    branchId: '',
    branchName: '',
    departmentId: 'department-1',
    departmentName: 'Administration',
    teamIds: ['team-1'],
    teamNames: ['People Operations']
  }],
  teams: [{
    id: 'team-1',
    name: 'People Operations',
    description: '',
    department: { id: 'department-1', name: 'Administration' },
    parentTeam: null,
    manager: null,
    members: [],
    memberCount: 0
  }],
  departments: [{
    id: 'department-1',
    name: 'Administration',
    description: '',
    headAccount: '',
    headName: '',
    parentDepartment: '',
    isSystem: false
  }],
  branches: [],
  canViewMembers: true,
  canManageMemberRoles: true,
  canManageMemberMetadata: true,
  canRemoveMembers: true,
  canManageAppAccess: true,
  canManageDepartments: true,
  canManageTeams: true,
  canManageLocations: true,
  canInviteMembers: true,
  canManageInvitations: true,
  canViewAccessControl: true,
  canSendNotifications: true,
  canTransferOwnership: true,
  identityPermissions: ['members.view', 'members.remove'],
  yourRole: 'owner',
  ownerCount: 1,
  activeView: 'members',
  user: {
    _id: 'account-admin',
    email: 'admin@example.com',
    profile: { name: 'Admin User' },
    currentOrganization: { _id: 'org-1', name: 'Example Company', role: 'owner' }
  },
  brand: { name: 'Seemplify', navLogoHtml: '<span>Seemplify</span>' },
  error: null,
  success: null
}

async function renderView(view, locals) {
  const viewPath = fileURLToPath(new URL(`../src/views/${view}`, import.meta.url))
  const html = await ejs.renderFile(viewPath, locals, { filename: viewPath })
  const inlineScripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1].trim())
    .filter(Boolean)

  inlineScripts.forEach((source, index) => {
    assert.doesNotThrow(() => new vm.Script(source), `${view} inline script ${index + 1} should parse`)
  })

  return html
}

test('the invitation page offers a file upload, a template, and column matching', async () => {
  const html = await renderView('invitations.ejs', inviteLocals)

  assert.match(html, /data-invite-source="file"/)
  assert.match(html, /data-invite-source="text"/)
  assert.match(html, /id="importFile"/)
  assert.match(html, /member-imports\/template\?type=creation&amp;format=xlsx/)
  assert.match(html, /member-imports\/template\?type=creation&amp;format=csv/)
  assert.match(html, /id="importMappingGrid"/)
  assert.match(html, /id="importPreviewScroll"/)
  assert.match(html, /id="importSkipped"/)
  assert.match(html, /member-imports\/preview/)
  assert.match(html, /member-imports\/rows/)
  assert.match(html, /data-import-field/)

  // Imported people land in the same per-person review the paste flow uses.
  assert.match(html, /function applyImportedRows/)
  assert.match(html, /renderRecipientReview\(\);/)
  assert.match(html, /recipient\.importIssues/)
})

test('the members page offers bulk deactivation behind the remove permission', async () => {
  const html = await renderView('members.ejs', memberLocals)

  assert.match(html, /id="bulkDeactivateModal"/)
  assert.match(html, /showBulkDeactivateModal\(\)/)
  assert.match(html, /member-imports\/template\?type=deactivation&amp;format=xlsx/)
  assert.match(html, /data-deactivate-field/)
  assert.match(html, /data-deactivate-toggle/)
  assert.match(html, /async function runBulkDeactivation/)
  assert.match(html, /method: 'DELETE'/)

  const withoutPermission = await renderView('members.ejs', { ...memberLocals, canRemoveMembers: false })
  assert.doesNotMatch(withoutPermission, /id="bulkDeactivateModal"/)
  assert.doesNotMatch(withoutPermission, /onclick="showBulkDeactivateModal\(\)"/)
  assert.match(withoutPermission, /const canRemoveMembersClient = false/)
})
