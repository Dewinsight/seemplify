const mongoose = require('mongoose');
require('dotenv').config();

// Import models
const OrganizationInvite = require('../models/OrganizationInvite');

// Database connection
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ MongoDB connected for cleanup script');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
};

// Main cleanup function
const cleanupRejectedInvitations = async () => {
  try {
    console.log('🧹 Starting cleanup of rejected/expired invitations...');
    
    // Find all rejected and expired invitations
    const rejectedInvites = await OrganizationInvite.find({
      $or: [
        { status: 'rejected' },
        { status: 'expired' },
        { expiresAt: { $lt: new Date() } }
      ]
    });

    console.log(`📊 Found ${rejectedInvites.length} invitations to cleanup:`);
    
    // Group by status for reporting
    const statusCounts = {};
    rejectedInvites.forEach(invite => {
      const status = invite.expiresAt < new Date() ? 'expired' : invite.status;
      statusCounts[status] = (statusCounts[status] || 0) + 1;
    });
    
    console.log('📈 Breakdown by status:', statusCounts);
    
    // Show some examples of problematic invitations
    if (rejectedInvites.length > 0) {
      console.log('\n📋 Sample invitations to be deleted:');
      rejectedInvites.slice(0, 5).forEach((invite, index) => {
        console.log(`  ${index + 1}. ${invite.email} (${invite.status}) - Created: ${invite.createdAt.toISOString()}`);
      });
      if (rejectedInvites.length > 5) {
        console.log(`  ... and ${rejectedInvites.length - 5} more`);
      }
    }

    // Perform the cleanup
    const deleteResult = await OrganizationInvite.deleteMany({
      $or: [
        { status: 'rejected' },
        { status: 'expired' },
        { expiresAt: { $lt: new Date() } }
      ]
    });

    console.log(`\n✅ Cleanup completed successfully!`);
    console.log(`🗑️ Deleted ${deleteResult.deletedCount} old invitations`);
    
    // Verify cleanup
    const remainingRejected = await OrganizationInvite.countDocuments({
      $or: [
        { status: 'rejected' },
        { status: 'expired' },
        { expiresAt: { $lt: new Date() } }
      ]
    });
    
    if (remainingRejected === 0) {
      console.log('✅ Verification: No rejected/expired invitations remaining');
    } else {
      console.log(`⚠️ Warning: ${remainingRejected} rejected/expired invitations still remain`);
    }

    // Show current pending invitations
    const pendingCount = await OrganizationInvite.countDocuments({ 
      status: 'pending',
      expiresAt: { $gt: new Date() }
    });
    console.log(`📊 Current valid pending invitations: ${pendingCount}`);

  } catch (error) {
    console.error('❌ Error during cleanup:', error);
    throw error;
  }
};

// Run the script
const main = async () => {
  try {
    await connectDB();
    await cleanupRejectedInvitations();
    
    console.log('\n🎉 Cleanup script completed successfully!');
    console.log('💡 Users can now re-invite emails that were previously deleted.');
    
  } catch (error) {
    console.error('❌ Script failed:', error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('📴 Database connection closed');
    process.exit(0);
  }
};

// Handle script termination
process.on('SIGINT', async () => {
  console.log('\n🛑 Script interrupted by user');
  await mongoose.connection.close();
  process.exit(0);
});

// Run the script
main();
