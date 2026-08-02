const mongoose = require('mongoose');
require('dotenv').config();

/**
 * Database Cleanup Script for Fake/Hallucinated Candidate Profiles
 * 
 * This script identifies and optionally removes candidate profiles that were
 * created due to CV parsing hallucinations (fake data generation).
 * 
 * Usage:
 *   node backend/scripts/cleanup-fake-candidates.js           # Dry run (list only)
 *   node backend/scripts/cleanup-fake-candidates.js --delete  # Actually delete
 */

async function cleanupFakeCandidates() {
  try {
    console.log('🔍 Connecting to MongoDB...\n');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to database\n');
    
    // Import Candidate model
    const Candidate = require('../models/Candidate');
    
    console.log('='.repeat(70));
    console.log('🔍 SEARCHING FOR POTENTIALLY FAKE/HALLUCINATED CANDIDATES');
    console.log('='.repeat(70));
    console.log('\nCriteria:');
    console.log('• firstName/lastName contains placeholder values');
    console.log('• Email matches temp/placeholder patterns');
    console.log('• Resume text is empty or < 50 characters');
    console.log('• Obvious parsing failure indicators\n');
    
    // Find suspicious candidates
    const suspiciousCandidates = await Candidate.find({
      $or: [
        // Placeholder names from fallback values
        { firstName: { $in: ['Pending', 'PARSING_FAILED', 'N/A', 'Review'] } },
        { lastName: { $in: ['Review', 'REVIEW_REQUIRED', 'N/A', 'Pending'] } },
        
        // Placeholder emails
        { email: { $regex: /candidate-\d+@temp\.com|failed-parse.*@placeholder\.com/ } },
        
        // Very short or empty resume text (indicates parsing failure)
        { 
          $and: [
            { resumeText: { $exists: true } },
            { $expr: { $lt: [{ $strLenCP: '$resumeText' }, 50] } }
          ]
        },
        
        // Processing metadata indicates failure
        { 'processingMetadata.parseSuccess': false },
        { 'processingMetadata.hasMinimalInfo': false }
      ]
    }).select('firstName lastName email resumeText status createdAt processingMetadata');
    
    console.log(`\n📊 Found ${suspiciousCandidates.length} suspicious candidate(s):\n`);
    
    if (suspiciousCandidates.length === 0) {
      console.log('✅ No fake candidates found! Database is clean.\n');
      await mongoose.disconnect();
      return;
    }
    
    // Display details
    suspiciousCandidates.forEach((candidate, index) => {
      console.log(`${index + 1}. ${candidate.firstName} ${candidate.lastName}`);
      console.log(`   Email: ${candidate.email}`);
      console.log(`   Status: ${candidate.status}`);
      console.log(`   Created: ${candidate.createdAt}`);
      console.log(`   Resume Text Length: ${candidate.resumeText?.length || 0} chars`);
      
      if (candidate.processingMetadata) {
        console.log(`   Parse Success: ${candidate.processingMetadata.parseSuccess || false}`);
        console.log(`   AI Success: ${candidate.processingMetadata.aiSuccess || false}`);
        console.log(`   Has Minimal Info: ${candidate.processingMetadata.hasMinimalInfo || false}`);
      }
      
      // Determine why it's suspicious
      const reasons = [];
      if (['Pending', 'PARSING_FAILED', 'N/A', 'Review'].includes(candidate.firstName)) {
        reasons.push('Placeholder first name');
      }
      if (['Review', 'REVIEW_REQUIRED', 'N/A', 'Pending'].includes(candidate.lastName)) {
        reasons.push('Placeholder last name');
      }
      if (candidate.email?.match(/candidate-\d+@temp\.com|failed-parse.*@placeholder\.com/)) {
        reasons.push('Placeholder email');
      }
      if (candidate.resumeText && candidate.resumeText.length < 50) {
        reasons.push('Minimal resume text');
      }
      if (candidate.processingMetadata?.parseSuccess === false) {
        reasons.push('Parse failed');
      }
      
      console.log(`   ⚠️  Flags: ${reasons.join(', ')}`);
      console.log('');
    });
    
    console.log('='.repeat(70));
    
    // Check if user wants to delete
    const shouldDelete = process.argv.includes('--delete');
    
    if (shouldDelete) {
      console.log('\n⚠️  DELETE MODE ENABLED');
      console.log(`\nDeleting ${suspiciousCandidates.length} suspicious candidate(s)...`);
      
      const candidateIds = suspiciousCandidates.map(c => c._id);
      const result = await Candidate.deleteMany({ _id: { $in: candidateIds } });
      
      console.log(`✅ Deleted ${result.deletedCount} candidate(s)\n`);
    } else {
      console.log('\n📋 DRY RUN MODE (no changes made)');
      console.log('\nTo delete these candidates, run:');
      console.log('   node backend/scripts/cleanup-fake-candidates.js --delete\n');
      
      console.log('⚠️  WARNING: This action cannot be undone!');
      console.log('   Review the list carefully before deleting.\n');
    }
    
    console.log('='.repeat(70));
    console.log('\n✅ Cleanup scan completed\n');
    
  } catch (error) {
    console.error('❌ Error during cleanup:', error.message);
    console.error(error.stack);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from database\n');
  }
}

// Run cleanup
console.log('\n');
console.log('╔═══════════════════════════════════════════════════════════════════╗');
console.log('║       FAKE CANDIDATE CLEANUP UTILITY                              ║');
console.log('╚═══════════════════════════════════════════════════════════════════╝');
console.log('\n');

cleanupFakeCandidates().then(() => {
  process.exit(0);
}).catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

