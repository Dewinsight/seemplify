/**
 * Sanitize rules data for all organizations.
 *
 * Actions:
 * 1) Remove orphan rules (missing org or org no longer exists).
 * 2) Infer and set category where missing.
 * 3) Backfill effects from category mapping (e.g. ESCALATION -> SET_TIER 3).
 * 4) Normalize legacy effects (remove ROUTE_TO_STAGE, keep SET_TIER + SET_FLAG).
 * 5) Soft-disable duplicate rules in the same org (hide + deactivate duplicates).
 *
 * Usage:
 *   node scripts/sanitizeRules.js
 *   node scripts/sanitizeRules.js --dry-run
 */

const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const Rule = require('../models/Rule');
const Organization = require('../models/Organization');
const { buildRuleEffectsFromCategory } = require('../services/governanceConfigService');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');

const toId = (value) => {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'object' && value.toString) return value.toString();
    return String(value);
};

const toDeptKey = (department) => {
    if (!department) return 'GLOBAL';
    return toId(department) || 'GLOBAL';
};

const inferCategory = (rule) => {
    const existing = String(rule.category || '').trim();
    if (existing) return existing;

    const hint = `${rule.name || ''} ${rule.description || ''} ${rule.criteria || ''}`;

    if (/(escalat|tier\s*3|trigger)/i.test(hint)) return 'ESCALATION';
    if (/(security|encryption|soc\s*2|compliance|privacy|rbac)/i.test(hint)) return 'Security';
    if (/(architecture|technology stack|integration|third-party|api|devops|infrastructure)/i.test(hint)) return 'Architecture';

    return 'Other';
};

const tierFromStageKey = (stageKey) => {
    const normalized = String(stageKey || '').trim().toLowerCase();
    if (normalized === 'centerofexcellence') return 1;
    if (normalized === 'governance') return 2;
    if (normalized === 'executive') return 3;
    return null;
};

async function findDuplicateGroups(matchFilter, keyBuilder) {
    const docs = await Rule.find(matchFilter)
        .select('_id organization name criteria department isSystem systemRuleId createdAt')
        .sort({ createdAt: 1, _id: 1 })
        .lean();

    const groups = new Map();

    for (const doc of docs) {
        const key = keyBuilder(doc);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(doc);
    }

    return Array.from(groups.values()).filter(group => group.length > 1);
}

