const mongoose = require('mongoose');
require('dotenv').config();

const Admin = require('../models/Admin');

async function reconcileIdpAdminLocks() {
  const result = await Admin.updateMany(
    {
      isActive: true,
      lockUntil: { $gt: new Date() },
      $or: [
        { idpAccountId: { $exists: true, $ne: '' } },
        { lastSsoLoginAt: { $exists: true } }
      ]
    },
    {
      $set: { loginAttempts: 0 },
      $unset: { lockUntil: 1 }
    }
  );

  return { matched: result.matchedCount, unlocked: result.modifiedCount };
}

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('MONGODB_URI or MONGO_URI is required');

  await mongoose.connect(uri);
  try {
    const result = await reconcileIdpAdminLocks();
    console.log(JSON.stringify({ success: true, ...result }));
  } finally {
    await mongoose.connection.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Failed to reconcile IdP admin locks:', error.message);
    process.exitCode = 1;
  });
}

module.exports = { reconcileIdpAdminLocks };
