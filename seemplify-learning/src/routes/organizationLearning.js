import express from 'express'
import mongoose from 'mongoose'
import { requireAuth } from '../middleware/auth.js'
import { Account } from '../models/Account.js'
import { Organization } from '../models/Organization.js'
import { SimpleLmsCourse } from '../models/SimpleLmsCourse.js'
import { SimpleLmsEnrollment } from '../models/SimpleLmsEnrollment.js'
import { logAuditEvent } from '../utils/auditLog.js'
import {
  COURSE_AUDIENCE_MODES,
  ORGANIZATION_CATALOG_ACCESS,
  ORGANIZATION_LEARNING_ROLES,
  formatOrganizationLearningRole,
  normalizeOrganizationLearningAccess,
  sanitizeCourseAudience
} from '../utils/organizationLearning.js'
import {
  syncIdpOrganizationMembers,
  updateMemberLearningAccess
} from '../services/idpLearningSyncService.js'
import {
  fetchIdpOrganizationMembers,
  getFreshSessionAccessToken
} from '../services/idpOidcService.js'

const router = express.Router()
const toIdString = (value) => String(value?._id || value || '').trim()
const courseHasPublishableContent = (course) => (
  Array.isArray(course?.chapters)
  && course.chapters.some((chapter) => (
    String(chapter?.title || '').trim()
    && Array.isArray(chapter?.lessons)
    && chapter.lessons.some((lesson) => String(lesson?.title || '').trim())
  ))
)

const redirectWithMessage = (res, { success = '', error = '', info = '' } = {}) => {
  const params = new URLSearchParams()
  if (success) params.set('success', success)
  if (error) params.set('error', error)
  if (info) params.set('info', info)
  const query = params.toString()
  return res.redirect(query ? `/organization-learning?${query}` : '/organization-learning')
}

const resolveOrganizationContext = async (account, { populateMembers = false } = {}) => {
  const currentOrganizationId = toIdString(account?.currentOrganization)
  if (!mongoose.Types.ObjectId.isValid(currentOrganizationId)) {
    return { error: 'Choose a Seemplify organisation before opening Learning administration.' }
  }

  let query = Organization.findById(currentOrganizationId)
  if (populateMembers) {
    query = query.populate('members.account', 'sub idpSubject email profile.name emailVerified authentication')
  }
  const organization = await query
  if (!organization) return { error: 'Your current organisation was not found in Learning.' }

  const member = (organization.members || []).find((entry) => (
    entry.status === 'active' && toIdString(entry.account) === toIdString(account._id)
  ))
  if (!member) return { error: 'You are not an active member of this organisation.' }

  const learningAccess = normalizeOrganizationLearningAccess(member.learningAccess, member.role)
  if (!learningAccess.enabled) {
    return { error: 'Seemplify Learning is not assigned to you for this organisation.' }
  }

  return { organization, member, learningAccess }
}

const requireOrganizationLearning = ({ manage = false } = {}) => async (req, res, next) => {
  try {
    const context = await resolveOrganizationContext(req.user)
    if (context.error) return redirectWithMessage(res, { error: context.error })
    if (manage && !context.learningAccess.canManageLearning) {
      return redirectWithMessage(res, { error: 'Learning admin access is required.' })
    }
    req.organizationLearning = context
    return next()
  } catch (error) {
    console.error('Organization Learning access error:', error)
    return redirectWithMessage(res, { error: 'Failed to validate organisation Learning access.' })
  }
}

router.use(requireAuth)

