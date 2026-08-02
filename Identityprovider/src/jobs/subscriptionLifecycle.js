import { subscriptionService } from '../services/subscriptionService.js'

/**
 * Subscription Lifecycle Jobs
 *
 * This module runs scheduled jobs to manage subscription lifecycles:
 * - Process expired subscriptions (move to grace period)
 * - End grace periods (move to fully expired)
 * - Send renewal reminders
 * - Expire stale subscription requests
 */

let jobInterval = null
let isRunning = false

/**
 * Run all lifecycle jobs
 */
async function runLifecycleJobs() {
  if (isRunning) {
    console.log('⏳ [SUBSCRIPTION] Lifecycle jobs already running, skipping...')
    return
  }

  isRunning = true
  const startTime = Date.now()
  console.log('🔄 [SUBSCRIPTION] Running subscription lifecycle jobs...')

  try {
    // Run all jobs in parallel
    const [
      expiredCount,
      gracePeriodEndCount,
      remindersCount,
      expiredRequestsCount
    ] = await Promise.all([
      processExpiredSubscriptions(),
      processGracePeriodEnd(),
      sendRenewalReminders(),
      expireOldRequests()
    ])

    const duration = Date.now() - startTime
    console.log(`✅ [SUBSCRIPTION] Lifecycle jobs completed in ${duration}ms:`)
    console.log(`   - Expired subscriptions processed: ${expiredCount}`)
    console.log(`   - Grace periods ended: ${gracePeriodEndCount}`)
    console.log(`   - Renewal reminders sent: ${remindersCount}`)
    console.log(`   - Stale requests expired: ${expiredRequestsCount}`)

    return {
      expiredCount,
      gracePeriodEndCount,
      remindersCount,
      expiredRequestsCount,
      duration
    }
  } catch (error) {
    console.error('❌ [SUBSCRIPTION] Error running lifecycle jobs:', error)
    throw error
  } finally {
    isRunning = false
  }
}

/**
 * Process subscriptions that have passed their end date
 * Moves them to grace period status
 */
async function processExpiredSubscriptions() {
  try {
    const count = await subscriptionService.processExpiredSubscriptions()
    return count
  } catch (error) {
    console.error('Error processing expired subscriptions:', error)
    return 0
  }
}

/**
 * Process subscriptions that have passed their grace period
 * Moves them to fully expired status
 */
async function processGracePeriodEnd() {
  try {
    const count = await subscriptionService.processGracePeriodEnd()
    return count
  } catch (error) {
    console.error('Error processing grace period end:', error)
    return 0
  }
}

/**
 * Send renewal reminders for subscriptions expiring soon
 * Sends at 7 days, 3 days, and 1 day before expiry
 */
async function sendRenewalReminders() {
  try {
    const count = await subscriptionService.sendRenewalReminders()
    return count
  } catch (error) {
    console.error('Error sending renewal reminders:', error)
    return 0
  }
}

/**
 * Expire subscription requests that have been pending too long
 */
async function expireOldRequests() {
  try {
    const count = await subscriptionService.expireOldRequests()
    return count
  } catch (error) {
    console.error('Error expiring old requests:', error)
    return 0
  }
}

/**
 * Start the subscription lifecycle jobs
 * Runs every 6 hours by default
 *
 * @param {number} intervalHours - How often to run jobs (default: 6 hours)
 */
export function startSubscriptionLifecycleJobs(intervalHours = 6) {
  if (jobInterval) {
    console.log('⚠️ [SUBSCRIPTION] Lifecycle jobs already started')
    return
  }

  const intervalMs = intervalHours * 60 * 60 * 1000

  console.log(`🚀 [SUBSCRIPTION] Starting lifecycle jobs (running every ${intervalHours} hours)`)

  // Run immediately on startup
  runLifecycleJobs().catch(err => {
    console.error('Failed initial lifecycle job run:', err)
  })

  // Then run periodically
  jobInterval = setInterval(() => {
    runLifecycleJobs().catch(err => {
      console.error('Failed periodic lifecycle job run:', err)
    })
  }, intervalMs)

  // Make interval unref'd so it doesn't keep the process alive
  if (jobInterval.unref) {
    jobInterval.unref()
  }
}

/**
 * Stop the subscription lifecycle jobs
 */
export function stopSubscriptionLifecycleJobs() {
  if (jobInterval) {
    clearInterval(jobInterval)
    jobInterval = null
    console.log('🛑 [SUBSCRIPTION] Lifecycle jobs stopped')
  }
}

/**
 * Manually trigger lifecycle jobs (for admin use)
 */
export async function triggerLifecycleJobs() {
  return runLifecycleJobs()
}

export default {
  startSubscriptionLifecycleJobs,
  stopSubscriptionLifecycleJobs,
  triggerLifecycleJobs
}
