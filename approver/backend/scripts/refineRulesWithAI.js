/**
 * AI-assisted rule refinement script.
 *
 * Purpose:
 * - Improve clarity of existing rules in bulk.
 * - Normalize deprecated effects to SET_TIER + SET_FLAG only.
 * - Apply updates across duplicate instances (e.g., same systemRuleId in multiple orgs).
 *
 * Usage:
 *   node scripts/refineRulesWithAI.js --scope=system --dry-run
 *   node scripts/refineRulesWithAI.js --scope=system --apply
 *   node scripts/refineRulesWithAI.js --scope=all --limit=100 --batch-size=10 --apply
 *
 * Notes:
 * - Default mode is dry-run unless --apply is provided.
 * - Requires Azure OpenAI env vars already used by the backend service.
 */

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const OpenAI = require('openai');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const Rule = require('../models/Rule');

const args = process.argv.slice(2);

const getArgValue = (name, fallback = null) => {
    const token = args.find((arg) => arg.startsWith(`--${name}=`));
    if (!token) return fallback;
    return token.split('=').slice(1).join('=');
};

const parsePositiveInt = (value, fallback) => {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return Math.floor(n);
};

const scope = String(getArgValue('scope', 'system')).trim().toLowerCase();
const limit = parsePositiveInt(getArgValue('limit', ''), 0);
const batchSize = parsePositiveInt(getArgValue('batch-size', ''), 12);
const explicitDryRun = args.includes('--dry-run');
const apply = args.includes('--apply');
const dryRun = explicitDryRun || !apply;

const ALLOWED_SCOPES = new Set(['system', 'custom', 'all']);
const ALLOWED_CATEGORIES = [
    'GATE',
    'ESCALATION',
    'SCORING',
    'STRATEGIC',
    'BOOST',
    'PENALTY',
    'CAP',
    'Security',
    'Architecture',
    'Other'
];

const CATEGORY_MAP = {
    GATE: 'GATE',
    ESCALATION: 'ESCALATION',
    SCORING: 'SCORING',
    STRATEGIC: 'STRATEGIC',
    BOOST: 'BOOST',
    PENALTY: 'PENALTY',
    CAP: 'CAP',
    SECURITY: 'Security',
    ARCHITECTURE: 'Architecture',
    OTHER: 'Other'
};

const toId = (value) => {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'object' && value.toString) return value.toString();
    return String(value);
};

const normalizeCategory = (value, fallback = 'Other') => {
    const raw = String(value || '').trim();
    if (!raw) return fallback;
    const mapped = CATEGORY_MAP[raw.toUpperCase()];
    if (mapped) return mapped;
    return ALLOWED_CATEGORIES.includes(raw) ? raw : fallback;
};

const stageToTier = (stageKey) => {
    const normalized = String(stageKey || '').trim().toLowerCase();
    if (normalized === 'centerofexcellence') return 1;
    if (normalized === 'governance') return 2;
    if (normalized === 'executive') return 3;
    return null;
};

const extractTierFromEffects = (effects) => {
    let forcedTier = null;
    const flags = [];

    (Array.isArray(effects) ? effects : []).forEach((effect) => {
        const type = String(effect?.type || '').toUpperCase();
        const params = effect?.params || {};

        if (type === 'SET_TIER') {
            const tier = Number(params.tier);
            if ([1, 2, 3].includes(tier)) {
                forcedTier = forcedTier == null ? tier : Math.max(forcedTier, tier);
            }
            return;
        }

        if (type === 'ROUTE_TO_STAGE') {
            const tier = stageToTier(params.stageKey);
            if ([1, 2, 3].includes(tier)) {
                forcedTier = forcedTier == null ? tier : Math.max(forcedTier, tier);
            }
            return;
        }

        if (type === 'SET_FLAG') {
            const key = typeof params.key === 'string' ? params.key.trim() : '';
            if (!key) return;
            flags.push({
                type: 'SET_FLAG',
                params: { key, value: params.value }
            });
        }
    });

    return { forcedTier, flags };
};

const buildNormalizedEffects = (existingEffects, aiTier) => {
    const { forcedTier: existingTier, flags } = extractTierFromEffects(existingEffects);
    const resolvedTier = Math.max(
        Number(existingTier || 0),
        [1, 2, 3].includes(Number(aiTier)) ? Number(aiTier) : 0
    );

    const nextEffects = [];
    if ([1, 2, 3].includes(resolvedTier)) {
        nextEffects.push({ type: 'SET_TIER', params: { tier: resolvedTier } });
    }
    nextEffects.push(...flags);
    return nextEffects;
};

