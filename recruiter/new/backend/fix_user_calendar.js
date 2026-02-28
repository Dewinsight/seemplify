const mongoose = require('mongoose');
const User = require('./models/User');
require('dotenv').config();

async function fixUserCalendar(email) {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    // Find user by email
    const user = await User.findOne({ email: email || 'test@smarthr.com' });
    
    if (!user) {
      console.log('❌ User not found');
      return;
    }

    console.log('Found user:', user.email);
    console.log('Current nylasGrantId:', user.nylasGrantId || '(not set)');
    
    // Set a temporary grant ID for testing
    // In production, this would come from Nylas
    user.nylasGrantId = 'grant_test_' + Date.now();
    user.calendarConnected = true;
    user.calendarProvider = 'google';
    user.nylasGrantStatus = 'active';
    
    await user.save();
    
    console.log('\n✅ User calendar updated!');
    console.log('New nylasGrantId:', user.nylasGrantId);
    console.log('calendarConnected:', user.calendarConnected);
    console.log('calendarProvider:', user.calendarProvider);
    console.log('nylasGrantStatus:', user.nylasGrantStatus);

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\nDisconnected from MongoDB');
  }
}

// Get email from command line argument or use default
const email = process.argv[2];
fixUserCalendar(email); 