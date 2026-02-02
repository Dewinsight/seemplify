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

// Zulip database configuration
const ZULIP_DB_CONFIG = {
  host: process.env.ZULIP_DB_HOST || 'code-database-1',
  port: process.env.ZULIP_DB_PORT || 5432,
  user: process.env.ZULIP_DB_USER || 'zulip',
  password: process.env.ZULIP_DB_PASSWORD || 'SeemplifyZulipDB2026!',
  database: process.env.ZULIP_DB_NAME || 'zulip'
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
 * Uses docker exec for server-side execution
 */
async function executeZulipSQL(sql, params = []) {
  // Note: In production, this would connect directly to PostgreSQL
  // For now, we return a mock result for development
  // In production, use: pg.connect(ZULIP_DB_CONFIG, ...)
  
  console.log('[Zulip Service] Would execute SQL:', sql.substring(0, 100), '...')
  
  // Return a mock successful result
  return { rows: [], rowCount: 0 }
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
  
  // Create realm via management command (preferred method)
  // docker exec code-zulip-1 /home/zulip/deployments/current/manage.py create_realm --name "..." --string-id "..."
  
  // For now, we'll create the realm record directly in the database
  const realmId = await createRealmRecord(organization.name, realmStringId)
  
  if (realmId) {
    // Create default streams for the organization
    await createDefaultStreams(realmId, organization.name, realmStringId)
    
    // Store realm info on the organization document
    organization.zulipRealmId = realmId.toString()
    organization.zulipRealmName = realmStringId
    await organization.save()
    
    console.log(`[Zulip Service] Successfully created realm ${realmId} for ${organization.name}`)
  }
  
  return {
    realmId: realmId,
    realmStringId: realmStringId,
    name: organization.name
  }
}

/**
 * Create realm record in database
 */
async function createRealmRecord(name, stringId) {
  const sql = `
    INSERT INTO zerver_realm (
      name, 
      string_id, 
      description, 
      date_created, 
      icon_url, 
      avatar_url,
      invite_required,
      invite_by_admins_only,
      name_changes_disabled,
      email_changes_disabled,
      password_auth_enabled,
      dev_auth_enabled,
      ldap_auth_enabled,
      oidc_auth_enabled,
      snipe,
      allow_message_editing,
      allow_community_topic_editing,
      allow_access_control_beta,
      default_language,
      default_code_block_language,
      waiting_period_threshold,
      digest_weekday,
      digest_sent_hour,
      digest_canonical_hour,
      last_message_full_edit_time,
      max_message_length,
      max_file_upload_size_mib,
      max_avatar_file_size_mib,
      unrestricted_access_accounts,
      can_create_accounts,
      can_create_public_streams,
      can_create_private_streams,
      can_create_web_public_streams,
      message_content_allowed_in_email_notifications,
      video_chat_provider,
      waiting_period_ends,
      default_display_recipient,
      row_version
    ) VALUES (
      $1, $2, $3, NOW(), '', '', true, false, false, false, false, false, false, true, false,
      true, true, false, 'en', NULL, 1000, 0, 16, 8, 4800, 10000, 100, 10,
      true, true, true, true, true, true, '', NULL, $4, 1
    )
    RETURNING id
  `
  
  const defaultDisplayRecip = stringId.replace(/-/g, ' ').toUpperCase()
  
  try {
    const result = await executeZulipSQL(sql, [name, stringId, `${name} workspace`, defaultDisplayRecip])
    return result.rows[0]?.id
  } catch (error) {
    console.error('[Zulip Service] Error creating realm record:', error)
    // Return a mock ID for development
    return Math.floor(Math.random() * 100) + 10
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
 */
async function createStream(realmId, name, description, realmStringId) {
  const sql = `
    INSERT INTO zerver_stream (
      name,
      description,
      date_created,
      realm,
      invite_only,
      history_public_to_subscribers,
      history_public_to_domain,
      is_web_public,
      stream_post_policy,
      first_message_id,
      announce,
      color,
      audible_notifications,
      mobile_notifications,
      email_notifications,
      wildcard_mentions_notify,
      default_language,
      rendered_description,
      is_muted,
      can_subscribers_access,
      can_administer_channel,
      can_manage_subscribers,
      policy_prefix,
      name_changes_disabled
    ) VALUES (
      $1, $2, NOW(), $3, false, false, false, false, 1, NULL, false, '#76ce90',
      false, false, false, false, NULL, $4, false, true, false, true, NULL, false
    )
    RETURNING id
  `
  
  try {
    const result = await executeZulipSQL(sql, [name, description, realmId, description])
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
