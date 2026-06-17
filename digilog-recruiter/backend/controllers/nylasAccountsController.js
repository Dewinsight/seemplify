const prisma = require('../db/client');
const multiNylasService = require('../services/multiNylasService');

/**
 * GET /api/admin/nylas-accounts
 * List all Nylas accounts with usage statistics
 */
const listAccounts = async (req, res) => {
  try {
    console.log('📋 Admin listing Nylas accounts...');
    
    const accountsWithUsage = await multiNylasService.getAllAccountsWithUsage();
    const systemCapacity = await multiNylasService.getSystemCapacity();
    
    res.json({
      success: true,
      accounts: accountsWithUsage,
      totalCapacity: systemCapacity,
      message: `Found ${accountsWithUsage.length} account(s)`
    });
  } catch (error) {
    console.error('Error listing Nylas accounts:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to list accounts',
      details: error.message
    });
  }
};

/**
 * POST /api/admin/nylas-accounts
 * Create a new Nylas account
 */
const createAccount = async (req, res) => {
  try {
    const {
      name,
      clientId,
      apiKey,
      clientSecret,
      region,
      maxGrants,
      accountType,
      priority,
      notes
    } = req.body;
    
    console.log(`📝 Creating new Nylas account: ${name}`);
    
    // Validation
    if (!name || !clientId || !apiKey || !clientSecret) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
        required: ['name', 'clientId', 'apiKey', 'clientSecret']
      });
    }
    
    // Check if client ID already exists
    const existing = await prisma.nylasAccount.findFirst({ where: { clientId } });
    if (existing) {
      // If the existing record is inactive (stale soft-delete leftover), remove it
      // so the new account can be created cleanly
      if (!existing.active) {
        console.log(`🧹 Found inactive/stale account with same clientId. Removing stale record (ID: ${existing._id})...`);
        await prisma.nylasAccount.delete({ where: { id: existing.id } });
        console.log(`✅ Stale record removed. Proceeding with new account creation.`);
      } else {
        return res.status(409).json({
          success: false,
          error: 'Nylas account with this Client ID already exists'
        });
      }
    }
    
    // Create new account
    const account = await prisma.nylasAccount.create({ data: {
      name,
      clientId,
      apiKey,
      clientSecret,
      region: region || 'us',
      maxGrants: maxGrants || 5,
      accountType: accountType || 'sandbox',
      priority: priority || 0,
      notes,
      createdById: req.admin._id,
      verified: false // Will be set to true after successful test
    } });
    
    console.log(`✅ Nylas account created: ${account.name} (ID: ${account._id})`);
    
    res.status(201).json({
      success: true,
      account: {
        _id: account._id,
        name: account.name,
        clientId: account.clientId,
        region: account.region,
        maxGrants: account.maxGrants,
        verified: account.verified
      },
      message: 'Nylas account created successfully'
    });
  } catch (error) {
    console.error('Error creating Nylas account:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create account',
      details: error.message
    });
  }
};

/**
 * PUT /api/admin/nylas-accounts/:accountId
 * Update an existing Nylas account
 */
const updateAccount = async (req, res) => {
  try {
    const { accountId } = req.params;
    const updateData = req.body;
    
    console.log(`📝 Updating Nylas account: ${accountId}`);
    
    // Don't allow updating clientId (unique identifier)
    delete updateData.clientId;
    delete updateData._id;
    delete updateData.currentGrantCount; // Managed automatically
    
    // Handle empty credential fields - remove them to preserve existing values
    if (updateData.apiKey === '') {
      delete updateData.apiKey;
      console.log('Empty apiKey detected - preserving existing value');
    }
    
    if (updateData.clientSecret === '') {
      delete updateData.clientSecret;
      console.log('Empty clientSecret detected - preserving existing value');
    }
    
    // If updating credentials with new values, mark as unverified until tested
    if (updateData.apiKey || updateData.clientSecret) {
      updateData.verified = false;
    }
    
    const existingAccount = await prisma.nylasAccount.findUnique({ where: { id: accountId } });

    if (!existingAccount) {
      return res.status(404).json({
        success: false,
        error: 'Nylas account not found'
      });
    }

    const account = await prisma.nylasAccount.update({
      where: { id: accountId },
      data: updateData
    });
    
    console.log(`✅ Nylas account updated: ${account.name}`);
    
    res.json({
      success: true,
      account,
      message: 'Account updated successfully'
    });
  } catch (error) {
    console.error('Error updating Nylas account:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update account',
      details: error.message
    });
  }
};

