import { Account } from '../models/Account.js'
import { emailService } from '../services/emailService.js'
import { getProfileCompletionForAccount } from '../utils/profileCompletion.js'

let reminderInterval = null
let isRunning = false

function buildReminderEmail(account, completion, options = {}) {
  const baseUrl = process.env.ISSUER_URL || 'http://localhost:4000'
  const nextRoute = completion?.nextIncompleteStep?.route || '/profile/personal'
  const actionUrl = `${baseUrl}${nextRoute}?wizard=1`
  const organizationName = String(options.organizationName || '').trim()
  const missingSteps = (completion?.steps || [])
    .filter(step => !step.complete)
    .map(step => `<li><strong>${step.label}</strong>: ${step.description}</li>`)
    .join('')
  const recipientName = account?.profile?.name || account?.email || 'there'
  const subject = organizationName
    ? `Complete your employee profile for ${organizationName}`
    : 'Complete your employee profile'
  const profileContext = organizationName
    ? ` for ${organizationName}`
    : ''

  return {
    subject,
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111827;">
        <h2 style="margin-bottom: 12px;">Complete your employee profile</h2>
        <p>Hi ${recipientName},</p>
        <p>Your employee profile${profileContext} is still missing a few required details for HR and payroll.</p>
        <ul>
          ${missingSteps}
        </ul>
        <p>
          <a href="${actionUrl}" style="display:inline-block;padding:12px 20px;background:#0f766e;color:#ffffff;text-decoration:none;border-radius:8px;">
            Complete profile
          </a>
        </p>
        <p style="font-size: 13px; color: #6b7280;">Open this link to continue from the next required step: ${actionUrl}</p>
      </div>
    `,
    text: [
      `Hi ${recipientName},`,
      '',
      `Your employee profile${profileContext} is still missing required details for HR and payroll.`,
      '',
      ...(completion?.steps || [])
        .filter(step => !step.complete)
        .map(step => `- ${step.label}: ${step.description}`),
      '',
      `Complete your profile here: ${actionUrl}`
    ].join('\n')
  }
}

function wasReminderSentWithinCooldown(lastSentAt, now, cooldownHours) {
  if (!lastSentAt) {
    return false
  }

  const cutoff = now.getTime() - (cooldownHours * 60 * 60 * 1000)
  return new Date(lastSentAt).getTime() > cutoff
}

async function sendProfileCompletionReminderForAccount(account, options = {}) {
  const {
    organizationId = null,
    organizationName = '',
    now = new Date(),
    respectCooldown = true,
    cooldownHours = 24
  } = options

  if (!account?.email) {
    return { sent: false, reason: 'missing_email' }
  }

  const completion = await getProfileCompletionForAccount(account, { organizationId })
  if (completion.complete) {
    return { sent: false, reason: 'complete', completion }
  }

  const lastSentAt = completion?.reminder?.lastSentAt
  if (respectCooldown && wasReminderSentWithinCooldown(lastSentAt, now, cooldownHours)) {
    return { sent: false, reason: 'cooldown', completion }
  }

  const { subject, html, text } = buildReminderEmail(account, completion, { organizationName })

  await emailService.sendEmail({
    to: account.email,
    subject,
    html,
    text
  })

  account.profile = account.profile || {}
  account.profile.completionReminders = {
    ...(account.profile.completionReminders || {}),
    lastSentAt: now,
    sendCount: Number(account.profile?.completionReminders?.sendCount || 0) + 1,
    lastMissingSteps: (completion.steps || []).filter(step => !step.complete).map(step => step.key)
  }
  account.markModified('profile')
  await account.save()

  return {
    sent: true,
    reason: 'sent',
    completion
  }
}

export async function sendProfileCompletionRemindersForAccounts(accounts = [], options = {}) {
  if (!emailService.apiKey) {
    if (options.throwOnUnconfigured) {
      throw new Error('Email service is not configured')
    }

    return {
      sentCount: 0,
      skippedCount: Array.isArray(accounts) ? accounts.length : 0,
      failedCount: 0
    }
  }

  const now = options.now || new Date()
  let sentCount = 0
  let skippedCount = 0
  let failedCount = 0

  for (const account of Array.isArray(accounts) ? accounts : []) {
    try {
      const result = await sendProfileCompletionReminderForAccount(account, {
        ...options,
        now
      })

      if (result.sent) {
        sentCount += 1
      } else {
        skippedCount += 1
      }
    } catch (error) {
      failedCount += 1
      console.error(`❌ [PROFILE] Failed to send completion reminder to ${account?.email || 'unknown recipient'}:`, error)
    }
  }

  return {
    sentCount,
    skippedCount,
    failedCount
  }
}

export async function sendProfileCompletionReminders() {
  if (isRunning) {
    console.log('⏳ [PROFILE] Reminder job already running, skipping')
    return 0
  }

  if (!emailService.apiKey) {
    console.log('⚠️ [PROFILE] Email service is not configured, skipping reminder run')
    return 0
  }

  isRunning = true

  try {
    const accounts = await Account.find({
      email: { $exists: true, $ne: null },
      'organizations.isActive': true
    })

    const { sentCount } = await sendProfileCompletionRemindersForAccounts(accounts, {
      now: new Date(),
      respectCooldown: true,
      cooldownHours: 24
    })

    console.log(`✅ [PROFILE] Sent ${sentCount} profile completion reminder(s)`)
    return sentCount
  } catch (error) {
    console.error('❌ [PROFILE] Profile reminder job failed:', error)
    throw error
  } finally {
    isRunning = false
  }
}

export function startProfileCompletionReminderJobs(intervalHours = 24) {
  if (reminderInterval) {
    console.log('⚠️ [PROFILE] Reminder job already started')
    return
  }

  const intervalMs = intervalHours * 60 * 60 * 1000
  console.log(`🚀 [PROFILE] Starting profile completion reminders every ${intervalHours} hours`)

  sendProfileCompletionReminders().catch(error => {
    console.error('❌ [PROFILE] Initial reminder run failed:', error)
  })

  reminderInterval = setInterval(() => {
    sendProfileCompletionReminders().catch(error => {
      console.error('❌ [PROFILE] Scheduled reminder run failed:', error)
    })
  }, intervalMs)

  if (reminderInterval.unref) {
    reminderInterval.unref()
  }
}

export function stopProfileCompletionReminderJobs() {
  if (!reminderInterval) {
    return
  }

  clearInterval(reminderInterval)
  reminderInterval = null
  console.log('🛑 [PROFILE] Profile completion reminders stopped')
}
