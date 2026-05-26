/**
 * Upload system rules from mosaic_approver_rules_v2.json to ALL organizations.
 * Uses ONLY the atomic_rules_from_spreadsheet array - no invented rules.
 *
 * Excludes process rule (id 4 only):
 * - 4: Minimum Priority Score - enforced in process flow (priorityScore thresholds)
 *
 * Rules 2 & 3 are AI-evaluated (reject at rules check level):
 * - 2: Group Head Pre-Approval - AI checks description for Group Head name + approval
 * - 3: HEART Sector Classification - AI checks description for HEART classification
 *
 * Run with: node scripts/uploadSystemRulesToAllOrgs.js
 *
 * Prerequisites:
 * - MONGO_URI in .env
 * - mosaic_approver_rules_v2.json in approver/ root
 */

const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const Organization = require('../models/Organization');
const { getAtomicRules } = require('../services/mosaicPolicyService');
const { seedSystemRulesForOrganization } = require('../services/systemRuleSeedService');

async function uploadSystemRulesToAllOrgs() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to MongoDB\n');

        const atomicRules = getAtomicRules({ includeProcessRules: false });
        console.log(`Loaded ${atomicRules.length} rules from mosaic_approver_rules_v2.json\n`);

        const orgs = await Organization.find({});
        if (orgs.length === 0) {
            console.log('No organizations found. Create organizations first.');
            await mongoose.connection.close();
            process.exit(0);
            return;
        }

        console.log(`Found ${orgs.length} organization(s)\n`);

        let totalCreated = 0;
        let totalUpdated = 0;
        let totalSkipped = 0;

        for (const org of orgs) {
            let created = 0;
            let updated = 0;
            let skipped = 0;

            const result = await seedSystemRulesForOrganization(org._id, {
                forcePolicySync: true,
                preserveRuntimeToggles: true,
                removeProcessRules: true
            });
            if (result.removedProcessRules > 0) {
                console.log(`  ${org.name}: removed ${result.removedProcessRules} process rule(s) (id 4)`);
            }
            created = result.created;
            updated = result.updated;
            skipped = result.skipped;

            totalCreated += created;
            totalUpdated += updated;
            totalSkipped += skipped;
            console.log(`  ${org.name} (${org.slug}): ${created} created, ${updated} updated, ${skipped} skipped`);
        }

        console.log(`\nDone. Total: ${totalCreated} created, ${totalUpdated} updated, ${totalSkipped} skipped across all orgs.`);
        await mongoose.connection.close();
        process.exit(0);
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

uploadSystemRulesToAllOrgs();
