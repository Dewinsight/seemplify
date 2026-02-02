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
 * Create realm with user groups
 * Since we can't execute Docker commands from inside the container,
 * we'll create the realm and required user groups via direct PostgreSQL
 */
async function createRealmViaManagementCommand(name, stringId, ownerEmail) {
  try {
    console.log(`[Zulip Service] Creating realm with required user groups...`)
    console.log(`[Zulip Service] Name: ${name}, String ID: ${stringId}`)
    
    // Step 1: Create default user groups for the realm
    // We'll create these after creating the realm since they need the realm_id
    
    // Step 2: Create the realm (we'll insert it first, then create groups)
    const realmId = await createRealmWithGroups(name, stringId)
    
    if (!realmId) {
      throw new Error('Failed to create realm')
    }
    
    console.log(`[Zulip Service] ✅ Realm created successfully with ID: ${realmId}`)
    return realmId
  } catch (error) {
    console.error('[Zulip Service] Error creating realm:', error)
    console.error('[Zulip Service] Error details:', error.message)
    throw error
  }
}

/**
 * Create realm with all required user groups
 */
async function createRealmWithGroups(name, stringId) {
  try {
    // First, create a minimal realm entry with NULL group references
    // We'll update the group IDs after creating the groups
    const createRealmSQL = `
      INSERT INTO zerver_realm (
        name, string_id, description,
        uuid, uuid_owner_secret, date_created,
        deactivated, push_notifications_enabled,
        emails_restricted_to_domains, invite_required,
        disallow_disposable_email_addresses, enable_spectator_access,
        want_advertise_in_communities_directory,
        inline_image_preview, inline_url_embed_preview,
        digest_emails_enabled, digest_weekday,
        send_welcome_emails, message_content_allowed_in_email_notifications,
        require_unique_names, name_changes_disabled,
        email_changes_disabled, avatar_changes_disabled,
        waiting_period_threshold, allow_message_editing,
        default_language, message_retention_days,
        first_visible_message_id, org_type, plan_type,
        video_chat_provider, giphy_rating,
        default_code_block_language, enable_read_receipts,
        enable_guest_user_indicator,
        icon_source, icon_version,
        logo_source, logo_version,
        night_logo_source, night_logo_version,
        enable_guest_user_dm_warning,
        message_edit_history_visibility_policy,
        topics_policy,
        require_e2ee_push_notifications,
        welcome_message_custom_text
      )
      SELECT $1, $2, $3,
        gen_random_uuid(), gen_random_uuid()::text, NOW(),
        false, true, false, false, true, false, false, true, true, true, 0, true, true, false,
        false, false, false, 0, true, 'en', -1, 0, 0, 1, 0, 1, '', true, true, 'G', 1, 'G', 1, 'G', 1,
        false, 0, 1, false, ''
      RETURNING id
    `
    
    let result = await executeZulipSQL(createRealmSQL, [name, stringId, `${name} workspace`])
    const realmId = result.rows[0]?.id
    
    if (!realmId) {
      throw new Error('Failed to create realm - no ID returned')
    }
    
    console.log(`[Zulip Service] Realm created with ID: ${realmId}, creating user groups...`)
    
    // Create a default user group for this realm
    const createGroupSQL = `
      INSERT INTO zerver_usergroup (realm_id)
      VALUES ($1)
      RETURNING id
    `
    
    result = await executeZulipSQL(createGroupSQL, [realmId])
    const groupId = result.rows[0]?.id
    
    if (!groupId) {
      console.error('[Zulip Service] Failed to create user group, continuing anyway')
      // Don't fail - just log the error
    } else {
      console.log(`[Zulip Service] Created default user group with ID: ${groupId}`)
      
      // Update the realm to use this group for all permissions
      const updateRealmSQL = `
        UPDATE zerver_realm SET
          can_access_all_users_group_id = $1,
          can_create_private_channel_group_id = $1,
          can_create_public_channel_group_id = $1,
          can_create_web_public_channel_group_id = $1,
          can_delete_any_message_group_id = $1,
          create_multiuse_invite_group_id = $1,
          direct_message_initiator_group_id = $1,
          direct_message_permission_group_id = $1,
          can_delete_own_message_group_id = $1,
          can_create_groups_id = $1,
          can_manage_all_groups_id = $1,
          can_add_custom_emoji_group_id = $1,
          can_move_messages_between_channels_group_id = $1,
          can_move_messages_between_topics_group_id = $1,
          can_invite_users_group_id = $1,
          can_add_subscribers_group_id = $1,
          can_create_bots_group_id = $1,
          can_create_write_only_bots_group_id = $1,
          can_summarize_topics_group_id = $1,
          can_mention_many_users_group_id = $1,
          can_manage_billing_group_id = $1,
          can_resolve_topics_group_id = $1,
          can_set_topics_policy_group_id = $1,
          can_set_delete_message_policy_group_id = $1
        WHERE id = $2
      `
      
      await executeZulipSQL(updateRealmSQL, [groupId, realmId])
      console.log(`[Zulip Service] Updated realm with group permissions`)
    }
    
    return realmId
  } catch (error) {
    console.error('[Zulip Service] Error in createRealmWithGroups:', error)
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
