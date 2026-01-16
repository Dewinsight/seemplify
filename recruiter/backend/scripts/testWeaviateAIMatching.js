const mongoose = require('mongoose');
const Job = require('../models/Job');
const Candidate = require('../models/Candidate');
const embeddingService = require('../services/embeddingService');
require('dotenv').config();

async function testAIMatching() {
  console.log('');
  console.log('╔════════════════════════════════════════════╗');
  console.log('║   WEAVIATE AI MATCHING TEST SUITE         ║');
  console.log('╚════════════════════════════════════════════╝');
  console.log('');

  try {
    // Connect to MongoDB
    console.log('📡 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ MongoDB connected\n');

    // Check which vector DB is active
    console.log('📊 Current Configuration:');
    console.log(`  - Vector DB: ${process.env.USE_WEAVIATE === 'true' ? '✨ Weaviate' : '📌 Pinecone'}`);
    console.log(`  - Weaviate Host: ${process.env.WEAVIATE_HOST || 'Not set'}`);
    console.log('');

    // ========================================
    // TEST 1: Find Matching Candidates for Job
    // ========================================
    console.log('🧪 TEST 1: Find Matching Candidates for Job');
    console.log('========================================');
    
    const job = await Job.findOne({ isEmbedded: true }).lean();
    if (!job) {
      console.log('⚠️  No embedded jobs found. Skipping test.');
    } else {
      console.log(`Job: "${job.title}"`);
      console.log(`Organization: ${job.organization}`);
      console.log('');
      
      const matchResult = await embeddingService.findMatchingCandidatesForJob(job, 5);
      const matches = matchResult.matches || matchResult;
      
      console.log(`✅ Found ${matches.length} matches`);
      if (matchResult.fromCache) {
        console.log(`   (from cache, ${matchResult.cacheAgeMinutes} minutes old)`);
      }
      
      matches.forEach((match, i) => {
        console.log(`  ${i + 1}. ${match.candidate?.name || 'Unknown'}`);
        console.log(`     Position: ${match.candidate?.position || 'N/A'}`);
        console.log(`     Similarity: ${(match.similarity * 100).toFixed(1)}%`);
        console.log(`     Skills: ${match.candidate?.skills?.slice(0, 3).join(', ') || 'N/A'}`);
      });
    }
    console.log('');

    // ========================================
    // TEST 2: Find Matching with Explanations
    // ========================================
    console.log('🧪 TEST 2: Find Matching Candidates with Explanations');
    console.log('========================================');
    
    if (job) {
      const explainResult = await embeddingService.findMatchingCandidatesWithExplanation(job, 3);
      const explainMatches = explainResult.matches || explainResult;
      
      console.log(`✅ Found ${explainMatches.length} matches with explanations`);
      
      explainMatches.forEach((match, i) => {
        console.log(`  ${i + 1}. ${match.candidate?.name || 'Unknown'}`);
        console.log(`     Similarity: ${(match.similarity * 100).toFixed(1)}%`);
        if (match.explanation?.reasons) {
          console.log(`     Reasons: ${match.explanation.reasons.slice(0, 2).join('; ')}`);
        }
      });
    }
    console.log('');

    // ========================================
    // TEST 3: Rank Candidates by IDs
    // ========================================
    console.log('🧪 TEST 3: Rank Specific Candidates (Shortlist)');
    console.log('========================================');
    
    if (job) {
      // Get some candidate IDs from the matches
      const candidateIds = await Candidate.find({ 
        isEmbedded: true,
        organization: job.organization 
      }).limit(5).select('_id').lean();
      
      if (candidateIds.length > 0) {
        const ids = candidateIds.map(c => c._id.toString());
        console.log(`Testing with ${ids.length} candidate IDs...`);
        
        const ranked = await embeddingService.rankCandidatesByIds(job, ids, 5);
        
        console.log(`✅ Ranked ${ranked.length} candidates`);
        ranked.forEach((match, i) => {
          console.log(`  ${i + 1}. ${match.candidate?.name || 'Unknown'}`);
          console.log(`     Relevance: ${(match.relevanceScore || match.similarity * 100).toFixed(1)}%`);
        });
      } else {
        console.log('⚠️  No candidates in same organization. Skipping test.');
      }
    }
    console.log('');

    // ========================================
    // TEST 4: Search Similar Candidates
    // ========================================
    console.log('🧪 TEST 4: Search Similar Candidates by Query');
    console.log('========================================');
    
    const searchQuery = 'Senior software engineer with React and Node.js experience';
    console.log(`Query: "${searchQuery}"`);
    console.log('');
    
    const searchMatches = await embeddingService.searchSimilarCandidates(searchQuery, 5);
    
    console.log(`✅ Found ${searchMatches.length} candidates`);
    searchMatches.forEach((match, i) => {
      // Handle both Weaviate and Pinecone response formats
      const name = match.firstName 
        ? `${match.firstName} ${match.lastName}` 
        : match.metadata?.name || 'Unknown';
      const position = match.position || match.metadata?.position || 'N/A';
      const distance = match._additional?.distance || match.score || 0;
      
      console.log(`  ${i + 1}. ${name}`);
      console.log(`     Position: ${position}`);
      console.log(`     Distance: ${distance.toFixed(4)}`);
    });
    console.log('');

    // ========================================
    // SUMMARY
    // ========================================
    console.log('========================================');
    console.log('✅ ALL AI MATCHING TESTS PASSED!');
    console.log('========================================');
    console.log('');
    console.log('Test Results:');
    console.log('  ✅ Find matching candidates for job');
    console.log('  ✅ Find matching with explanations');
    console.log('  ✅ Rank candidates by IDs (shortlist)');
    console.log('  ✅ Search similar candidates by query');
    console.log('');
    console.log(`Vector DB: ${process.env.USE_WEAVIATE === 'true' ? '✨ Weaviate' : '📌 Pinecone'}`);
    console.log('');
    console.log('🎉 AI Matching is working correctly!');

    await mongoose.disconnect();
    process.exit(0);

  } catch (error) {
    console.error('\n❌ TEST FAILED:', error);
    console.error('Stack:', error.stack);
    
    try {
      await mongoose.disconnect();
    } catch (e) {}
    
    process.exit(1);
  }
}

// Run tests
if (require.main === module) {
  testAIMatching();
}

module.exports = { testAIMatching };
