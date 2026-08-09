'use strict';

require('dotenv').config();
const mongoose = require('mongoose');
const {
  reissueActionableFeedbackInvitations
} = require('../services/publicFeedbackReissueService');

function argument(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

async function main() {
  const send = process.argv.includes('--send');
  const organizationId = argument('organization');
  const limit = Number(argument('limit') || 100);
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) throw new Error('MONGO_URI is required');
  await mongoose.connect(mongoUri);
  const result = await reissueActionableFeedbackInvitations({
    organizationId,
    limit,
    send
  });
  console.log(JSON.stringify(result, null, 2));
  if (!send) {
    console.log('Dry run only. Re-run with --send to email newly capability-bound links.');
  }
}

main()
  .then(async () => {
    await mongoose.disconnect();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error(error.message || error);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
