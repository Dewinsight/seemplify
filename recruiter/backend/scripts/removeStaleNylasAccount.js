/**
 * One-off script to remove a stale NylasAccount document from MongoDB.
 * 
 * Usage: node scripts/removeStaleNylasAccount.js
 * 
 * This removes the soft-deleted (or stuck) NylasAccount with
 * clientId: f2a65b3a-e3ff-4d64-ba8d-e0e23aca2e92
 * so it can be re-added through the admin UI.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI;
const TARGET_CLIENT_ID = 'f2a65b3a-e3ff-4d64-ba8d-e0e23aca2e92';

async function main() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGO_URI);
    console.log('Connected.\n');

    const NylasAccount = require('../models/NylasAccount');

    // Find the account first
    const account = await NylasAccount.findOne({ clientId: TARGET_CLIENT_ID });

    if (!account) {
      console.log(`No NylasAccount found with clientId: ${TARGET_CLIENT_ID}`);
      console.log('It may have already been removed.');
      process.exit(0);
    }

    console.log('Found stale account:');
    console.log(`  _id:      ${account._id}`);
    console.log(`  name:     ${account.name}`);
    console.log(`  clientId: ${account.clientId}`);
    console.log(`  active:   ${account.active}`);
    console.log(`  verified: ${account.verified}`);
    console.log(`  created:  ${account.createdAt}`);
    console.log('');

    // Check if any users are still linked to this account
    const User = require('../models/User');
    const linkedUsers = await User.countDocuments({
      nylasAccountId: account._id,
      calendarConnected: true,
      nylasGrantId: { $exists: true, $ne: null }
    });

    if (linkedUsers > 0) {
      console.log(`WARNING: ${linkedUsers} user(s) still have active grants on this account.`);
      console.log('Proceeding with hard delete anyway (grants will be orphaned).');
    }

    // Hard delete
    const result = await NylasAccount.deleteOne({ _id: account._id });
    console.log(`Deleted ${result.deletedCount} document(s).`);
    console.log('Done. You can now re-add this account through the admin UI.');

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

main();