router.get('/', async (req, res) => {
  try {
    const context = await resolveOrganizationContext(req.user, { populateMembers: true })
    if (context.error) {
      return res.status(403).render('organization-learning-admin', {
        title: 'Organisation Learning',
        user: req.user,
        activePage: 'organization-learning',
        organization: null,
        organizationLearningAccess: null,
        organizations: [],
        members: [],
        courses: [],
        learningRoles: ORGANIZATION_LEARNING_ROLES,
        catalogAccessOptions: ORGANIZATION_CATALOG_ACCESS,
        courseAudienceModes: COURSE_AUDIENCE_MODES,
        formatOrganizationLearningRole,
        stats: {},
        success: '',
        info: '',
        error: context.error
      })
    }

    const organization = context.organization
    const organizationIds = (req.user.organizations || [])
      .filter((entry) => entry.isActive !== false && mongoose.Types.ObjectId.isValid(toIdString(entry.organization)))
      .map((entry) => entry.organization)
    const [organizations, courses, enrollmentCounts] = await Promise.all([
      Organization.find({ _id: { $in: organizationIds } }).select('_id name idpOrganizationId').sort({ name: 1 }).lean(),
      SimpleLmsCourse.find({ organization: organization._id })
        .populate('createdBy', 'email profile.name')
        .sort({ updatedAt: -1 })
        .lean(),
      SimpleLmsEnrollment.aggregate([
        { $match: { organization: organization._id } },
        { $group: { _id: '$course', count: { $sum: 1 } } }
      ])
    ])
    const enrollmentCountByCourseId = new Map(
      (enrollmentCounts || []).map((entry) => [toIdString(entry._id), Number(entry.count || 0)])
    )
    const members = (organization.members || [])
      .filter((entry) => entry.status === 'active' && entry.account)
      .map((entry) => {
        const access = normalizeOrganizationLearningAccess(entry.learningAccess, entry.role)
        return {
          accountId: toIdString(entry.account),
          name: entry.account?.profile?.name || entry.account?.email || 'Staff member',
          email: entry.account?.email || '',
          organizationRole: String(entry.role || 'staff'),
          learningAccess: access,
          designation: entry.idpProfile?.designation || '',
          employeeId: entry.idpProfile?.employeeId || '',
          departmentName: entry.idpProfile?.departmentName || '',
          teamNames: Array.isArray(entry.idpProfile?.teamNames) ? entry.idpProfile.teamNames : [],
          isCurrentUser: toIdString(entry.account) === toIdString(req.user._id)
        }
      })
      .sort((left, right) => left.name.localeCompare(right.name))
    const courseRows = courses.map((course) => ({
      ...course,
      creatorName: course.createdBy?.profile?.name || course.createdBy?.email || course.createdByName || 'Course creator',
      enrollmentCount: enrollmentCountByCourseId.get(toIdString(course._id)) || 0,
      audienceMode: String(course.audience?.mode || 'all_members'),
      audienceLearningRoles: Array.isArray(course.audience?.learningRoles) ? course.audience.learningRoles : [],
      audienceMembers: Array.isArray(course.audience?.members) ? course.audience.members.map(toIdString) : []
    }))
    const settings = organization.settings?.simpleLms || {}

    return res.render('organization-learning-admin', {
      title: `${organization.name} - Learning administration`,
      user: req.user,
      activePage: 'organization-learning',
      organization,
      organizationLearningAccess: context.learningAccess,
      organizations,
      members,
      courses: courseRows,
      settings,
      learningRoles: ORGANIZATION_LEARNING_ROLES,
      catalogAccessOptions: ORGANIZATION_CATALOG_ACCESS,
      courseAudienceModes: COURSE_AUDIENCE_MODES,
      formatOrganizationLearningRole,
      stats: {
        memberCount: members.length,
        enabledMemberCount: members.filter((member) => member.learningAccess.enabled).length,
        courseCount: courses.length,
        pendingReviewCount: courses.filter((course) => course.status === 'pending_public_review').length
      },
      success: String(req.query.success || ''),
      error: String(req.query.error || ''),
      info: String(req.query.info || '')
    })
  } catch (error) {
    console.error('Organization Learning page error:', error)
    return res.status(500).send('Failed to load organisation Learning administration.')
  }
})

router.post('/switch', async (req, res) => {
  try {
    const organizationId = String(req.body.organizationId || '').trim()
    const membership = (req.user.organizations || []).find((entry) => (
      entry.isActive !== false && toIdString(entry.organization) === organizationId
    ))
    if (!membership || !mongoose.Types.ObjectId.isValid(organizationId)) {
      return redirectWithMessage(res, { error: 'That organisation is not available to this account.' })
    }
    req.user.currentOrganization = organizationId
    await req.user.save()
    return redirectWithMessage(res, { success: 'Learning organisation changed.' })
  } catch (error) {
    console.error('Organization Learning switch error:', error)
    return redirectWithMessage(res, { error: 'Failed to change organisation.' })
  }
})

