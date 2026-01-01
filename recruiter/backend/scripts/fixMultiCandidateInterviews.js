require('dotenv').config();
const mongoose = require('mongoose');
const Interview = require('../models/Interview');

async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/smarthr', {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ MongoDB connected successfully');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
}

async function fixMultiCandidateInterviews() {
  try {
    console.log('🔍 Looking for multi-candidate interviews with incorrect data structure...');
    
    // Find interviews that have startTime instead of scheduledAt
    const interviewsToFix = await Interview.find({
      isMultiCandidate: true,
      $or: [
        { scheduledAt: { $exists: false } },
        { scheduledAt: null },
        { startTime: { $exists: true } }
      ]
    });
    
    console.log(`📋 Found ${interviewsToFix.length} interviews to fix`);
    
    for (const interview of interviewsToFix) {
      console.log(`🔧 Fixing interview ${interview._id}...`);
      
      const updates = {};
      
      // Fix scheduledAt if it's missing but startTime exists
      if (interview.startTime && !interview.scheduledAt) {
        updates.scheduledAt = new Date(interview.startTime);
        console.log(`  ✅ Set scheduledAt to ${updates.scheduledAt}`);
      }
      
      // Fix notetaker structure if it's using old format
      if (interview.notetaker && typeof interview.notetaker === 'object') {
        if (interview.notetaker.enabled) {
          updates.notetakerEnabled = true;
        }
        if (interview.notetaker.status) {
          updates.notetakerStatus = interview.notetaker.status === 'pending' ? 'pending' : 'enabled';
        }
        if (interview.notetaker.sessionId) {
          updates.notetakerId = interview.notetaker.sessionId;
        }
        
        // Remove old notetaker object
        updates.$unset = { notetaker: 1 };
        console.log(`  ✅ Updated notetaker structure`);
      }
      
      // Add conferencing details if meetingLink exists but conferencing doesn't
      if (interview.meetingLink && !interview.conferencing) {
        updates.conferencing = {
          provider: 'google_meet',
          details: {
            url: interview.meetingLink
          }
        };
        console.log(`  ✅ Added conferencing details`);
      }
      
      if (Object.keys(updates).length > 0) {
        await Interview.findByIdAndUpdate(interview._id, updates);
        console.log(`  ✅ Updated interview ${interview._id}`);
      } else {
        console.log(`  ⏭️ No updates needed for interview ${interview._id}`);
      }
    }
    
    console.log('🎉 Multi-candidate interview fix completed!');
    
  } catch (error) {
    console.error('❌ Error fixing multi-candidate interviews:', error);
    throw error;
  }
}

async function main() {
  try {
    await connectDB();
    await fixMultiCandidateInterviews();
    console.log('✅ Script completed successfully');
  } catch (error) {
    console.error('❌ Script failed:', error);
  } finally {
    await mongoose.connection.close();
    console.log('📡 Database connection closed');
  }
}

if (require.main === module) {
  main();
}

module.exports = { fixMultiCandidateInterviews };
