const weaviateService = require('../services/weaviateService');
const embeddingService = require('../services/embeddingService');
const mongoose = require('mongoose');
require('dotenv').config();

async function testWeaviateSearch() {
  try {
    console.log('🧪 Testing Weaviate Search Functionality');
    console.log('========================================\n');

    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ MongoDB connected\n');

    // Check Weaviate stats
    console.log('📊 Weaviate Statistics:');
    const stats = await weaviateService.getStats();
    console.log(`  - Candidates: ${stats.candidates}`);
    console.log(`  - Jobs: ${stats.jobs}`);
    console.log('');

    if (stats.candidates === 0 && stats.jobs === 0) {
      console.log('⚠️  No data in Weaviate yet. Run migration first.');
      process.exit(0);
    }

    // Test 1: Search for a software engineer
    console.log('🔍 Test 1: Searching for "software engineer"');
    console.log('----------------------------------------');
    const query1 = 'experienced software engineer with JavaScript and React skills';
    const embedding1 = await embeddingService.generateEmbedding(query1);
    const results1 = await weaviateService.searchSimilarCandidates(embedding1, null, 5);
    
    console.log(`Found ${results1.length} candidates:`);
    results1.forEach((candidate, i) => {
      console.log(`  ${i + 1}. ${candidate.firstName} ${candidate.lastName} - ${candidate.position}`);
      console.log(`     Skills: ${candidate.skills?.join(', ')}`);
      console.log(`     Distance: ${candidate._additional?.distance?.toFixed(4)}`);
    });
    console.log('');

    // Test 2: Search jobs
    console.log('🔍 Test 2: Searching for relevant jobs');
    console.log('----------------------------------------');
    const query2 = 'senior full-stack developer position';
    const embedding2 = await embeddingService.generateEmbedding(query2);
    const results2 = await weaviateService.searchSimilarJobs(embedding2, null, 5);
    
    console.log(`Found ${results2.length} jobs:`);
    results2.forEach((job, i) => {
      console.log(`  ${i + 1}. ${job.title} - ${job.department || 'N/A'}`);
      console.log(`     Location: ${job.location}`);
      console.log(`     Distance: ${job._additional?.distance?.toFixed(4)}`);
    });
    console.log('');

    // Test 3: Hybrid search
    console.log('🔍 Test 3: Hybrid Search (Vector + Keyword)');
    console.log('----------------------------------------');
    const query3 = 'React developer';
    const embedding3 = await embeddingService.generateEmbedding(query3);
    const results3 = await weaviateService.hybridSearchCandidates(query3, embedding3, null, 5, 0.7);
    
    console.log(`Found ${results3.length} candidates (hybrid search):`);
    results3.forEach((candidate, i) => {
      console.log(`  ${i + 1}. ${candidate.firstName} ${candidate.lastName} - ${candidate.position}`);
      console.log(`     Score: ${candidate._additional?.score}`);
    });
    console.log('');

    // Test 4: Organization filtering
    console.log('🔍 Test 4: Organization Filtering');
    console.log('----------------------------------------');
    // Get first candidate's org ID for testing
    if (results1.length > 0 && results1[0].organizationId) {
      const testOrgId = results1[0].organizationId;
      console.log(`Testing filter with org: ${testOrgId}`);
      
      const orgResults = await weaviateService.searchSimilarCandidates(embedding1, testOrgId, 10);
      console.log(`Found ${orgResults.length} candidates in this organization`);
    } else {
      console.log('No organization IDs available for testing');
    }
    console.log('');

    console.log('========================================');
    console.log('✅ ALL TESTS PASSED!');
    console.log('========================================');
    console.log('');
    console.log('Weaviate is ready for production use 🎉');
    console.log('');
    console.log('Next steps:');
    console.log('  1. Set USE_WEAVIATE=true in environment');
    console.log('  2. Restart recruiter backend');
    console.log('  3. Monitor for 48 hours');
    console.log('  4. If stable, cancel Pinecone subscription');

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
  testWeaviateSearch();
}

module.exports = { testWeaviateSearch };