router.post('/sync', requireOrganizationLearning({ manage: true }), async (req, res) => {
  try {
    const organization = req.organizationLearning.organization
    const idpOrganizationId = String(organization.idpOrganizationId || '').trim()
    if (!idpOrganizationId) {
      return redirectWithMessage(res, { error: 'This organisation is not linked to the Seemplify IdP.' })
    }
    const accessToken = await getFreshSessionAccessToken(req.session)
    const payload = await fetchIdpOrganizationMembers({ accessToken, organizationId: idpOrganizationId })
    const result = await syncIdpOrganizationMembers({
      organization,
      remoteMembers: payload.members || []
    })
    const skippedCopy = result.skipped.length > 0 ? ` ${result.skipped.length} record(s) need attention.` : ''
    return redirectWithMessage(res, {
      success: `Staff sync complete: ${result.created} added and ${result.updated} updated.${skippedCopy}`
    })
  } catch (error) {
    console.error('Organization Learning staff sync error:', error)
    return redirectWithMessage(res, { error: error.message || 'Failed to sync staff from Seemplify.' })
  }
})

router.post('/settings', requireOrganizationLearning({ manage: true }), async (req, res) => {
  try {
    const organization = req.organizationLearning.organization
    organization.settings = organization.settings || {}
    organization.settings.simpleLms = organization.settings.simpleLms || {}
    organization.settings.simpleLms.allowSystemCourses = req.body.allowSystemCourses === 'on'
    organization.settings.simpleLms.allowExternalPublicCourses = req.body.allowExternalPublicCourses === 'on'
    organization.settings.simpleLms.defaultCourseAudience = COURSE_AUDIENCE_MODES.includes(String(req.body.defaultCourseAudience || ''))
      ? String(req.body.defaultCourseAudience)
      : 'all_members'
    await organization.save()
    await logAuditEvent({
      action: 'organization_learning.settings_update',
      performedBy: req.user._id,
      targetOrganization: organization._id,
      metadata: organization.settings.simpleLms,
      req
    })
    return redirectWithMessage(res, { success: 'Organisation Learning settings saved.' })
  } catch (error) {
    console.error('Organization Learning settings error:', error)
    return redirectWithMessage(res, { error: 'Failed to save organisation Learning settings.' })
  }
})

router.post('/members/:accountId', requireOrganizationLearning({ manage: true }), async (req, res) => {
  try {
    const accountId = String(req.params.accountId || '').trim()
    if (!mongoose.Types.ObjectId.isValid(accountId)) {
      return redirectWithMessage(res, { error: 'Invalid staff member selected.' })
    }
    const access = await updateMemberLearningAccess({
      organization: req.organizationLearning.organization,
      accountId,
      role: req.body.learningRole,
      catalogAccess: req.body.catalogAccess,
      updatedBy: req.user._id
    })
    await logAuditEvent({
      action: 'organization_learning.member_access_update',
      performedBy: req.user._id,
      targetAccount: accountId,
      targetOrganization: req.organizationLearning.organization._id,
      metadata: { role: access.role, catalogAccess: access.catalogAccess },
      req
    })
    return redirectWithMessage(res, { success: 'Staff Learning access updated.' })
  } catch (error) {
    console.error('Organization Learning member update error:', error)
    return redirectWithMessage(res, { error: error.message || 'Failed to update staff Learning access.' })
  }
})

router.post('/courses/:courseId/access', requireOrganizationLearning({ manage: true }), async (req, res) => {
  try {
    const courseId = String(req.params.courseId || '').trim()
    if (!mongoose.Types.ObjectId.isValid(courseId)) {
      return redirectWithMessage(res, { error: 'Invalid course selected.' })
    }
    const organization = req.organizationLearning.organization
    const course = await SimpleLmsCourse.findOne({ _id: courseId, organization: organization._id })
    if (!course) return redirectWithMessage(res, { error: 'Course was not found in this organisation.' })

    const validMemberIds = (organization.members || [])
      .filter((member) => member.status === 'active' && member.learningAccess?.enabled !== false)
      .map((member) => toIdString(member.account))
    course.audience = sanitizeCourseAudience({
      mode: req.body.audienceMode,
      learningRoles: req.body.audienceLearningRoles,
      members: req.body.audienceMembers
    }, validMemberIds)
    await course.save()
    return redirectWithMessage(res, { success: `Course access updated for ${course.title}.` })
  } catch (error) {
    console.error('Organization Learning course access error:', error)
    return redirectWithMessage(res, { error: 'Failed to update course access.' })
  }
})

