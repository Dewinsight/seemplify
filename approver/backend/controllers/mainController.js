const Rule = require('../models/Rule');
const Project = require('../models/Project');
const Organization = require('../models/Organization');
const Role = require('../models/Role');
const Department = require('../models/Department');
const { randomUUID } = require('crypto');
const openAIService = require('../services/OpenAIService');
const weaviateVectorService = require('../services/WeaviateVectorService');
const {
    getWorkflowPolicyForOrganization,
    ensureGovernanceConfigForOrganization
} = require('../services/governanceConfigService');
const {
    roleMatches,
    getDepartmentsForCapabilities,
    buildRoleCatalog,
    sanitizePermissions,
    collectUserCapabilities
} = require('../utils/access');

const LEGACY_PENDING_STAGE_KEY = {
    'Pending Center of Excellence': 'CenterOfExcellence',
    'Pending Governance': 'Governance',
    'Pending Executive': 'Executive'
};

const getPendingStatusLabel = (stage) => stage.pendingStatusLabel || `Pending ${stage.label || stage.stageKey}`;
const getApprovedStatusLabel = (stage) => stage.approvedStatusLabel || `${stage.label || stage.stageKey} Approved`;
const getRejectedStatusLabel = (stage) => stage.rejectedStatusLabel || `${stage.label || stage.stageKey} Rejected`;

const resolveTierWorkflow = (project, workflowPolicy) => {
    if (project?.workflowPlan?.tier && Array.isArray(project.workflowPlan.stages) && project.workflowPlan.stages.length > 0) {
        return project.workflowPlan;
    }
    if (!workflowPolicy || !Array.isArray(workflowPolicy.tiers)) return null;
    const tierDef = workflowPolicy.tiers.find(t => Number(t.tier) === Number(project?.tier));
    return tierDef || null;
};

const resolveCurrentStageKey = (project) => project.currentStageKey || LEGACY_PENDING_STAGE_KEY[project.approvalStatus] || null;

const hasUserReviewedStage = (project, stageKey, userId) => {
    return (project.approvalHistory || []).some((entry) =>
        String(entry.stage) === String(stageKey) &&
        entry.by &&
        String(entry.by) === String(userId)
    );
};

const countApprovedReviewsForStage = (project, stageKey) => {
    const uniqueApprovers = new Set();
    (project.approvalHistory || []).forEach((entry) => {
        if (String(entry.stage) !== String(stageKey)) return;
        if (entry.action !== 'Approved') return;
        if (!entry.by) return;
        uniqueApprovers.add(String(entry.by));
    });
    return uniqueApprovers.size;
};

const getTierRouteLabel = (tierWorkflow) => {
    const stages = (tierWorkflow?.stages || [])
        .map(stage => stage.label || stage.stageKey)
        .filter(Boolean);
    return stages.length > 0 ? stages.join(' -> ') : 'manual workflow';
};

const DEFAULT_SCORING_WEIGHTS = {
    strategicAlignment: 25,
    regulatoryRisk: 25,
    businessImpact: 20,
    implementationComplexity: 15,
    timeToValue: 10,
    resourceRequirements: 5
};

const SCORING_WEIGHT_KEYS = Object.keys(DEFAULT_SCORING_WEIGHTS);
const TRIGGER_RULE_CATEGORIES = new Set(['ESCALATION', 'CAP', 'PENALTY', 'BOOST']);

const normalizeScoringWeights = (weights, fallback = DEFAULT_SCORING_WEIGHTS) => {
    const next = { ...fallback };
    SCORING_WEIGHT_KEYS.forEach((key) => {
        const value = Number(weights?.[key]);
        if (!Number.isNaN(value) && value >= 0 && value <= 100) {
            next[key] = value;
        }
    });
    return next;
};

const resolveScoringWeightsForDepartment = (workflowPolicy, departmentId) => {
    const globalWeights = normalizeScoringWeights(workflowPolicy?.scoringWeights || DEFAULT_SCORING_WEIGHTS);
    if (!departmentId) return globalWeights;

    const match = (workflowPolicy?.departmentScoringWeights || []).find((row) => {
        if (!row?.department) return false;
        return String(row.department) === String(departmentId);
    });

    if (!match || !match.weights) return globalWeights;
    return normalizeScoringWeights(match.weights, globalWeights);
};

const determineTierFromScore = (priorityScore, workflowPolicy) => {
    const tiers = Array.isArray(workflowPolicy?.tiers) ? [...workflowPolicy.tiers] : [];
    if (tiers.length > 0) {
        const sorted = tiers.sort((a, b) => Number(a.tier) - Number(b.tier));
        const match = sorted.find((tierDef) => {
            const min = Number(tierDef.minPriorityScore);
            const max = Number(tierDef.maxPriorityScore);
            if (Number.isNaN(min) || Number.isNaN(max)) return false;
            return priorityScore >= min && priorityScore <= max;
        });
        if (match && [1, 2, 3].includes(Number(match.tier))) {
            return Number(match.tier);
        }
    }

    if (priorityScore >= 3.6) return 3;
    if (priorityScore >= 2.6) return 2;
    return 1;
};

const applyTriggeredRuleEffects = (effectSourceAnalyses, sourceRuleById) => {
    const appliedEffects = [];
    let forcedTier = null;
    const effectFlags = {};

    effectSourceAnalyses.forEach((analysis) => {
        const sourceRule = sourceRuleById.get(String(analysis.ruleId));
        const effects = Array.isArray(sourceRule?.effects) ? sourceRule.effects : [];

        effects.forEach((effect) => {
            const type = String(effect?.type || '').toUpperCase();
            const params = effect?.params || {};

            if (type === 'SET_TIER') {
                const tierValue = Number(params.tier);
                if ([1, 2, 3].includes(tierValue)) {
                    forcedTier = forcedTier == null ? tierValue : Math.max(forcedTier, tierValue);
                }
            } else if (type === 'SET_FLAG') {
                const key = typeof params.key === 'string' ? params.key.trim() : '';
                if (key) effectFlags[key] = params.value;
            }

            appliedEffects.push({
                ruleId: analysis.ruleId,
                ruleName: analysis.ruleName,
                type,
                params
            });
        });
    });

    return { appliedEffects, forcedTier, effectFlags };
};

const normalizeRuleEffects = (effects) => {
    if (!Array.isArray(effects)) return [];

    const normalized = [];

    effects.forEach((effect) => {
        const type = String(effect?.type || '').trim().toUpperCase();
        const params = effect?.params || {};

        if (type === 'SET_TIER') {
            const tier = Number(params.tier);
            if ([1, 2, 3].includes(tier)) {
                normalized.push({ type: 'SET_TIER', params: { tier } });
            }
            return;
        }

        // Internal metadata; not exposed in standard rule creation UI.
        if (type === 'SET_FLAG') {
            const key = typeof params.key === 'string' ? params.key.trim() : '';
            if (!key) return;
            normalized.push({
                type: 'SET_FLAG',
                params: { key, value: params.value }
            });
        }
    });

    return normalized;
};

const FORM_ENUM_LABELS = {
    heartSectorClassification: {
        direct_heart_impact: 'Direct HEART Impact',
        indirect_heart_impact: 'Indirect HEART Impact',
        heart_adjacent: 'HEART-Adjacent',
        non_heart: 'Non-HEART'
    },
    whoAffected: {
        customers: 'Customers',
        staff: 'Staff',
        operations: 'Operations',
        all: 'All'
    },
    aiDirection: {
        automate: 'Automation',
        decisions: 'Better Decisions',
        customer_experience: 'Customer Experience',
        detect_patterns: 'Detect Patterns/Risk',
        not_sure: 'Not Sure'
    },
    dataStorage: {
        excel: 'Excel Files',
        banking_system: 'Core Banking System',
        customer_files: 'Customer Files',
        external: 'External Systems',
        not_sure: 'Not Sure'
    },
    involvesPersonalInfo: {
        yes: 'Yes',
        no: 'No',
        not_sure: 'Not Sure'
    },
    urgency: {
        urgent_3months: 'Urgent (within 3 months)',
        important_6months: 'Important (within 6 months)',
        can_wait_1year: 'Can wait (within 1 year)',
        nice_to_have: 'Nice to have'
    },
    budgetAvailable: {
        yes: 'Yes',
        no: 'No',
        not_sure: 'Not Sure'
    },
    teamTimeCommitment: {
        yes: 'Yes',
        limited: 'Limited',
        no: 'No'
    },
    improvements: {
        time: 'Time Savings',
        money: 'Cost Savings',
        customer: 'Customer Experience',
        errors: 'Error Reduction',
        decisions: 'Better Decisions'
    }
};

