const mongoose = require('mongoose');
require('dotenv').config();

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/smarthr');

const Interview = require('./backend/models/Interview');

async function fixCompletedInterview() {
  try {
    // Find the interview with the specific meeting link
    const meetingLink = 'https://meet.google.com/nad-nhvn-gvd';
    
    const interview = await Interview.findOne({
      $or: [
        { 'conferencing.details.url': meetingLink },
        { meetingLink: meetingLink }
      ]
    }).populate('interviewerId', 'nylasGrantId firstName lastName');
    
    if (!interview) {
      console.log('❌ No interview found with that meeting link');
      console.log('Searching for recent interviews...');
      
      // Show recent interviews
      const recentInterviews = await Interview.find({
        scheduledAt: {
          $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
          $lte: new Date(Date.now() + 24 * 60 * 60 * 1000)  // Next 24 hours
        }
      }).limit(10);
      
      console.log('\n📅 Recent interviews:');
      recentInterviews.forEach(i => {
        console.log(`- ${i._id}: ${i.title} (${i.status}) - ${i.scheduledAt}`);
        if (i.conferencing?.details?.url) {
          console.log(`  Meeting: ${i.conferencing.details.url}`);
        }
      });
      return;
    }
    
    console.log('✅ Found interview:');
    console.log('ID:', interview._id);
    console.log('Title:', interview.title);
    console.log('Current Status:', interview.status);
    console.log('Scheduled:', interview.scheduledAt);
    console.log('Duration:', interview.duration, 'minutes');
    console.log('Notetaker Enabled:', interview.notetakerEnabled);
    console.log('Notetaker ID:', interview.notetakerId);
    console.log('Notetaker Status:', interview.notetakerStatus);
    
    // Calculate if meeting should have ended
    const scheduledEnd = new Date(interview.scheduledAt);
    scheduledEnd.setMinutes(scheduledEnd.getMinutes() + interview.duration);
    const now = new Date();
    
    console.log('\n⏰ Time Analysis:');
    console.log('Scheduled Start:', interview.scheduledAt);
    console.log('Scheduled End:', scheduledEnd.toISOString());
    console.log('Current Time:', now.toISOString());
    console.log('Meeting should have ended:', now > scheduledEnd ? 'YES' : 'NO');
    
    // Fix the interview by bypassing validation
    console.log('\n🔧 Fixing interview status...');
    
    // Use updateOne to bypass model validation
    const updateResult = await Interview.updateOne(
      { _id: interview._id },
      {
        $set: {
          status: 'completed',
          notetakerStatus: 'completed',
          // Add a mock transcript if none exists
          ...((!interview.transcript || !interview.transcript.content) && {
            transcript: {
              content: `Mock completed interview transcript for ${interview.title}.\n\nThis interview has been marked as completed. The actual transcript would contain the conversation between the interviewer and candidate.\n\nKey points discussed:\n- Candidate background and experience\n- Technical skills assessment\n- Cultural fit evaluation\n- Questions and answers session\n\nThis is a placeholder transcript created for testing purposes.`,
              summary: 'Interview completed successfully with positive candidate evaluation',
              keyPoints: [
                'Candidate demonstrated strong technical skills',
                'Good communication and problem-solving abilities', 
                'Cultural fit appears positive',
                'Candidate asked thoughtful questions'
              ],
              actionItems: [
                'Follow up with candidate within 2 business days',
                'Schedule next interview round if proceeding',
                'Update candidate status in system',
                'Share feedback with hiring team'
              ],
              participants: [
                {
                  name: 'Interviewer',
                  email: interview.interviewerId?.email || 'interviewer@company.com',
                  speakingTime: 300 // 5 minutes
                },
                {
                  name: 'Candidate',
                  email: 'candidate@email.com',
                  speakingTime: 600 // 10 minutes
                }
              ],
              duration: interview.duration * 60, // Convert to seconds
              language: 'en',
              confidence: 0.92
            },
            transcriptAvailableAt: new Date(),
            recordingUrl: 'https://example.com/mock-recording.mp4'
          })
        }
      },
      { 
        // Bypass validation
        runValidators: false,
        // Don't run pre-save hooks that might cause the validation error
        timestamps: false
      }
    );
    
    console.log('Update result:', updateResult);
    
    if (updateResult.modifiedCount > 0) {
      console.log('✅ Interview successfully marked as completed!');
      console.log('📊 Status updated to: completed');
      console.log('🎙️ Notetaker status: completed');
      console.log('📝 Mock transcript added');
      console.log('🎥 Mock recording URL added');
      
      console.log('\n🎯 Test the completed interview at:');
      console.log(`http://localhost:3000/interviews/${interview._id}/transcript`);
      console.log('\nYou should now see:');
      console.log('- Completed transcript viewer');
      console.log('- Recording download link');
      console.log('- Interview marked as completed in calendar');
      
    } else {
      console.log('⚠️ No changes were made to the interview');
    }
    
  } catch (error) {
    console.error('Error fixing interview:', error);
  } finally {
    mongoose.disconnect();
  }
}

fixCompletedInterview(); 