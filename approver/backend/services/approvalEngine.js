const { getAiGate, getTierDefinitions } = require('./mosaicPolicyService');

const SCORING_KEYS = [
    'strategicAlignment',
    'regulatoryRisk',
    'businessImpact',
    'implementationComplexity',
    'timeToValue',
    'resourceRequirements'
];

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const round2 = (value) => Math.round(Number(value || 0) * 100) / 100;

function normalizeScore(value, fallback = 0) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return clamp(number, 1, 5);
}

function normalizeWeights(weights) {
    return SCORING_KEYS.reduce((acc, key) => {
        const value = Number(weights?.[key]);
        acc[key] = Number.isFinite(value) ? Math.max(0, value) : 0;
        return acc;
    }, {});
}

function getScoreValue(scoringBreakdown, key) {
    return normalizeScore(scoringBreakdown?.[key]?.score, 0);
}

function calculateWeightedPriorityScore(scoringBreakdown, scoringWeights) {
    const weights = normalizeWeights(scoringWeights);
    const totalWeight = SCORING_KEYS.reduce((sum, key) => sum + Number(weights[key] || 0), 0) || 100;
    const weighted = SCORING_KEYS.reduce((sum, key) => {
        return sum + (getScoreValue(scoringBreakdown, key) * (Number(weights[key] || 0) / totalWeight));
    }, 0);
    return round2(clamp(weighted, 1, 5));
}

function cloneScoringBreakdown(scoringBreakdown) {
    return JSON.parse(JSON.stringify(scoringBreakdown || {}));
}

function applyPriorityEffects({ basePriorityScore, scoringBreakdown, scoringWeights, appliedEffects }) {
    const adjustedBreakdown = cloneScoringBreakdown(scoringBreakdown);
    const scoreAdjustments = [];
    const scoreCapsApplied = [];
    const hasScoringBreakdown = scoringBreakdown && Object.keys(scoringBreakdown).length > 0;

    for (const effect of appliedEffects || []) {
        if (!hasScoringBreakdown) break;
        const type = String(effect?.type || '').toUpperCase();
        const params = effect?.params || {};

        if (type === 'CAP_DIMENSION_SCORE') {
            const dimension = String(params.dimension || '').trim();
            const maxScore = Number(params.maxScore);
            if (!SCORING_KEYS.includes(dimension) || !Number.isFinite(maxScore)) continue;

            const current = getScoreValue(adjustedBreakdown, dimension);
            if (current > maxScore) {
                adjustedBreakdown[dimension] = {
                    ...(adjustedBreakdown[dimension] || {}),
                    score: round2(maxScore),
                    reason: [
                        adjustedBreakdown[dimension]?.reason,
                        `Capped by ${effect.ruleName || 'Mosaic cap rule'} at ${maxScore}.`
                    ].filter(Boolean).join(' ')
                };
                scoreCapsApplied.push({
                    ruleId: effect.ruleId,
                    ruleName: effect.ruleName,
                    type,
                    dimension,
                    previousScore: current,
                    cappedScore: round2(maxScore)
                });
            }
        }
    }

    let priorityScore = hasScoringBreakdown
        ? calculateWeightedPriorityScore(adjustedBreakdown, scoringWeights)
        : round2(basePriorityScore);
    if (!Number.isFinite(priorityScore)) priorityScore = round2(basePriorityScore);

    for (const effect of appliedEffects || []) {
        const type = String(effect?.type || '').toUpperCase();
        const params = effect?.params || {};

        if (type === 'ADJUST_PRIORITY_SCORE') {
            const delta = Number(params.delta);
            if (!Number.isFinite(delta) || delta === 0) continue;
            const before = priorityScore;
            priorityScore = round2(clamp(priorityScore + delta, 1, 5));
            scoreAdjustments.push({
                ruleId: effect.ruleId,
                ruleName: effect.ruleName,
                delta,
                previousScore: before,
                adjustedScore: priorityScore
            });
        }
    }

    for (const effect of appliedEffects || []) {
        const type = String(effect?.type || '').toUpperCase();
        const params = effect?.params || {};

        if (type === 'CAP_PRIORITY_SCORE') {
            const maxScore = Number(params.maxScore);
            if (!Number.isFinite(maxScore)) continue;
            if (priorityScore > maxScore) {
                const before = priorityScore;
                priorityScore = round2(clamp(maxScore, 1, 5));
                scoreCapsApplied.push({
                    ruleId: effect.ruleId,
                    ruleName: effect.ruleName,
                    type,
                    previousScore: before,
                    cappedScore: priorityScore
                });
            }
        }
    }

    return {
        priorityScore: round2(clamp(priorityScore, 1, 5)),
        adjustedScoringBreakdown: adjustedBreakdown,
        scoreAdjustments,
        scoreCapsApplied
    };
}

