import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
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
  canViewMembers: true,
  canViewAccessControl: true,
  identityPermissions: ['members.view', 'members.invite', 'invitations.manage', 'roles.assign', 'apps.assign'],
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
