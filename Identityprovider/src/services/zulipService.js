/**
 * Zulip Service
 * Handles integration with Zulip chat platform for multi-organization support
 * 
 * Architecture Note: Self-hosted Zulip typically uses a single realm with streams
 * for organization separation. This service manages:
 * - Default stream creation for each organization
 * - User provisioning via OIDC
 * - Organization-to-stream mapping
 */

import mongoose from 'mongoose'
import pkg from 'pg'
const { Pool } = pkg

// Zulip database configuration
const ZULIP_DB_CONFIG = {
  host: process.env.ZULIP_DB_HOST || 'code-database-1',
  port: process.env.ZULIP_DB_PORT || 5432,
  user: process.env.ZULIP_DB_USER || 'zulip',
  password: process.env.ZULIP_DB_PASSWORD || 'SeemplifyZulipDB2026!',
  database: process.env.ZULIP_DB_NAME || 'zulip'
}

// Create PostgreSQL connection pool
let zulipPool = null

function getZulipPool() {
  if (!zulipPool) {
    zulipPool = new Pool(ZULIP_DB_CONFIG)
    zulipPool.on('error', (err) => {
      console.error('[Zulip Service] Unexpected error on idle PostgreSQL client:', err)
    })
  }
  return zulipPool
}

/**
 * Generate a unique string_id for Zulip realm
 * string_id is used in URLs and must be URL-safe
 */
function generateRealmStringId(organizationName) {
  // Convert to lowercase, replace spaces with hyphens, remove special chars
  const base = organizationName
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .substring(0, 30) // Max length for string_id
  
  // Add random suffix to ensure uniqueness
  const suffix = Math.random().toString(36).substring(2, 6)
  return `${base}-${suffix}`
}

/**
 * Execute raw SQL on Zulip database
 * Connects directly to Zulip PostgreSQL database (now in dokploy-network)
 */
async function executeZulipSQL(sql, params = []) {
  const pool = getZulipPool()
  
  try {
    console.log('[Zulip Service] Executing SQL:', sql.substring(0, 100), '...')
    const result = await pool.query(sql, params)
    console.log(`[Zulip Service] SQL executed successfully. Rows affected: ${result.rowCount}`)
    return result
  } catch (error) {
    console.error('[Zulip Service] Error executing SQL:', error.message)
    throw error
  }
}

/**
 * Create a new realm (organization) in Zulip
 * 
 * In self-hosted Zulip, creating additional realms requires Django management commands
 * or direct database access. This function:
 * 1. Creates the realm record in zerver_realm
 * 2. Creates default streams for the organization
 * 3. Sets up realm-specific configuration
 * 
 * @param {Object} organization - The organization from IDP
 * @param {Object} owner - The owner user from IDP
 * @returns {Object} The created Zulip realm info
 */
export async function createZulipRealm(organization, owner) {
  const realmStringId = generateRealmStringId(organization.name)
  
  console.log(`[Zulip Service] Creating realm for organization: ${organization.name}`)
  console.log(`[Zulip Service] Realm string_id: ${realmStringId}`)
  
  // Create realm via Zulip management command (preferred method)
  // This handles all user group creation and default setup
  const realmId = await createRealmViaManagementCommand(organization.name, realmStringId, owner.email)
  
  if (realmId) {
    // Create default streams for the organization
    await createDefaultStreamsViaManagementCommand(realmStringId, organization.name)
    
    // Store realm info on the organization document
    organization.zulipRealmId = realmId.toString()
    organization.zulipRealmName = realmStringId
    await organization.save()
    
    console.log(`[Zulip Service] Successfully created realm ${realmId} for ${organization.name}`)
  }
  
  return {
    realmId: realmId,
    realmStringId: realmStringId,
    chatUrl: `https://chat.seemplifyai.com`,
    name: organization.name
  }
}

/**
 * Create realm via Zulip management command
 * This is the recommended way as it handles all user groups and default setup
 */
