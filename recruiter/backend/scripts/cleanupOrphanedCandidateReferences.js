const mongoose = require('mongoose');
const { cleanupAllJobCandidateReferences } = require('../utils/candidateCleanupUtils');

// Configuration
const DRY_RUN = process.env.DRY_RUN === 'true';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/smarthr';

async function main() {
  try {
    // Connect to MongoDB
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Run cleanup
    const stats = await cleanupAllJobCandidateReferences(DRY_RUN);
    
    if (DRY_RUN) {
      console.log('\n🔍 DRY RUN COMPLETED - No changes were made to the database');
      console.log('To actually clean up the database, run this script with DRY_RUN=false');
    } else {
      console.log('\n✅ DATABASE CLEANUP COMPLETED');
    }

    // Show detailed results if there were issues
    if (stats.jobsWithIssues > 0) {
      console.log('\n📊 Detailed Results:');
      stats.jobsProcessed.forEach(job => {
        console.log(`  • Job: ${job.title} (${job.jobId})`);
        if (job.shortlistCleaned > 0) {
          console.log(`    - Shortlist: ${job.shortlistBefore} → ${job.shortlistAfter} (cleaned ${job.shortlistCleaned})`);
        }
        if (job.applicantsCleaned > 0) {
          console.log(`    - Applicants: ${job.applicantsBefore} → ${job.applicantsAfter} (cleaned ${job.applicantsCleaned})`);
        }
      });
    }

    console.log('\n🎉 Script completed successfully!');
  } catch (error) {
    console.error('❌ Error running cleanup script:', error);
    process.exit(1);
  } finally {
    // Disconnect from MongoDB
    await mongoose.disconnect();
    console.log('📤 Disconnected from MongoDB');
  }
}

// Show usage information
console.log('🧹 Orphaned Candidate References Cleanup Script');
console.log('===============================================');
console.log('');
console.log('This script will clean up orphaned candidate references from job shortlists and applicants.');
console.log('These references occur when candidates are deleted but their references remain in jobs.');
console.log('');
console.log('Usage:');
console.log('  node cleanupOrphanedCandidateReferences.js                    # Dry run (no changes)');
console.log('  DRY_RUN=false node cleanupOrphanedCandidateReferences.js     # Actually clean up database');
console.log('');
console.log(`Current mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE CLEANUP'}`);
console.log('');

// Run the script
main(); 