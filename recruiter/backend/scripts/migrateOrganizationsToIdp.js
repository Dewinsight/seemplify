/**
 * Migration Script: Link Existing Organizations to Identity Provider
 *
 * This script migrates existing SmartHR organizations to the Identity Provider (IdP).
 * For each organization without an idpOrganizationId:
 * 1. Checks if a corresponding IdP organization exists (by name)
 * 2. If exists: Links the organizations
 * 3. If not: Creates the organization in IdP and links
 *
 * Usage:
 *   node scripts/migrateOrganizationsToIdp.js
 *   node scripts/migrateOrganizationsToIdp.js --dry-run   # Preview without changes
 *   node scripts/migrateOrganizationsToIdp.js --force     # Force re-link all orgs
 */

const mongoose = require('mongoose');
const dotenv = require('dotenv');
const axios = require('axios');
const Organization = require('../models/Organization');
const User = require('../models/User');

// Load environment variables
dotenv.config();

// Configuration
const IDP_BASE_URL = process.env.OIDC_ISSUER || process.env.IDP_URL || 'http://localhost:4000';
const IDP_API_KEY = process.env.IDP_API_KEY;
const DRY_RUN = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force');

// Migration statistics
const stats = {
  total: 0,
  alreadyLinked: 0,
  linkedExisting: 0,
  createdNew: 0,
  failed: 0,
  skipped: 0
};

// Audit log
const auditLog = [];

function log(message, level = 'info') {
  const timestamp = new Date().toISOString();
  const prefix = {
    info: 'ℹ️',
    success: '✅',
    warning: '⚠️',
    error: '❌',
    debug: '🔍'
  }[level] || 'ℹ️';

  console.log(`${prefix} [${timestamp}] ${message}`);
  auditLog.push({ timestamp, level, message });
}

async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/smarthr', {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    log('MongoDB connected for migration', 'success');
  } catch (error) {
    log(`MongoDB connection error: ${error.message}`, 'error');
    process.exit(1);
  }
}

/**
 * Create an axios client for IdP API calls
 */
function createIdpClient() {
  const headers = {
    'Content-Type': 'application/json'
  };

  if (IDP_API_KEY) {
    headers['X-API-Key'] = IDP_API_KEY;
  }

  return axios.create({
    baseURL: IDP_BASE_URL,
    headers,
    timeout: 10000
  });
}

/**
 * Search for an existing IdP organization by name
 */
async function findIdpOrganizationByName(client, name) {
  try {
    const response = await client.get('/api/organizations', {
      params: { name }
    });

    if (response.data && response.data.organizations) {
      // Find exact match
      return response.data.organizations.find(
        org => org.name.toLowerCase() === name.toLowerCase()
      );
    }
    return null;
  } catch (error) {
    if (error.response?.status === 404) {
      return null;
    }
    throw error;
  }
}

/**
 * Create a new organization in IdP
 */
async function createIdpOrganization(client, orgData) {
  try {
    const response = await client.post('/api/organizations', {
      name: orgData.name,
      description: orgData.description || `Migrated from SmartHR on ${new Date().toISOString()}`
    });
    return response.data;
  } catch (error) {
    log(`Failed to create IdP organization "${orgData.name}": ${error.message}`, 'error');
    throw error;
  }
}

/**
 * Link a SmartHR organization to an IdP organization
 */
async function linkOrganization(org, idpOrgId) {
  if (DRY_RUN) {
    log(`[DRY-RUN] Would link SmartHR org "${org.name}" to IdP org ${idpOrgId}`, 'debug');
    return true;
  }

  org.idpOrganizationId = idpOrgId;
  await org.save();
  log(`Linked SmartHR org "${org.name}" (${org._id}) to IdP org ${idpOrgId}`, 'success');
  return true;
}

/**
 * Process a single organization
 */
async function processOrganization(client, org) {
  log(`Processing organization: "${org.name}" (${org._id})`);

  // Check if already linked
  if (org.idpOrganizationId && !FORCE) {
    log(`Organization already linked to IdP: ${org.idpOrganizationId}`, 'info');
    stats.alreadyLinked++;
    return;
  }

  try {
    // Try to find existing IdP organization by name
    const existingIdpOrg = await findIdpOrganizationByName(client, org.name);

    if (existingIdpOrg) {
      log(`Found existing IdP organization: ${existingIdpOrg._id || existingIdpOrg.id}`, 'info');
      await linkOrganization(org, existingIdpOrg._id || existingIdpOrg.id);
      stats.linkedExisting++;
    } else {
      // Create new IdP organization
      log(`Creating new IdP organization for "${org.name}"`, 'info');
      const newIdpOrg = await createIdpOrganization(client, org);
      await linkOrganization(org, newIdpOrg._id || newIdpOrg.id);
      stats.createdNew++;
    }
  } catch (error) {
    log(`Failed to process organization "${org.name}": ${error.message}`, 'error');
    stats.failed++;
  }
}