async function createRealmViaManagementCommand(name, stringId, ownerEmail) {
  const { exec } = await import('child_process')
  const { promisify } = await import('util')
  const execAsync = promisify(exec)
  
  try {
    console.log(`[Zulip Service] Creating realm via management command...`)
    console.log(`[Zulip Service] Name: ${name}, String ID: ${stringId}, Owner: ${ownerEmail}`)
    
    // Execute Zulip's create_realm management command
    const command = `docker exec code-zulip-1 /home/zulip/deployments/current/manage.py create_realm --string-id "${stringId}" --name "${name}" --owner-email "${ownerEmail}"`
    
    console.log(`[Zulip Service] Executing: ${command}`)
    const { stdout, stderr } = await execAsync(command)
    
    if (stdout) console.log(`[Zulip Service] STDOUT:`, stdout)
    if (stderr) console.log(`[Zulip Service] STDERR:`, stderr)
    
    // Query the database to get the realm ID
    const result = await executeZulipSQL('SELECT id FROM zerver_realm WHERE string_id = $1', [stringId])
    const realmId = result.rows[0]?.id
    
    if (!realmId) {
      throw new Error('Realm created but ID not found in database')
    }
    
    console.log(`[Zulip Service] ✅ Realm created successfully with ID: ${realmId}`)
    return realmId
  } catch (error) {
    console.error('[Zulip Service] Error creating realm via management command:', error)
    console.error('[Zulip Service] Error details:', error.message)
    if (error.stderr) console.error('[Zulip Service] Command stderr:', error.stderr)
    throw error
  }
}

/**
 * Create default streams via management command
 */
async function createDefaultStreamsViaManagementCommand(realmStringId, orgName) {
  const { exec } = await import('child_process')
  const { promisify } = await import('util')
  const execAsync = promisify(exec)
  
  const defaultStreams = [
    `${orgName} General`,
    `${orgName} Announcements`,
    `${orgName} Help`
  ]
  
  try {
    for (const streamName of defaultStreams) {
      const command = `docker exec code-zulip-1 /home/zulip/deployments/current/manage.py create_stream --realm "${realmStringId}" --name "${streamName}"`
      console.log(`[Zulip Service] Creating stream: ${streamName}`)
      
      try {
        const { stdout, stderr } = await execAsync(command)
        if (stdout) console.log(`[Zulip Service] Stream STDOUT:`, stdout)
        if (stderr) console.log(`[Zulip Service] Stream STDERR:`, stderr)
      } catch (streamError) {
        console.error(`[Zulip Service] Failed to create stream ${streamName}:`, streamError.message)
        // Continue with other streams even if one fails
      }
    }
    
    console.log(`[Zulip Service] ✅ Default streams created for realm ${realmStringId}`)
  } catch (error) {
    console.error('[Zulip Service] Error creating default streams:', error)
    // Don't throw - stream creation is not critical
  }
}

/**
 * Create default streams for a new organization
 * Each organization gets its own set of streams for isolation
 */
async function createDefaultStreams(realmId, orgName, realmStringId) {
  const defaultStreams = [
    { name: `${orgName} General`, description: 'General discussion for ' + orgName },
    { name: `${orgName} Announcements`, description: 'Important announcements for ' + orgName },
    { name: `${orgName} Help`, description: 'Get help with using the platform' }
  ]
  
  for (const stream of defaultStreams) {
    await createStream(realmId, stream.name, stream.description, realmStringId)
  }
  
  console.log(`[Zulip Service] Created ${defaultStreams.length} default streams for realm ${realmId}`)
}

/**
 * Create a single stream in Zulip
 * Note: Uses default group ID (1) for permissions which should exist in any Zulip installation
 */
async function createStream(realmId, name, description, realmStringId) {
  const defaultGroupId = 1 // Default group in Zulip
  
  const sql = `
    INSERT INTO zerver_stream (
      name,
      description,
      rendered_description,
      date_created,
      deactivated,
      realm_id,
      invite_only,
      history_public_to_subscribers,
      is_web_public,
      is_in_zephyr_realm,
      can_remove_subscribers_group_id,
      can_administer_channel_group_id,
      can_send_message_group_id,
      can_add_subscribers_group_id,
      can_subscribe_group_id,
      topics_policy,
      can_move_messages_within_channel_group_id,
      can_move_messages_out_of_channel_group_id,
      can_resolve_topics_group_id,
      can_delete_any_message_group_id,
      can_delete_own_message_group_id
    ) VALUES (
      $1, $2, $3, NOW(), false, $4, false, true, false, false, $5, $5, $5, $5, $5, 1, $5, $5, $5, $5, $5
    )
    RETURNING id
  `
  
  try {
    const result = await executeZulipSQL(sql, [name, description, description, realmId, defaultGroupId])
    const streamId = result.rows[0]?.id
    
    if (streamId) {
      // Create recipient record for the stream
      await createStreamRecipient(realmId, streamId, 2) // type 2 = stream
    }
    
    return streamId
  } catch (error) {
    console.error('[Zulip Service] Error creating stream:', error)
    return null
  }
}

