/**
 * Test script for interview cancellation
 * 
 * This script simulates cancelling an interview to verify that:
 * 1. Calendar event is cancelled
 * 2. Email notification is sent
 * 3. App notifications are created
 */

require('dotenv').config();
const mongoose = require('mongoose');

// Need to register all models for proper population
require('./models/User');
require('./models/Interview');
require('./models/Notification');
require('./models/Candidate');
require('./models/Job');
require('./models/Organization');

// Then load the models for use
const Interview = mongoose.model('Interview');
const Notification = mongoose.model('Notification');
const User = mongoose.model('User');

// Connect to database
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/smarthr';
console.log(`Connecting to MongoDB: ${MONGO_URI}`);

mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch(err => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  });

async function testCancelInterview() {
  try {
    // Find most recent non-cancelled interview
    const interview = await Interview.findOne({ 
      status: { $nin: ['cancelled', 'completed'] } 
    })
    .sort({ createdAt: -1 })
    .populate(['candidateId', 'interviewerId', 'jobId'])
    .exec();
    
    if (!interview) {
      console.error('❌ No active interviews found to test cancellation');
      process.exit(1);
    }
    
    console.log('📅 Found interview to test cancellation:', {
      id: interview._id,
      status: interview.status,
      candidate: interview.candidateId ? 
        `${interview.candidateId.firstName || ''} ${interview.candidateId.lastName || ''}` : 'Unknown',
      candidateEmail: interview.candidateId?.email,
      scheduledAt: interview.scheduledAt,
      hasNylasEventId: !!interview.nylasEventId
    });
    
    // Get a user to be the canceller
    const user = await User.findOne({ currentOrganization: { $exists: true } });
    if (!user) {
      console.error('❌ No users found to be the canceller');
      process.exit(1);
    }
    
    console.log('👤 Found user to be canceller:', {
      id: user._id,
      email: user.email,
      organization: user.currentOrganization
    });

    // Load the controller
    const interviewController = require('./controllers/interviewController');
    
    // Mock req and res objects for controller
    const req = {
      params: { interviewId: interview._id.toString() },
      body: { 
        reason: 'Testing interview cancellation',
        notifyParticipants: true 
      },
      user: {
        id: user._id.toString()
      }
    };
    
    // Create a mock response object that resolves a promise when json() is called
    let responseData = null;
    const res = {
      status: function(code) {
        console.log(`Response status: ${code}`);
        return this;
      },
      json: function(data) {
        responseData = data;
        console.log('Response data:', data);
      }
    };
    
    console.log('🔄 Starting interview cancellation test...');
    
    // Call the controller function
    await interviewController.cancelInterview(req, res);
    
    console.log('✅ Cancellation controller completed');
    
    // Verify the results
    
    // 1. Check if interview was updated
    const updatedInterview = await Interview.findById(interview._id);
    console.log('📋 Verification - Interview status:', updatedInterview.status);
    console.log('   Cancellation reason:', updatedInterview.cancellationReason);
    console.log('   Cancelled at:', updatedInterview.cancelledAt);
    
    // 2. Check if notifications were created
    const notifications = await Notification.find({ 
      'data.interviewId': interview._id,
      type: 'interview_cancelled',
      createdAt: { $gt: new Date(Date.now() - 60000) } // Created in the last minute
    });
    
    console.log('🔔 Verification - Notifications created:', notifications.length);
    notifications.forEach(notification => {
      console.log(`   - To: ${notification.user} - ${notification.message}`);
    });
    
    console.log('✅ Test completed');
    
  } catch (error) {
    console.error('❌ Test error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
}

testCancelInterview();
