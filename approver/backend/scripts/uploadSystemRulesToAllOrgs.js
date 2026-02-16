/**
 * Upload system rules from mosaic_approver_rules_v2.json to ALL organizations.
 * Uses ONLY the atomic_rules_from_spreadsheet array — no invented rules.
 *
 * Excludes process rules (ids 2, 3, 4):
 * - 2: Group Head Pre-Approval — enforced at form validation
 * - 3: HEART Sector Classification — enforced at form validation
 * - 4: Minimum Priority Score — enforced in process flow (priorityScore thresholds)
 *
 * Run with: node scripts/uploadSystemRulesToAllOrgs.js
 *
 * Prerequisites:
 * - MONGO_URI in .env
 * - mosaic_approver_rules_v2.json in approver/ root
 */

const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const Rule = require('../models/Rule');
const Organization = require('../models/Organization');

const RULES_JSON_PATH = path.join(__dirname, '..', '..', 'mosaic_approver_rules_v2.json');

/** Process rule IDs: enforced by form/process, not LLM evaluation */
const PROCESS_RULE_IDS = [2, 3, 4];

function loadRulesFromJson() {
    if (!fs.existsSync(RULES_JSON_PATH)) {
        throw new Error(`Rules file not found: ${RULES_JSON_PATH}`);
    }
    const raw = fs.readFileSync(RULES_JSON_PATH, 'utf8');
    const data = JSON.parse(raw);
    const atomic = data.atomic_rules_from_spreadsheet;
    if (!Array.isArray(atomic)) {
        throw new Error('atomic_rules_from_spreadsheet not found or not an array in JSON');
    }
    return atomic.filter(r => !PROCESS_RULE_IDS.includes(r.id));
}

function toRuleDoc(atomic) {
    return {
        name: atomic.name,
        description: atomic.description,
        criteria: atomic.description, // AI uses description as evaluation criteria
        weight: atomic.weight_1_to_10 || 5,
        isMandatory: atomic.mandatory === true,
        department: null, // Global
        isActive: true,
        isSystem: true,
        isHidden: false,
        category: atomic.category || 'GENERAL',
        systemRuleId: atomic.id
    };
}

async function uploadSystemRulesToAllOrgs() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to MongoDB\n');

        const atomicRules = loadRulesFromJson();
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
        let totalSkipped = 0;

        for (const org of orgs) {
            let created = 0;
            let skipped = 0;

            // Remove process rules (2, 3, 4) that were previously uploaded — now enforced by form/process
            const removed = await Rule.deleteMany({
                organization: org._id,
                isSystem: true,
                systemRuleId: { $in: PROCESS_RULE_IDS }
            });
            if (removed.deletedCount > 0) {
                console.log(`  ${org.name}: removed ${removed.deletedCount} process rule(s) (ids 2, 3, 4)`);
            }

            for (const atomic of atomicRules) {
                const existing = await Rule.findOne({
                    organization: org._id,
                    systemRuleId: atomic.id,
                    isSystem: true
                });
                if (existing) {
                    skipped++;
                    continue;
                }

                const doc = toRuleDoc(atomic);
                doc.organization = org._id;
                await Rule.create(doc);
                created++;
            }

            totalCreated += created;
            totalSkipped += skipped;
            console.log(`  ${org.name} (${org.slug}): ${created} created, ${skipped} skipped`);
        }

        console.log(`\nDone. Total: ${totalCreated} created, ${totalSkipped} skipped across all orgs.`);
        await mongoose.connection.close();
        process.exit(0);
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

uploadSystemRulesToAllOrgs();
