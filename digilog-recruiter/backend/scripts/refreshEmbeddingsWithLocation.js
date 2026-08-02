const mongoose = require('mongoose');
const Candidate = require('../models/Candidate');
const embeddingService = require('../services/embeddingService');
require('dotenv').config();

async function refreshEmbeddingsWithLocation() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');

    // Get all candidates with location data
    const candidates = await Candidate.find({ 
      location: { $exists: true, $ne: '', $ne: null },
      isEmbedded: true
    });
    
    console.log(`📊 Found ${candidates.length} candidates with location data and existing embeddings`);

    if (candidates.length === 0) {
      console.log('❌ No candidates found with both location data and embeddings');
      return;
    }

    console.log('\n🔄 Refreshing embeddings with location data:');
    console.log('=' .repeat(70));

    let successCount = 0;
    let errorCount = 0;

    // Refresh embeddings for each candidate
    for (const candidate of candidates) {
      try {
        console.log(`\n🔄 Processing: ${candidate.firstName} ${candidate.lastName}`);
        console.log(`   Location: ${candidate.location}`);
        console.log(`   Position: ${candidate.position}`);
        
        // Delete existing embedding first
        try {
          await embeddingService.deleteEmbedding(candidate._id.toString());
          console.log(`   ✅ Deleted old embedding`);
        } catch (deleteError) {
          console.log(`   ⚠️ No existing embedding to delete (this is okay)`);
        }
        
        // Create new embedding with location data
        await embeddingService.createCandidateEmbedding(candidate);
        
        // Update candidate status
        await Candidate.findByIdAndUpdate(candidate._id, {
          isEmbedded: true,
          embeddingCreatedAt: new Date()
        });
        
        console.log(`   ✅ Successfully refreshed embedding with location: ${candidate.location}`);
        successCount++;
        
        // Add a small delay to avoid overwhelming the API
        await new Promise(resolve => setTimeout(resolve, 500));
        
      } catch (error) {
        console.log(`   ❌ Failed to refresh embedding: ${error.message}`);
        errorCount++;
      }
    }

    console.log(`\n📋 Final Summary:`);
    console.log('=' .repeat(70));
    console.log(`Total candidates processed: ${candidates.length}`);
    console.log(`Successfully refreshed: ${successCount}`);
    console.log(`Failed: ${errorCount}`);
    
    if (successCount > 0) {
      console.log('\n✅ Embedding refresh completed! Location data is now included in candidate embeddings.');
      console.log('   This will improve location-based matching in job searches.');
    }

  } catch (error) {
    console.error('❌ Error refreshing embeddings:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Disconnected from MongoDB');
  }
}

refreshEmbeddingsWithLocation(); 