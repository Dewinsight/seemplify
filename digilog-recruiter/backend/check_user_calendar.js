const mongoose = require('mongoose');
const User = require('./models/User');
require('dotenv').config();

async function checkUserCalendar(email) {
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

    console.log('\n=== USER CALENDAR INFO ===');
    console.log('User ID:', user._id);
    console.log('Email:', user.email);
    console.log('\n📅 Calendar Fields:');
    console.log('- nylasGrantId:', user.nylasGrantId || '(not set)');
    console.log('- calendarConnected:', user.calendarConnected);
    console.log('- calendarProvider:', user.calendarProvider || '(not set)');
    console.log('- nylasGrantStatus:', user.nylasGrantStatus || '(not set)');
    console.log('- Last updated:', user.updatedAt);

    if (user.nylasGrantId) {
      console.log('\n✅ Calendar appears to be connected!');
    } else {
      console.log('\n❌ Calendar is NOT connected');
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\nDisconnected from MongoDB');
  }
}

// Get email from command line argument or use default
const email = process.argv[2];
checkUserCalendar(email); 