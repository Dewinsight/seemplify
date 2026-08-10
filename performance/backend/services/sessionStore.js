/**
 * Session Store for Performance Management
 * Handles session manipulation for webhook-triggered updates
 *
 * When IDP sends webhooks about team/org changes:
 * - Invalidate sessions for removed users
 * - Mark claims as needing refresh for updated users
 * - Update session data directly when possible
 */

// Get the session store instance (shared with main app)
let sessionStore = null

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * connect-mongo stores the Express session payload as a JSON string by
 * default. Include both the decoded-object shape (for compatible/custom
 * stores) and the serialized shape used in production.
 */
function buildSessionIdentityFilter(userId) {
  const normalizedUserId = String(userId || '').trim()
  if (!normalizedUserId) return null

  const escapedUserId = escapeRegExp(normalizedUserId)
  const serializedIdentity = new RegExp(
    `"(?:sub|id)"\\s*:\\s*"${escapedUserId}"`
  )

  return {
    $or: [
      { 'session.user.sub': normalizedUserId },
      { 'session.user.id': normalizedUserId },
      { 'session.passport.user.sub': normalizedUserId },
      { session: { $regex: serializedIdentity } },
    ],
  }
}

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

function requireMongoClient() {
  const store = getMongoClient()
  if (!store) throw new Error('Performance session store is not initialized')
  return store
}

async function requireSessionCollection(store) {
  const collection = store.collectionPromise
    ? await store.collectionPromise
    : store.collection
  if (!collection) throw new Error('Performance session collection is unavailable')
  return collection
}

/**
 * Invalidate all sessions for a user
 * Used when user is removed from team/org
 */
async function invalidateUserSessions(userId) {
  const store = requireMongoClient()

  const identityFilter = buildSessionIdentityFilter(userId)
  if (!identityFilter) return 0

  try {
    // Access the underlying MongoDB collection
    const collection = await requireSessionCollection(store)

    // Find and delete all sessions for this user
    const result = await collection.deleteMany(identityFilter)

    console.log(`🔒 Invalidated ${result.deletedCount} sessions for user ${userId}`)
    return result.deletedCount
  } catch (error) {
    console.error(`❌ Failed to invalidate sessions for user ${userId}:`, error)
    throw error
  }
}

/**
 * Update team claims in user's session
 * Used when user is added to a team
 */
async function updateUserTeamClaims(userId, newTeamData) {
  const store = requireMongoClient()

  try {
    const collection = await requireSessionCollection(store)

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
    throw error
  }
}

/**
 * Update organization claims in user's session
 * Used when user is added to an organization
 */
async function updateUserOrgClaims(userId, newOrgData) {
  const store = requireMongoClient()

  try {
    const collection = await requireSessionCollection(store)

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
    throw error
  }
}

/**
 * Refresh claims for a user (mark as needing refresh)
 * Used when team role changes
 */
async function refreshUserClaims(userId) {
  const store = requireMongoClient()

  try {
    const collection = await requireSessionCollection(store)

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
    throw error
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
  buildSessionIdentityFilter,
  invalidateUserSessions,
  updateUserTeamClaims,
  updateUserOrgClaims,
  refreshUserClaims,
  getUserSessionCount,
}
