/**
 * Session store with user-based operations for webhook support
 * Works with express-session and connect-mongo
 *
 * Enables:
 * - Invalidating all sessions for a specific user
 * - Updating team claims in active sessions
 * - Marking sessions as needing claims refresh
 */

const mongoose = require('mongoose')

// Session collection name (default for connect-mongo)
const SESSION_COLLECTION = 'sessions'

/**
 * Get all sessions for a specific user (by IDP user ID / sub)
 */
async function getUserSessions(userId) {
  const db = mongoose.connection.db
  if (!db) {
    console.warn('⚠️ Database not connected, cannot query sessions')
    return []
  }

  const sessions = await db.collection(SESSION_COLLECTION)
    .find({
      $or: [
        { 'session.user.id': userId },
        { 'session.user.sub': userId },
      ]
    })
    .toArray()

  return sessions
}

/**
 * Invalidate (delete) all sessions for a specific user
 * Called when user is removed from team/org
 */
async function invalidateUserSessions(userId) {
  const db = mongoose.connection.db
  if (!db) {
    console.warn('⚠️ Database not connected, cannot invalidate sessions')
    return 0
  }

  const result = await db.collection(SESSION_COLLECTION).deleteMany({
    $or: [
      { 'session.user.id': userId },
      { 'session.user.sub': userId },
    ]
  })

  console.log(`🔒 Invalidated ${result.deletedCount} sessions for user ${userId}`)
  return result.deletedCount
}

/**
 * Update team claims for a user's active sessions
 * Called when user is added to a team
 */
async function updateUserTeamClaims(userId, newTeamData) {
  const db = mongoose.connection.db
  if (!db) {
    console.warn('⚠️ Database not connected, cannot update team claims')
    return 0
  }

  const sessions = await getUserSessions(userId)

  for (const sessionDoc of sessions) {
    try {
      const session = JSON.parse(sessionDoc.session)

      if (!session.user.teams) {
        session.user.teams = []
      }

      const existingIndex = session.user.teams.findIndex(t => t.id === newTeamData.id)
      if (existingIndex >= 0) {
        session.user.teams[existingIndex] = newTeamData
      } else {
        session.user.teams.push(newTeamData)
      }

      session.claimsLastRefreshed = Date.now()
      session.claimsRefreshReason = 'webhook_team_added'

      await db.collection(SESSION_COLLECTION).updateOne(
        { _id: sessionDoc._id },
        { $set: { session: JSON.stringify(session) } }
      )

      console.log(`✅ Updated team claims for session ${sessionDoc._id}`)
    } catch (error) {
      console.error(`❌ Failed to update session ${sessionDoc._id}:`, error)
    }
  }

  return sessions.length
}

/**
 * Update organization claims for a user's active sessions
 */
async function updateUserOrgClaims(userId, newOrgData) {
  const db = mongoose.connection.db
  if (!db) {
    console.warn('⚠️ Database not connected, cannot update org claims')
    return 0
  }

  const sessions = await getUserSessions(userId)

  for (const sessionDoc of sessions) {
    try {
      const session = JSON.parse(sessionDoc.session)

      if (!session.user.organizations) {
        session.user.organizations = []
      }

      const existingIndex = session.user.organizations.findIndex(o => o.id === newOrgData.id)
      if (existingIndex >= 0) {
        session.user.organizations[existingIndex] = newOrgData
      } else {
        session.user.organizations.push(newOrgData)
      }

      session.claimsLastRefreshed = Date.now()
      session.claimsRefreshReason = 'webhook_org_added'

      await db.collection(SESSION_COLLECTION).updateOne(
        { _id: sessionDoc._id },
        { $set: { session: JSON.stringify(session) } }
      )
    } catch (error) {
      console.error(`❌ Failed to update session ${sessionDoc._id}:`, error)
    }
  }

  return sessions.length
}

/**
 * Force refresh all claims for a user by marking sessions as stale
 * Next request will trigger a full claims refresh from IdP
 */
async function refreshUserClaims(userId) {
  const db = mongoose.connection.db
  if (!db) {
    console.warn('⚠️ Database not connected, cannot refresh claims')
    return 0
  }

  const sessions = await getUserSessions(userId)

  for (const sessionDoc of sessions) {
    try {
      const session = JSON.parse(sessionDoc.session)

      session.claimsNeedRefresh = true
      session.claimsRefreshReason = 'webhook_role_changed'

      await db.collection(SESSION_COLLECTION).updateOne(
        { _id: sessionDoc._id },
        { $set: { session: JSON.stringify(session) } }
      )
    } catch (error) {
      console.error(`❌ Failed to mark session for refresh ${sessionDoc._id}:`, error)
    }
  }

  return sessions.length
}

module.exports = {
  getUserSessions,
  invalidateUserSessions,
  updateUserTeamClaims,
  updateUserOrgClaims,
  refreshUserClaims,
}