router.post('/courses/:courseId/lifecycle', requireOrganizationLearning({ manage: true }), async (req, res) => {
  try {
    const courseId = String(req.params.courseId || '').trim()
    const organization = req.organizationLearning.organization
    const course = mongoose.Types.ObjectId.isValid(courseId)
      ? await SimpleLmsCourse.findOne({ _id: courseId, organization: organization._id })
      : null
    if (!course) return redirectWithMessage(res, { error: 'Course was not found in this organisation.' })

    const action = String(req.body.action || '').trim().toLowerCase()
    if (['publish_internal', 'submit_public'].includes(action) && !courseHasPublishableContent(course)) {
      return redirectWithMessage(res, {
        error: 'Add at least one titled chapter and lesson before publishing or submitting this course.'
      })
    }
    if (action === 'publish_internal') {
      course.status = 'published'
      course.visibility = 'organization_private'
      course.isActive = true
      course.publishedAt = course.publishedAt || new Date()
      course.reviewDecision = 'none'
      course.submittedForPublicReviewAt = null
    } else if (action === 'submit_public') {
      course.status = 'pending_public_review'
      course.visibility = 'organization_public'
      course.isActive = true
      course.requiresPublicReview = true
      course.publishedAt = null
      course.submittedForPublicReviewAt = new Date()
      course.reviewDecision = 'pending'
      course.reviewedAt = null
      course.reviewedBy = null
      course.reviewNotes = ''
    } else if (action === 'draft') {
      course.status = 'draft'
      course.visibility = 'organization_private'
      course.isActive = true
      course.publishedAt = null
    } else if (action === 'archive') {
      course.status = 'archived'
      course.isActive = false
      course.archivedAt = new Date()
    } else {
      return redirectWithMessage(res, { error: 'Choose a valid course action.' })
    }
    await course.save()
    await logAuditEvent({
      action: `organization_learning.course_${action}`,
      performedBy: req.user._id,
      targetOrganization: organization._id,
      metadata: { courseId: course._id, courseTitle: course.title },
      req
    })
    const message = action === 'submit_public'
      ? `${course.title} was sent to Seemplify for public review.`
      : `${course.title} was updated.`
    return redirectWithMessage(res, { success: message })
  } catch (error) {
    console.error('Organization Learning course lifecycle error:', error)
    return redirectWithMessage(res, { error: 'Failed to update the course.' })
  }
})

router.post('/courses/:courseId/assign', requireOrganizationLearning({ manage: true }), async (req, res) => {
  try {
    const courseId = String(req.params.courseId || '').trim()
    const organization = req.organizationLearning.organization
    const course = mongoose.Types.ObjectId.isValid(courseId)
      ? await SimpleLmsCourse.findOne({ _id: courseId, organization: organization._id }).lean()
      : null
    if (!course) return redirectWithMessage(res, { error: 'Course was not found in this organisation.' })

    const requestedIds = (Array.isArray(req.body.memberIds) ? req.body.memberIds : [req.body.memberIds])
      .map((value) => String(value || '').trim())
      .filter((value) => mongoose.Types.ObjectId.isValid(value))
    const allowedMemberIds = new Set(
      (organization.members || [])
        .filter((member) => member.status === 'active' && member.learningAccess?.enabled !== false)
        .map((member) => toIdString(member.account))
    )
    const memberIds = Array.from(new Set(requestedIds.filter((memberId) => allowedMemberIds.has(memberId))))
    if (memberIds.length === 0) {
      return redirectWithMessage(res, { error: 'Select at least one eligible staff member.' })
    }

    await SimpleLmsEnrollment.bulkWrite(memberIds.map((memberId) => ({
      updateOne: {
        filter: {
          organization: organization._id,
          course: course._id,
          enrolledMember: memberId
        },
        update: {
          $setOnInsert: {
            enrolledBy: req.user._id,
            assignmentType: 'member',
            source: 'manual',
            status: 'assigned',
            assignedAt: new Date(),
            lastActivityAt: new Date()
          }
        },
        upsert: true
      }
    })))
    return redirectWithMessage(res, {
      success: `${course.title} assigned to ${memberIds.length} staff member${memberIds.length === 1 ? '' : 's'}.`
    })
  } catch (error) {
    console.error('Organization Learning course assignment error:', error)
    return redirectWithMessage(res, { error: 'Failed to assign the course.' })
  }
})

export default router