/**
 * DELETE /api/admin/nylas-accounts/:accountId
 * Hard-delete a Nylas account from the database.
 * Previously this was a soft delete (active=false) which caused a bug where
 * re-adding the same clientId was blocked by the unique index + stale document.
 */
const deleteAccount = async (req, res) => {
  try {
    const { accountId } = req.params;
    
    console.log(`🗑️ Deleting Nylas account: ${accountId}`);
    
    // Check if any users are using this account (active grants)
    const activeUsersCount = await prisma.user.count({
      where: {
        nylasAccountId: accountId,
        calendarConnected: true,
        nylasGrantId: { not: null }
      }
    });

    if (activeUsersCount > 0) {
      return res.status(400).json({
        success: false,
        error: 'Cannot delete account with active grants',
        usersCount: activeUsersCount,
        message: `${activeUsersCount} user(s) are currently using this account. Please revoke their grants first.`
      });
    }
    
    // Hard delete - removes the document entirely so the clientId can be reused
    const account = await prisma.nylasAccount.findUnique({ where: { id: accountId } });

    if (!account) {
      return res.status(404).json({
        success: false,
        error: 'Nylas account not found'
      });
    }

    await prisma.nylasAccount.delete({ where: { id: accountId } });

    // Clear nylasAccountId references on any users that were linked to this account
    // (users who previously had grants but are no longer connected)
    await prisma.user.updateMany({
      where: { nylasAccountId: accountId, calendarConnected: false },
      data: { nylasAccountId: null }
    });
    
    console.log(`✅ Nylas account hard-deleted: ${account.name} (clientId: ${account.clientId})`);
    
    res.json({
      success: true,
      message: 'Account deleted successfully. The Client ID can now be reused.'
    });
  } catch (error) {
    console.error('Error deleting Nylas account:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete account',
      details: error.message
    });
  }
};

/**
 * POST /api/admin/nylas-accounts/:accountId/test
 * Test Nylas account credentials
 */
const testAccount = async (req, res) => {
  try {
    const { accountId } = req.params;
    
    console.log(`🧪 Testing Nylas account: ${accountId}`);
    
    const account = await prisma.nylasAccount.findUnique({ where: { id: accountId } });

    if (!account) {
      return res.status(404).json({
        success: false,
        error: 'Nylas account not found'
      });
    }
    
    const testResult = await multiNylasService.testCredentials({
      clientId: account.clientId,
      apiKey: account.apiKey,
      clientSecret: account.clientSecret,
      region: account.region
    });
    
    if (testResult.success) {
      // Mark account as verified
      account.verified = true;
      account.lastVerified = new Date();
      account.lastError = null;
      await prisma.nylasAccount.update({ where: { id: account.id }, data: { verified: true, lastVerified: account.lastVerified, lastError: null } });

      console.log(`✅ Account verified: ${account.name}`);
    } else {
      account.lastError = testResult.error || testResult.message;
      await prisma.nylasAccount.update({ where: { id: account.id }, data: { lastError: account.lastError } });

      console.error(`❌ Account verification failed: ${account.name}`);
    }
    
    res.json({
      success: testResult.success,
      message: testResult.message,
      verified: testResult.success,
      accountName: account.name
    });
  } catch (error) {
    console.error('Error testing Nylas account:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to test account',
      details: error.message
    });
  }
};

/**
 * POST /api/admin/nylas-accounts/test-credentials
 * Test credentials before saving (for new accounts)
 */
const testCredentialsOnly = async (req, res) => {
  try {
    const { clientId, apiKey, region } = req.body;
    
    console.log(`🧪 Testing credentials (pre-save)...`);
    
    if (!clientId || !apiKey) {
      return res.status(400).json({
        success: false,
        error: 'Client ID and API Key are required'
      });
    }
    
    const testResult = await multiNylasService.testCredentials({
      clientId,
      apiKey,
      region: region || 'us'
    });
    
    res.json(testResult);
  } catch (error) {
    console.error('Error testing credentials:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to test credentials',
      details: error.message
    });
  }
};

module.exports = {
  listAccounts,
  createAccount,
  updateAccount,
  deleteAccount,
  testAccount,
  testCredentialsOnly
};
