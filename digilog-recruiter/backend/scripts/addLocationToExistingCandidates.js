const mongoose = require('mongoose');
const Candidate = require('../models/Candidate');
require('dotenv').config();

async function addLocationToExistingCandidates() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');

    // Get all candidates without location
    const candidates = await Candidate.find({ 
      $or: [
        { location: { $exists: false } },
        { location: '' },
        { location: null }
      ]
    });
    
    console.log(`📊 Found ${candidates.length} candidates without location data`);

    if (candidates.length === 0) {
      console.log('✅ All candidates already have location data');
      return;
    }

    // Sample locations to assign
    const sampleLocations = [
      'New York, NY',
      'San Francisco, CA',
      'London, UK',
      'Boston, MA',
      'Seattle, WA',
      'Chicago, IL',
      'Austin, TX',
      'Toronto, Canada',
      'Berlin, Germany',
      'Remote'
    ];

    console.log('\n🔄 Adding location data to candidates:');
    console.log('=' .repeat(50));

    // Update each candidate with a sample location
    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      const location = sampleLocations[i % sampleLocations.length];
      
      await Candidate.findByIdAndUpdate(candidate._id, {
        location: location
      });
      
      console.log(`✅ Updated ${candidate.firstName} ${candidate.lastName} - Location: ${location}`);
    }

    console.log(`\n📋 Summary:`);
    console.log('=' .repeat(50));
    console.log(`Total candidates updated: ${candidates.length}`);
    console.log('Location data added successfully!');
    
    // Verify the updates
    const updatedCandidates = await Candidate.find({ 
      location: { $exists: true, $ne: '', $ne: null }
    });
    console.log(`Total candidates with location: ${updatedCandidates.length}`);

  } catch (error) {
    console.error('❌ Error adding location data:', error);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
  }
}

addLocationToExistingCandidates(); 