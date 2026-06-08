require('dotenv').config();
const mongoose = require('mongoose');
const NylasAccount = require('../models/NylasAccount');
const User = require('../models/User');

/**
 * Migration Script: Move from single .env Nylas account to multi-account system
 * 
 * This script:
 * 1. Creates a default Nylas account from .env variables
 * 2. Links all existing grants to this default account
 * 3. Updates grant counts
 */

async function migrate() {
  try {
    console.log('\n🔄 === NYLAS MULTI-ACCOUNT MIGRATION ===');
    console.log('==========================================\n');
    
    // Connect to database
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');
    
    // Step 1: Check if migration already done
    const existingAccounts = await NylasAccount.countDocuments();
    if (existingAccounts > 0) {
      console.log(`⚠️ Found ${existingAccounts} existing Nylas account(s)`);
      const proceed = process.argv[2] === '--force';
      if (!proceed) {
        console.log('❌ Migration already completed. Use --force to run anyway.');
        process.exit(0);
      }
      console.log('⚡ Running migration anyway (--force flag)');
    }
    
    // Step 2: Get credentials from .env
    const envClientId = process.env.NYLAS_CLIENT_ID;
    const envApiKey = process.env.NYLAS_API_KEY;
    const envClientSecret = process.env.NYLAS_CLIENT_SECRET;
    const envRegion = process.env.NYLAS_REGION || 'us';
    // redirectUri is managed by app.config.json, get it from configLoader
    const configLoader = require('../config/configLoader');
    const envRedirectUri = configLoader.getCallbackUrl();
    
    if (!envClientId || !envApiKey || !envClientSecret) {
      console.error('❌ Missing Nylas credentials in .env file!');
      console.error('   Required: NYLAS_CLIENT_ID, NYLAS_API_KEY, NYLAS_CLIENT_SECRET');
      process.exit(1);
    }
    
    console.log('\n📋 .env Credentials Found:');
    console.log(`   Client ID: ${envClientId.substring(0, 20)}...`);
    console.log(`   API Key: ${envApiKey.substring(0, 20)}...`);
    console.log(`   Region: ${envRegion}`);
    console.log('');
    
    // Step 3: Create or update default account
    let defaultAccount = await NylasAccount.findOne({ clientId: envClientId });
    
    if (defaultAccount) {
      console.log(`📝 Updating existing account: ${defaultAccount.name}`);
      defaultAccount.apiKey = envApiKey;
      defaultAccount.clientSecret = envClientSecret;
      defaultAccount.region = envRegion;
      defaultAccount.redirectUri = envRedirectUri;
      defaultAccount.isDefault = true;
      await defaultAccount.save();
    } else {
      console.log('📝 Creating default Nylas account from .env...');
      defaultAccount = await NylasAccount.create({
        name: 'Default Account (Migrated from .env)',
        clientId: envClientId,
        apiKey: envApiKey,
        clientSecret: envClientSecret,
        region: envRegion,
        redirectUri: envRedirectUri,
        maxGrants: 5, // Default Nylas free tier limit
        accountType: 'production',
        priority: 100, // Highest priority (use this first)
        active: true,
        verified: true, // Assume it's working if app was working
        isDefault: true,
        notes: 'Auto-migrated from environment variables'
      });
      console.log(`✅ Default account created: ${defaultAccount._id}`);
    }
    
    // Step 4: Link all existing users with grants to this account
    console.log('\n🔗 Linking existing user grants to default account...');
    
    const usersWithGrants = await User.find({
      nylasGrantId: { $exists: true, $ne: null },
      calendarConnected: true
    });
    
    console.log(`   Found ${usersWithGrants.length} user(s) with active grants`);
    
    let linkedCount = 0;
    for (const user of usersWithGrants) {
      if (!user.nylasAccountId) {
        user.nylasAccountId = defaultAccount._id;
        await user.save();
        linkedCount++;
      }
    }
    
    console.log(`   Linked ${linkedCount} user(s) to default account`);
    
    // Step 5: Update grant count for default account
    defaultAccount.currentGrantCount = usersWithGrants.length;
    await defaultAccount.save();
    
    console.log(`   Updated grant count: ${usersWithGrants.length}/${defaultAccount.maxGrants}`);
    
    // Step 6: Summary
    console.log('\n✅ === MIGRATION COMPLETE ===');
    console.log(`   Default Account ID: ${defaultAccount._id}`);
    console.log(`   Account Name: ${defaultAccount.name}`);
    console.log(`   Current Grants: ${defaultAccount.currentGrantCount}/${defaultAccount.maxGrants}`);
    console.log(`   Users Migrated: ${linkedCount}`);
    console.log('\n📝 Next Steps:');
    console.log('   1. Test the default account in admin panel');
    console.log('   2. Add additional Nylas accounts as needed');
    console.log('   3. Total capacity = Sum of all accounts\' maxGrants');
    console.log('\n✨ You can now add more Nylas accounts via admin UI!');
    console.log('=====================================\n');
    
  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('✅ Disconnected from MongoDB\n');
  }
}

migrate();