const HEART_CLASSIFICATION_NOTES = {
    direct_heart_impact: 'Directly advances one or more HEART sectors: Health, Education, Agriculture, Renewable Energy, Transportation.',
    indirect_heart_impact: 'Supports HEART sectors indirectly through enablers, shared capabilities, or secondary outcomes.',
    heart_adjacent: 'Related to the HEART mission but not directly within a primary HEART sector.',
    non_heart: 'Not aligned to a HEART sector outcome.'
};

const FORM_FIELD_ORDER = [
    'initiativeName',
    'submitterName',
    'submitterTitle',
    'submitterEmail',
    'submitterPhone',
    'groupHeadName',
    'confirmGroupHeadApproval',
    'groupHeadApproval',
    'heartSectorClassification',
    'problemDescription',
    'whoAffected',
    'currentHandling',
    'aiDirection',
    'aiIdea',
    'improvements',
    'timeSaved',
    'moneySaved',
    'customerBenefit',
    'errorReduction',
    'betterDecisions',
    'successMeasure',
    'dataNeeded',
    'dataStorage',
    'involvesPersonalInfo',
    'urgency',
    'budgetAvailable',
    'budgetAmount',
    'teamTimeCommitment',
    'teamHoursPerWeek',
    'previousAttempts',
    'regulations',
    'additionalContext',
    'confirmAccuracy',
    'confirmContactAcknowledgment'
];

const humanizeText = (value) => String(value || '').replace(/_/g, ' ').trim();

const humanizeFieldName = (key) => {
    return String(key || '')
        .replace(/([A-Z])/g, ' $1')
        .replace(/_/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^./, (char) => char.toUpperCase());
};

const formatFormValue = (fieldKey, value) => {
    if (value === undefined || value === null) return '(not provided)';

    if (Array.isArray(value)) {
        if (value.length === 0) return '(not provided)';
        const mapped = FORM_ENUM_LABELS[fieldKey] || {};
        return value
            .map((item) => {
                const raw = String(item || '').trim();
                if (!raw) return null;
                return mapped[raw] ? `${mapped[raw]} [${raw}]` : humanizeText(raw);
            })
            .filter(Boolean)
            .join(', ');
    }

    if (typeof value === 'boolean') return value ? 'Yes' : 'No';

    const raw = String(value).trim();
    if (!raw) return '(not provided)';

    const mapped = FORM_ENUM_LABELS[fieldKey] || {};
    if (mapped[raw]) return `${mapped[raw]} [${raw}]`;

    return humanizeText(raw);
};

const buildInitiativeAnalysisContext = ({ name, description, formData }) => {
    const sections = [];

    sections.push(`Initiative Name: ${name || '(not provided)'}`);

    if (description) {
        sections.push(`Narrative Description:\n${description}`);
    }

    if (formData && typeof formData === 'object') {
        const knownKeys = FORM_FIELD_ORDER.filter((key) => Object.prototype.hasOwnProperty.call(formData, key));
        const extraKeys = Object.keys(formData)
            .filter((key) => !FORM_FIELD_ORDER.includes(key))
            .sort();
        const orderedKeys = [...knownKeys, ...extraKeys];

        const fieldLines = orderedKeys.map((key) => {
            return `- ${humanizeFieldName(key)}: ${formatFormValue(key, formData[key])}`;
        });

        sections.push(`Structured Form Fields:\n${fieldLines.join('\n')}`);

        const heartKey = String(formData.heartSectorClassification || '').trim();
        if (heartKey && HEART_CLASSIFICATION_NOTES[heartKey]) {
            sections.push(
                `HEART Classification Explanation:\n` +
                `- Selected: ${formatFormValue('heartSectorClassification', heartKey)}\n` +
                `- Meaning: ${HEART_CLASSIFICATION_NOTES[heartKey]}`
            );
        }

        sections.push(`Raw Form JSON:\n${JSON.stringify(formData, null, 2)}`);
    }

    return sections.join('\n\n');
};

const normalizeRuleStatus = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    if (['pass', 'passed', 'ok', 'true', 'yes'].includes(normalized)) return 'Pass';
    if (['fail', 'failed', 'false', 'no', 'triggered', 'escalated'].includes(normalized)) return 'Fail';
    return null;
};

const isTriggerRuleCategory = (category) => TRIGGER_RULE_CATEGORIES.has(String(category || '').trim().toUpperCase());

const resolveRuleAnalysisStatus = (rule, evaluation) => {
    const rawStatus = normalizeRuleStatus(evaluation?.status) || 'Fail';
    const category = String(rule?.category || '').toUpperCase();

    // Trigger-style rules: Fail means trigger condition is present.
    if (isTriggerRuleCategory(category) && rawStatus === 'Fail' && evaluation?.hardFailure !== true) {
        return 'Triggered';
    }

    return rawStatus;
};

const isPassEquivalentRuleStatus = (status) => {
    const normalized = String(status || '').trim().toLowerCase();
    return normalized === 'pass' || normalized === 'triggered';
};

const inferRuleCategory = (ruleDoc) => {
    const explicit = String(ruleDoc.category || '').trim().toUpperCase();
    if (explicit) return explicit;
    const hint = `${ruleDoc.name || ''} ${ruleDoc.description || ''} ${ruleDoc.criteria || ''}`;
    return /(escalat|tier\s*3|trigger)/i.test(hint) ? 'ESCALATION' : 'GENERAL';
};

const isSummaryScaleInvalid = (summary) => {
    const text = String(summary || '');
    return /out of 10/i.test(text) || /\/\s*10(\D|$)/i.test(text);
};

const resolveDepartmentForAnalysis = async ({ requestedDepartment, user, organization }) => {
    let department = requestedDepartment;

    if (department && !user.isAdmin) {
        const hasConf = (user.permissions || []).some((p) => {
            const userDeptId = (p.department?._id || p.department || '').toString();
            return userDeptId === department.toString();
        });
        if (!hasConf) {
            const error = new Error('You do not have permissions for the selected department.');
            error.status = 403;
            throw error;
        }
    }

    if (!department) {
        if (user && user.permissions && user.permissions.length > 0) {
            const firstDept = user.permissions[0].department;
            department = firstDept?._id || firstDept;
        } else {
            const general = await Department.findOne({ name: 'General', organization });
            department = general?._id;
        }
    }

    return department;
};

const runWithConcurrency = async (items, concurrency, worker, onItemDone) => {
    const effectiveConcurrency = Math.max(1, Math.min(concurrency, items.length || 1));
    const results = new Array(items.length);
    let nextIndex = 0;

    const runner = async () => {
        while (true) {
            const currentIndex = nextIndex++;
            if (currentIndex >= items.length) break;

            const item = items[currentIndex];
            const result = await worker(item, currentIndex);
            results[currentIndex] = result;
            if (onItemDone) onItemDone(result, currentIndex, item);
        }
    };

    const workers = Array.from({ length: effectiveConcurrency }, () => runner());
    await Promise.all(workers);
    return results;
};

const buildUserContext = (user) => ({
    id: user?.id,
    isAdmin: user?.isAdmin === true,
    permissions: Array.isArray(user?.permissions) ? user.permissions : [],
    roleCatalog: user?.roleCatalog || {}
});

const RULE_EVAL_CONCURRENCY = Math.max(1, Number(process.env.RULE_EVAL_CONCURRENCY || 12));
const RULE_EVAL_MAX_ATTEMPTS = Math.max(1, Number(process.env.RULE_EVAL_MAX_ATTEMPTS || 3));
const RULE_GROUNDING_ENABLED_DEFAULT = process.env.USE_WEAVIATE_RULE_GROUNDING !== 'false';
const RULE_GROUNDED_FAIL_RESCUE = process.env.RULE_GROUNDED_FAIL_RESCUE !== 'false';

