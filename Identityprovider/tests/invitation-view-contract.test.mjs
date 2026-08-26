import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs/promises'
import ejs from 'ejs'

const viewPath = fileURLToPath(new URL('../src/views/invitations.ejs', import.meta.url))
const locals = {
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
  identityPermissions: ['members.view', 'members.invite', 'invitations.manage', 'roles.assign', 'apps.assign', 'departments.manage', 'teams.manage'],
  yourRole: 'admin',
  user: {
    email: 'admin@example.com',
    profile: { name: 'Admin User' },
    currentOrganization: { _id: 'org-1', name: 'Example Company', role: 'admin' }
  },
  brand: { name: 'Seemplify', navLogoHtml: '<span>Seemplify</span>' },
  error: null,
  success: null
}

test('renders the paste, review, ordering, and batch recovery invitation contract', async () => {
  const html = await ejs.renderFile(viewPath, locals, { filename: viewPath })

  assert.match(html, /id="recipientSource"/)
  assert.match(html, /id="recipientReview"/)
  assert.match(html, /Sort A–Z/)
  assert.match(html, /data-recipient-action="up"/)
  assert.match(html, /data-recipient-action="down"/)
  assert.match(html, /data-recipient-role/)
  assert.match(html, /data-recipient-designation/)
  assert.match(html, /data-recipient-department/)
  assert.match(html, /data-recipient-team/)
  assert.match(html, /data-recipient-app-mode/)
  assert.match(html, /Apply role, team &amp; access to everyone/)
  assert.match(html, /id="createTeamPanel"/)
  assert.match(html, /createTeamFromInvite/)
  assert.match(html, /role: recipient\.role/)
  assert.match(html, /team: recipient\.teamId/)
  assert.match(html, /invitation-recipient-parser\.js\?v=1/)
  assert.match(html, /for \(let index = 0; index < batch\.length; index \+= 1\)/)
  assert.match(html, /recipients = failures/)

  const inlineScripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map(match => match[1].trim())
    .filter(Boolean)

  inlineScripts.forEach((source, index) => {
    assert.doesNotThrow(() => new vm.Script(source), `inline script ${index + 1} should parse`)
  })
})

test('designation is optional while a valid team remains required by the invitation API', async () => {
  const routeSource = await fs.readFile(
    fileURLToPath(new URL('../src/routes/invitations.js', import.meta.url)),
    'utf8'
  )
  const modelSource = await fs.readFile(
    fileURLToPath(new URL('../src/models/OrganizationInvite.js', import.meta.url)),
    'utf8'
  )

  assert.doesNotMatch(routeSource, /Designation is required/)
  assert.match(routeSource, /if \(!teamId\)/)
  assert.match(routeSource, /Team is required/)
  assert.match(modelSource, /designation:\s*\{\s*type: String,\s*default: ''/)
})
