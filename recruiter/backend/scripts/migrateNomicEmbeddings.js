const mongoose = require('mongoose');
const { requireEmbeddingRuntimeConfig } = require('../config/embeddingRuntimeConfig');
const { migrateNomicIndex } = require('../services/nomicIndexMigration');
async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  try {
    const proof = await migrateNomicIndex({ db: mongoose.connection.db, service: require('../services/embeddingService'), store: require('../services/weaviateService'), config: requireEmbeddingRuntimeConfig() });
    console.log(JSON.stringify({ event: 'recruiter-nomic-index-verified', ...proof }));
  } finally { await mongoose.disconnect(); }
}
if (require.main === module) main().then(() => process.exit(0)).catch(() => { console.error('Recruiter Nomic migration failed; keeping the previous release.'); process.exit(1); });
module.exports = { main };