const evaluateRulesWithAgents = async ({
    initiativeContext,
    rules,
    organizationId,
    analysisRunId,
    onProgress,
    ruleVectorsById = {}
}) => {
    let retryAttempts = 0;
    let hardFailures = 0;
    let completed = 0;
    let groundingApplied = 0;
    let groundingFailures = 0;
    let groundingChunksFetched = 0;
    let groundingHistoryFetched = 0;
    let consistencyChecks = 0;
    let overturnedFails = 0;

    const evaluations = await runWithConcurrency(
        rules,
        RULE_EVAL_CONCURRENCY,
        async (rule) => {
            let lastError = 'Unknown rule evaluation error';
            let retrievedContext = '';
            const ruleId = String(rule?._id || '');

            if (weaviateVectorService.isRuleGroundingEnabled() && RULE_GROUNDING_ENABLED_DEFAULT) {
                try {
                    const grounding = await weaviateVectorService.buildRuleGroundingContext({
                        organizationId,
                        runId: analysisRunId,
                        rule,
                        ruleVector: ruleVectorsById[ruleId]
                    });
                    if (grounding?.context) {
                        retrievedContext = grounding.context;
                        groundingApplied += 1;
                    }
                    groundingChunksFetched += Number(grounding?.chunkCount || 0);
                    groundingHistoryFetched += Number(grounding?.historyCount || 0);
                } catch (error) {
                    groundingFailures += 1;
                }
            }

            for (let attempt = 1; attempt <= RULE_EVAL_MAX_ATTEMPTS; attempt += 1) {
                try {
                    // Primary decision is always full-context only.
                    const response = await openAIService.evaluateSingleRule(
                        initiativeContext,
                        rule,
                        { retrievedContext: '' }
                    );
                    const triggerStyle = isTriggerRuleCategory(inferRuleCategory(rule));
                    const hasConditionPresent = typeof response?.conditionPresent === 'boolean';
                    const normalizedFromCondition = triggerStyle && hasConditionPresent
                        ? (response.conditionPresent ? 'Fail' : 'Pass')
                        : null;
                    const status = normalizedFromCondition || normalizeRuleStatus(response?.status);
                    if (!status) {
                        lastError = 'Model returned invalid rule status.';
                    } else {
                        let finalStatus = status;
                        let finalReason = String(response?.reason || `Rule evaluated as ${status}.`).trim();

                        // Grounding rescue: for non-trigger FAILs, allow vector context to rescue false negatives.
                        if (
                            RULE_GROUNDED_FAIL_RESCUE &&
                            retrievedContext &&
                            !triggerStyle &&
                            finalStatus === 'Fail'
                        ) {
                            try {
                                consistencyChecks += 1;
                                const groundedOpinion = await openAIService.evaluateSingleRule(
                                    initiativeContext,
                                    rule,
                                    { retrievedContext }
                                );
                                const groundedHasConditionPresent = typeof groundedOpinion?.conditionPresent === 'boolean';
                                const groundedNormalizedFromCondition = triggerStyle && groundedHasConditionPresent
                                    ? (groundedOpinion.conditionPresent ? 'Fail' : 'Pass')
                                    : null;
                                const groundedStatus = groundedNormalizedFromCondition || normalizeRuleStatus(groundedOpinion?.status);

                                if (groundedStatus === 'Pass') {
                                    finalStatus = 'Pass';
                                    finalReason = `Resolved by vector-grounded evidence: ${String(groundedOpinion?.reason || 'Additional context indicates requirement is satisfied.').trim()}`;
                                    overturnedFails += 1;
                                }
                            } catch (_) {
                                // keep primary full-context result if rescue call fails
                            }
                        }

                        return {
                            ruleId: String(rule._id || ''),
                            ruleName: rule.name || '',
                            status: finalStatus,
                            reason: finalReason,
                            attempts: attempt
                        };
                    }
                } catch (error) {
                    lastError = error.message || 'Rule evaluation failed.';
                }

                if (attempt < RULE_EVAL_MAX_ATTEMPTS) retryAttempts += 1;
            }

            hardFailures += 1;
            return {
                ruleId: String(rule._id || ''),
                ruleName: rule.name || '',
                status: 'Fail',
                reason: `Rule evaluation unavailable after retry: ${lastError}`,
                attempts: RULE_EVAL_MAX_ATTEMPTS,
                hardFailure: true
            };
        },
        (evaluation, _index, rule) => {
            completed += 1;
            onProgress?.({
                phase: 'rule_checks',
                message: `Checked rule ${completed}/${rules.length}: ${rule.name || 'Unnamed Rule'}`,
                completedRules: completed,
                totalRules: rules.length,
                currentRule: rule.name || '',
                currentRuleStatus: evaluation?.status || 'Fail'
            });
        }
    );

    return {
        evaluations,
        coverage: {
            mode: 'agentic_parallel',
            totalRules: rules.length,
            completedRules: completed,
            retryAttempts,
            hardFailures,
            concurrency: RULE_EVAL_CONCURRENCY,
            maxAttempts: RULE_EVAL_MAX_ATTEMPTS,
            groundingEnabled: weaviateVectorService.isRuleGroundingEnabled() && RULE_GROUNDING_ENABLED_DEFAULT,
            groundingApplied,
            groundingFailures,
            groundingChunksFetched,
            groundingHistoryFetched,
            consistencyChecks,
            overturnedFails
        }
    };
};

const fallbackSummary = ({ priorityScore, tier, score, passedRules, totalRules }) => {
    return `Priority score ${priorityScore?.toFixed(2) || 'N/A'}/5.0 (Tier ${tier}). ` +
        `Rule pass ${passedRules}/${totalRules} (${score}%).`;
};