const normalizeText = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');

const buildGroupKey = (rule) => {
    // For system rules, unify by source identity so all org copies receive the same refinement.
    if (rule.isSystem && rule.systemRuleId != null) {
        return `SYSTEM:${rule.systemRuleId}`;
    }

    // For custom rules, keep org isolation to avoid cross-tenant rewrites.
    const orgId = toId(rule.organization) || 'NO_ORG';
    return `CUSTOM:${orgId}:${normalizeText(rule.name)}:${normalizeText(rule.criteria)}`;
};

const buildScopeFilter = (selectedScope) => {
    if (selectedScope === 'system') return { isSystem: true };
    if (selectedScope === 'custom') return { isSystem: { $ne: true } };
    return {};
};

const stripCodeFence = (value) => {
    return String(value || '')
        .replace(/```json/gi, '')
        .replace(/```/g, '')
        .trim();
};

const createOpenAIClient = () => {
    if (!process.env.AZURE_OPENAI_API_KEY || !process.env.AZURE_OPENAI_ENDPOINT || !process.env.AZURE_OPENAI_DEPLOYMENT_NAME) {
        throw new Error('Missing Azure OpenAI configuration in backend .env');
    }

    return new OpenAI({
        apiKey: process.env.AZURE_OPENAI_API_KEY,
        baseURL: `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments/${process.env.AZURE_OPENAI_DEPLOYMENT_NAME}`,
        defaultQuery: { 'api-version': process.env.AZURE_OPENAI_API_VERSION },
        defaultHeaders: { 'api-key': process.env.AZURE_OPENAI_API_KEY }
    });
};

const refineBatch = async (client, batchInput) => {
    const prompt = `
You are refining enterprise governance rules for non-technical business users.
For each input item, rewrite the rule name and criteria to be clear, specific, and measurable.

Rules:
- Keep original policy intent and threshold meaning.
- Keep language concise and plain-English.
- Criteria must be evaluable as pass/fail.
- Category must be one of: ${ALLOWED_CATEGORIES.join(', ')}.
- tierEffect must be null or 1/2/3.
- Return JSON array only, with one output object for each input key.

Input:
${JSON.stringify(batchInput, null, 2)}

Output schema:
[
  {
    "key": "same key from input",
    "name": "refined rule title",
    "criteria": "refined pass/fail criteria",
    "category": "one allowed category",
    "tierEffect": 1 | 2 | 3 | null
  }
]
`;

    const completion = await client.chat.completions.create({
        messages: [
            {
                role: 'system',
                content: 'You rewrite policy rules for clarity. Return valid JSON only.'
            },
            {
                role: 'user',
                content: prompt
            }
        ],
        model: process.env.AZURE_OPENAI_DEPLOYMENT_NAME
    });

    const raw = completion.choices?.[0]?.message?.content || '';
    const parsed = JSON.parse(stripCodeFence(raw));
    if (!Array.isArray(parsed)) {
        throw new Error('Model output is not an array.');
    }
    return parsed;
};

