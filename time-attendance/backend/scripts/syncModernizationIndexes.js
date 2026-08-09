/**
 * Removes the legacy fixed 90-day TTL from raw presence evidence so the
 * organization-specific leased retention job can summarize before deletion.
 * Dry-run is the default; pass --apply after taking a database snapshot.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { PresenceEvent } = require('../models');

async function run() {
    const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
    if (!uri) throw new Error('MONGODB_URI is required');
    await mongoose.connect(uri);
    try {
        const indexes = await PresenceEvent.collection.indexes();
        const legacy = indexes.filter(index => index.key?.occurredAt === 1 && index.expireAfterSeconds != null);
        const report = { apply: process.argv.includes('--apply'), legacyIndexes: legacy.map(index => ({ name: index.name, expireAfterSeconds: index.expireAfterSeconds })) };
        if (report.apply) {
            for (const index of legacy) await PresenceEvent.collection.dropIndex(index.name);
            await PresenceEvent.collection.createIndex({ occurredAt: 1 });
            report.completed = true;
        }
        console.log(JSON.stringify(report, null, 2));
    } finally { await mongoose.disconnect(); }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