const analyzeProjectPipeline = async ({
    organization,
    user,
    payload,
    onProgress
}) => {
    const { name, description, repoUrl, formData } = payload;
    const department = await resolveDepartmentForAnalysis({
        requestedDepartment: payload.department,
        user,
        organization
    });

    onProgress?.({
        phase: 'preparing',
        message: 'Loading active rules...'
    });

    const rules = await Rule.find({
        isActive: true,
        organization,
        $or: [{ department: department }, { department: null }]
    });

    if (rules.length === 0) {
        const error = new Error('No active rules defined for approval.');
        error.status = 400;
        throw error;
    }

    const initiativeContext = buildInitiativeAnalysisContext({
        name,
        description,
        formData
    });

    const analysisRunId = randomUUID();
    let vectorGrounding = {
        enabled: false,
        analysisRunId,
        indexedRules: 0,
        indexedChunks: 0,
        embeddingSource: null,
        error: null
    };
    let ruleVectorsById = {};

    if (weaviateVectorService.isEnabled()) {
        onProgress?.({
            phase: 'grounding',
            message: 'Building vector index for initiative and rules...'
        });

        try {
            const ruleIndexResult = await weaviateVectorService.indexRules({
                organizationId: organization,
                rules
            });

            const initiativeIndexResult = await weaviateVectorService.indexInitiativeContext({
                organizationId: organization,
                runId: analysisRunId,
                initiativeContext
            });

            ruleVectorsById = ruleIndexResult?.vectorsByRuleId || {};
            vectorGrounding = {
                enabled: true,
                analysisRunId,
                indexedRules: Number(ruleIndexResult?.indexedRules || 0),
                indexedChunks: Number(initiativeIndexResult?.indexedChunks || 0),
                embeddingSource: initiativeIndexResult?.embeddingSource || ruleIndexResult?.embeddingSource || null,
                ruleGroundingEnabled: weaviateVectorService.isRuleGroundingEnabled(),
                initiativeMemoryEnabled: weaviateVectorService.isInitiativeMemoryEnabled(),
                error: null
            };
        } catch (error) {
            vectorGrounding = {
                enabled: false,
                analysisRunId,
                indexedRules: 0,
                indexedChunks: 0,
                embeddingSource: null,
                error: error.message || 'Vector grounding failed.'
            };
            onProgress?.({
                phase: 'grounding',
                message: 'Vector grounding unavailable. Continuing with standard analysis.'
            });
        }
    }

    onProgress?.({
        phase: 'priority_scoring',
        message: 'Scoring initiative dimensions...'
    });

    const priorityResult = await openAIService.analyzePriorityOnly(initiativeContext);
    const scoringBreakdown = priorityResult?.scoringBreakdown || null;

    onProgress?.({
        phase: 'rule_checks',
        message: `Checking rules (0/${rules.length})...`,
        completedRules: 0,
        totalRules: rules.length
    });

    const { evaluations, coverage } = await evaluateRulesWithAgents({
        initiativeContext,
        rules,
        organizationId: organization,
        analysisRunId,
        onProgress,
        ruleVectorsById
    });

    const sourceRules = rules.map((r) => ({
        id: (r._id || '').toString(),
        name: r.name || '',
        mandatory: r.isMandatory === true,
        category: inferRuleCategory(r),
        effects: Array.isArray(r.effects) ? r.effects : []
    }));
    const sourceRuleById = new Map(sourceRules.map(rule => [rule.id, rule]));
    const evalById = new Map(
        evaluations.map((evaluation) => [String(evaluation.ruleId || ''), evaluation])
    );

    const ruleAnalyses = sourceRules.map((rule) => {
        const evaluation = evalById.get(rule.id);
        const status = resolveRuleAnalysisStatus(rule, evaluation);
        return {
            ruleId: rule.id,
            ruleName: rule.name,
            category: rule.category,
            mandatory: rule.mandatory,
            status,
            reason: evaluation?.reason || 'Rule evaluation unavailable.'
        };
    });

    const totalRules = ruleAnalyses.length;
    const passedRules = ruleAnalyses.filter(ra => isPassEquivalentRuleStatus(ra.status)).length;
    const score = totalRules > 0 ? Math.round((passedRules / totalRules) * 100) : 0;

    const failedMandatoryGateRules = ruleAnalyses.filter(ra =>
        ra.mandatory === true &&
        !isTriggerRuleCategory(ra.category) &&
        ra.status === 'Fail'
    );
    const triggeredActionRules = ruleAnalyses.filter(ra =>
        isTriggerRuleCategory(ra.category) &&
        ra.status === 'Triggered'
    );
    const triggeredEscalationRules = triggeredActionRules.filter(ra => String(ra.category || '').toUpperCase() === 'ESCALATION');

    const mandatoryFailed = failedMandatoryGateRules.length > 0;
    const escalationTriggers = triggeredEscalationRules.map(ra => ra.ruleName);
    const effectSourceAnalyses = ruleAnalyses.filter(ra => ra.status === 'Fail' || ra.status === 'Triggered');
    const { appliedEffects, forcedTier, effectFlags } =
        applyTriggeredRuleEffects(effectSourceAnalyses, sourceRuleById);

    const analysisResult = {
        rulesAnalysis: ruleAnalyses,
        scoringBreakdown,
        ruleEvaluationCoverage: coverage,
        vectorGrounding,
        mandatoryFailed,
        failedMandatoryRules: failedMandatoryGateRules.map(ra => ra.ruleName),
        escalationTriggers,
        triggeredRuleActions: triggeredActionRules.map((ra) => ({
            ruleName: ra.ruleName,
            category: ra.category
        })),
        appliedEffects,
        effectFlags
    };

    const workflowPolicy = await getWorkflowPolicyForOrganization(organization);
    const scoringWeights = resolveScoringWeightsForDepartment(workflowPolicy, department);

    let priorityScore;
    if (scoringBreakdown) {
        const s = Number(scoringBreakdown.strategicAlignment?.score ?? 0);
        const r = Number(scoringBreakdown.regulatoryRisk?.score ?? 0);
        const b = Number(scoringBreakdown.businessImpact?.score ?? 0);
        const c = Number(scoringBreakdown.implementationComplexity?.score ?? 0);
        const t = Number(scoringBreakdown.timeToValue?.score ?? 0);
        const resources = Number(scoringBreakdown.resourceRequirements?.score ?? 0);

        priorityScore = Math.round((
            (s * (Number(scoringWeights.strategicAlignment || 0) / 100)) +
            (r * (Number(scoringWeights.regulatoryRisk || 0) / 100)) +
            (b * (Number(scoringWeights.businessImpact || 0) / 100)) +
            (c * (Number(scoringWeights.implementationComplexity || 0) / 100)) +
            (t * (Number(scoringWeights.timeToValue || 0) / 100)) +
            (resources * (Number(scoringWeights.resourceRequirements || 0) / 100))
        ) * 100) / 100;
    } else {
        const modelPriority = Number(priorityResult?.priorityScore);
        priorityScore = Number.isFinite(modelPriority) ? modelPriority : (score / 20);
    }

    analysisResult.scoringWeightsUsed = scoringWeights;

    let tier = determineTierFromScore(priorityScore, workflowPolicy);
    const policyForcedTier = Number(workflowPolicy?.escalation?.forcedTierOnEscalation || 3);

    if (escalationTriggers.length > 0 && [1, 2, 3].includes(policyForcedTier)) {
        tier = Math.max(tier, policyForcedTier);
    }
    if ([1, 2, 3].includes(Number(forcedTier))) {
        tier = Math.max(tier, Number(forcedTier));
    }

    const tierWorkflow = workflowPolicy?.tiers?.find(t => Number(t.tier) === Number(tier)) || null;

    const rejectBelow = Number(workflowPolicy?.aiGate?.rejectBelow ?? process.env.PRIORITY_SCORE_REJECT_BELOW ?? 1.5);
    const enhancedOversightMax = Number(workflowPolicy?.aiGate?.enhancedOversightMax ?? process.env.PRIORITY_SCORE_ENHANCED_OVERSIGHT_MAX ?? 2.0);
    const needEnhancedOversight = priorityScore >= rejectBelow && priorityScore < enhancedOversightMax;

    const aiApproved = !mandatoryFailed && (priorityScore >= rejectBelow || escalationTriggers.length > 0);

    onProgress?.({
        phase: 'finalize',
        message: 'Finalizing decision...'
    });

    const summarizerPayload = {
        priorityScore,
        tier,
        rulePassRate: score,
        passedRules,
        totalRules,
        mandatoryFailedRules: failedMandatoryGateRules.map(rule => rule.ruleName),
        escalationTriggers,
        triggeredRuleActions: triggeredActionRules.map(rule => ({
            ruleName: rule.ruleName,
            category: rule.category
        })),
        topFailedRules: ruleAnalyses
            .filter(rule => rule.status === 'Fail')
            .slice(0, 10)
            .map(rule => ({ ruleName: rule.ruleName, reason: rule.reason }))
    };
    const summarized = await openAIService.summarizeFinalDecision(initiativeContext, summarizerPayload);
    const fallback = fallbackSummary({
        priorityScore,
        tier,
        score,
        passedRules,
        totalRules
    });
    const candidateSummary = summarized || priorityResult?.summary || fallback;
    analysisResult.summary = isSummaryScaleInvalid(candidateSummary) ? fallback : candidateSummary;
    analysisResult.priorityScore = priorityScore;
    analysisResult.calculatedTier = tier;

    let approvalStatus;
    let workflowStage;
    let simpleStatus;
    let aiDecisionReason;
    let currentStageKey = null;
    const workflowPlanSnapshot = tierWorkflow ? JSON.parse(JSON.stringify(tierWorkflow)) : null;

    if (!aiApproved) {
        approvalStatus = 'AI Rejected';
        workflowStage = 'Screening';
        simpleStatus = 'Rejected';

        const rejectReasons = [];
        if (priorityScore < rejectBelow && escalationTriggers.length === 0) {
            rejectReasons.push(`Priority Score ${priorityScore.toFixed(2)} below ${rejectBelow}`);
        }
        if (mandatoryFailed) {
            rejectReasons.push(`Mandatory gate rules failed: ${failedMandatoryGateRules.map(r => r.ruleName).join(', ')}`);
        }
        aiDecisionReason = `AI rejected - ${rejectReasons.join('. ')}. Score: ${score}/100, Tier ${tier}`;
    } else {
        simpleStatus = 'Under Review';
        const workflowStages = Array.isArray(tierWorkflow?.stages) ? tierWorkflow.stages : [];
        const initialStage = workflowStages[0] || null;

        if (initialStage) {
            approvalStatus = getPendingStatusLabel(initialStage);
            workflowStage = initialStage.label || initialStage.stageKey;
            currentStageKey = initialStage.stageKey;
        } else {
            approvalStatus = 'Under Review';
            workflowStage = 'Under Review';
        }

        const tierRoute = getTierRouteLabel(tierWorkflow);

        if (escalationTriggers.length > 0) {
            aiDecisionReason = `AI approved with escalation triggers: ${escalationTriggers.join(', ')}. Routed to ${tierRoute} review path. Score: ${score}/100 (Priority: ${priorityScore.toFixed(2)}, Tier ${tier})`;
        } else if (needEnhancedOversight) {
            aiDecisionReason = `AI approved with enhanced oversight - Priority Score ${priorityScore.toFixed(2)} (${rejectBelow}-${enhancedOversightMax} range). Routed to ${tierRoute} review path. Score: ${score}/100, Tier ${tier}`;
        } else {
            aiDecisionReason = `AI approved with score ${score}/100 (Priority: ${priorityScore.toFixed(2)}, Tier ${tier}). Routed to ${tierRoute} review path.`;
        }
    }

    const aiAction = aiApproved
        ? (needEnhancedOversight || escalationTriggers.length > 0 ? 'Escalated' : 'Approved')
        : 'Rejected';

    const project = new Project({
        name,
        description,
        repoUrl,
        organization,
        analysisResult,
        approvalStatus,
        status: simpleStatus,
        score,
        requester: user ? user.id : null,
        department: department,
        formData: formData || null,
        submittedAt: new Date(),
        tier,
        priorityScore,
        scoringBreakdown,
        escalationTriggers,
        needEnhancedOversight: needEnhancedOversight || false,
        workflowStage,
        workflowPolicy: workflowPolicy?._id || null,
        currentStageKey,
        workflowPlan: workflowPlanSnapshot,
        approvalHistory: [{
            stage: 'AI',
            action: aiAction,
            by: null,
            reason: aiDecisionReason,
            score,
            timestamp: new Date()
        }]
    });

    if (weaviateVectorService.isInitiativeMemoryEnabled()) {
        try {
            const initiativeMemoryResult = await weaviateVectorService.upsertInitiativeMemory({
                organizationId: organization,
                projectId: project._id,
                name,
                initiativeContext,
                summary: analysisResult.summary,
                approvalStatus,
                workflowStage,
                tier,
                priorityScore
            });
            project.analysisResult = {
                ...project.analysisResult,
                vectorGrounding: {
                    ...(project.analysisResult?.vectorGrounding || {}),
                    initiativeMemory: initiativeMemoryResult
                }
            };
        } catch (error) {
            project.analysisResult = {
                ...project.analysisResult,
                vectorGrounding: {
                    ...(project.analysisResult?.vectorGrounding || {}),
                    initiativeMemory: {
                        enabled: false,
                        indexed: false,
                        error: error.message || 'Initiative memory indexing failed.'
                    }
                }
            };
        }
    }

    await project.save();
    return project;
};