/**
 * Main migration function
 */
async function migrateOrganizationsToIdp() {
  log('Starting organization migration to Identity Provider...');

  if (DRY_RUN) {
    log('Running in DRY-RUN mode - no changes will be made', 'warning');
  }

  if (FORCE) {
    log('Running in FORCE mode - will re-link all organizations', 'warning');
  }

  // Check IdP connectivity
  const client = createIdpClient();
  try {
    await client.get('/health');
    log('IdP health check passed', 'success');
  } catch (error) {
    log(`IdP health check failed: ${error.message}`, 'error');
    log('Please ensure the Identity Provider is running and accessible', 'error');
    process.exit(1);
  }

  // Find organizations to migrate
  const query = FORCE
    ? {}
    : { $or: [{ idpOrganizationId: { $exists: false } }, { idpOrganizationId: null }] };

  const organizations = await Organization.find(query)
    .populate('owner', 'email profile.firstName profile.lastName');

  stats.total = organizations.length;
  log(`Found ${organizations.length} organizations to process`);

  if (organizations.length === 0) {
    log('No organizations need migration', 'success');
    return;
  }

  // Process each organization
  for (const org of organizations) {
    await processOrganization(client, org);
  }

  // Print summary
  log('');
  log('═══════════════════════════════════════════════');
  log('MIGRATION SUMMARY');
  log('═══════════════════════════════════════════════');
  log(`Total organizations processed: ${stats.total}`);
  log(`Already linked (skipped): ${stats.alreadyLinked}`);
  log(`Linked to existing IdP org: ${stats.linkedExisting}`);
  log(`Created new IdP org: ${stats.createdNew}`);
  log(`Failed: ${stats.failed}`);
  log('═══════════════════════════════════════════════');

  if (stats.failed > 0) {
    log('Some organizations failed to migrate. Check the logs above for details.', 'warning');
  } else {
    log('Migration completed successfully!', 'success');
  }
}

/**
 * Verify migration status
 */
async function verifyMigration() {
  log('');
  log('Verifying migration status...');

  const unlinkedCount = await Organization.countDocuments({
    $or: [{ idpOrganizationId: { $exists: false } }, { idpOrganizationId: null }]
  });

  const linkedCount = await Organization.countDocuments({
    idpOrganizationId: { $exists: true, $ne: null }
  });

  log(`Organizations linked to IdP: ${linkedCount}`);
  log(`Organizations NOT linked to IdP: ${unlinkedCount}`);

  if (unlinkedCount === 0) {
    log('All organizations are linked to the Identity Provider!', 'success');
  } else {
    log(`${unlinkedCount} organization(s) still need to be linked to IdP`, 'warning');
  }
}

/**
 * Save audit log to file
 */
function saveAuditLog() {
  const fs = require('fs');
  const logFileName = `idp-migration-${new Date().toISOString().replace(/[:.]/g, '-')}.log`;
  const logPath = `./logs/${logFileName}`;

  try {
    // Create logs directory if it doesn't exist
    if (!fs.existsSync('./logs')) {
      fs.mkdirSync('./logs', { recursive: true });
    }

    const logContent = auditLog.map(entry =>
      `[${entry.timestamp}] [${entry.level.toUpperCase()}] ${entry.message}`
    ).join('\n');

    fs.writeFileSync(logPath, logContent);
    log(`Audit log saved to: ${logPath}`, 'info');
  } catch (error) {
    log(`Failed to save audit log: ${error.message}`, 'warning');
  }
}

async function main() {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║  SmartHR Organization to Identity Provider Migration Script   ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝');
  console.log('');

  await connectDB();
  await migrateOrganizationsToIdp();
  await verifyMigration();
  saveAuditLog();

  log('Closing database connection...');
  await mongoose.connection.close();

  process.exit(stats.failed > 0 ? 1 : 0);
}

// Run migration if called directly
if (require.main === module) {
  main().catch(error => {
    log(`Migration failed: ${error.message}`, 'error');
    console.error(error);
    process.exit(1);
  });
}

module.exports = { migrateOrganizationsToIdp, verifyMigration };
