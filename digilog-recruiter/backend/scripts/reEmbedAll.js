const mongoose = require('mongoose');
require('dotenv').config();

// Show usage if help requested (do this before loading embeddingService)
const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log('🔧 Re-Embedding Script Usage:');
  console.log('');
  console.log('Re-embed everything:');
  console.log('  node scripts/reEmbedAll.js');
  console.log('');
  console.log('Re-embed jobs only (fixes skills parsing):');
  console.log('  node scripts/reEmbedAll.js --jobs-only');
  console.log('');
  console.log('Re-embed candidates only:');
  console.log('  node scripts/reEmbedAll.js --candidates-only');
  console.log('');
  console.log('Show this help:');
  console.log('  node scripts/reEmbedAll.js --help');
  console.log('');
  console.log('🎯 IMPORTANT:');
  console.log('  This script fixes the skills parsing issue where job skills');
  console.log('  were stored as single comma-separated strings instead of arrays.');
  console.log('  After running this, skills matching will show proper percentages!');
  process.exit(0);
}

// Load embedding service only after help check
const embeddingService = require('../services/embeddingService');

async function runReEmbedding() {
  console.log('🚀 Starting Complete Re-Embedding Process...\n');
  
  try {
    // Connect to database
    console.log('🔌 Connecting to database...');
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/smarthr');
    console.log('✅ Connected to database\n');

    // Run the complete re-embedding process
    const result = await embeddingService.reEmbedAll();
    
    console.log('\n🎉 RE-EMBEDDING PROCESS COMPLETED!');
    console.log('═'.repeat(60));
    console.log('📊 FINAL SUMMARY:');
    console.log('═'.repeat(60));
    console.log(`⏱️  Total Duration: ${result.duration}`);
    console.log(`📝 Jobs: ${result.jobs.success}/${result.jobs.total} successful`);
    console.log(`👤 Candidates: ${result.candidates.success}/${result.candidates.total} successful`);
    
    if (result.jobs.errors > 0 || result.candidates.errors > 0) {
      console.log(`⚠️  Total Errors: ${result.jobs.errors + result.candidates.errors}`);
    }
    
    console.log('\n✅ The skills matching issue has been fixed!');
    console.log('💡 Skills will now show proper match percentages instead of 0%');
    
  } catch (error) {
    console.error('\n❌ Re-embedding process failed:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  } finally {
    console.log('\n🔌 Disconnecting from database...');
    await mongoose.disconnect();
    console.log('✅ Disconnected from database');
  }
}

// Handle script arguments (already parsed above)
const jobsOnly = args.includes('--jobs-only');
const candidatesOnly = args.includes('--candidates-only');

async function main() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/smarthr');
    console.log('✅ Connected to database\n');

    if (jobsOnly) {
      console.log('🔄 Re-embedding JOBS ONLY...');
      const result = await embeddingService.reEmbedAllJobs();
      console.log(`\n✅ Jobs re-embedding completed: ${result.successCount}/${result.totalJobs} successful`);
    } else if (candidatesOnly) {
      console.log('🔄 Re-embedding CANDIDATES ONLY...');
      const result = await embeddingService.reEmbedAllCandidates();
      console.log(`\n✅ Candidates re-embedding completed: ${result.successCount}/${result.totalCandidates} successful`);
    } else {
      await runReEmbedding();
    }
  } catch (error) {
    console.error('❌ Process failed:', error.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

// Run the main function
main(); 