const ANALYSIS_JOBS = new Map();
const ANALYSIS_JOB_TTL_MS = Math.max(60 * 1000, Number(process.env.ANALYSIS_JOB_TTL_MS || 60 * 60 * 1000));

const getAnalysisProgressPercent = (job) => {
    if (job.status === 'completed') return 100;
    if (job.status === 'failed') return 100;

    if (job.phase === 'queued') return 0;
    if (job.phase === 'preparing') return 8;
    if (job.phase === 'priority_scoring') return 20;
    if (job.phase === 'rule_checks') {
        const total = Number(job.totalRules || 0);
        const completed = Number(job.completedRules || 0);
        if (total <= 0) return 30;
        return Math.min(92, Math.max(30, Math.round(30 + ((completed / total) * 60))));
    }
    if (job.phase === 'finalize') return 96;
    return 0;
};

const scheduleAnalysisJobCleanup = (jobId) => {
    setTimeout(() => {
        ANALYSIS_JOBS.delete(jobId);
    }, ANALYSIS_JOB_TTL_MS);
};

const createAnalysisJob = ({ organization, userId }) => {
    const jobId = randomUUID();
    const now = new Date().toISOString();

    const job = {
        jobId,
        organization: String(organization),
        userId: String(userId),
        status: 'queued',
        phase: 'queued',
        message: 'Analysis queued.',
        totalRules: 0,
        completedRules: 0,
        currentRule: '',
        currentRuleStatus: '',
        projectId: null,
        error: null,
        progressPercent: 0,
        createdAt: now,
        updatedAt: now
    };

    ANALYSIS_JOBS.set(jobId, job);
    return job;
};

const updateAnalysisJob = (jobId, patch = {}) => {
    const current = ANALYSIS_JOBS.get(jobId);
    if (!current) return null;

    const merged = {
        ...current,
        ...patch,
        updatedAt: new Date().toISOString()
    };
    const next = {
        ...merged,
        progressPercent: getAnalysisProgressPercent(merged)
    };
    ANALYSIS_JOBS.set(jobId, next);
    return next;
};

const syncRuleEmbedding = async ({ organizationId, rule }) => {
    const now = new Date();
    const persist = async (patch) => {
        rule.embeddingStatus = {
            state: rule.embeddingStatus?.state || 'pending',
            indexedAt: rule.embeddingStatus?.indexedAt || null,
            lastAttemptAt: rule.embeddingStatus?.lastAttemptAt || null,
            source: rule.embeddingStatus?.source || '',
            error: rule.embeddingStatus?.error || '',
            ...patch
        };
        await rule.save();
    };

    if (!weaviateVectorService.isEnabled() || !rule) {
        if (rule) {
            await persist({
                state: 'disabled',
                lastAttemptAt: now,
                error: 'Weaviate disabled'
            });
        }
        return { enabled: false, indexed: false, state: 'disabled' };
    }

    try {
        const result = await weaviateVectorService.indexRules({
            organizationId,
            rules: [rule]
        });
        const indexed = Number(result?.indexedRules || 0) > 0;
        await persist({
            state: indexed ? 'indexed' : 'failed',
            indexedAt: indexed ? now : (rule.embeddingStatus?.indexedAt || null),
            lastAttemptAt: now,
            source: result?.embeddingSource || '',
            error: indexed ? '' : 'Embedding index returned no indexed rows.'
        });
        return {
            enabled: true,
            indexed,
            state: indexed ? 'indexed' : 'failed',
            embeddingSource: result?.embeddingSource || null
        };
    } catch (error) {
        await persist({
            state: 'failed',
            lastAttemptAt: now,
            error: error.message || 'Rule embedding sync failed.'
        });
        return {
            enabled: true,
            indexed: false,
            state: 'failed',
            error: error.message || 'Rule embedding sync failed.'
        };
    }
};

