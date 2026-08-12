import crypto from 'crypto'
import { LearningSyncEvent } from '../models/LearningSyncEvent.js'
import { SimpleLmsEnrollment } from '../models/SimpleLmsEnrollment.js'

const SERVICE_ID = 'seemplify-learning'
const MAX_ATTEMPTS = 12
const DEFAULT_INTERVAL_MS = 15_000
let workerTimer = null
let warnedAboutConfiguration = false

const text = (value) => String(value || '').trim()

const configuredEndpoint = () => {
  const baseUrl = text(process.env.PERFORMANCE_MANAGEMENT_URL).replace(/\/+$/, '')
  return baseUrl ? `${baseUrl}/api/webhooks/suite` : ''
}

const configuredSecret = () => text(
  process.env.PERFORMANCE_MANAGEMENT_WEBHOOK_SECRET
  || process.env.INTERNAL_SERVICE_SECRET
)

export const isPerformanceLearningSyncConfigured = () => Boolean(configuredEndpoint() && configuredSecret())

export const accountCanSynchronizeLearning = (account) => Boolean(
  text(account?.idpSubject)
  && account?.authentication?.seemplifyEnabled === true
)

const retryDelayMs = (attempts) => Math.min(60 * 60 * 1000, 5000 * (2 ** Math.min(attempts, 9)))

const enrollmentEventType = (enrollment, requestedType = '') => {
  if (requestedType) return requestedType
  if (enrollment.status === 'completed') return 'learning.enrollment.completed'
  if (Number(enrollment.progressPercent || 0) > 0 || enrollment.status === 'in_progress') {
    return 'learning.enrollment.progressed'
  }
  return 'learning.enrollment.assigned'
}

const loadEnrollmentForSync = async (enrollmentOrId) => {
  const enrollmentId = enrollmentOrId?._id || enrollmentOrId
  if (!enrollmentId) return null
  return SimpleLmsEnrollment.findById(enrollmentId)
    .populate('enrolledMember', 'sub idpSubject email profile authentication currentOrganization organizations')
    .populate('organization', 'name idpOrganizationId')
    .populate('course', 'title slug description category level tags lessonCount organization isSystemCourse')
}

const resolveSyncOrganization = async (enrollment) => {
  const account = enrollment.enrolledMember
  const enrollmentOrganizationId = text(enrollment.organization?._id || enrollment.organization)
  const currentOrganizationId = text(account?.currentOrganization?._id || account?.currentOrganization)
  const selectedOrganizationId = enrollmentOrganizationId || currentOrganizationId
  if (!selectedOrganizationId) return null
  const activeMembership = (account.organizations || []).find((entry) => (
    entry.isActive !== false
    && entry.learningAccess?.enabled !== false
    && text(entry.organization?._id || entry.organization) === selectedOrganizationId
  ))
  if (!activeMembership) return null
  if (enrollmentOrganizationId) {
    return enrollment.organization?.idpOrganizationId ? enrollment.organization : null
  }
  await account.populate('currentOrganization', 'name idpOrganizationId')
  return account.currentOrganization?.idpOrganizationId ? account.currentOrganization : null
}

export const buildEnrollmentSyncEnvelope = async (enrollmentOrId, requestedType = '') => {
  const enrollment = await loadEnrollmentForSync(enrollmentOrId)
  if (!enrollment?.enrolledMember || !enrollment?.course) return null

  const account = enrollment.enrolledMember
  const subjectId = text(account.idpSubject)
  if (!accountCanSynchronizeLearning(account)) return null

  const organization = await resolveSyncOrganization(enrollment)
  const organizationId = text(organization?.idpOrganizationId)
  if (!organizationId) return null

  const event = enrollmentEventType(enrollment, requestedType)
  const eventId = crypto.randomUUID()
  const appBaseUrl = text(process.env.APP_BASE_URL) || 'https://learning.seemplifyai.com'
  const enrollmentId = text(enrollment._id)
  const course = enrollment.course
  const completedLessonCount = Array.isArray(enrollment.completedLessonKeys)
    ? enrollment.completedLessonKeys.length
    : 0

  return {
    eventId,
    event,
    source: SERVICE_ID,
    occurredAt: new Date().toISOString(),
    organizationId,
    subjectId,
    data: {
      organizationId,
      subjectId,
      userId: subjectId,
      learningAccountId: text(account._id),
      learnerEmail: text(account.email).toLowerCase(),
      learnerName: text(account.profile?.name || account.profile?.preferred_username || account.email),
      enrollmentId,
      courseId: text(course._id),
      courseTitle: text(course.title),
      courseUrl: `${appBaseUrl}/simple-lms/learn/${enrollmentId}`,
      courseCategory: text(course.category),
      courseLevel: text(course.level),
      courseTags: Array.isArray(course.tags) ? course.tags.map(text).filter(Boolean) : [],
      lessonCount: Number(course.lessonCount || 0),
      completedLessonCount,
      status: text(enrollment.status) || 'assigned',
      progressPercent: Number(enrollment.progressPercent || 0),
      latestQuizScore: Number(enrollment.latestQuizScore || 0),
      assignmentType: text(enrollment.assignmentType),
      assignmentSource: text(enrollment.source),
      assignedAt: enrollment.assignedAt || null,
      dueAt: enrollment.dueAt || null,
      startedAt: enrollment.startedAt || null,
      completedAt: enrollment.completedAt || null,
      lastActivityAt: enrollment.lastActivityAt || enrollment.updatedAt || null
    }
  }
}

