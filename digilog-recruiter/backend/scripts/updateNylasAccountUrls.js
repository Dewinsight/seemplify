#!/usr/bin/env node

/**
 * Update NylasAccount redirectUri values to production URL
 * 
 * This script updates all NylasAccount records in the database to use the correct
 * production callback URL. Run this after deploying the fix that removes database
 * redirectUri override.
 * 
 * Usage:
 *   node backend/scripts/updateNylasAccountUrls.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const configLoader = require('../config/configLoader');

// Import models
const NylasAccount = require('../models/NylasAccount');

async function updateNylasAccountUrls() {
  try {
    console.log('=== Nylas Account URL Update Script ===\n');
    
    // Connect to MongoDB
    console.log('📡 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB\n');
    
    // Get current environment info
    const environment = configLoader.getEnvironment();
    const callbackUrl = configLoader.getCallbackUrl();
    
    console.log('📋 Environment Information:');
    console.log(`   NODE_ENV: ${process.env.NODE_ENV || 'not set'}`);
    console.log(`   Detected Environment: ${environment}`);
    console.log(`   Callback URL: ${callbackUrl}\n`);
    
    // Get all Nylas accounts
    console.log('🔍 Finding all Nylas accounts...');
    const accounts = await NylasAccount.find({});
    
    if (accounts.length === 0) {
      console.log('⚠️  No Nylas accounts found in database');
      await mongoose.connection.close();
      return;
    }
    
    console.log(`   Found ${accounts.length} account(s)\n`);
    
    // Display current values
    console.log('📊 Current redirectUri values:');
    accounts.forEach(account => {
      console.log(`   ${account.name}: ${account.redirectUri || 'not set'}`);
    });
    console.log('');
    
    // Ask for confirmation
    console.log(`🔄 This script will update all accounts to: ${callbackUrl}`);
    console.log('   Note: After code changes, this field is no longer used in OAuth flow.');
    console.log('   This update is for database consistency only.\n');
    
    // Update all accounts
    let updatedCount = 0;
    let unchangedCount = 0;
    
    for (const account of accounts) {
      if (account.redirectUri !== callbackUrl) {
        const oldUrl = account.redirectUri;
        account.redirectUri = callbackUrl;
        await account.save();
        console.log(`✅ Updated: ${account.name}`);
        console.log(`   Old: ${oldUrl}`);
        console.log(`   New: ${callbackUrl}\n`);
        updatedCount++;
      } else {
        console.log(`⏭️  Skipped: ${account.name} (already correct)\n`);
        unchangedCount++;
      }
    }
    
    // Summary
    console.log('=== Update Summary ===');
    console.log(`✅ Updated: ${updatedCount} account(s)`);
    console.log(`⏭️  Unchanged: ${unchangedCount} account(s)`);
    console.log(`📊 Total: ${accounts.length} account(s)\n`);
    
    // Important note
    console.log('📝 Important Note:');
    console.log('   The redirectUri field in NylasAccount is now deprecated.');
    console.log('   The OAuth flow always uses configLoader.getCallbackUrl() for the callback URL.');
    console.log('   This ensures the correct URL based on NODE_ENV (development vs production).\n');
    
    // Close connection
    await mongoose.connection.close();
    console.log('✅ Database connection closed');
    console.log('✅ Script completed successfully!');
    
  } catch (error) {
    console.error('❌ Error updating Nylas account URLs:', error);
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
    }
    process.exit(1);
  }
}

// Run the script
updateNylasAccountUrls();

