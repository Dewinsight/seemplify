const test = require('node:test');
const assert = require('node:assert/strict');

const {
    calculateWeightedPriorityScore,
    applyPriorityEffects,
    determineTierFromScore,
    getManualReviewReasons,
    resolveInitialStage
} = require('../services/approvalEngine');
const {
    DEFAULT_WORKFLOW_POLICY
} = require('../services/governanceConfigService');
const {
    getAtomicRules,
    getDefaultScoringWeights
} = require('../services/mosaicPolicyService');
const {
    roleMatches,
    hasAnyCapability,
    getDepartmentsForCapabilities
} = require('../utils/access');

function scoringBreakdown(scoreByKey) {
    return Object.fromEntries(
        Object.entries(scoreByKey).map(([key, score]) => [key, { score, reason: 'test' }])
    );
}

test('calculates weighted score and tier boundaries from Mosaic policy', () => {
    const weights = getDefaultScoringWeights();
    const breakdown = scoringBreakdown({
        strategicAlignment: 4,
        regulatoryRisk: 3,
        businessImpact: 5,
        implementationComplexity: 2,
        timeToValue: 4,
        resourceRequirements: 3
    });

    assert.equal(calculateWeightedPriorityScore(breakdown, weights), 3.6);
    assert.equal(determineTierFromScore(2.5, DEFAULT_WORKFLOW_POLICY), 1);
    assert.equal(determineTierFromScore(2.6, DEFAULT_WORKFLOW_POLICY), 2);
    assert.equal(determineTierFromScore(3.6, DEFAULT_WORKFLOW_POLICY), 3);
});

test('below 1.5 scores are rejected by the default AI gate', () => {
    const gate = DEFAULT_WORKFLOW_POLICY.aiGate;
    const priorityScore = 1.49;

    assert.equal(priorityScore < gate.rejectBelow, true);
    assert.equal(determineTierFromScore(priorityScore, DEFAULT_WORKFLOW_POLICY), 1);
});

test('1.5 to 2.0 scores require enhanced oversight', () => {
    const gate = DEFAULT_WORKFLOW_POLICY.aiGate;
    const priorityScore = 1.75;

    assert.equal(priorityScore >= gate.rejectBelow && priorityScore < gate.enhancedOversightMax, true);
});

test('near-boundary scores produce manual review reasons', () => {
    const reasons = getManualReviewReasons(2.48, DEFAULT_WORKFLOW_POLICY);

    assert.ok(reasons.some(reason => reason.includes('Tier 1 upper boundary')));
    assert.ok(reasons.some(reason => reason.includes('Tier 2 lower boundary')));
});

test('mandatory escalation starts Tier 3 workflow at Governance', () => {
    const tier3 = DEFAULT_WORKFLOW_POLICY.tiers.find(tier => tier.tier === 3);
    const result = resolveInitialStage({ tierWorkflow: tier3, escalationTriggered: true });

    assert.equal(result.stage.stageKey, 'Governance');
    assert.match(result.reason, /Mandatory Mosaic escalation/);
});

test('Tier 2 requires two Center of Excellence approvals before Governance', () => {
    const tier2 = DEFAULT_WORKFLOW_POLICY.tiers.find(tier => tier.tier === 2);
    const coeStage = tier2.stages.find(stage => stage.stageKey === 'CenterOfExcellence');
    const governanceStage = tier2.stages.find(stage => stage.stageKey === 'Governance');

    assert.equal(coeStage.minApprovals, 2);
    assert.equal(governanceStage.stageKey, 'Governance');
});

test('cap, boost, and penalty effects apply after base priority scoring', () => {
    const weights = getDefaultScoringWeights();
    const breakdown = scoringBreakdown({
        strategicAlignment: 5,
        regulatoryRisk: 4,
        businessImpact: 4,
        implementationComplexity: 4,
        timeToValue: 4,
        resourceRequirements: 4
    });
    const basePriorityScore = calculateWeightedPriorityScore(breakdown, weights);
    const result = applyPriorityEffects({
        basePriorityScore,
        scoringBreakdown: breakdown,
        scoringWeights: weights,
        appliedEffects: [
            {
                ruleId: 'cap-dimension',
                ruleName: 'Strategic cap',
                type: 'CAP_DIMENSION_SCORE',
                params: { dimension: 'strategicAlignment', maxScore: 3 }
            },
            {
                ruleId: 'boost',
                ruleName: 'Executive sponsor boost',
                type: 'ADJUST_PRIORITY_SCORE',
                params: { delta: 0.5 }
            },
            {
                ruleId: 'penalty',
                ruleName: 'Weak readiness penalty',
                type: 'ADJUST_PRIORITY_SCORE',
                params: { delta: -1 }
            },
            {
                ruleId: 'cap-priority',
                ruleName: 'Priority cap',
                type: 'CAP_PRIORITY_SCORE',
                params: { maxScore: 3.2 }
            }
        ]
    });

    assert.equal(result.adjustedScoringBreakdown.strategicAlignment.score, 3);
    assert.equal(result.priorityScore, 3.2);
    assert.equal(result.scoreAdjustments.length, 2);
    assert.equal(result.scoreCapsApplied.length, 2);
});

test('org-wide reviewer assignments apply across departments', () => {
    const user = {
        isAdmin: false,
        permissions: [
            { department: null, roles: ['GovernanceApprover'] }
        ],
        roleCatalog: {
            GovernanceApprover: ['projects.review.governance', 'dashboard.review']
        }
    };

    assert.equal(roleMatches(user, ['GovernanceApprover'], 'department-a'), true);
    assert.equal(hasAnyCapability(user, ['projects.review.governance'], 'department-b'), true);
    assert.deepEqual(getDepartmentsForCapabilities(user, ['projects.review.governance'], user.roleCatalog), ['*']);
});

test('Mosaic policy loads expected system rules and excludes process rule 4 by default', () => {
    const rules = getAtomicRules();
    const ids = rules.map(rule => Number(rule.id));

    assert.equal(rules.length, 95);
    assert.equal(ids.includes(4), false);
    assert.ok(ids.includes(1));
    assert.ok(ids.includes(96));
});
