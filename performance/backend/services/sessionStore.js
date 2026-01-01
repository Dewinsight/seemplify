/**
 * Session Store for Performance Management
 * Handles session manipulation for webhook-triggered updates
 *
 * When IDP sends webhooks about team/org changes:
 * - Invalidate sessions for removed users
 * - Mark claims as needing refresh for updated users
 * - Update session data directly when possible
 */

const session = require('express-session')
const MongoStore = require('connect-mongo')

// Get the session store instance (shared with main app)
let sessionStore = null

/**
 * Initialize session store connection
 * Call this during app startup
 */
function initSessionStore(store) {
  sessionStore = store
  console.log('✅ Session store initialized for webhook updates')
}

/**
 * Get MongoDB client from session store
 */
function getMongoClient() {
  if (!sessionStore) {
    console.warn('⚠️ Session store not initialized')
    return null
  }
  return sessionStore
}

/**
 * Invalidate all sessions for a user
 * Used when user is removed from team/org
 */
async function invalidateUserSessions(userId) {
  const store = getMongoClient()
  if (!store) return 0

  try {
    // Access the underlying MongoDB collection
    const collection = store.collectionPromise
      ? await store.collectionPromise
      : store.collection

    if (!collection) {
      console.warn('⚠️ Could not access session collection')
      return 0
    }

    // Find and delete all sessions for this user
    const result = await collection.deleteMany({
      $or: [
        { 'session.user.sub': userId },
        { 'session.user.id': userId },
        { 'session.passport.user.sub': userId },
      ],
    })

    console.log(`🔒 Invalidated ${result.deletedCount} sessions for user ${userId}`)
    return result.deletedCount
  } catch (error) {
    console.error(`❌ Failed to invalidate sessions for user ${userId}:`, error)
    return 0
  }
}

/**
 * Update team claims in user's session
 * Used when user is added to a team
 */
async function updateUserTeamClaims(userId, newTeamData) {
  const store = getMongoClient()
  if (!store) return 0

  try {
    const collection = store.collectionPromise
      ? await store.collectionPromise
      : store.collection

    if (!collection) return 0

    // Mark sessions as needing claims refresh
    const result = await collection.updateMany(
      {
        $or: [
          { 'session.user.sub': userId },
          { 'session.user.id': userId },
          { 'session.passport.user.sub': userId },
        ],
      },
      {
        $set: {
          'session.claimsNeedRefresh': true,
          'session.pendingTeamUpdate': newTeamData,
        },
      }
    )

    console.log(`🔄 Marked ${result.modifiedCount} sessions for claims refresh (user ${userId})`)
    return result.modifiedCount
  } catch (error) {
    console.error(`❌ Failed to update team claims for user ${userId}:`, error)
    return 0
  }
}

/**
 * Update organization claims in user's session
 * Used when user is added to an organization
 */
async function updateUserOrgClaims(userId, newOrgData) {
  const store = getMongoClient()
  if (!store) return 0

  try {
    const collection = store.collectionPromise
      ? await store.collectionPromise
      : store.collection

    if (!collection) return 0

    // Mark sessions as needing claims refresh
    const result = await collection.updateMany(
      {
        $or: [
          { 'session.user.sub': userId },
          { 'session.user.id': userId },
          { 'session.passport.user.sub': userId },
        ],
      },
      {
        $set: {
          'session.claimsNeedRefresh': true,
          'session.pendingOrgUpdate': newOrgData,
        },
      }
    )

    console.log(`🔄 Marked ${result.modifiedCount} sessions for org claims refresh (user ${userId})`)
    return result.modifiedCount
  } catch (error) {
    console.error(`❌ Failed to update org claims for user ${userId}:`, error)
    return 0
  }
}

/**
 * Refresh claims for a user (mark as needing refresh)
 * Used when team role changes
 */
async function refreshUserClaims(userId) {
  const store = getMongoClient()
  if (!store) return 0

  try {
    const collection = store.collectionPromise
      ? await store.collectionPromise
      : store.collection

    if (!collection) return 0

    const result = await collection.updateMany(
      {
        $or: [
          { 'session.user.sub': userId },
          { 'session.user.id': userId },
          { 'session.passport.user.sub': userId },
        ],
      },
      {
        $set: {
          'session.claimsNeedRefresh': true,
        },
      }
    )

    console.log(`🔄 Marked ${result.modifiedCount} sessions for refresh (user ${userId})`)
    return result.modifiedCount
  } catch (error) {
    console.error(`❌ Failed to mark claims for refresh (user ${userId}):`, error)
    return 0
  }
}

/**
 * Get active session count for a user
 */
async function getUserSessionCount(userId) {
  const store = getMongoClient()
  if (!store) return 0

  try {
    const collection = store.collectionPromise
      ? await store.collectionPromise
      : store.collection

    if (!collection) return 0

    const count = await collection.countDocuments({
      $or: [
        { 'session.user.sub': userId },
        { 'session.user.id': userId },
        { 'session.passport.user.sub': userId },
      ],
    })

    return count
  } catch (error) {
    console.error(`❌ Failed to get session count for user ${userId}:`, error)
    return 0
  }
}

module.exports = {
  initSessionStore,
  invalidateUserSessions,
  updateUserTeamClaims,
  updateUserOrgClaims,
  refreshUserClaims,
  getUserSessionCount,
}
