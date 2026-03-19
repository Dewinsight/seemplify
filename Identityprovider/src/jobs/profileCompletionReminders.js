import { Account } from '../models/Account.js'
import { emailService } from '../services/emailService.js'
import { getProfileCompletionForAccount } from '../utils/profileCompletion.js'

let reminderInterval = null
let isRunning = false

function buildReminderEmail(account, completion) {
  const baseUrl = process.env.ISSUER_URL || 'http://localhost:4000'
  const nextRoute = completion?.nextIncompleteStep?.route || '/profile/personal'
  const actionUrl = `${baseUrl}${nextRoute}?wizard=1`
  const missingSteps = (completion?.steps || [])
    .filter(step => !step.complete)
    .map(step => `<li><strong>${step.label}</strong>: ${step.description}</li>`)
    .join('')
  const recipientName = account?.profile?.name || account?.email || 'there'

  return {
    subject: 'Complete your employee profile',
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111827;">
        <h2 style="margin-bottom: 12px;">Complete your employee profile</h2>
        <p>Hi ${recipientName},</p>
        <p>Your employee profile is still missing a few required details for HR and payroll.</p>
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
      'Your employee profile is still missing required details for HR and payroll.',
      '',
      ...(completion?.steps || [])
        .filter(step => !step.complete)
        .map(step => `- ${step.label}: ${step.description}`),
      '',
      `Complete your profile here: ${actionUrl}`
    ].join('\n')
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
  const now = new Date()
  const cutoff = now.getTime() - (24 * 60 * 60 * 1000)

  try {
    const accounts = await Account.find({
      email: { $exists: true, $ne: null },
      'organizations.isActive': true
    })

    let sentCount = 0

    for (const account of accounts) {
      const completion = await getProfileCompletionForAccount(account)
      if (completion.complete) {
        continue
      }

      const lastSentAt = completion?.reminder?.lastSentAt
      if (lastSentAt && new Date(lastSentAt).getTime() > cutoff) {
        continue
      }

      const { subject, html, text } = buildReminderEmail(account, completion)

      try {
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
        sentCount += 1
      } catch (error) {
        console.error(`❌ [PROFILE] Failed to send completion reminder to ${account.email}:`, error)
      }
    }

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
