require('dotenv').config();
const connectDatabase = require('../config/database');
const { EU_COUNTRIES, definitions, seedDefaultRulePacks } = require('../services/rulePackSeedService');

async function run({ apply = false } = {}) {
    if (!apply) {
        console.log(JSON.stringify({ dryRun: true, count: definitions().length, keys: definitions().map(pack => pack.key) }, null, 2));
        return;
    }
    await connectDatabase();
    const result = await seedDefaultRulePacks();
    console.log(`Rule-pack templates ready: ${result.inserted} added, ${result.existing} already present`);
    process.exit(0);
}

if (require.main === module) run({ apply: process.argv.includes('--apply') }).catch(error => {
    console.error(error);
    process.exit(1);
});

module.exports = { EU_COUNTRIES, definitions };