exports.createRule = async (req, res) => {
    try {
        const { department, effects, ...rest } = req.body;
        // User-created rules are never system rules
        const rule = new Rule({
            ...rest,
            department: department || null,
            organization: req.organization,
            isSystem: false,
            isHidden: false,
            effects: normalizeRuleEffects(effects)
        });
        await rule.save();
        const embeddingSync = await syncRuleEmbedding({ organizationId: req.organization, rule });
        const payload = rule.toObject();
        payload.embeddingSync = embeddingSync;
        res.status(201).json(payload);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.getRules = async (req, res) => {
    try {
        const { department, includeHidden } = req.query;
        let query = { organization: req.organization };

        if (department) {
            query = {
                organization: req.organization,
                $or: [{ department: department }, { department: null }]
            };
        } else if (!req.user.isAdmin) {
            query.department = null;
        }

        // By default exclude hidden rules unless admin requests includeHidden=1
        if (includeHidden !== '1' && includeHidden !== 'true') {
            query.isHidden = { $ne: true };
        }

        const rules = await Rule.find(query).populate('department', 'name');
        res.json(rules);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.getDepartments = async (req, res) => {
    try {
        const Department = require('../models/Department');
        let query = {};

        // If authenticated user, scope to their org
        if (req.user && req.organization) {
            query.organization = req.organization;
        } else if (req.query.organization) {
            // Public route (registration) - filter by requested org
            query.organization = req.query.organization;
        }

        const departments = await Department.find(query, 'name description manager organization').populate('manager', 'username firstName lastName');
        res.json(departments);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.createDepartment = async (req, res) => {
    try {
        const { name, description } = req.body;
        const Department = require('../models/Department');
        const dept = new Department({ name, description, organization: req.organization });
        await dept.save();
        res.status(201).json(dept);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.deleteDepartment = async (req, res) => {
    try {
        const Department = require('../models/Department');
        // Verify department belongs to user's org before deleting
        const dept = await Department.findOne({ _id: req.params.id, organization: req.organization });
        if (!dept) {
            return res.status(404).json({ error: 'Department not found in your organization' });
        }
        await Department.findByIdAndDelete(req.params.id);
        res.json({ message: 'Department deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.analyzeProject = async (req, res) => {
    try {
        const userContext = buildUserContext(req.user);
        const project = await analyzeProjectPipeline({
            organization: req.organization,
            user: userContext,
            payload: { ...req.body }
        });
        res.json(project);
    } catch (error) {
        const status = Number(error.status) || 500;
        res.status(status).json({ error: error.message });
    }
};

exports.analyzeProjectAsync = async (req, res) => {
    try {
        const userContext = buildUserContext(req.user);
        const payload = { ...req.body };

        const job = createAnalysisJob({
            organization: req.organization,
            userId: req.user.id
        });

        updateAnalysisJob(job.jobId, {
            status: 'running',
            phase: 'preparing',
            message: 'Starting initiative analysis...'
        });

        setImmediate(async () => {
            try {
                const project = await analyzeProjectPipeline({
                    organization: req.organization,
                    user: userContext,
                    payload,
                    onProgress: (progress) => {
                        updateAnalysisJob(job.jobId, {
                            status: 'running',
                            ...progress
                        });
                    }
                });

                updateAnalysisJob(job.jobId, {
                    status: 'completed',
                    phase: 'completed',
                    message: 'Analysis completed successfully.',
                    projectId: String(project._id || ''),
                    currentRule: '',
                    currentRuleStatus: ''
                });
                scheduleAnalysisJobCleanup(job.jobId);
            } catch (error) {
                updateAnalysisJob(job.jobId, {
                    status: 'failed',
                    phase: 'failed',
                    message: 'Analysis failed.',
                    error: error.message || 'Unknown analysis error'
                });
                scheduleAnalysisJobCleanup(job.jobId);
            }
        });

        return res.status(202).json({
            jobId: job.jobId,
            status: 'running'
        });
    } catch (error) {
        const status = Number(error.status) || 500;
        return res.status(status).json({ error: error.message });
    }
};

exports.getAnalyzeJobStatus = async (req, res) => {
    try {
        const job = ANALYSIS_JOBS.get(req.params.jobId);
        if (!job) {
            return res.status(404).json({ error: 'Analysis job not found or expired.' });
        }

        if (String(job.organization) !== String(req.organization)) {
            return res.status(403).json({ error: 'Forbidden: Job belongs to another organization.' });
        }

        if (!req.user.isAdmin && String(job.userId) !== String(req.user.id)) {
            return res.status(403).json({ error: 'Forbidden: You can only view your own analysis jobs.' });
        }

        return res.json(job);
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};

exports.getProjects = async (req, res) => {
    try {
        let query = { organization: req.organization };

        // Admin sees all within org
        if (req.user.isAdmin) {
            // Just org filter
        } else {
            const approverDeptIds = getDepartmentsForCapabilities(
                req.user,
                ['projects.review.*', 'projects.override', 'dashboard.review'],
                req.user.roleCatalog || {}
            );

            query = {
                organization: req.organization,
                $or: [
                    { requester: req.user.id },
                    { department: { $in: approverDeptIds } }
                ]
            };
        }

        // Filter by specific department if requested
        if (req.query.department) {
            query.department = req.query.department;
        }

        const projects = await Project.find(query)
            .populate('requester', 'username firstName lastName department')
            .populate('department', 'name')
            .sort({ createdAt: -1 });
        res.json(projects);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.overrideProject = async (req, res) => {
    try {
        const projectId = req.params?.id || req.body?.projectId;
        const { newStatus, reason } = req.body || {};

        if (!projectId) {
            return res.status(400).json({ error: 'Project ID is required.' });
        }

        const normalized = String(newStatus || '').trim().toLowerCase();
        const finalStatus =
            normalized === 'approved' ? 'Approved'
                : normalized === 'rejected' ? 'Rejected'
                    : null;

        // Only allow Approved or Rejected as final statuses
        if (!finalStatus) {
            return res.status(400).json({ error: 'Invalid status for override.' });
        }
        const project = await Project.findOne({ _id: projectId, organization: req.organization });
        if (!project) {
            return res.status(404).json({ error: 'Project not found.' });
        }
        const previousStatus = project.approvalStatus;
        project.approvalStatus = finalStatus;
        project.status = finalStatus;
        project.workflowStage = 'Complete';
        project.currentStageKey = null;
        project.overrideBy = req.user.id;
        project.overrideReason = reason || '';
        if (!Array.isArray(project.approvalHistory)) {
            project.approvalHistory = [];
        }
        project.approvalHistory.push({
            stage: 'AdminOverride',
            action: finalStatus,
            by: req.user.id,
            reason: reason || `Admin override ${finalStatus.toLowerCase()}`,
            timestamp: new Date()
        });
        await project.save();
        // Record audit
        const Audit = require('../models/Audit');
        await Audit.create({
            project: project._id,
            organization: req.organization,
            action: 'override',
            performedBy: req.user.id,
            previousStatus,
            newStatus: finalStatus,
            reason,
        });
        res.json(project);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Get a single project by ID (including analysis and score)
exports.getProjectById = async (req, res) => {
    try {
        const projectId = req.params.id;
        const project = await Project.findOne({ _id: projectId, organization: req.organization })
            .populate('requester', 'username firstName lastName department')
            .populate('department', 'name')
            .populate('approvalHistory.by', 'username firstName lastName');
        if (!project) {
            return res.status(404).json({ error: 'Project not found.' });
        }
        res.json(project);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Dashboard statistics for admin/approver view
exports.getDashboardStats = async (req, res) => {
    try {
        let query = { organization: req.organization };
        if (!req.user.isAdmin) {
            const approverDepts = getDepartmentsForCapabilities(
                req.user,
                ['projects.review.*', 'projects.override', 'dashboard.review'],
                req.user.roleCatalog || {}
            );

            query = {
                organization: req.organization,
                $or: [
                    { requester: req.user.id },
                    { department: { $in: approverDepts } }
                ]
            };
        }

        // Filter by specific department if requested
        if (req.query.department) {
            query.department = req.query.department;
        }

        const total = await Project.countDocuments(query);
        const approved = await Project.countDocuments({ ...query, status: 'Approved' });
        const rejected = await Project.countDocuments({ ...query, status: 'Rejected' });
        const pending = await Project.countDocuments({ ...query, status: { $in: ['Pending', 'Under Review'] } });

        // Aggregate for avg score needs the query match
        const avgScoreAgg = await Project.aggregate([
            { $match: query },
            { $group: { _id: null, avgScore: { $avg: '$score' } } }
        ]);
        const avgScore = avgScoreAgg[0] ? Math.round(avgScoreAgg[0].avgScore) : 0;

        res.json({ total, approved, rejected, pending, avgScore });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Bulk update system rules (turn off/on all, or hide/unhide all)
exports.bulkUpdateSystemRules = async (req, res) => {
    try {
        const { isActive, isHidden } = req.body;
        const update = {};
        if (typeof isActive === 'boolean') update.isActive = isActive;
        if (typeof isHidden === 'boolean') update.isHidden = isHidden;
        if (Object.keys(update).length === 0) {
            return res.status(400).json({ error: 'Provide isActive and/or isHidden' });
        }
        const result = await Rule.updateMany(
            { organization: req.organization, isSystem: true },
            { $set: update }
        );
        res.json({ modifiedCount: result.modifiedCount, message: 'System rules updated' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Update rule (isActive, isHidden only — used for system rules)
exports.updateRule = async (req, res) => {
    try {
        const rule = await Rule.findOne({ _id: req.params.id, organization: req.organization });
        if (!rule) {
            return res.status(404).json({ error: 'Rule not found in your organization' });
        }
        const { isActive, isHidden } = req.body;
        if (typeof isActive === 'boolean') rule.isActive = isActive;
        if (typeof isHidden === 'boolean') rule.isHidden = isHidden;
        await rule.save();
        const embeddingSync = await syncRuleEmbedding({ organizationId: req.organization, rule });
        const payload = rule.toObject();
        payload.embeddingSync = embeddingSync;
        res.json(payload);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.retryRuleEmbedding = async (req, res) => {
    try {
        const rule = await Rule.findOne({ _id: req.params.id, organization: req.organization });
        if (!rule) {
            return res.status(404).json({ error: 'Rule not found in your organization' });
        }

        const embeddingSync = await syncRuleEmbedding({ organizationId: req.organization, rule });
        const payload = rule.toObject();
        payload.embeddingSync = embeddingSync;
        return res.json(payload);
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};

exports.retryAllRuleEmbeddings = async (req, res) => {
    try {
        const query = { organization: req.organization };
        const rules = await Rule.find(query);
        if (rules.length === 0) {
            return res.json({
                total: 0,
                indexed: 0,
                failed: 0,
                disabled: 0,
                message: 'No rules found for this organization.'
            });
        }

        const EMBEDDING_RETRY_CONCURRENCY = Math.max(1, Number(process.env.RULE_EMBED_RETRY_CONCURRENCY || 8));
        const results = await runWithConcurrency(
            rules,
            EMBEDDING_RETRY_CONCURRENCY,
            async (rule) => {
                const sync = await syncRuleEmbedding({ organizationId: req.organization, rule });
                return {
                    ruleId: String(rule._id),
                    ruleName: rule.name,
                    indexed: sync.indexed === true,
                    state: sync.state || (sync.indexed ? 'indexed' : 'failed'),
                    error: sync.error || ''
                };
            }
        );

        const indexed = results.filter((r) => r.indexed).length;
        const disabled = results.filter((r) => r.state === 'disabled').length;
        const failed = results.length - indexed - disabled;

        return res.json({
            total: results.length,
            indexed,
            failed,
            disabled,
            results
        });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};

// Delete a rule (system rules cannot be deleted)
exports.deleteRule = async (req, res) => {
    try {
        const rule = await Rule.findOne({ _id: req.params.id, organization: req.organization });
        if (!rule) {
            return res.status(404).json({ error: 'Rule not found in your organization' });
        }
        if (rule.isSystem) {
            return res.status(403).json({ error: 'System rules cannot be deleted. You can turn them off or hide them.' });
        }
        await Rule.findByIdAndDelete(req.params.id);
        res.json({ message: 'Rule deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Delete a project
exports.deleteProject = async (req, res) => {
    try {
        const project = await Project.findOne({ _id: req.params.id, organization: req.organization });
        if (!project) {
            return res.status(404).json({ error: 'Project not found in your organization' });
        }
        await Project.findByIdAndDelete(req.params.id);
        res.json({ message: 'Project deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const getLegacyTierWorkflow = (tier) => {
    const workflows = {
        1: {
            tier: 1,
            stages: [
                {
                    stageKey: 'CenterOfExcellence',
                    label: 'Center of Excellence Review',
                    requiredRoleKeys: ['CenterOfExcellence', 'GovernanceApprover', 'ExecutiveApprover'],
                    minApprovals: 1,
                    onReject: 'REJECT',
                    pendingStatusLabel: 'Pending Center of Excellence',
                    approvedStatusLabel: 'Approved',
                    rejectedStatusLabel: 'Center of Excellence Rejected'
                }
            ]
        },
        2: {
            tier: 2,
            stages: [
                {
                    stageKey: 'CenterOfExcellence',
                    label: 'Center of Excellence Review',
                    requiredRoleKeys: ['CenterOfExcellence', 'GovernanceApprover', 'ExecutiveApprover'],
                    minApprovals: 1,
                    onReject: 'REJECT',
                    pendingStatusLabel: 'Pending Center of Excellence',
                    approvedStatusLabel: 'Center of Excellence Approved',
                    rejectedStatusLabel: 'Center of Excellence Rejected'
                },
                {
                    stageKey: 'Governance',
                    label: 'Governance Committee',
                    requiredRoleKeys: ['GovernanceApprover', 'ExecutiveApprover'],
                    minApprovals: 1,
                    onReject: 'REJECT',
                    pendingStatusLabel: 'Pending Governance',
                    approvedStatusLabel: 'Governance Approved',
                    rejectedStatusLabel: 'Governance Rejected'
                }
            ]
        },
        3: {
            tier: 3,
            stages: [
                {
                    stageKey: 'CenterOfExcellence',
                    label: 'Center of Excellence Review',
                    requiredRoleKeys: ['CenterOfExcellence', 'GovernanceApprover', 'ExecutiveApprover'],
                    minApprovals: 1,
                    onReject: 'REJECT',
                    pendingStatusLabel: 'Pending Center of Excellence',
                    approvedStatusLabel: 'Center of Excellence Approved',
                    rejectedStatusLabel: 'Center of Excellence Rejected'
                },
                {
                    stageKey: 'Governance',
                    label: 'Governance Committee',
                    requiredRoleKeys: ['GovernanceApprover', 'ExecutiveApprover'],
                    minApprovals: 1,
                    onReject: 'ESCALATE_TO_NEXT',
                    pendingStatusLabel: 'Pending Governance',
                    approvedStatusLabel: 'Governance Approved',
                    rejectedStatusLabel: 'Governance Rejected'
                },
                {
                    stageKey: 'Executive',
                    label: 'Executive Approval',
                    requiredRoleKeys: ['ExecutiveApprover'],
                    minApprovals: 1,
                    onReject: 'REJECT',
                    pendingStatusLabel: 'Pending Executive',
                    approvedStatusLabel: 'Executive Approved',
                    rejectedStatusLabel: 'Executive Rejected'
                }
            ]
        }
    };
    return workflows[Number(tier)] || null;
};

const processStageReview = async (req, res, stageKey, auditAction) => {
    const { projectId, action, reason } = req.body;

    if (!['Approved', 'Rejected'].includes(action)) {
        return res.status(400).json({ error: 'Action must be Approved or Rejected' });
    }

    const project = await Project.findOne({ _id: projectId, organization: req.organization });
    if (!project) {
        return res.status(404).json({ error: 'Project not found' });
    }

    const currentStageKey = resolveCurrentStageKey(project);
    if (currentStageKey !== stageKey) {
        return res.status(400).json({
            error: `Project is not pending ${stageKey} review (Current stage: ${currentStageKey || project.approvalStatus})`
        });
    }

    const workflowPolicy = await getWorkflowPolicyForOrganization(req.organization);
    const tierWorkflow = resolveTierWorkflow(project, workflowPolicy) || getLegacyTierWorkflow(project.tier);
    if (!tierWorkflow || !Array.isArray(tierWorkflow.stages)) {
        return res.status(400).json({ error: 'Workflow policy for this project tier is not configured.' });
    }

    const stageIndex = tierWorkflow.stages.findIndex(stage => String(stage.stageKey) === String(stageKey));
    if (stageIndex < 0) {
        return res.status(400).json({ error: `Stage ${stageKey} is not configured for Tier ${project.tier}.` });
    }

    const stageDefinition = tierWorkflow.stages[stageIndex];
    const nextStage = tierWorkflow.stages[stageIndex + 1] || null;

    if (!roleMatches(req.user, stageDefinition.requiredRoleKeys || [], project.department)) {
        return res.status(403).json({ error: `You do not have permission to perform ${stageDefinition.label || stageKey} review` });
    }

    if (hasUserReviewedStage(project, stageKey, req.user.id)) {
        return res.status(400).json({ error: 'You have already submitted a decision for this stage.' });
    }

    const previousStatus = project.approvalStatus;
    if (!project.workflowPolicy && workflowPolicy?._id) {
        project.workflowPolicy = workflowPolicy._id;
    }
    if (!project.workflowPlan && tierWorkflow?.tier) {
        project.workflowPlan = JSON.parse(JSON.stringify(tierWorkflow));
    }
    project.approvalHistory.push({
        stage: stageKey,
        action,
        by: req.user.id,
        reason: reason || `${stageDefinition.label || stageKey} ${action.toLowerCase()}`,
        timestamp: new Date()
    });

    if (action === 'Approved') {
        const minApprovals = Math.max(1, Number(stageDefinition.minApprovals || 1));
        const approvedCount = countApprovedReviewsForStage(project, stageKey);

        if (approvedCount < minApprovals) {
            project.approvalStatus = getPendingStatusLabel(stageDefinition);
            project.workflowStage = stageDefinition.label || stageDefinition.stageKey;
            project.currentStageKey = stageDefinition.stageKey;
            project.status = 'Under Review';
        } else if (nextStage) {
            project.approvalStatus = getPendingStatusLabel(nextStage);
            project.workflowStage = nextStage.label || nextStage.stageKey;
            project.currentStageKey = nextStage.stageKey;
            project.status = 'Under Review';
        } else {
            project.approvalStatus = getApprovedStatusLabel(stageDefinition);
            project.workflowStage = 'Complete';
            project.currentStageKey = null;
            project.status = 'Approved';
        }
    } else if (stageDefinition.onReject === 'ESCALATE_TO_NEXT' && nextStage) {
        project.approvalHistory[project.approvalHistory.length - 1].action = 'Escalated';
        project.approvalStatus = getPendingStatusLabel(nextStage);
        project.workflowStage = nextStage.label || nextStage.stageKey;
        project.currentStageKey = nextStage.stageKey;
        project.status = 'Under Review';
    } else {
        project.approvalStatus = getRejectedStatusLabel(stageDefinition);
        project.workflowStage = 'Complete';
        project.currentStageKey = null;
        project.status = 'Rejected';
    }

    await project.save();

    const Audit = require('../models/Audit');
    await Audit.create({
        project: project._id,
        organization: req.organization,
        action: auditAction,
        performedBy: req.user.id,
        previousStatus,
        newStatus: project.approvalStatus,
        reason
    });

    return res.json(project);
};

// Center of Excellence Review
exports.centerOfExcellenceReview = async (req, res) => {
    try {
        return await processStageReview(req, res, 'CenterOfExcellence', 'coe_review');
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};

// Governance Committee Review
exports.governanceReview = async (req, res) => {
    try {
        return await processStageReview(req, res, 'Governance', 'governance_review');
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};

// Executive Review
exports.executiveReview = async (req, res) => {
    try {
        return await processStageReview(req, res, 'Executive', 'executive_review');
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};

// Get projects pending review for specific role
exports.getPendingReviews = async (req, res) => {
    try {
        const { stage } = req.query;
        const stageKeyByQuery = {
            governance: 'Governance',
            executive: 'Executive',
            center_of_excellence: 'CenterOfExcellence'
        };
        const pendingStatusByStageKey = {
            Governance: 'Pending Governance',
            Executive: 'Pending Executive',
            CenterOfExcellence: 'Pending Center of Excellence'
        };
        const stageCapabilityByKey = {
            Governance: 'projects.review.governance',
            Executive: 'projects.review.executive',
            CenterOfExcellence: 'projects.review.coe'
        };

        let query = { organization: req.organization };
        const requestedStageKey = stageKeyByQuery[String(stage || '').toLowerCase()] || null;

        if (requestedStageKey) {
            query.$or = [
                { currentStageKey: requestedStageKey },
                { approvalStatus: pendingStatusByStageKey[requestedStageKey] }
            ];
        } else {
            query.$or = [
                { currentStageKey: { $exists: true, $ne: null } },
                {
                    approvalStatus: {
                        $in: [
                            pendingStatusByStageKey.CenterOfExcellence,
                            pendingStatusByStageKey.Governance,
                            pendingStatusByStageKey.Executive
                        ]
                    }
                }
            ];
        }

        // Filter by department if not admin
        if (!req.user.isAdmin) {
            const userDepts = requestedStageKey
                ? getDepartmentsForCapabilities(
                    req.user,
                    [stageCapabilityByKey[requestedStageKey]],
                    req.user.roleCatalog || {}
                )
                : (req.user.permissions || [])
                    .filter(permission => Array.isArray(permission.roles) && permission.roles.length > 0)
                    .map(permission => (permission.department?._id || permission.department)?.toString())
                    .filter(Boolean);
            if (userDepts?.length > 0) {
                query.department = { $in: userDepts };
            } else {
                return res.json([]); // No reviewer permissions
            }
        }

        let projects = await Project.find(query)
            .populate('requester', 'username firstName lastName')
            .populate('department', 'name')
            .sort({ createdAt: -1 });

        if (!req.user.isAdmin) {
            projects = projects.filter((project) => {
                const currentStageKey = resolveCurrentStageKey(project);
                if (!currentStageKey) return false;

                const tierWorkflow = resolveTierWorkflow(project, null) || getLegacyTierWorkflow(project.tier);
                const stageDefinition = tierWorkflow?.stages?.find((s) => String(s.stageKey) === String(currentStageKey));
                if (!stageDefinition) return false;

                const departmentId = project.department?._id || project.department;
                return roleMatches(req.user, stageDefinition.requiredRoleKeys || [], departmentId);
            });
        }

        res.json(projects);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// --- Organization Management ---
exports.getOrganizations = async (req, res) => {
    try {
        const orgs = await Organization.find({}, 'name slug description');
        res.json(orgs);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.createOrganization = async (req, res) => {
    try {
        const { name, description } = req.body;
        const org = new Organization({
            name,
            description,
            createdBy: req.user.id
        });
        await org.save();
        await ensureGovernanceConfigForOrganization(org._id);
        res.status(201).json(org);
    } catch (error) {
        // Duplicate key (e.g. unique org name/slug)
        if (error && error.code === 11000) {
            const dupField = error.keyPattern ? Object.keys(error.keyPattern)[0] : null;
            const message =
                dupField === 'name'
                    ? 'An organization with that name already exists.'
                    : dupField === 'slug'
                        ? 'An organization with a similar name already exists.'
                        : 'Organization already exists.';
            return res.status(409).json({ error: message });
        }
        res.status(500).json({ error: error.message });
    }
};

// Same slug derivation as Organization model (for lookup on conflict)
function slugFromName(name) {
    if (!name || typeof name !== 'string') return '';
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

// Create org AND join it (onboarding flow — no org context needed)
exports.createAndJoin = async (req, res) => {
    const UserOrganization = require('../models/UserOrganization');
    const Department = require('../models/Department');

    try {
        const { name, description } = req.body;
        if (!name) {
            return res.status(400).json({ error: 'Organization name is required' });
        }

        const trimmedName = name.trim();

        // Create the organization (rely on MongoDB unique indexes for duplicate detection)
        const org = new Organization({
            name: trimmedName,
            description: (description || '').trim(),
            createdBy: req.user.id
        });
        await org.save();
        await ensureGovernanceConfigForOrganization(org._id);

        // Create General department
        const generalDept = await new Department({
            name: 'General',
            description: 'Default department',
            organization: org._id
        }).save();

        // Create UserOrganization — creator becomes admin with ExecutiveApprover role
        const membership = await UserOrganization.create({
            user: req.user.id,
            organization: org._id,
            isAdmin: true,
            permissions: [{ department: generalDept._id, roles: ['ExecutiveApprover'] }]
        });

        await membership.populate('organization', 'name slug');
        await membership.populate('permissions.department', 'name');

        res.status(201).json({
            organization: {
                _id: org._id,
                name: org.name,
                slug: org.slug,
                isAdmin: membership.isAdmin,
                permissions: membership.permissions
            }
        });
    } catch (error) {
        // Duplicate key (org name/slug already exists)
        if (error && error.code === 11000) {
            const trimmedName = (req.body.name || '').trim();
            const attemptedSlug = slugFromName(trimmedName);
            const existingOrg = await Organization.findOne({
                $or: [{ name: trimmedName }, { slug: attemptedSlug }]
            });
            if (existingOrg) {
                const existingMembership = await UserOrganization.findOne({
                    user: req.user.id,
                    organization: existingOrg._id
                }).populate('organization', 'name slug').populate('permissions.department', 'name');
                if (existingMembership) {
                    return res.status(200).json({
                        organization: {
                            _id: existingOrg._id,
                            name: existingOrg.name,
                            slug: existingOrg.slug,
                            isAdmin: existingMembership.isAdmin,
                            permissions: existingMembership.permissions
                        }
                    });
                }
                // Orphan recovery: org exists but has no members — createdBy matches current user (partial create failed)
                const isOrphan = existingOrg.createdBy && existingOrg.createdBy.toString() === req.user.id.toString();
                if (isOrphan) {
                    await ensureGovernanceConfigForOrganization(existingOrg._id);
                    let generalDept = await Department.findOne({ name: 'General', organization: existingOrg._id });
                    if (!generalDept) {
                        generalDept = await new Department({
                            name: 'General',
                            description: 'Default department',
                            organization: existingOrg._id
                        }).save();
                    }
                    const membership = await UserOrganization.create({
                        user: req.user.id,
                        organization: existingOrg._id,
                        isAdmin: true,
                        permissions: [{ department: generalDept._id, roles: ['ExecutiveApprover'] }]
                    });
                    await membership.populate('organization', 'name slug');
                    await membership.populate('permissions.department', 'name');
                    return res.status(200).json({
                        organization: {
                            _id: existingOrg._id,
                            name: existingOrg.name,
                            slug: existingOrg.slug,
                            isAdmin: membership.isAdmin,
                            permissions: membership.permissions
                        }
                    });
                }
            }
            const dupField = error.keyPattern ? Object.keys(error.keyPattern)[0] : null;
            const message =
                dupField === 'name'
                    ? 'An organization with that name already exists.'
                    : dupField === 'slug'
                        ? 'An organization with a similar name already exists.'
                        : 'Organization already exists.';
            return res.status(409).json({
                error: message,
                hint: 'Try a different name (e.g. add "2" or your company name), or ask an admin of that organization to invite you.'
            });
        }
        res.status(500).json({ error: error.message });
    }
};

// Get all orgs the current user belongs to
exports.getMyOrganizations = async (req, res) => {
    try {
        const UserOrganization = require('../models/UserOrganization');

        const memberships = await UserOrganization.find({ user: req.user.id })
            .populate('organization', 'name slug logo logoDark logoLight logoBackground logoMode')
            .populate('permissions.department', 'name');

        const orgIds = Array.from(new Set(
            memberships.map(m => m.organization?._id?.toString()).filter(Boolean)
        ));
        for (const orgId of orgIds) {
            await ensureGovernanceConfigForOrganization(orgId);
        }
        const roleDocs = await Role.find(
            { organization: { $in: orgIds } },
            'organization key name description capabilities isSystem isActive'
        ).lean();

        const rolesByOrg = new Map();
        roleDocs.forEach((roleDoc) => {
            const orgId = roleDoc.organization.toString();
            if (!rolesByOrg.has(orgId)) rolesByOrg.set(orgId, []);
            rolesByOrg.get(orgId).push(roleDoc);
        });

        const organizations = memberships.map((membership) => {
            const orgId = membership.organization._id.toString();
            const orgRoles = rolesByOrg.get(orgId) || [];
            const roleCatalog = buildRoleCatalog(orgRoles);
            const permissions = sanitizePermissions(
                membership.permissions || [],
                Object.keys(roleCatalog).length > 0 ? new Set(Object.keys(roleCatalog)) : null
            );
            const capabilities = collectUserCapabilities({ permissions }, roleCatalog);

            return {
                _id: membership.organization._id,
                name: membership.organization.name,
                slug: membership.organization.slug,
                logo: membership.organization.logo,
                logoDark: membership.organization.logoDark,
                logoLight: membership.organization.logoLight,
                logoBackground: membership.organization.logoBackground,
                logoMode: membership.organization.logoMode,
                isAdmin: membership.isAdmin,
                permissions,
                capabilities,
                roles: orgRoles.map((role) => ({
                    key: role.key,
                    name: role.name,
                    description: role.description || '',
                    capabilities: role.capabilities || [],
                    isSystem: role.isSystem === true,
                    isActive: role.isActive !== false
                }))
            };
        });

        res.json(organizations);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
