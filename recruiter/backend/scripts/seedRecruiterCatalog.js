const mongoose = require('mongoose');
require('dotenv').config();

const { seedDefaultPlans } = require('./seedDefaultPlans');
const { seedCreditPacks } = require('./seedCreditPacks');

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('MONGODB_URI or MONGO_URI is required');

  await mongoose.connect(uri);
  console.log('MongoDB connected. Seeding the Recruiter admin catalogue...');

  try {
    const plans = await seedDefaultPlans();
    const creditPacks = await seedCreditPacks();
    console.log(JSON.stringify({ success: true, plans, creditPacks }));
  } finally {
    await mongoose.connection.close();
  }
}

main().catch(error => {
  console.error('Recruiter catalogue seed failed:', error.message);
  process.exitCode = 1;
});