async function run() {
    if (!ALLOWED_SCOPES.has(scope)) {
        console.error(`Invalid --scope "${scope}". Use one of: ${Array.from(ALLOWED_SCOPES).join(', ')}`);
        process.exit(1);
    }

    const client = createOpenAIClient();

    await mongoose.connect(process.env.MONGO_URI);
    console.log(`Connected to MongoDB (scope=${scope}, dryRun=${dryRun}, batchSize=${batchSize}, limit=${limit || 'none'})`);

    const filter = buildScopeFilter(scope);
    const rules = await Rule.find(filter)
        .select('_id organization name criteria category isMandatory weight effects isSystem systemRuleId')
        .lean();

    if (rules.length === 0) {
        console.log('No rules found for selected scope.');
        await mongoose.connection.close();
        process.exit(0);
        return;
    }

    const grouped = new Map();
    rules.forEach((rule) => {
        const key = buildGroupKey(rule);
        if (!grouped.has(key)) {
            grouped.set(key, {
                key,
                representative: rule,
                ruleIds: [],
                count: 0
            });
        }
        const group = grouped.get(key);
        group.ruleIds.push(rule._id);
        group.count += 1;
    });

    let groups = Array.from(grouped.values()).sort((a, b) => b.count - a.count);
    if (limit > 0) groups = groups.slice(0, limit);

    const inputItems = groups.map((group) => {
        const rule = group.representative;
        const extracted = extractTierFromEffects(rule.effects || []);
        return {
            key: group.key,
            name: String(rule.name || '').trim(),
            criteria: String(rule.criteria || '').trim(),
            category: normalizeCategory(rule.category || 'Other'),
            mandatory: rule.isMandatory === true,
            weight: Number(rule.weight || 1),
            tierEffect: [1, 2, 3].includes(Number(extracted.forcedTier)) ? Number(extracted.forcedTier) : null
        };
    });

    const refinedByKey = new Map();
    const failures = [];

    for (let i = 0; i < inputItems.length; i += batchSize) {
        const batch = inputItems.slice(i, i + batchSize);
        const batchNumber = Math.floor(i / batchSize) + 1;
        const totalBatches = Math.ceil(inputItems.length / batchSize);
        process.stdout.write(`Refining batch ${batchNumber}/${totalBatches} (${batch.length} rules)... `);

        try {
            const refinedBatch = await refineBatch(client, batch);
            refinedBatch.forEach((item) => {
                const key = String(item?.key || '').trim();
                if (!key) return;
                refinedByKey.set(key, item);
            });
            console.log('ok');
        } catch (error) {
            console.log('failed');
            failures.push({
                batch: batchNumber,
                error: error.message,
                keys: batch.map((item) => item.key)
            });
        }
    }

    const bulkOps = [];
    let changedGroups = 0;
    let changedRules = 0;

    const preview = [];

    for (const group of groups) {
        const rule = group.representative;
        const refined = refinedByKey.get(group.key);

        const nextName = String(refined?.name || rule.name || '').trim() || String(rule.name || '').trim();
        const nextCriteria = String(refined?.criteria || rule.criteria || '').trim() || String(rule.criteria || '').trim();
        const nextCategory = normalizeCategory(refined?.category, normalizeCategory(rule.category || 'Other'));
        const nextEffects = buildNormalizedEffects(rule.effects || [], refined?.tierEffect);

        const changed =
            nextName !== String(rule.name || '').trim() ||
            nextCriteria !== String(rule.criteria || '').trim() ||
            nextCategory !== normalizeCategory(rule.category || 'Other') ||
            JSON.stringify(nextEffects) !== JSON.stringify(Array.isArray(rule.effects) ? rule.effects : []);

        if (!changed) continue;

        changedGroups += 1;
        changedRules += group.ruleIds.length;

        preview.push({
            key: group.key,
            sampleRuleNameBefore: rule.name,
            sampleRuleNameAfter: nextName,
            sampleCriteriaBefore: rule.criteria,
            sampleCriteriaAfter: nextCriteria,
            categoryBefore: rule.category || 'Other',
            categoryAfter: nextCategory,
            rulesAffected: group.ruleIds.length
        });

        bulkOps.push({
            updateMany: {
                filter: { _id: { $in: group.ruleIds } },
                update: {
                    $set: {
                        name: nextName,
                        criteria: nextCriteria,
                        category: nextCategory,
                        effects: nextEffects
                    }
                }
            }
        });
    }

    if (!dryRun && bulkOps.length > 0) {
        await Rule.bulkWrite(bulkOps, { ordered: false });
    }

    const summary = {
        scope,
        dryRun,
        totalRulesScanned: rules.length,
        uniqueRuleTemplates: groups.length,
        aiRefinedTemplates: refinedByKey.size,
        changedTemplates: changedGroups,
        changedRules,
        failedBatches: failures.length
    };

    const reportDir = path.join(__dirname, 'reports');
    fs.mkdirSync(reportDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportPath = path.join(reportDir, `rule-refine-report-${timestamp}.json`);
    fs.writeFileSync(reportPath, JSON.stringify({
        summary,
        failures,
        preview: preview.slice(0, 50)
    }, null, 2));

    console.log('\n=== REFINE SUMMARY ===');
    console.log(JSON.stringify(summary, null, 2));
    console.log(`Report: ${reportPath}`);

    if (failures.length > 0) {
        console.log('\nSome batches failed. Review report for fallback handling.');
    }

    await mongoose.connection.close();
    process.exit(0);
}

run().catch(async (error) => {
    console.error('Rule refinement failed:', error);
    try {
        await mongoose.connection.close();
    } catch (_) {
        // ignore close error
    }
    process.exit(1);
});
