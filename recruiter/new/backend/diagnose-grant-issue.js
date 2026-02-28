/**
 * Diagnostic script to troubleshoot "No Grant found" error
 * Usage: node diagnose-grant-issue.js <userEmail>
 */

const mongoose = require('mongoose');
const User = require('./models/User');
const NylasAccount = require('./models/NylasAccount');
const nylasV3Service = require('./services/nylasV3Service');
require('dotenv').config();

async function diagnoseGrantIssue(userEmail) {
  try {
    console.log('🔍 Diagnosing Grant Issue for:', userEmail);
    console.log('='.repeat(60));
    
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB\n');
    
    // Find the user
    const user = await User.findOne({ email: userEmail });
    
    if (!user) {
      console.error('❌ User not found:', userEmail);
      process.exit(1);
    }
    
    console.log('📋 User Information:');
    console.log(`   Name: ${user.firstName} ${user.lastName}`);
    console.log(`   Email: ${user.email}`);
    console.log(`   Calendar Connected: ${user.calendarConnected}`);
    console.log(`   Grant ID: ${user.nylasGrantId || 'NOT SET'}`);
    console.log(`   Nylas Account ID: ${user.nylasAccountId || 'NOT SET'}`);
    console.log(`   Grant Status: ${user.nylasGrantStatus || 'unknown'}\n`);
    
    if (!user.nylasGrantId) {
      console.error('❌ User has no Grant ID set. Calendar not connected.');
      process.exit(1);
    }
    
    // Check which Nylas account the user is linked to
    if (user.nylasAccountId) {
      console.log('📋 Linked Nylas Account:');
      const nylasAccount = await NylasAccount.findById(user.nylasAccountId).select('+apiKey');
      
      if (nylasAccount) {
        console.log(`   Account Name: ${nylasAccount.name}`);
        console.log(`   Client ID: ${nylasAccount.clientId}`);
        console.log(`   Region: ${nylasAccount.region}`);
        console.log(`   Max Grants: ${nylasAccount.maxGrants}`);
        console.log(`   Active: ${nylasAccount.active}`);
        console.log(`   Verified: ${nylasAccount.verified}\n`);
        
        // Verify grant with custom account credentials
        console.log('🧪 Testing Grant with Custom Nylas Account...');
        const accountCredentials = {
          apiKey: nylasAccount.apiKey,
          region: nylasAccount.region,
          clientId: nylasAccount.clientId
        };
        
        const verification = await nylasV3Service.verifyGrantStatus(user.nylasGrantId, accountCredentials);
        console.log('Result:', JSON.stringify(verification, null, 2));
        
        if (verification.valid) {
          console.log('\n✅ Grant is VALID in custom account!');
        } else {
          console.log('\n❌ Grant is INVALID in custom account!');
          console.log('Message:', verification.message);
        }
      } else {
        console.error('❌ Linked Nylas Account not found in database!');
      }
    } else {
      console.log('⚠️  User is NOT linked to a specific Nylas account');
      console.log('   Will use default/system account credentials\n');
      
      // Try verifying with default account
      console.log('🧪 Testing Grant with Default/System Account...');
      const verification = await nylasV3Service.verifyGrantStatus(user.nylasGrantId);
      console.log('Result:', JSON.stringify(verification, null, 2));
      
      if (verification.valid) {
        console.log('\n✅ Grant is VALID in default account!');
      } else {
        console.log('\n❌ Grant is INVALID in default account!');
        console.log('Message:', verification.message);
        
        // Now try all Nylas accounts to see if grant exists elsewhere
        console.log('\n🔍 Searching all Nylas accounts for this grant...');
        const allAccounts = await NylasAccount.find({ active: true }).select('+apiKey');
        
        for (const account of allAccounts) {
          console.log(`\n   Testing ${account.name}...`);
          const testCreds = {
            apiKey: account.apiKey,
            region: account.region,
            clientId: account.clientId
          };
          
          const testResult = await nylasV3Service.verifyGrantStatus(user.nylasGrantId, testCreds);
          if (testResult.valid) {
            console.log(`   ✅ FOUND! Grant exists in: ${account.name}`);
            console.log(`   Account ID: ${account._id}`);
            console.log('\n💡 SOLUTION: Update user.nylasAccountId to:', account._id);
            
            // Offer to fix it
            console.log('\n🔧 Would you like to fix this automatically? (yes/no)');
            const readline = require('readline').createInterface({
              input: process.stdin,
              output: process.stdout
            });
            
            readline.question('> ', async (answer) => {
              if (answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y') {
                user.nylasAccountId = account._id;
                await user.save();
                console.log('✅ Fixed! User.nylasAccountId updated to:', account._id);
              } else {
                console.log('Skipped fix.');
              }
              readline.close();
              process.exit(0);
            });
            
            return; // Exit the loop
          } else {
            console.log(`   ❌ Not in ${account.name}`);
          }
        }
        
        console.log('\n❌ Grant not found in any Nylas account!');
        console.log('💡 User needs to reconnect their calendar.');
      }
    }
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    if (mongoose.connection.readyState === 1) {
      await mongoose.disconnect();
    }
  }
}

// Get email from command line args
const userEmail = process.argv[2];

if (!userEmail) {
  console.error('Usage: node diagnose-grant-issue.js <userEmail>');
  process.exit(1);
}

diagnoseGrantIssue(userEmail);
