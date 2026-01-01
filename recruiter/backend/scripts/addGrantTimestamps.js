/**
 * Migration Script: Add grantConnectedAt timestamps to existing grants
 * 
 * This script adds timestamps to all existing calendar grants in the database.
 * For users who already have grants, we estimate the connection time using
 * lastGrantRefresh or default to current time minus 30 days.
 * 
 * Run with: node backend/scripts/addGrantTimestamps.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

async function addGrantTimestamps() {
  try {
    console.log('🔄 Starting grant timestamp migration...\n');
    
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');
    
    // Find all users with grants but no timestamp
    const usersWithGrants = await User.find({
      nylasGrantId: { $exists: true, $ne: null },
      grantConnectedAt: { $exists: false }
    });
    
    console.log(`📊 Found ${usersWithGrants.length} grants without timestamps\n`);
    
    if (usersWithGrants.length === 0) {
      console.log('✅ All grants already have timestamps!');
      process.exit(0);
    }
    
    let updated = 0;
    let errors = 0;
    
    for (const user of usersWithGrants) {
      try {
        // Estimate connection time:
        // 1. Use lastGrantRefresh if available
        // 2. Use user createdAt if available
        // 3. Default to 30 days ago
        let estimatedTime;
        
        if (user.lastGrantRefresh) {
          estimatedTime = user.lastGrantRefresh;
          console.log(`  ${user.email}: Using lastGrantRefresh (${estimatedTime.toISOString()})`);
        } else if (user.createdAt) {
          // Assume grant was connected around account creation
          estimatedTime = new Date(user.createdAt.getTime() + (7 * 24 * 60 * 60 * 1000)); // 7 days after account creation
          console.log(`  ${user.email}: Estimating from createdAt + 7 days (${estimatedTime.toISOString()})`);
        } else {
          // Default to 30 days ago
          estimatedTime = new Date(Date.now() - (30 * 24 * 60 * 60 * 1000));
          console.log(`  ${user.email}: Using default 30 days ago (${estimatedTime.toISOString()})`);
        }
        
        user.grantConnectedAt = estimatedTime;
        await user.save();
        updated++;
        
      } catch (error) {
        console.error(`  ❌ Error updating ${user.email}:`, error.message);
        errors++;
      }
    }
    
    console.log('\n📈 Migration Summary:');
    console.log(`   ✅ Successfully updated: ${updated}`);
    console.log(`   ❌ Errors: ${errors}`);
    console.log(`   📊 Total processed: ${usersWithGrants.length}`);
    
    console.log('\n✅ Migration complete!');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('\n👋 Disconnected from MongoDB');
  }
}

// Run migration
addGrantTimestamps();
