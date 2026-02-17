const Rule = require('../models/Rule');
const Project = require('../models/Project');
const Organization = require('../models/Organization');
const Role = require('../models/Role');
const openAIService = require('../services/OpenAIService');
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

const applyTriggeredRuleEffects = (failedRuleAnalyses, sourceRuleById) => {
    const appliedEffects = [];
    let forcedTier = null;
    let forcedStageKey = null;
    const effectFlags = {};

    failedRuleAnalyses.forEach((analysis) => {
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
            } else if (type === 'ROUTE_TO_STAGE') {
                const stageKey = typeof params.stageKey === 'string' ? params.stageKey.trim() : '';
                if (stageKey) forcedStageKey = stageKey;
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

    return { appliedEffects, forcedTier, forcedStageKey, effectFlags };
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
            effects: Array.isArray(effects) ? effects : []
        });
        await rule.save();
        res.status(201).json(rule);
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
        const { name, description, repoUrl, formData } = req.body;

        // Determine department
        let department = req.body.department;

        // Validate user belongs to this department (unless Admin)
        if (department && !req.user.isAdmin) {
            const hasConf = req.user.permissions.some(p => {
                const userDeptId = (p.department._id || p.department).toString();
                return userDeptId === department.toString();
            });
            if (!hasConf) {
                return res.status(403).json({ error: 'You do not have permissions for the selected department.' });
            }
        }

        if (!department) {
            // Fallback default
            if (req.user && req.user.permissions && req.user.permissions.length > 0) {
                const firstDept = req.user.permissions[0].department;
                department = firstDept._id || firstDept;
            } else {
                const general = await require('../models/Department').findOne({ name: 'General', organization: req.organization });
                department = general?._id;
            }
        }

        // 1. Fetch active rules for this scope (dept + global) within org
        const rules = await Rule.find({
            isActive: true,
            organization: req.organization,
            $or: [{ department: department }, { department: null }]
        });

        if (rules.length === 0) {
            return res.status(400).json({ error: 'No active rules defined for approval.' });
        }

        // 2. Perform analysis
        const analysisResult = await openAIService.analyzeProject(description || 'No description provided', rules);

        // 3. Deterministic reconciliation of AI output against source rules
        const normalizeText = (value) => String(value || '').trim().toLowerCase();
        const normalizeStatus = (value) => {
            const v = normalizeText(value);
            if (['pass', 'passed', 'ok', 'true', 'yes'].includes(v)) return 'Pass';
            if (['fail', 'failed', 'false', 'no', 'triggered', 'escalated'].includes(v)) return 'Fail';
            return null;
        };
        const inferCategory = (ruleDoc) => {
            const explicit = String(ruleDoc.category || '').trim().toUpperCase();
            if (explicit) return explicit;
            const hint = `${ruleDoc.name || ''} ${ruleDoc.description || ''} ${ruleDoc.criteria || ''}`;
            return /(escalat|tier\s*3|trigger)/i.test(hint) ? 'ESCALATION' : 'GENERAL';
        };

        const sourceRules = rules.map(r => ({
            id: (r._id || '').toString(),
            name: r.name || '',
            mandatory: r.isMandatory === true,
            category: inferCategory(r),
            effects: Array.isArray(r.effects) ? r.effects : []
        }));
        const sourceRuleById = new Map(sourceRules.map(rule => [rule.id, rule]));

        const aiRuleAnalyses = Array.isArray(analysisResult.rulesAnalysis) ? analysisResult.rulesAnalysis : [];
        const aiById = new Map();
        const aiByName = new Map();

        aiRuleAnalyses.forEach((ra) => {
            const ruleId = normalizeText(ra.ruleId || ra.id);
            const ruleName = normalizeText(ra.ruleName);
            if (ruleId && !aiById.has(ruleId)) aiById.set(ruleId, ra);
            if (ruleName && !aiByName.has(ruleName)) aiByName.set(ruleName, ra);
        });

        const ruleAnalyses = sourceRules.map((rule) => {
            const byId = aiById.get(normalizeText(rule.id));
            const byName = aiByName.get(normalizeText(rule.name));
            const aiMatch = byId || byName || null;
            const normalized = normalizeStatus(aiMatch?.status);
            return {
                ruleId: rule.id,
                ruleName: rule.name,
                category: rule.category,
                mandatory: rule.mandatory,
                status: normalized || 'Fail',
                reason: aiMatch?.reason || 'No evaluation returned by model for this rule.'
            };
        });

        // Persist reconciled analysis
        analysisResult.rulesAnalysis = ruleAnalyses;

        const totalRules = ruleAnalyses.length;
        const passedRules = ruleAnalyses.filter(ra => ra.status === 'Pass').length;
        const score = totalRules > 0 ? Math.round((passedRules / totalRules) * 100) : 0;

        // Mandatory GATE failures reject. ESCALATION failures route to Tier 3.
        const failedMandatoryGateRules = ruleAnalyses.filter(ra =>
            ra.mandatory === true &&
            ra.category !== 'ESCALATION' &&
            ra.status !== 'Pass'
        );
        const triggeredEscalationRules = ruleAnalyses.filter(ra =>
            ra.category === 'ESCALATION' &&
            ra.status !== 'Pass'
        );

        const mandatoryFailed = failedMandatoryGateRules.length > 0;
        const escalationTriggers = triggeredEscalationRules.map(ra => ra.ruleName);
        const failedRuleAnalyses = ruleAnalyses.filter(ra => ra.status !== 'Pass');
        const { appliedEffects, forcedTier, forcedStageKey, effectFlags } =
            applyTriggeredRuleEffects(failedRuleAnalyses, sourceRuleById);

        // Keep top-level fields consistent with reconciled decisioning
        analysisResult.mandatoryFailed = mandatoryFailed;
        analysisResult.failedMandatoryRules = failedMandatoryGateRules.map(ra => ra.ruleName);
        analysisResult.escalationTriggers = escalationTriggers;
        analysisResult.appliedEffects = appliedEffects;
        analysisResult.effectFlags = effectFlags;

        // 4. Priority score from scoring breakdown (source of truth)
        const scoringBreakdown = analysisResult.scoringBreakdown || null;
        let priorityScore;

        if (scoringBreakdown) {
            const s = scoringBreakdown.strategicAlignment?.score ?? 0;
            const r = scoringBreakdown.regulatoryRisk?.score ?? 0;
            const b = scoringBreakdown.businessImpact?.score ?? 0;
            const c = scoringBreakdown.implementationComplexity?.score ?? 0;
            const t = scoringBreakdown.timeToValue?.score ?? 0;
            const resources = scoringBreakdown.resourceRequirements?.score ?? 0;
            priorityScore = Math.round(((s * 0.25) + (r * 0.25) + (b * 0.20) + (c * 0.15) + (t * 0.10) + (resources * 0.05)) * 100) / 100;
        } else {
            priorityScore = typeof analysisResult.priorityScore === 'number' && !isNaN(analysisResult.priorityScore)
                ? analysisResult.priorityScore
                : score / 20;
        }

        let tier = Number(analysisResult.calculatedTier);
        if (!tier || tier < 1 || tier > 3) {
            if (priorityScore >= 3.6) tier = 3;
            else if (priorityScore >= 2.6) tier = 2;
            else tier = 1;
        }

        const workflowPolicy = await getWorkflowPolicyForOrganization(req.organization);
        const policyForcedTier = Number(workflowPolicy?.escalation?.forcedTierOnEscalation || 3);

        // Escalation triggers and explicit rule effects can force higher-tier routing.
        if (escalationTriggers.length > 0 && [1, 2, 3].includes(policyForcedTier)) {
            tier = Math.max(tier, policyForcedTier);
        }
        if ([1, 2, 3].includes(Number(forcedTier))) {
            tier = Math.max(tier, Number(forcedTier));
        }

        const tierWorkflow = workflowPolicy?.tiers?.find(t => Number(t.tier) === Number(tier)) || null;

        // 5. Process flow thresholds (deterministic process rule)
        const rejectBelow = Number(workflowPolicy?.aiGate?.rejectBelow ?? process.env.PRIORITY_SCORE_REJECT_BELOW ?? 1.5);
        const enhancedOversightMax = Number(workflowPolicy?.aiGate?.enhancedOversightMax ?? process.env.PRIORITY_SCORE_ENHANCED_OVERSIGHT_MAX ?? 2.0);
        const needEnhancedOversight = priorityScore >= rejectBelow && priorityScore < enhancedOversightMax;

        // Approval decision:
        // - Reject for failed mandatory gates.
        // - Reject below threshold unless escalation trigger exists.
        const aiApproved = !mandatoryFailed && (priorityScore >= rejectBelow || escalationTriggers.length > 0);

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
            let initialStage = workflowStages[0] || null;

            if (forcedStageKey) {
                const forcedStage = workflowStages.find(stage => String(stage.stageKey) === String(forcedStageKey));
                if (forcedStage) initialStage = forcedStage;
            }

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

        // 6. Create project with tiered workflow data
        const project = new Project({
            name,
            description,
            repoUrl,
            organization: req.organization,
            analysisResult,
            approvalStatus,
            status: simpleStatus,
            score,
            requester: req.user ? req.user.id : null,
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
                by: null, // AI decision
                reason: aiDecisionReason,
                score,
                timestamp: new Date()
            }]
        });
        await project.save();

        res.json(project);

    } catch (error) {
        res.status(500).json({ error: error.message });
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
        const { projectId, newStatus, reason } = req.body;
        // Only allow Approved or Rejected as final statuses
        if (!['Approved', 'Rejected'].includes(newStatus)) {
            return res.status(400).json({ error: 'Invalid status for override.' });
        }
        const project = await Project.findOne({ _id: projectId, organization: req.organization });
        if (!project) {
            return res.status(404).json({ error: 'Project not found.' });
        }
        const previousStatus = project.approvalStatus;
        project.approvalStatus = newStatus;
        project.status = newStatus;
        project.overrideBy = req.user.id;
        project.overrideReason = reason || '';
        await project.save();
        // Record audit
        const Audit = require('../models/Audit');
        await Audit.create({
            project: project._id,
            organization: req.organization,
            action: 'override',
            performedBy: req.user.id,
            previousStatus,
            newStatus,
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
        res.json(rule);
    } catch (error) {
        res.status(500).json({ error: error.message });
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