const deliverClaimedEvent = async (syncEvent) => {
  const endpoint = configuredEndpoint()
  const secret = configuredSecret()
  if (!endpoint || !secret) {
    syncEvent.status = 'failed'
    syncEvent.lastError = 'Performance Learning synchronization is not configured'
    syncEvent.nextAttemptAt = new Date(Date.now() + retryDelayMs(syncEvent.attempts))
    await syncEvent.save()
    return false
  }

  const timestamp = new Date().toISOString()
  const serialized = JSON.stringify(syncEvent.envelope)
  const signature = crypto.createHmac('sha256', secret)
    .update(`${timestamp}.${serialized}`)
    .digest('hex')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), Number(process.env.PERFORMANCE_MANAGEMENT_TIMEOUT_MS || 8000))

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-service-id': SERVICE_ID,
        'x-service-timestamp': timestamp,
        'x-service-signature': signature
      },
      body: serialized,
      signal: controller.signal
    })
    if (!response.ok) {
      const responseText = await response.text().catch(() => '')
      throw new Error(`Performance endpoint returned ${response.status}${responseText ? `: ${responseText.slice(0, 400)}` : ''}`)
    }
    syncEvent.status = 'delivered'
    syncEvent.deliveredAt = new Date()
    syncEvent.lastError = ''
    await syncEvent.save()
    return true
  } catch (error) {
    syncEvent.status = syncEvent.attempts >= MAX_ATTEMPTS ? 'dead' : 'failed'
    syncEvent.lastError = text(error?.message || error).slice(0, 2000)
    syncEvent.nextAttemptAt = new Date(Date.now() + retryDelayMs(syncEvent.attempts))
    await syncEvent.save()
    return false
  } finally {
    clearTimeout(timeout)
  }
}

export const deliverLearningSyncEvent = async (eventId) => {
  if (!eventId) return false
  const syncEvent = await LearningSyncEvent.findOneAndUpdate(
    {
      eventId,
      status: { $in: ['pending', 'failed'] },
      nextAttemptAt: { $lte: new Date() }
    },
    {
      $set: { status: 'delivering', lastAttemptAt: new Date() },
      $inc: { attempts: 1 }
    },
    { new: true }
  )
  if (!syncEvent) return false
  return deliverClaimedEvent(syncEvent)
}

export const flushLearningSyncEvents = async ({ limit = 25 } = {}) => {
  if (!isPerformanceLearningSyncConfigured()) return { processed: 0, delivered: 0 }
  await LearningSyncEvent.updateMany(
    {
      status: 'delivering',
      lastAttemptAt: { $lt: new Date(Date.now() - 2 * 60 * 1000) }
    },
    {
      $set: {
        status: 'failed',
        nextAttemptAt: new Date(),
        lastError: 'Recovered an interrupted delivery attempt'
      }
    }
  )
  const pending = await LearningSyncEvent.find({
    status: { $in: ['pending', 'failed'] },
    nextAttemptAt: { $lte: new Date() }
  }).sort({ createdAt: 1 }).limit(limit).select('eventId').lean()
  let delivered = 0
  for (const entry of pending) {
    if (await deliverLearningSyncEvent(entry.eventId)) delivered += 1
  }
  return { processed: pending.length, delivered }
}

export const queueEnrollmentSync = async ({ enrollment, eventType = '' } = {}) => {
  const envelope = await buildEnrollmentSyncEnvelope(enrollment, eventType)
  if (!envelope) return null
  const syncEvent = await LearningSyncEvent.create({
    eventId: envelope.eventId,
    event: envelope.event,
    organizationId: envelope.organizationId,
    subjectId: envelope.subjectId,
    envelope
  })
  setImmediate(() => {
    deliverLearningSyncEvent(syncEvent.eventId).catch((error) => {
      console.warn('Deferred Performance Learning delivery failed:', error.message)
    })
  })
  return syncEvent
}

export const queueAccountLearningSnapshot = async (accountOrId) => {
  const accountId = accountOrId?._id || accountOrId
  if (!accountId) return { queued: 0 }
  const enrollments = await SimpleLmsEnrollment.find({ enrolledMember: accountId }).select('_id').lean()
  let queued = 0
  for (const enrollment of enrollments) {
    const event = await queueEnrollmentSync({
      enrollment: enrollment._id,
      eventType: 'learning.enrollment.snapshot'
    })
    if (event) queued += 1
  }
  return { queued }
}

export const startPerformanceLearningSyncWorker = () => {
  if (workerTimer) return workerTimer
  if (!isPerformanceLearningSyncConfigured()) {
    if (!warnedAboutConfiguration && (configuredEndpoint() || configuredSecret())) {
      warnedAboutConfiguration = true
      console.warn('Performance Learning sync requires both PERFORMANCE_MANAGEMENT_URL and PERFORMANCE_MANAGEMENT_WEBHOOK_SECRET')
    }
    return null
  }
  const intervalMs = Math.max(5000, Number(process.env.LEARNING_SYNC_INTERVAL_MS || DEFAULT_INTERVAL_MS))
  workerTimer = setInterval(() => {
    flushLearningSyncEvents().catch((error) => {
      console.warn('Performance Learning sync worker failed:', error.message)
    })
  }, intervalMs)
  workerTimer.unref?.()
  setImmediate(() => flushLearningSyncEvents().catch(() => {}))
  return workerTimer
}

export const stopPerformanceLearningSyncWorker = () => {
  if (workerTimer) clearInterval(workerTimer)
  workerTimer = null
}
