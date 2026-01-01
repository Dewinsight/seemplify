const mongoose = require('mongoose');
const Candidate = require('../models/Candidate');
const Job = require('../models/Job');
const weaviateService = require('../services/weaviateService');
const { Pinecone } = require('@pinecone-database/pinecone');
require('dotenv').config();

async function migrateData() {
  console.log('🚀 Starting Pinecone → Weaviate migration...');
  console.log('========================================\n');
  
  let candidateCount = 0;
  let candidateSkipped = 0;
  let jobCount = 0;
  let jobSkipped = 0;
  let errors = [];

  try {
    // Connect to MongoDB
    console.log('📡 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ MongoDB connected\n');

    // Initialize Pinecone
    console.log('📡 Connecting to Pinecone...');
    const pinecone = new Pinecone({
      apiKey: process.env.PINECONE_API_KEY,
    });
    console.log('✅ Pinecone connected\n');

    // Check Weaviate
    console.log('📡 Checking Weaviate connection...');
    const stats = await weaviateService.getStats();
    console.log(`✅ Weaviate connected - Current stats:`, stats);
    console.log('');

    // ========================================
    // MIGRATE CANDIDATES
    // ========================================
    console.log('📋 MIGRATING CANDIDATES...');
    console.log('========================================');
    
    const candidates = await Candidate.find({ isEmbedded: true }).lean();
    console.log(`Found ${candidates.length} embedded candidates in MongoDB\n`);
    
    const candidateIndex = pinecone.index('candidates');
    
    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      const candidateId = candidate._id.toString();
      
      try {
        // Check if already exists in Weaviate
        const existsInWeaviate = await weaviateService.checkCandidateExists(candidateId);
        if (existsInWeaviate) {
          console.log(`  ⏭️  Skipped ${i + 1}/${candidates.length} - Already in Weaviate: ${candidate.firstName} ${candidate.lastName}`);
          candidateSkipped++;
          continue;
        }

        // Fetch from Pinecone
        const result = await candidateIndex.fetch([candidateId]);
        
        if (result.records && result.records[candidateId]) {
          const record = result.records[candidateId];
          
          // Store in Weaviate
          await weaviateService.storeCandidateEmbedding(
            candidateId,
            record.values,
            record.metadata || {
              candidateId: candidateId,
              organizationId: candidate.organization?.toString() || '',
              firstName: candidate.firstName || '',
              lastName: candidate.lastName || '',
              email: candidate.email || '',
              position: candidate.position || '',
              resumeText: candidate.resumeText || '',
              skills: candidate.skills || [],
              totalYearsExperience: candidate.workExperience?.totalYearsExperience || 0,
            }
          );
          
          candidateCount++;
          console.log(`  ✅ Migrated ${i + 1}/${candidates.length} - ${candidate.firstName} ${candidate.lastName}`);
        } else {
          candidateSkipped++;
          console.log(`  ⚠️  Skipped ${i + 1}/${candidates.length} - Not found in Pinecone: ${candidate.firstName} ${candidate.lastName}`);
        }

        // Progress update every 10 candidates
        if ((candidateCount + candidateSkipped) % 10 === 0) {
          console.log(`\n  📊 Progress: ${candidateCount} migrated, ${candidateSkipped} skipped, ${i + 1}/${candidates.length} processed\n`);
        }

      } catch (error) {
        console.error(`  ❌ Error migrating candidate ${candidateId}:`, error.message);
        errors.push({ 
          type: 'candidate', 
          id: candidateId, 
          name: `${candidate.firstName} ${candidate.lastName}`,
          error: error.message 
        });
      }
    }

    console.log('\n========================================');
    console.log(`✅ CANDIDATES COMPLETE: ${candidateCount} migrated, ${candidateSkipped} skipped`);
    console.log('========================================\n');

    // ========================================
    // MIGRATE JOBS
    // ========================================
    console.log('📋 MIGRATING JOBS...');
    console.log('========================================');
    
    const jobs = await Job.find({ isEmbedded: true }).lean();
    console.log(`Found ${jobs.length} embedded jobs in MongoDB\n`);
    
    const jobIndex = pinecone.index('jobs');
    
    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i];
      const jobId = job._id.toString();
      
      try {
        // Check if already exists in Weaviate
        const existsInWeaviate = await weaviateService.checkJobExists(jobId);
        if (existsInWeaviate) {
          console.log(`  ⏭️  Skipped ${i + 1}/${jobs.length} - Already in Weaviate: ${job.title}`);
          jobSkipped++;
          continue;
        }

        // Fetch from Pinecone
        const result = await jobIndex.fetch([jobId]);
        
        if (result.records && result.records[jobId]) {
          const record = result.records[jobId];
          
          // Store in Weaviate
          await weaviateService.storeJobEmbedding(
            jobId,
            record.values,
            record.metadata || {
              jobId: jobId,
              organizationId: job.organization?.toString() || '',
              title: job.title || '',
              department: job.department || '',
              location: job.location || '',
              type: job.type || '',
              level: job.level || '',
              description: job.description || '',
              requirements: job.requirements || '',
              requiredSkills: job.requiredSkills || [],
            }
          );
          
          jobCount++;
          console.log(`  ✅ Migrated ${i + 1}/${jobs.length} - ${job.title}`);
        } else {
          jobSkipped++;
          console.log(`  ⚠️  Skipped ${i + 1}/${jobs.length} - Not found in Pinecone: ${job.title}`);
        }

      } catch (error) {
        console.error(`  ❌ Error migrating job ${jobId}:`, error.message);
        errors.push({ 
          type: 'job', 
          id: jobId, 
          title: job.title,
          error: error.message 
        });
      }
    }

    console.log('\n========================================');
    console.log(`✅ JOBS COMPLETE: ${jobCount} migrated, ${jobSkipped} skipped`);
    console.log('========================================\n');

    // ========================================
    // FINAL VERIFICATION
    // ========================================
    console.log('📊 FINAL VERIFICATION');
    console.log('========================================');
    
    const finalStats = await weaviateService.getStats();
    
    console.log('Weaviate Statistics:');
    console.log(`  - Candidates: ${finalStats.candidates}`);
    console.log(`  - Jobs: ${finalStats.jobs}`);
    console.log('');
    console.log('Migration Summary:');
    console.log(`  - Candidates migrated: ${candidateCount}`);
    console.log(`  - Candidates skipped: ${candidateSkipped}`);
    console.log(`  - Jobs migrated: ${jobCount}`);
    console.log(`  - Jobs skipped: ${jobSkipped}`);
    console.log(`  - Total errors: ${errors.length}`);
    
    if (errors.length > 0) {
      console.log('\n⚠️  ERRORS ENCOUNTERED:');
      errors.forEach(err => {
        console.log(`  - [${err.type}] ${err.name || err.title} (${err.id}): ${err.error}`);
      });
    }

    console.log('\n========================================');
    console.log('🎉 MIGRATION COMPLETE!');
    console.log('========================================');
    console.log('');
    console.log('Next steps:');
    console.log('  1. Test search functionality in Weaviate');
    console.log('  2. Compare results with Pinecone');
    console.log('  3. If satisfied, set USE_WEAVIATE=true in production');
    console.log('  4. Monitor for 48 hours');
    console.log('  5. Cancel Pinecone subscription');
    console.log('');

    await mongoose.disconnect();
    
    return { 
      candidateCount, 
      candidateSkipped,
      jobCount, 
      jobSkipped,
      errors, 
      finalStats 
    };

  } catch (error) {
    console.error('\n❌ MIGRATION FAILED:', error);
    console.error('Stack:', error.stack);
    
    try {
      await mongoose.disconnect();
    } catch (e) {
      // Ignore disconnect errors
    }
    
    throw error;
  }
}

// Run migration
if (require.main === module) {
  console.log('');
  console.log('╔════════════════════════════════════════════╗');
  console.log('║   PINECONE → WEAVIATE MIGRATION SCRIPT    ║');
  console.log('╚════════════════════════════════════════════╝');
  console.log('');
  
  migrateData()
    .then(result => {
      console.log('✅ Migration script completed successfully');
      process.exit(0);
    })
    .catch(error => {
      console.error('❌ Migration script failed');
      process.exit(1);
    });
}

module.exports = { migrateData };
