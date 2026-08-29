require('dotenv').config();

const mongoose = require('mongoose');
const { seedDefaultCompensationPolicies } = require('../services/compensationPolicyService');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const result = await seedDefaultCompensationPolicies();
  console.log(JSON.stringify(result));
  await mongoose.disconnect();
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
