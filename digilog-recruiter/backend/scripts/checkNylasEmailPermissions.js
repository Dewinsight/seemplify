/**
 * Script to check which users have Nylas email permissions
 * Run with: node scripts/checkNylasEmailPermissions.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const User = require('../models/User');
const mongoose = require('mongoose');
const nylasEmailService = require('../services/nylasEmailService');

async function checkEmailPermissions() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');

    // Find all users with Nylas grants
    const usersWithGrants = await User.find({ 
      nylasGrantId: { $exists: true, $ne: null },
      calendarConnected: true 
    }).select('name email nylasGrantId');

    console.log(`\n🔍 Found ${usersWithGrants.length} users with Nylas calendar connections\n`);

    const results = {
      withEmailPermissions: [],
      needReconnection: [],
      errors: []
    };

    for (const user of usersWithGrants) {
      try {
        console.log(`📧 Checking ${user.name || user.email}...`);
        
        const permissions = await nylasEmailService.checkEmailPermissions(user.nylasGrantId);
        
        const userInfo = {
          name: user.name || user.email,
          email: user.email,
          grantId: user.nylasGrantId,
          hasEmailPermissions: permissions.canSendEmail,
          provider: permissions.provider,
          grantStatus: permissions.grantStatus
        };

        if (permissions.canSendEmail) {
          results.withEmailPermissions.push(userInfo);
          console.log(`  ✅ Has email permissions (${permissions.provider})`);
        } else {
          results.needReconnection.push(userInfo);
          console.log(`  ❌ Missing email permissions (${permissions.provider}) - needs reconnection`);
        }

      } catch (error) {
        console.log(`  ⚠️ Error checking permissions: ${error.message}`);
        results.errors.push({
          name: user.name || user.email,
          email: user.email,
          error: error.message
        });
      }
    }

    // Summary report
    console.log('\n📊 SUMMARY REPORT');
    console.log('================');
    console.log(`✅ Users with email permissions: ${results.withEmailPermissions.length}`);
    console.log(`❌ Users needing reconnection: ${results.needReconnection.length}`);
    console.log(`⚠️ Users with errors: ${results.errors.length}`);

    if (results.withEmailPermissions.length > 0) {
      console.log('\n✅ USERS WITH EMAIL PERMISSIONS:');
      results.withEmailPermissions.forEach(user => {
        console.log(`  - ${user.name} (${user.provider})`);
      });
    }

    if (results.needReconnection.length > 0) {
      console.log('\n❌ USERS NEEDING CALENDAR RECONNECTION:');
      results.needReconnection.forEach(user => {
        console.log(`  - ${user.name} (${user.provider}) - needs to disconnect & reconnect calendar`);
      });
    }

    if (results.errors.length > 0) {
      console.log('\n⚠️ USERS WITH PERMISSION CHECK ERRORS:');
      results.errors.forEach(user => {
        console.log(`  - ${user.name}: ${user.error}`);
      });
    }

    console.log('\n🔧 RECOMMENDATIONS:');
    if (results.needReconnection.length > 0) {
      console.log('1. Have users go to Calendar page in Smart HR');
      console.log('2. Click "Disconnect Calendar"');
      console.log('3. Click "Connect Calendar" again');
      console.log('4. Grant email permissions when prompted by Google/Microsoft');
    }
    
    console.log('\n💡 TEMPORARY SOLUTION:');
    console.log('Set USE_NYLAS_FOR_INTERVIEW_EMAILS=false in .env to use Brevo for all users');

  } catch (error) {
    console.error('❌ Script error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n✅ Disconnected from MongoDB');
  }
}

checkEmailPermissions();