async function run() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log(`Connected to MongoDB (dryRun=${dryRun})`);

        const organizations = await Organization.find({}, '_id').lean();
        const validOrgIds = new Set(organizations.map((org) => toId(org._id)));

        const before = {
            totalRules: await Rule.countDocuments({}),
            withEffects: await Rule.countDocuments({ effects: { $exists: true, $not: { $size: 0 } } }),
            missingCategory: await Rule.countDocuments({ $or: [{ category: { $exists: false } }, { category: null }, { category: '' }] })
        };

        const allRules = await Rule.find({}).select('_id organization').lean();
        const orphanIds = allRules
            .filter((rule) => {
                const orgId = toId(rule.organization);
                return !orgId || !validOrgIds.has(orgId);
            })
            .map((rule) => rule._id);

        let orphanRemoved = 0;
        if (orphanIds.length > 0) {
            if (!dryRun) {
                const removeResult = await Rule.deleteMany({ _id: { $in: orphanIds } });
                orphanRemoved = removeResult.deletedCount || 0;
            } else {
                orphanRemoved = orphanIds.length;
            }
        }

        const missingCategoryRules = await Rule.find({
            $or: [{ category: { $exists: false } }, { category: null }, { category: '' }]
        })
            .select('_id name description criteria category')
            .lean();

        let categoriesUpdated = 0;
        for (const rule of missingCategoryRules) {
            const category = inferCategory(rule);
            if (!dryRun) {
                await Rule.updateOne({ _id: rule._id }, { $set: { category } });
            }
            categoriesUpdated++;
        }

        const rulesNeedingEffects = await Rule.find({
            $or: [
                { effects: { $exists: false } },
                { effects: null },
                { effects: { $size: 0 } }
            ]
        })
            .select('_id category name description criteria')
            .lean();

        let effectsUpdated = 0;
        for (const rule of rulesNeedingEffects) {
            const category = inferCategory(rule);
            const nextEffects = buildRuleEffectsFromCategory(category);
            if (!Array.isArray(nextEffects) || nextEffects.length === 0) continue;
            if (!dryRun) {
                await Rule.updateOne({ _id: rule._id }, { $set: { effects: nextEffects, category } });
            }
            effectsUpdated++;
        }

        const rulesWithLegacyEffects = await Rule.find({ effects: { $exists: true, $not: { $size: 0 } } })
            .select('_id effects')
            .lean();

        let legacyEffectsNormalized = 0;
        for (const rule of rulesWithLegacyEffects) {
            const currentEffects = Array.isArray(rule.effects) ? rule.effects : [];
            let forcedTier = null;
            const flags = [];

            currentEffects.forEach((effect) => {
                const type = String(effect?.type || '').toUpperCase();
                const params = effect?.params || {};

                if (type === 'SET_TIER') {
                    const tierValue = Number(params.tier);
                    if ([1, 2, 3].includes(tierValue)) {
                        forcedTier = forcedTier == null ? tierValue : Math.max(forcedTier, tierValue);
                    }
                    return;
                }

                if (type === 'ROUTE_TO_STAGE') {
                    const routeTier = tierFromStageKey(params.stageKey);
                    if ([1, 2, 3].includes(routeTier)) {
                        forcedTier = forcedTier == null ? routeTier : Math.max(forcedTier, routeTier);
                    }
                    return;
                }

                if (type === 'SET_FLAG') {
                    const key = typeof params.key === 'string' ? params.key.trim() : '';
                    if (!key) return;
                    flags.push({ type: 'SET_FLAG', params: { key, value: params.value } });
                }
            });

            const nextEffects = [];
            if ([1, 2, 3].includes(Number(forcedTier))) {
                nextEffects.push({ type: 'SET_TIER', params: { tier: Number(forcedTier) } });
            }
            nextEffects.push(...flags);

            if (JSON.stringify(nextEffects) === JSON.stringify(currentEffects)) continue;
            if (!dryRun) {
                await Rule.updateOne({ _id: rule._id }, { $set: { effects: nextEffects } });
            }
            legacyEffectsNormalized++;
        }

        const customDuplicateGroups = await findDuplicateGroups(
            { isSystem: { $ne: true } },
            (doc) => [toId(doc.organization), toDeptKey(doc.department), doc.name || '', doc.criteria || '', 'custom'].join('|')
        );

        const systemDuplicateGroups = await findDuplicateGroups(
            { isSystem: true, systemRuleId: { $exists: true, $ne: null } },
            (doc) => [toId(doc.organization), doc.systemRuleId, 'system'].join('|')
        );

        const duplicateIdsToDisable = [];

        for (const group of customDuplicateGroups) {
            const duplicateDocs = group.slice(1);
            duplicateDocs.forEach((doc) => duplicateIdsToDisable.push(doc._id));
        }

        for (const group of systemDuplicateGroups) {
            const duplicateDocs = group.slice(1);
            duplicateDocs.forEach((doc) => duplicateIdsToDisable.push(doc._id));
        }

        let duplicatesDisabled = 0;
        if (duplicateIdsToDisable.length > 0) {
            if (!dryRun) {
                const updateResult = await Rule.updateMany(
                    { _id: { $in: duplicateIdsToDisable } },
                    { $set: { isActive: false, isHidden: true } }
                );
                duplicatesDisabled = updateResult.modifiedCount || 0;
            } else {
                duplicatesDisabled = duplicateIdsToDisable.length;
            }
        }

        const after = {
            totalRules: dryRun ? before.totalRules - orphanRemoved : await Rule.countDocuments({}),
            withEffects: dryRun ? before.withEffects + effectsUpdated : await Rule.countDocuments({ effects: { $exists: true, $not: { $size: 0 } } }),
            missingCategory: dryRun ? Math.max(0, before.missingCategory - categoriesUpdated) : await Rule.countDocuments({ $or: [{ category: { $exists: false } }, { category: null }, { category: '' }] })
        };

        console.log('\n=== SANITIZE SUMMARY ===');
        console.log(JSON.stringify({
            dryRun,
            before,
            actions: {
                orphanRemoved,
                categoriesUpdated,
                effectsUpdated,
                legacyEffectsNormalized,
                duplicatesDisabled,
                customDuplicateGroups: customDuplicateGroups.length,
                systemDuplicateGroups: systemDuplicateGroups.length
            },
            after
        }, null, 2));

        await mongoose.connection.close();
        process.exit(0);
    } catch (error) {
        console.error('Rule sanitize failed:', error);
        try {
            await mongoose.connection.close();
        } catch (_) {
            // ignore close errors
        }
        process.exit(1);
    }
}

run();
