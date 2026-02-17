/**
 * Backfill rule effects for existing rules that predate the `effects` field.
 *
 * Usage:
 *   node scripts/backfillRuleEffects.js
 */

const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const Rule = require('../models/Rule');
const { buildRuleEffectsFromCategory } = require('../services/governanceConfigService');

async function run() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to MongoDB');

        const rules = await Rule.find({});
        let updated = 0;

        for (const rule of rules) {
            const hasEffects = Array.isArray(rule.effects) && rule.effects.length > 0;
            if (hasEffects) continue;

            const effects = buildRuleEffectsFromCategory(rule.category);
            if (!effects || effects.length === 0) continue;

            rule.effects = effects;
            await rule.save();
            updated++;
        }

        console.log(`Backfill complete. Updated ${updated} rule(s).`);
        await mongoose.connection.close();
        process.exit(0);
    } catch (error) {
        console.error('Backfill failed:', error);
        process.exit(1);
    }
}

run();