function determineTierFromScore(priorityScore, workflowPolicy) {
    const policyTiers = Array.isArray(workflowPolicy?.tiers) && workflowPolicy.tiers.length > 0
        ? workflowPolicy.tiers
        : getTierDefinitions();
    const match = [...policyTiers]
        .sort((a, b) => Number(a.tier) - Number(b.tier))
        .find((tierDef) => {
            const min = Number(tierDef.minPriorityScore);
            const max = Number(tierDef.maxPriorityScore);
            if (!Number.isFinite(min) || !Number.isFinite(max)) return false;
            return priorityScore >= min && priorityScore <= max;
        });

    if (match && [1, 2, 3].includes(Number(match.tier))) return Number(match.tier);
    if (priorityScore >= 3.6) return 3;
    if (priorityScore >= 2.6) return 2;
    return 1;
}

function getManualReviewReasons(priorityScore, workflowPolicy) {
    const aiGate = getAiGate();
    const boundaryDelta = Number(workflowPolicy?.aiGate?.boundaryManualReviewDelta ?? aiGate.boundaryManualReviewDelta ?? 0.3);
    const tiers = Array.isArray(workflowPolicy?.tiers) && workflowPolicy.tiers.length > 0
        ? workflowPolicy.tiers
        : getTierDefinitions();
    const reasons = [];

    for (const tier of tiers) {
        const min = Number(tier.minPriorityScore);
        const max = Number(tier.maxPriorityScore);
        if (Number.isFinite(min) && Math.abs(priorityScore - min) <= boundaryDelta) {
            reasons.push(`Priority score ${priorityScore.toFixed(2)} is within ${boundaryDelta} of Tier ${tier.tier} lower boundary ${min}.`);
        }
        if (Number.isFinite(max) && Math.abs(priorityScore - max) <= boundaryDelta) {
            reasons.push(`Priority score ${priorityScore.toFixed(2)} is within ${boundaryDelta} of Tier ${tier.tier} upper boundary ${max}.`);
        }
    }

    return Array.from(new Set(reasons));
}

function resolveInitialStage({ tierWorkflow, escalationTriggered = false }) {
    const stages = Array.isArray(tierWorkflow?.stages) ? tierWorkflow.stages : [];
    if (stages.length === 0) return { stage: null, reason: 'No workflow stages configured.' };

    if (escalationTriggered) {
        const governance = stages.find(stage => String(stage.stageKey) === 'Governance');
        if (governance) {
            return {
                stage: governance,
                reason: 'Mandatory Mosaic escalation bypassed standard tier routing and started at Governance Committee.'
            };
        }
    }

    return {
        stage: stages[0],
        reason: `Standard Tier ${tierWorkflow?.tier || ''} workflow started at ${stages[0].label || stages[0].stageKey}.`
    };
}

module.exports = {
    SCORING_KEYS,
    calculateWeightedPriorityScore,
    applyPriorityEffects,
    determineTierFromScore,
    getManualReviewReasons,
    resolveInitialStage
};
