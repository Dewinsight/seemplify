const fs = require('fs');
const path = require('path');

const POLICY_FILE_NAME = 'mosaic_approver_rules_v2.json';
const PROCESS_RULE_IDS = new Set([4]);

const SCORING_KEY_BY_MOSAIC_KEY = {
    strategic_alignment: 'strategicAlignment',
    regulatory_risk: 'regulatoryRisk',
    business_impact: 'businessImpact',
    implementation_complexity: 'implementationComplexity',
    time_to_value: 'timeToValue',
    resource_requirements: 'resourceRequirements'
};

const DIMENSION_BY_TEXT = [
    { pattern: /strategic alignment/i, key: 'strategicAlignment' },
    { pattern: /regulatory risk/i, key: 'regulatoryRisk' },
    { pattern: /business impact/i, key: 'businessImpact' },
    { pattern: /implementation complexity/i, key: 'implementationComplexity' },
    { pattern: /time[-\s]?to[-\s]?value/i, key: 'timeToValue' },
    { pattern: /resource requirements/i, key: 'resourceRequirements' }
];

const BOOST_DELTAS_BY_RULE_ID = {
    40: 1,
    41: 1,
    42: 1,
    43: 1,
    44: 1,
    45: 1,
    46: 0.5,
    47: 0.5,
    48: 0.5,
    49: 0.5,
    50: 0.5,
    51: 0.5,
    52: 0.5,
    53: 0.5,
    54: 0.5,
    55: 0.5,
    56: 0.3,
    57: 0.3,
    58: 0.3,
    59: 0.3,
    60: 0.3,
    61: 0.3,
    62: 0.3,
    63: 0.3,
    64: 1,
    65: 0.5,
    66: 0.3,
    67: 0.2,
    68: 0.2
};

const PENALTY_DELTAS_BY_RULE_ID = {
    69: -2,
    70: -2,
    71: -2,
    72: -2,
    73: -1,
    74: -1,
    75: -1,
    76: -1,
    77: -1,
    78: -1,
    79: -1,
    80: -0.5,
    81: -1,
    82: -0.5,
    83: -0.5,
    84: -0.5,
    85: -0.5,
    86: -0.5
};

let cachedPolicy = null;
let cachedPolicyPath = null;

function candidatePolicyPaths() {
    const explicit = process.env.MOSAIC_POLICY_PATH;
    return [
        explicit,
        path.join(__dirname, '..', '..', POLICY_FILE_NAME),
        path.join(__dirname, '..', 'data', POLICY_FILE_NAME),
        path.join(process.cwd(), POLICY_FILE_NAME),
        path.join(process.cwd(), 'data', POLICY_FILE_NAME)
    ].filter(Boolean);
}

function resolvePolicyPath() {
    const match = candidatePolicyPaths().find((candidate) => fs.existsSync(candidate));
    if (!match) {
        throw new Error(`Mosaic policy file not found. Set MOSAIC_POLICY_PATH or include ${POLICY_FILE_NAME}.`);
    }
    return match;
}

function loadPolicy({ fresh = false } = {}) {
    if (cachedPolicy && !fresh) return cachedPolicy;

    cachedPolicyPath = resolvePolicyPath();
    cachedPolicy = JSON.parse(fs.readFileSync(cachedPolicyPath, 'utf8'));
    return cachedPolicy;
}

function getPolicyPath() {
    if (!cachedPolicyPath) loadPolicy();
    return cachedPolicyPath;
}

function getPolicyVersion() {
    const policy = loadPolicy();
    return {
        document: policy.document_meta?.document || 'Mosaic Approver Rules',
        effectiveDate: policy.document_meta?.effective_date || '',
        owner: policy.document_meta?.owner || '',
        sourcePath: getPolicyPath()
    };
}

function normalizeWeightPercent(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return number <= 1 ? number * 100 : number;
}

function getDefaultScoringWeights() {
    const weights = loadPolicy().priority_score_model?.formula?.weights || {};
    return Object.entries(SCORING_KEY_BY_MOSAIC_KEY).reduce((acc, [mosaicKey, appKey]) => {
        acc[appKey] = normalizeWeightPercent(weights[mosaicKey]);
        return acc;
    }, {});
}

function parseTierNumber(value) {
    const match = String(value || '').match(/(\d+)/);
    return match ? Number(match[1]) : null;
}

function getTierDefinitions() {
    return (loadPolicy().priority_score_model?.tier_classification?.tiers || [])
        .map((tier) => ({
            tier: parseTierNumber(tier.tier),
            label: tier.tier,
            riskLevel: tier.risk_level || '',
            minPriorityScore: Number(tier.score_range?.min),
            maxPriorityScore: Number(tier.score_range?.max),
            approvalAuthority: Array.isArray(tier.approval_authority) ? tier.approval_authority : []
        }))
        .filter((tier) => [1, 2, 3].includes(tier.tier));
}

function getAiGate() {
    const thresholds = loadPolicy().priority_score_model?.go_no_go_thresholds || {};
    return {
        rejectBelow: Number(thresholds.reject_below ?? 1.5),
        enhancedOversightMax: Number(thresholds.enhanced_oversight_range?.max ?? 2.0),
        enhancedOversightMin: Number(thresholds.enhanced_oversight_range?.min ?? thresholds.reject_below ?? 1.5),
        boundaryManualReviewDelta: Number(loadPolicy().priority_score_model?.tier_classification?.boundary_rule_manual_review_delta ?? 0.3)
    };
}

function shouldExcludeProcessRule(ruleId) {
    return PROCESS_RULE_IDS.has(Number(ruleId));
}

