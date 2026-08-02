const mongoose = require('mongoose');
const sessionService = require('../services/sessionService');
require('dotenv').config();

/**
 * Script to clean up expired sessions
 * Can be run manually or scheduled as a cron job
 */
async function cleanupExpiredSessions() {
  try {
    console.log('🧹 Starting session cleanup...');
    
    // Connect to database
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    
    console.log('✅ Connected to MongoDB');
    
    // Clean up expired sessions
    const cleanedCount = await sessionService.cleanupExpiredSessions();
    
    console.log(`✅ Session cleanup completed. Cleaned up ${cleanedCount} expired sessions`);
    
    // Get session statistics
    const stats = await sessionService.getSessionStats();
    console.log('📊 Session Statistics:');
    console.log(`   - Total Active Sessions: ${stats.totalActiveSessions}`);
    console.log(`   - Anonymous Sessions: ${stats.totalAnonymousSessions}`);
    console.log(`   - User Sessions: ${stats.totalUserSessions}`);
    
  } catch (error) {
    console.error('❌ Error during session cleanup:', error);
    process.exit(1);
  } finally {
    // Close database connection
    await mongoose.connection.close();
    console.log('🔌 Database connection closed');
    process.exit(0);
  }
}

// Run the cleanup if this script is executed directly
if (require.main === module) {
  cleanupExpiredSessions();
}

module.exports = { cleanupExpiredSessions }; 