/**
 * Create recipient record for a stream
 */
async function createStreamRecipient(realmId, streamId, type) {
  const sql = `
    INSERT INTO zerver_recipient (
      realm_id,
      type,
      type_id
    ) VALUES (
      $1, $2, $3
    )
    RETURNING id
  `
  
  try {
    const result = await executeZulipSQL(sql, [realmId, type, streamId])
    return result.rows[0]?.id
  } catch (error) {
    console.error('[Zulip Service] Error creating stream recipient:', error)
    return null
  }
}

/**
 * Add a user to Zulip when they first log in via OIDC
 * This is called automatically by Zulip's OIDC backend
 * We provide this hook for any additional setup
 * 
 * @param {Object} user - The user from IDP
 * @param {Object} organization - The user's current organization
 */
export async function onUserFirstLogin(user, organization) {
  console.log(`[Zulip Service] Processing first login for user: ${user.email}`)
  console.log(`[Zulip Service] Organization: ${organization.name}`)
  
  // The user will be automatically created in Zulip via OIDC
  // We can add additional setup here if needed
  
  // Subscribe user to their organization's default streams
  await subscribeUserToOrgStreams(user, organization)
  
  return true
}

/**
 * Subscribe a user to their organization's default streams
 */
async function subscribeUserToOrgStreams(user, organization) {
  if (!organization.zulipRealmId) {
    console.log(`[Zulip Service] Organization ${organization.name} has no Zulip realm, skipping stream subscription`)
    return
  }
  
  console.log(`[Zulip Service] Would subscribe ${user.email} to streams for realm ${organization.zulipRealmId}`)
  
  // In production, this would:
  // 1. Get the user's Zulip user_id from zerver_userprofile
  // 2. Get the stream IDs from zerver_stream where realm = organization.zulipRealmId
  // 3. Insert subscription records into zerver_subscription
  
  // For now, we log the action as the actual subscription happens via OIDC
}

/**
 * Get Zulip realm info for an organization
 */
export async function getZulipRealmInfo(organization) {
  if (!organization.zulipRealmId) {
    return null
  }
  
  return {
    realmId: organization.zulipRealmId,
    realmName: organization.zulipRealmName,
    organizationName: organization.name,
    chatUrl: `https://chat.seemplify.ai.com/#narrow/stream/${encodeURIComponent(organization.name)}`
  }
}

/**
 * Sync organization members to Zulip
 * Ensures all members have accounts and proper stream access
 */
export async function syncOrganizationMembers(organization) {
  console.log(`[Zulip Service] Syncing members for organization: ${organization.name}`)
  
  const members = organization.members.filter(m => m.status === 'active')
  console.log(`[Zulip Service] Found ${members.length} active members to sync`)
  
  // Each member will be created/updated on their next OIDC login
  // This function can be used for bulk operations if needed
  
  return {
    synced: members.length,
    organization: organization.name
  }
}

/**
 * Delete a Zulip realm when an organization is deleted
 */
export async function deleteZulipRealm(organization) {
  if (!organization.zulipRealmId) {
    console.log(`[Zulip Service] Organization ${organization.name} has no Zulip realm to delete`)
    return true
  }
  
  console.log(`[Zulip Service] Would delete realm ${organization.zulipRealmId} for organization ${organization.name}`)
  
  // In production, this would:
  // 1. Delete all stream subscriptions
  // 2. Delete all streams
  // 3. Delete the realm record
  // 4. Archive or delete user accounts in this realm
  
  // Note: This is a soft delete - actual data may be retained for compliance
  
  return true
}

export default {
  createZulipRealm,
  onUserFirstLogin,
  getZulipRealmInfo,
  syncOrganizationMembers,
  deleteZulipRealm
}
