'use strict';

async function verifySharedAIHealth(service = require('../services/sharedAIAccountService')) {
  const result = await service.health();
  if (result?.ok !== true || result.service !== 'seemplify-shared-ai-account'
      || result.consumer !== 'performance-management' || result.signatureVersion !== '2') {
    throw new Error('Shared AI authority identity could not be verified');
  }
  return { sharedAiReady: true, signatureVersion: '2' };
}

if (require.main === module) {
  verifySharedAIHealth().then((result) => console.log(JSON.stringify(result))).catch(() => {
    console.error('Performance could not verify its signed connection to the shared AI authority');
    process.exitCode = 1;
  });
}

module.exports = { verifySharedAIHealth };
