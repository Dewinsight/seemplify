const Rule = require('../models/Rule');
const { ensureGovernanceConfigForOrganization } = require('./governanceConfigService');
const {
    PROCESS_RULE_IDS,
    getAtomicRules,
    buildSystemRuleDoc
} = require('./mosaicPolicyService');

function normalizeEffects(effects = []) {
    return (effects || []).map((effect) => ({
        type: effect?.type,
        params: effect?.params || {}
    }));
}

function comparableRule(rule) {
    return {
        name: rule.name,
        description: rule.description || '',
        criteria: rule.criteria,
        weight: rule.weight,
        isMandatory: rule.isMandatory === true,
        department: rule.department || null,
        category: rule.category || null,
        effects: normalizeEffects(rule.effects),
        isSystem: rule.isSystem === true
    };
}

async function seedSystemRulesForOrganization(organizationId, options = {}) {
    const {
        forcePolicySync = false,
        preserveRuntimeToggles = true,
        removeProcessRules = true
    } = options;

    await ensureGovernanceConfigForOrganization(organizationId, { forcePolicySync });

    let removed = 0;
    if (removeProcessRules) {
        const result = await Rule.deleteMany({
            organization: organizationId,
            isSystem: true,
            systemRuleId: { $in: Array.from(PROCESS_RULE_IDS) }
        });
        removed = result.deletedCount || 0;
    }

    let created = 0;
    let updated = 0;
    let skipped = 0;
    const atomicRules = getAtomicRules({ includeProcessRules: false });

    for (const atomic of atomicRules) {
        const doc = {
            ...buildSystemRuleDoc(atomic),
            organization: organizationId
        };

        const existing = await Rule.findOne({
            organization: organizationId,
            systemRuleId: atomic.id,
            isSystem: true
        });

        if (!existing) {
            await Rule.create(doc);
            created += 1;
            continue;
        }

        const updateDoc = {
            name: doc.name,
            description: doc.description,
            criteria: doc.criteria,
            weight: doc.weight,
            isMandatory: doc.isMandatory,
            department: doc.department,
            category: doc.category,
            effects: doc.effects,
            isSystem: true
        };

        if (!preserveRuntimeToggles) {
            updateDoc.isActive = doc.isActive;
            updateDoc.isHidden = doc.isHidden;
        }

        if (JSON.stringify(comparableRule(existing)) !== JSON.stringify(comparableRule(updateDoc))) {
            await Rule.updateOne({ _id: existing._id }, { $set: updateDoc });
            updated += 1;
        } else {
            skipped += 1;
        }
    }

    return {
        created,
        updated,
        skipped,
        removedProcessRules: removed,
        expectedSystemRules: atomicRules.length
    };
}

module.exports = {
    seedSystemRulesForOrganization
};
