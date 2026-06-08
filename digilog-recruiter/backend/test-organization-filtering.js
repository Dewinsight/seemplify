const mongoose = require('mongoose');
const Job = require('./models/Job');
const Candidate = require('./models/Candidate');
const EmbeddingService = require('./services/embeddingService');

// Test script to verify organization filtering in AI candidate matching
async function testOrganizationFiltering() {
  try {
    console.log('🧪 Testing AI Candidate Matching Organization Filtering...\n');

    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/smarthr');
    console.log('✅ Connected to MongoDB');

    // Initialize embedding service
    const embeddingService = new EmbeddingService();
    
    // Test 1: Find a job with organization info
    console.log('\n📋 Test 1: Finding a job with organization...');
    const job = await Job.findOne({ organization: { $exists: true } }).populate('organization');
    
    if (!job) {
      console.log('❌ No jobs found with organization info');
      return;
    }
    
    console.log(`✅ Found job: "${job.title}" (ID: ${job._id})`);
    console.log(`🏢 Organization: ${job.organization}`);

    // Test 2: Check candidates in same organization
    const candidatesInOrg = await Candidate.countDocuments({ organization: job.organization });
    const totalCandidates = await Candidate.countDocuments();
    
    console.log(`\n👥 Candidates in same organization: ${candidatesInOrg}`);
    console.log(`👥 Total candidates in database: ${totalCandidates}`);
    
    if (candidatesInOrg === 0) {
      console.log('❌ No candidates found in the same organization as the job');
      return;
    }

    // Test 3: Run AI matching with organization filtering
    console.log('\n🤖 Test 3: Running AI matching with organization filtering...');
    const matches = await embeddingService.findMatchingCandidatesForJob(job, 10);
    
    console.log(`\n🔍 AI Matching Results:`);
    console.log(`📊 Found ${matches.length} matching candidates`);
    
    if (matches.length === 0) {
      console.log('⚠️ No matches found. This could mean:');
      console.log('   - No candidate embeddings exist for this organization');
      console.log('   - Embeddings need to be recreated with organization metadata');
      console.log('   - No semantic similarity between job and candidates');
    } else {
      console.log('\n📝 Match Details:');
      matches.forEach((match, index) => {
        console.log(`  ${index + 1}. ${match.candidate.name}`);
        console.log(`     📧 Email: ${match.candidate.email}`);
        console.log(`     📊 Similarity: ${(match.similarity * 100).toFixed(1)}%`);
        console.log(`     🏢 Org in metadata: ${match.metadata?.organizationId || 'NOT SET'}`);
        console.log('');
      });
    }

    // Test 4: Verify organization filtering is working
    console.log('\n🔬 Test 4: Verifying organization isolation...');
    
    // Check if any matches have different organization IDs
    const orgMismatches = matches.filter(match => 
      match.metadata?.organizationId && 
      match.metadata.organizationId !== job.organization.toString()
    );
    
    if (orgMismatches.length > 0) {
      console.log('❌ ORGANIZATION FILTERING FAILED!');
      console.log(`Found ${orgMismatches.length} candidates from different organizations:`);
      orgMismatches.forEach(match => {
        console.log(`  - ${match.candidate.name}: ${match.metadata.organizationId} (should be ${job.organization})`);
      });
    } else {
      console.log('✅ ORGANIZATION FILTERING WORKING CORRECTLY!');
      console.log('All matched candidates belong to the same organization as the job.');
    }

    // Test 5: Check embedding metadata status
    console.log('\n🔍 Test 5: Checking embedding metadata status...');
    const candidatesWithEmbeddings = await Candidate.countDocuments({ 
      organization: job.organization,
      isEmbedded: true 
    });
    
    console.log(`📊 Candidates with embeddings in organization: ${candidatesWithEmbeddings}`);
    
    if (candidatesWithEmbeddings === 0) {
      console.log('⚠️ No candidates have embeddings in this organization.');
      console.log('   Run the embedding creation process to generate embeddings with organization metadata.');
    }

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Disconnected from MongoDB');
  }
}

// Run the test
if (require.main === module) {
  testOrganizationFiltering()
    .then(() => {
      console.log('\n✅ Test completed');
      process.exit(0);
    })
    .catch(error => {
      console.error('❌ Test error:', error);
      process.exit(1);
    });
}

module.exports = { testOrganizationFiltering };
