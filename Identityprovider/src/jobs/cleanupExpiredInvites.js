/**
 * Background job for cleaning up expired invitations
 * Runs daily to mark expired invitations as 'expired'
 */

import { OrganizationInvite } from '../models/OrganizationInvite.js'

/**
 * Run cleanup of expired invitations
 */
export async function cleanupExpiredInvites() {
  console.log('🧹 Starting expired invitation cleanup...')

  try {
    const result = await OrganizationInvite.cleanupExpiredInvites()
    const count = result.modifiedCount || 0
    console.log(`✅ Marked ${count} invitation(s) as expired`)
    return count
  } catch (error) {
    console.error('❌ Error cleaning up expired invitations:', error)
    throw error
  }
}

/**
 * Run cleanup on server startup
 */
export async function runCleanupOnStartup() {
  console.log('🚀 Running startup cleanup for expired invitations...')
  try {
    const count = await cleanupExpiredInvites()
    console.log(`📊 Startup cleanup complete: ${count} invitation(s) processed`)
  } catch (error) {
    console.error('❌ Error in startup cleanup:', error)
  }
}

/**
 * Schedule daily cleanup job
 * Uses setInterval as a simple scheduler (for production, use node-cron)
 */
export function scheduleCleanupJob() {
  // Run every 24 hours
  const interval = 24 * 60 * 60 * 1000

  setInterval(async () => {
    console.log('⏰ Running scheduled cleanup...')
    await cleanupExpiredInvites()
  }, interval)

  console.log('📅 Scheduled daily cleanup job')
}

/**
 * Initialize cleanup system
 * Call this on server startup
 */
export async function initializeCleanupJobs() {
  // Run cleanup immediately on startup
  await runCleanupOnStartup()

  // Schedule daily cleanup
  scheduleCleanupJob()
}

export default {
  cleanupExpiredInvites,
  runCleanupOnStartup,
  scheduleCleanupJob,
  initializeCleanupJobs
}
