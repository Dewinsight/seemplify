const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    // Enable Mongoose security features
    // NOTE: We're NOT using global sanitizeFilter as it breaks legitimate queries
    // Instead, we rely on our input sanitization middleware to clean user input
    // mongoose.set('sanitizeFilter', true); // REMOVED - too restrictive
    
    mongoose.set('strict', true); // Strict schema mode by default
    mongoose.set('strictQuery', true); // Strip unknown query filters
    
    const conn = await mongoose.connect(process.env.MONGO_URI, {
      // Connection options for security
      serverSelectionTimeoutMS: 5000,
      maxPoolSize: 10
    });
    
    console.log(`MongoDB Connected: ${conn.connection.host}`);
    console.log('✅ MongoDB security features enabled: strict mode, strictQuery');
    console.log('ℹ️  Using middleware-based sanitization instead of global sanitizeFilter');
    
    // Remove unique email index if it exists
    await removeEmailUniqueIndex();

    // Repair historical CV/runtime data before Mongoose builds the guarded
    // idempotency index or any worker can dispatch queued uploads.
    const { ensureCvProcessingCompatibility } = require('../services/cvProcessingCompatibilityService');
    const compatibility = await ensureCvProcessingCompatibility();
    console.log('CV runtime compatibility checks complete:', compatibility);

    // Raw AI usage events are the authoritative ledger. Repair legacy event
    // identities and rebuild any missing/ghost materialized projections before
    // the API begins accepting inference traffic.
    const {
      ensureAIUsageProjectionCompatibility,
      repairPendingUsageProjectionsOnStartup
    } = require('../services/aiRuntime/usageService');
    const usageCompatibility = await ensureAIUsageProjectionCompatibility();
    console.log('AI usage projection checks complete:', usageCompatibility);
    const usageRepair = await repairPendingUsageProjectionsOnStartup();
    console.log('AI usage pending projection repair complete:', usageRepair);
    
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
};

// Function to remove the unique email index
const removeEmailUniqueIndex = async () => {
  try {
    const collection = mongoose.connection.db.collection('candidates');
    
    // Check if email_1 index exists
    const indexes = await collection.indexes();
    const emailIndexExists = indexes.some(index => index.name === 'email_1');
    
    if (emailIndexExists) {
      console.log('🗑️  Removing unique email constraint...');
      await collection.dropIndex('email_1');
      console.log('✅ Email unique constraint removed - candidates can now have duplicate emails');
    }
  } catch (error) {
    // Silently handle errors - this is not critical for server startup
    if (error.message.includes('index not found')) {
      // Index already removed, which is good
    } else {
      console.log('ℹ️  Email index cleanup:', error.message);
    }
  }
};

module.exports = connectDB;
