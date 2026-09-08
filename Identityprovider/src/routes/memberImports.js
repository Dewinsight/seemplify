import express from 'express'
import multer from 'multer'

import { Account } from '../models/Account.js'
import { OrganizationInvite } from '../models/OrganizationInvite.js'
import { Team } from '../models/Team.js'
import { getOrganizationManagedHubApps } from '../config/hubApps.js'
import { buildMemberStructureMap, getMemberStructure } from '../utils/memberStructure.js'
import {
  MEMBER_IMPORT_CREATION,
  MEMBER_IMPORT_DEACTIVATION,
  buildMemberImportTemplate,
  getMemberImportFields,
  normalizeImportType,
  previewMemberImport,
  resolveMemberImportRows
} from '../services/memberImportService.js'
import {
  requireAuth,
  requireOrganizationMember,
  requestHasIdentityPermission
} from '../middleware/permissions.js'

const router = express.Router()

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024
  }
})

function parseMaybeJson(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback
  if (typeof value === 'object') return value
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

function canRunImport(req, type) {
  if (type === MEMBER_IMPORT_DEACTIVATION) {
    return requestHasIdentityPermission(req, 'members.remove')
  }
  return requestHasIdentityPermission(req, 'members.invite') ||
    requestHasIdentityPermission(req, 'invitations.manage')
}

function requireImportPermission(req, res) {
  const type = normalizeImportType(req.body?.type ?? req.query?.type)
  if (!canRunImport(req, type)) {
    return {
      type,
      denied: res.status(403).json({
        error: type === MEMBER_IMPORT_DEACTIVATION
          ? 'Permission to remove organization members is required.'
          : 'Permission to invite organization members is required.',
        code: 'ORGANIZATION_PERMISSION_REQUIRED',
        requiredPermission: type === MEMBER_IMPORT_DEACTIVATION ? 'members.remove' : 'members.invite'
      })
    }
  }
  return { type, denied: null }
}

/**
 * Everything the import service needs to turn spreadsheet text into the
 * organization's own departments, teams, roles, apps, and members.
 */
async function loadImportContext(req, type) {
  const organization = req.organization
  const organizationId = organization._id.toString()
  const apps = getOrganizationManagedHubApps().map(app => ({ appId: app.appId, name: app.name }))

  const teamDocs = await Team.find({ organization: organizationId })
    .select('name department members')
    .lean()

  const departments = (organization.departments || []).map(department => ({
    id: department._id.toString(),
    name: department.name
  }))

  const teams = teamDocs.map(team => ({
    id: team._id.toString(),
    name: team.name,
    departmentId: team.department?.toString() || ''
  }))

  const activeMembers = organization.members.filter(member => member.status === 'active')
  const accounts = await Account.find({
    _id: { $in: activeMembers.map(member => member.account) }
  }).select('email profile.name').lean()
  const accountById = new Map(accounts.map(account => [account._id.toString(), account]))

  const memberStructure = buildMemberStructureMap(organization, teamDocs)
  const members = activeMembers.map(member => {
    const accountId = (member.account?._id || member.account).toString()
    const account = accountById.get(accountId)
    const structure = getMemberStructure(memberStructure, accountId, organization)
    return {
      id: accountId,
      email: account?.email || '',
      name: account?.profile?.name || account?.email || '',
      employeeId: member.employeeId || '',
      role: member.role,
      isOwner: member.role === 'owner',
      departmentName: structure.departmentName || '',
      teamNames: structure.teamNames || []
    }
  })

  const pendingInvites = type === MEMBER_IMPORT_CREATION
    ? await OrganizationInvite.find({
      organization: organizationId,
      status: 'pending',
      expiresAt: { $gt: new Date() }
    }).select('email employeeId').lean()
    : []

  return {
    departments,
    teams,
    apps,
    members,
    pendingInvites: pendingInvites.map(invite => ({
      email: invite.email || '',
      employeeId: invite.employeeId || ''
    })),
    canAssignRoles: requestHasIdentityPermission(req, 'roles.assign'),
    canAssignApps: requestHasIdentityPermission(req, 'apps.assign'),
    currentAccountId: req.user._id.toString()
  }
}

/**
 * Download the creation or deactivation template, pre-filled with this
 * organization's departments, teams, and apps so the names line up on upload.
 * GET /api/organizations/:orgId/member-imports/template
 */
router.get('/:orgId/member-imports/template',
  requireAuth,
  requireOrganizationMember,
  async (req, res) => {
    const { type, denied } = requireImportPermission(req, res)
    if (denied) return denied

    try {
      const context = await loadImportContext(req, type)
      const template = buildMemberImportTemplate({
        type,
        format: String(req.query.format || 'xlsx'),
        context
      })

      res.setHeader('Content-Type', template.contentType)
      res.setHeader('Content-Disposition', `attachment; filename="${template.fileName}"`)
      res.setHeader('Cache-Control', 'no-store')
      return res.send(template.body)
    } catch (error) {
      console.error('Member import template error:', error)
      return res.status(500).json({ error: 'Failed to build the import template.' })
    }
  }
)

/**
 * Read the uploaded sheet and propose a column mapping for confirmation.
 * POST /api/organizations/:orgId/member-imports/preview
 */
router.post('/:orgId/member-imports/preview',
  requireAuth,
  requireOrganizationMember,
  upload.single('file'),
  async (req, res) => {
    const { type, denied } = requireImportPermission(req, res)
    if (denied) return denied

    try {
      if (!req.file && !req.body.csvText) {
        return res.status(400).json({ error: 'Choose a CSV or Excel file first.' })
      }

      const preview = previewMemberImport({
        buffer: req.file?.buffer || null,
        csvText: String(req.body.csvText || ''),
        sourceFileName: req.file?.originalname || '',
        sheetName: String(req.body.sheetName || '').trim(),
        columnMap: parseMaybeJson(req.body.columnMap, {}),
        type
      })

      if (preview.errors.length > 0) {
        return res.status(400).json({ error: preview.errors[0], details: preview.errors })
      }

      return res.json({ preview, fields: getMemberImportFields(type) })
    } catch (error) {
      console.error('Member import preview error:', error)
      return res.status(500).json({ error: 'Failed to read that file. Save it as CSV or Excel and try again.' })
    }
  }
)

/**
 * Resolve every row against the organization so each one can be checked before
 * it is committed. Nothing is written here.
 * POST /api/organizations/:orgId/member-imports/rows
 */
router.post('/:orgId/member-imports/rows',
  requireAuth,
  requireOrganizationMember,
  upload.single('file'),
  async (req, res) => {
    const { type, denied } = requireImportPermission(req, res)
    if (denied) return denied

    try {
      if (!req.file && !req.body.csvText) {
        return res.status(400).json({ error: 'Choose a CSV or Excel file first.' })
      }

      const context = await loadImportContext(req, type)
      const resolved = resolveMemberImportRows({
        buffer: req.file?.buffer || null,
        csvText: String(req.body.csvText || ''),
        sourceFileName: req.file?.originalname || '',
        sheetName: String(req.body.sheetName || '').trim(),
        columnMap: parseMaybeJson(req.body.columnMap, {}),
        type,
        context
      })

      if (resolved.errors.length > 0) {
        return res.status(400).json({ error: resolved.errors[0], details: resolved.errors })
      }

      return res.json(resolved)
    } catch (error) {
      console.error('Member import rows error:', error)
      return res.status(500).json({ error: 'Failed to match that file against your organization.' })
    }
  }
)

export default router
