/**
 * One-off: Mongo candidate embedding coverage (+ Weaviate count if reachable).
 * Run: node scripts/embeddingCoverageReport.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Candidate = require('../models/Candidate');

async function main() {
  if (!process.env.MONGO_URI) {
    console.error('MONGO_URI missing');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  const total = await Candidate.countDocuments();
  const isEmbeddedTrue = await Candidate.countDocuments({ isEmbedded: true });
  const notMarkedEmbedded = total - isEmbeddedTrue;
  const withResume = await Candidate.countDocuments({
    resumeText: { $exists: true, $nin: [null, ''] },
  });
  const embeddedNoFlag = await Candidate.countDocuments({
    $or: [{ isEmbedded: { $exists: false } }, { isEmbedded: false }],
    embeddingCreatedAt: { $exists: true, $ne: null },
  });

  console.log('\n=== MongoDB: smart_hr_db / Candidate ===\n');
  console.log(JSON.stringify({
    totalCandidates: total,
    isEmbeddedTrue,
    notMarkedEmbedded,
    pctEmbedded: total ? Math.round((isEmbeddedTrue / total) * 10000) / 100 : 0,
    withResumeText: withResume,
    anomaly_embeddingCreatedAtButNotFlag: embeddedNoFlag,
  }, null, 2));

  try {
    const weaviateService = require('../services/weaviateService');
    const stats = await weaviateService.getStats();
    console.log('\n=== Weaviate (if reachable) ===\n');
    console.log(JSON.stringify(stats, null, 2));
    if (!stats.error && typeof stats.candidates === 'number') {
      const gap = isEmbeddedTrue - stats.candidates;
      console.log('\nNote: Mongo isEmbedded=true:', isEmbeddedTrue, '| Weaviate Candidate objects:', stats.candidates,
        gap === 0 ? '(match)' : `(approx. gap: ${gap} — re-run migration or re-embed if Weaviate is source of truth)`);
    }
  } catch (e) {
    console.log('\n=== Weaviate ===\nCould not fetch stats:', e.message);
  }

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