function getAtomicRules({ includeProcessRules = false } = {}) {
    const atomic = loadPolicy().atomic_rules_from_spreadsheet;
    if (!Array.isArray(atomic)) return [];
    return atomic.filter((rule) => includeProcessRules || !shouldExcludeProcessRule(rule.id));
}

function inferDimensionFromText(text) {
    const match = DIMENSION_BY_TEXT.find((item) => item.pattern.test(text));
    return match?.key || null;
}

function extractPriorityCap(description) {
    const text = String(description || '');
    const match = text.match(/(?:overall\s+)?Priority Score is capped at (?:a maximum of |)(\d+(?:\.\d+)?)/i)
        || text.match(/cannot exceed (?:Tier\s*)?(\d+(?:\.\d+)?)/i);
    return match ? Number(match[1]) : null;
}

function extractDimensionCap(description) {
    const text = String(description || '');
    const dimension = inferDimensionFromText(text);
    const match = text.match(/score is capped at (\d+(?:\.\d+)?)/i);
    if (!dimension || !match) return null;
    return { dimension, maxScore: Number(match[1]) };
}

function buildEffectsForAtomicRule(atomicRule) {
    const category = String(atomicRule?.category || '').trim().toUpperCase();
    const id = Number(atomicRule?.id);
    const effects = [];

    if (category === 'ESCALATION') {
        effects.push(
            { type: 'SET_TIER', params: { tier: 3, source: 'MOSAIC_ESCALATION_RULE' } },
            { type: 'SET_FLAG', params: { key: 'mandatoryEscalation', value: true } }
        );
    } else if (category === 'BOOST') {
        const delta = BOOST_DELTAS_BY_RULE_ID[id];
        if (Number.isFinite(delta)) {
            effects.push({ type: 'ADJUST_PRIORITY_SCORE', params: { delta, source: 'MOSAIC_BOOST' } });
        }
    } else if (category === 'PENALTY') {
        const delta = PENALTY_DELTAS_BY_RULE_ID[id];
        if (Number.isFinite(delta)) {
            effects.push({ type: 'ADJUST_PRIORITY_SCORE', params: { delta, source: 'MOSAIC_PENALTY' } });
        }
        if (id === 70) {
            effects.push({ type: 'SET_TIER', params: { tier: 3, source: 'MOSAIC_ETHICS_ESCALATION' } });
        }
    } else if (category === 'CAP') {
        const dimensionCap = extractDimensionCap(atomicRule.description);
        const priorityCap = extractPriorityCap(atomicRule.description);
        if (dimensionCap) {
            effects.push({
                type: 'CAP_DIMENSION_SCORE',
                params: {
                    dimension: dimensionCap.dimension,
                    maxScore: dimensionCap.maxScore,
                    source: 'MOSAIC_CAP'
                }
            });
        } else if (Number.isFinite(priorityCap)) {
            effects.push({
                type: 'CAP_PRIORITY_SCORE',
                params: { maxScore: priorityCap, source: 'MOSAIC_CAP' }
            });
        }
    }

    return effects;
}

function buildSystemRuleDoc(atomicRule) {
    const category = atomicRule.category || 'GENERAL';
    return {
        name: atomicRule.name,
        description: atomicRule.description,
        criteria: atomicRule.description,
        weight: atomicRule.weight_1_to_10 || 5,
        isMandatory: atomicRule.mandatory === true,
        department: null,
        isActive: true,
        isSystem: true,
        isHidden: false,
        category,
        effects: buildEffectsForAtomicRule(atomicRule),
        systemRuleId: atomicRule.id
    };
}

function buildScoringRubricText() {
    const policy = loadPolicy();
    const rubrics = policy.parameter_rubrics || {};
    const weights = policy.priority_score_model?.formula?.weights || {};
    const paramOrder = [
        { key: 'strategic_alignment', name: 'Strategic Alignment' },
        { key: 'regulatory_risk', name: 'Regulatory Risk' },
        { key: 'business_impact', name: 'Business Impact' },
        { key: 'implementation_complexity', name: 'Implementation Complexity' },
        { key: 'time_to_value', name: 'Time-to-Value' },
        { key: 'resource_requirements', name: 'Resource Requirements' }
    ];

    const lines = paramOrder.map(({ key, name }) => {
        const rubric = rubrics[key];
        const weightPct = normalizeWeightPercent(weights[key]);

        if (rubric?.top_level_rubric?.scale) {
            const defs = rubric.top_level_rubric.scale
                .map(s => `Score ${s.score}: ${s.label} - ${s.definition}`)
                .join('\n               ');
            return `${name} (${weightPct}% weight)\n               ${defs}`;
        }

        if (Array.isArray(rubric?.scale)) {
            const defs = rubric.scale
                .map(s => `Score ${s.score}: ${s.definition || s.profile || s.label || ''}`)
                .filter(Boolean)
                .join('\n               ');
            return defs
                ? `${name} (${weightPct}% weight)\n               ${defs}`
                : `${name} (${weightPct}% weight): ${rubric.description || ''}`;
        }

        return `${name} (${weightPct}% weight): ${rubric?.description || ''}`;
    });

    return {
        lines: lines.filter(Boolean).join('\n\n            '),
        formula: policy.priority_score_model?.formula?.expression || '',
        tiers: getTierDefinitions()
            .map(t => `- Tier ${t.tier}: ${t.minPriorityScore}-${t.maxPriorityScore}`)
            .join('\n            ')
    };
}

module.exports = {
    PROCESS_RULE_IDS,
    loadPolicy,
    getPolicyPath,
    getPolicyVersion,
    getDefaultScoringWeights,
    getTierDefinitions,
    getAiGate,
    getAtomicRules,
    shouldExcludeProcessRule,
    buildEffectsForAtomicRule,
    buildSystemRuleDoc,
    buildScoringRubricText
};
