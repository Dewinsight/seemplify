/**
 * Profile Completion Recalculation Script
 * 
 * This script recalculates profile completion percentages for all users
 * using the updated 6-field calculation system (down from 11 fields).
 * 
 * Context:
 * - Old system: 11 fields (4 profile + 2 optional + 5 company fields)
 * - New system: 6 fields (4 profile + 2 optional, company fields removed)
 * - Issue: Users with old calculations show incorrect percentages (e.g., 91%)
 * 
 * Usage:
 *   cd backend
 *   node scripts/recalculate_profile_completion.js
 * 
 * Created: October 3, 2025
 * Related: docs/PROFILE_COMPLETION_91_PERCENT_ISSUE.md
 */

const mongoose = require('mongoose');
const User = require('../models/User');
require('dotenv').config();

// Color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

async function recalculateAllProfiles() {
  console.log('\n' + '='.repeat(60));
  log('Profile Completion Recalculation Script', colors.bright + colors.cyan);
  console.log('='.repeat(60) + '\n');

  try {
    // Connect to MongoDB
    log('📡 Connecting to MongoDB...', colors.blue);
    await mongoose.connect(process.env.MONGO_URI);
    log('✅ Connected to MongoDB\n', colors.green);

    // Find all users
    log('🔍 Fetching users from database...', colors.blue);
    const users = await User.find({});
    log(`✅ Found ${users.length} users to process\n`, colors.green);

    // Statistics
    let updated = 0;
    let unchanged = 0;
    let errors = 0;
    const changes = [];

    // Progress bar setup
    const progressBar = {
      total: users.length,
      current: 0,
      width: 40,
      
      update() {
        this.current++;
        const percentage = Math.round((this.current / this.total) * 100);
        const filled = Math.round((this.current / this.total) * this.width);
        const empty = this.width - filled;
        const bar = '█'.repeat(filled) + '░'.repeat(empty);
        process.stdout.write(`\r${colors.cyan}Progress: [${bar}] ${percentage}% (${this.current}/${this.total})${colors.reset}`);
      },
      
      finish() {
        console.log('\n');
      }
    };

    log('🔄 Recalculating profile completion percentages...\n', colors.blue);

    // Process each user
    for (const user of users) {
      try {
        const oldPercentage = user.profileCompletion?.percentage || 0;
        const oldMissingFields = [...(user.profileCompletion?.missingFields || [])];
        
        // Trigger recalculation by saving (pre-save middleware calls calculateProfileCompletion)
        await user.save();
        
        const newPercentage = user.profileCompletion?.percentage || 0;
        const newMissingFields = user.profileCompletion?.missingFields || [];
        
        // Track changes
        if (oldPercentage !== newPercentage) {
          updated++;
          changes.push({
            email: user.email,
            name: `${user.profile?.firstName || ''} ${user.profile?.lastName || ''}`.trim() || 'N/A',
            oldPercentage,
            newPercentage,
            oldMissingFields,
            newMissingFields,
          });
        } else {
          unchanged++;
        }
        
        progressBar.update();
      } catch (error) {
        errors++;
        log(`\n❌ Error processing user ${user.email}: ${error.message}`, colors.red);
        progressBar.update();
      }
    }

    progressBar.finish();

    // Display results
    console.log('\n' + '='.repeat(60));
    log('Results Summary', colors.bright + colors.cyan);
    console.log('='.repeat(60) + '\n');

    log(`📊 Total users processed: ${users.length}`, colors.blue);
    log(`✅ Updated: ${updated}`, updated > 0 ? colors.green : colors.reset);
    log(`➖ Unchanged: ${unchanged}`, colors.yellow);
    log(`❌ Errors: ${errors}`, errors > 0 ? colors.red : colors.reset);

    // Display detailed changes
    if (changes.length > 0) {
      console.log('\n' + '='.repeat(60));
      log('Detailed Changes', colors.bright + colors.cyan);
      console.log('='.repeat(60) + '\n');

      changes.forEach((change, index) => {
        const arrow = change.newPercentage > change.oldPercentage ? '📈' : '📉';
        const color = change.newPercentage > change.oldPercentage ? colors.green : colors.red;
        
        console.log(`${index + 1}. ${change.email} (${change.name})`);
        log(`   ${arrow} ${change.oldPercentage}% → ${change.newPercentage}%`, color);
        
        if (change.oldMissingFields.length > 0) {
          console.log(`   Old missing: ${change.oldMissingFields.join(', ')}`);
        }
        if (change.newMissingFields.length > 0) {
          console.log(`   New missing: ${change.newMissingFields.join(', ')}`);
        } else if (change.newPercentage === 100) {
          log(`   ✨ Profile now 100% complete!`, colors.green);
        }
        console.log('');
      });
    }

    // Recommendations
    if (updated > 0) {
      console.log('='.repeat(60));
      log('Recommendations', colors.bright + colors.yellow);
      console.log('='.repeat(60) + '\n');
      log('✅ Profile completion percentages have been recalculated', colors.green);
      log('📧 Consider notifying users whose profiles became 100% complete', colors.blue);
      log('📊 Update dashboard analytics to reflect new completion rates', colors.blue);
      console.log('');
    }

    // Disconnect
    await mongoose.disconnect();
    log('✅ Disconnected from MongoDB\n', colors.green);

    console.log('='.repeat(60));
    log('Script completed successfully! 🎉', colors.bright + colors.green);
    console.log('='.repeat(60) + '\n');

    process.exit(0);
  } catch (error) {
    log('\n❌ Fatal Error:', colors.bright + colors.red);
    console.error(error);
    
    try {
      await mongoose.disconnect();
      log('✅ Disconnected from MongoDB', colors.green);
    } catch (disconnectError) {
      log('❌ Failed to disconnect from MongoDB', colors.red);
    }
    
    process.exit(1);
  }
}

// Run the script
recalculateAllProfiles();

