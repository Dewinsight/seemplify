'use strict';

// Backward-compatible entry point for operators that still invoke the former
// Recruiter-owned path. The implementation and ownership are platform-level.
const platformConfiguration = require('../../../tools/chatgpt-gateway/dokploy-configure.cjs');

if (require.main === module) {
  platformConfiguration.main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}

module.exports = platformConfiguration;
