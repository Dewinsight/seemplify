const Role = require('../models/Role');
const Invite = require('../models/Invite');
const UserOrganization = require('../models/UserOrganization');
const WorkflowPolicy = require('../models/WorkflowPolicy');
const Department = require('../models/Department');
const {
    normalizeRoleKey,
    ensureGovernanceConfigForOrganization,
    ensureWorkflowPolicyForOrganization,
    getWorkflowPolicyForOrganization
} = require('../services/governanceConfigService');
const { toRoleArray } = require('../utils/access');

const SCORING_KEYS = [
    'strategicAlignment',
    'regulatoryRisk',
    'businessImpact',
    'implementationComplexity',
    'timeToValue',
    'resourceRequirements'
];

const DEFAULT_SCORING_WEIGHTS = {
    strategicAlignment: 25,
    regulatoryRisk: 25,
    businessImpact: 20,
    implementationComplexity: 15,
    timeToValue: 10,
    resourceRequirements: 5
};

const normalizeSingleWeights = (weights, fallback = DEFAULT_SCORING_WEIGHTS) => {
    const next = { ...fallback };
    SCORING_KEYS.forEach((key) => {
        if (weights && Object.prototype.hasOwnProperty.call(weights, key)) {
            const value = Number(weights[key]);
            if (!Number.isNaN(value)) next[key] = Math.max(0, Math.min(100, value));
        }
    });
    return next;
};

const sumWeights = (weights) => {
    return SCORING_KEYS.reduce((acc, key) => acc + Number(weights[key] || 0), 0);
};

const weightsTotalIsValid = (weights) => {
    const total = sumWeights(weights);
    return Math.abs(total - 100) < 0.001;
};

const normalizeCapabilities = (value) => {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(
        value
            .map(cap => typeof cap === 'string' ? cap.trim() : '')
            .filter(Boolean)
    ));
};

const normalizeStages = (stages) => {
    if (!Array.isArray(stages)) return [];
    return stages.map((stage) => ({
        stageKey: String(stage.stageKey || '').trim(),
        label: String(stage.label || '').trim(),
        requiredRoleKeys: Array.from(new Set((stage.requiredRoleKeys || [])
            .map(role => typeof role === 'string' ? role.trim() : '')
            .filter(Boolean))),
        minApprovals: Math.max(1, Number(stage.minApprovals || 1)),
        onReject: stage.onReject === 'ESCALATE_TO_NEXT' ? 'ESCALATE_TO_NEXT' : 'REJECT',
        pendingStatusLabel: String(stage.pendingStatusLabel || '').trim(),
        approvedStatusLabel: String(stage.approvedStatusLabel || '').trim(),
        rejectedStatusLabel: String(stage.rejectedStatusLabel || '').trim()
    }));
};

const normalizeTiers = (tiers) => {
    if (!Array.isArray(tiers)) return [];
    return tiers.map((tier) => ({
        tier: Number(tier.tier),
        label: String(tier.label || '').trim(),
        minPriorityScore: Number(tier.minPriorityScore),
        maxPriorityScore: Number(tier.maxPriorityScore),
        stages: normalizeStages(tier.stages)
    }));
};

const stageCapabilityByKey = {
    CenterOfExcellence: 'projects.review.coe',
    Governance: 'projects.review.governance',
    Executive: 'projects.review.executive'
};

const findFallbackRoleKey = (roles, preferredCapability = null) => {
    if (preferredCapability) {
        const preferred = roles.find(role => (role.capabilities || []).includes(preferredCapability));
        if (preferred) return preferred.key;
    }
    const requester = roles.find(role => (role.capabilities || []).includes('projects.submit'));
    if (requester) return requester.key;
    return roles[0]?.key || null;
};

const buildDepartmentWeightRows = (policy, departmentsById) => {
    return (policy.departmentScoringWeights || [])
        .map((row) => ({
            department: row.department,
            departmentLabel: departmentsById.get(String(row.department)) || null,
            weights: normalizeSingleWeights(row.weights || {})
        }))
        .filter((row) => row.department);
};

const getPermissionDepartmentId = (permission) => {
    if (!permission?.department) return null;
    if (typeof permission.department === 'string') return permission.department;
    if (permission.department._id) return String(permission.department._id);
    return String(permission.department);
};

const getScoringManageDepartmentIds = (user, roleCatalog = {}) => {
    if (user?.isAdmin) return null;

    const managedDepartmentIds = new Set();

    (user?.permissions || []).forEach((permission) => {
        const departmentId = getPermissionDepartmentId(permission);
        if (!departmentId) return;

        const roles = toRoleArray(permission);
        const canManage = roles.some((roleKey) =>
            Array.isArray(roleCatalog?.[roleKey]) && roleCatalog[roleKey].includes('scoring.manage')
        );

        if (canManage) managedDepartmentIds.add(String(departmentId));
    });

    return managedDepartmentIds;
};

exports.getRoles = async (req, res) => {
    try {
        await ensureGovernanceConfigForOrganization(req.organization);
        const roles = await Role.find({ organization: req.organization }).sort({ isSystem: -1, name: 1 });
        res.json(roles);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.createRole = async (req, res) => {
    try {
        const { name, key, description, capabilities, isActive } = req.body;
        const resolvedName = typeof name === 'string' ? name.trim() : '';
        if (!resolvedName) {
            return res.status(400).json({ error: 'Role name is required' });
        }

        const resolvedKey = normalizeRoleKey(key || resolvedName);
        if (!resolvedKey) {
            return res.status(400).json({ error: 'Role key is invalid' });
        }

        const existing = await Role.findOne({ organization: req.organization, key: resolvedKey });
        if (existing) {
            return res.status(409).json({ error: `Role key "${resolvedKey}" already exists.` });
        }

        const role = await Role.create({
            organization: req.organization,
            key: resolvedKey,
            name: resolvedName,
            description: typeof description === 'string' ? description.trim() : '',
            capabilities: normalizeCapabilities(capabilities),
            isSystem: false,
            isActive: typeof isActive === 'boolean' ? isActive : true
        });

        res.status(201).json(role);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.updateRole = async (req, res) => {
    try {
        const role = await Role.findOne({ _id: req.params.id, organization: req.organization });
        if (!role) {
            return res.status(404).json({ error: 'Role not found in your organization' });
        }

        if (typeof req.body.key === 'string' && req.body.key.trim() && normalizeRoleKey(req.body.key) !== role.key) {
            return res.status(400).json({ error: 'Role key cannot be changed. Create a new role and migrate assignments.' });
        }

        if (typeof req.body.name === 'string') {
            const name = req.body.name.trim();
            if (!name) return res.status(400).json({ error: 'Role name cannot be empty' });
            role.name = name;
        }
        if (typeof req.body.description === 'string') {
            role.description = req.body.description.trim();
        }
        if (Array.isArray(req.body.capabilities)) {
            role.capabilities = normalizeCapabilities(req.body.capabilities);
        }
        if (typeof req.body.isActive === 'boolean') {
            role.isActive = req.body.isActive;
        }

        await role.save();
        res.json(role);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.deleteRole = async (req, res) => {
    try {
        const role = await Role.findOne({ _id: req.params.id, organization: req.organization });
        if (!role) {
            return res.status(404).json({ error: 'Role not found in your organization' });
        }

        const remainingActiveRoles = await Role.find({
            organization: req.organization,
            _id: { $ne: role._id },
            isActive: true
        });

        if (remainingActiveRoles.length === 0) {
            return res.status(400).json({ error: 'Cannot delete the last active role in an organization.' });
        }

        const fallbackInviteRoleKey = findFallbackRoleKey(remainingActiveRoles, 'projects.submit');

        const memberships = await UserOrganization.find({ organization: req.organization });
        let membershipUpdates = 0;
        for (const membership of memberships) {
            const originalPermissions = (membership.permissions || []).map((permission) => ({
                department: permission.department ? String(permission.department) : '',
                roles: toRoleArray(permission)
            }));
            const nextPermissions = (membership.permissions || [])
                .map((permission) => {
                    const roles = toRoleArray(permission).filter(roleKey => roleKey !== role.key);
                    return {
                        department: permission.department || null,
                        roles
                    };
                })
                .filter(permission => permission.roles.length > 0 || membership.isAdmin);

            const changed = JSON.stringify(originalPermissions) !== JSON.stringify(
                nextPermissions.map((permission) => ({
                    department: permission.department ? String(permission.department) : '',
                    roles: permission.roles
                }))
            );

            if (changed) {
                membership.permissions = nextPermissions;
                await membership.save();
                membershipUpdates++;
            }
        }

        const invitesResult = await Invite.updateMany(
            { organization: req.organization, role: role.key, status: 'pending' },
            { $set: { role: fallbackInviteRoleKey } }
        );

        const workflowPolicy = await WorkflowPolicy.findOne({ organization: req.organization });
        let workflowUpdated = false;
        if (workflowPolicy) {
            workflowPolicy.tiers.forEach((tier) => {
                tier.stages.forEach((stage) => {
                    const current = Array.from(new Set(stage.requiredRoleKeys || []));
                    const filtered = current.filter(roleKey => roleKey !== role.key);

                    if (filtered.length === 0) {
                        const fallback = findFallbackRoleKey(
                            remainingActiveRoles,
                            stageCapabilityByKey[stage.stageKey] || null
                        );
                        if (fallback) filtered.push(fallback);
                    }

                    if (filtered.join('|') !== current.join('|')) {
                        stage.requiredRoleKeys = filtered;
                        workflowUpdated = true;
                    }
                });
            });

            if (workflowUpdated) {
                await workflowPolicy.save();
            }
        }

        await Role.deleteOne({ _id: role._id });

        res.json({
            message: 'Role deleted and references cleaned up.',
            membershipUpdates,
            pendingInviteUpdates: invitesResult.modifiedCount,
            workflowUpdated
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.getWorkflowPolicy = async (req, res) => {
    try {
        await ensureGovernanceConfigForOrganization(req.organization);
        const [policy, roles] = await Promise.all([
            getWorkflowPolicyForOrganization(req.organization),
            Role.find({ organization: req.organization }).sort({ isSystem: -1, name: 1 })
        ]);
        res.json({ policy, roles });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.updateWorkflowPolicy = async (req, res) => {
    try {
        const existing = await ensureWorkflowPolicyForOrganization(req.organization);
        const activeRoles = await Role.find({ organization: req.organization, isActive: true });
        const validRoleKeys = new Set(activeRoles.map(role => role.key));

        const normalizedTiers = normalizeTiers(req.body.tiers);
        if (normalizedTiers.length === 0) {
            return res.status(400).json({ error: 'Workflow policy must define at least one tier.' });
        }
        const uniqueTierCount = new Set(normalizedTiers.map(tier => tier.tier)).size;
        if (uniqueTierCount !== normalizedTiers.length) {
            return res.status(400).json({ error: 'Workflow policy cannot contain duplicate tier definitions.' });
        }

        for (const tier of normalizedTiers) {
            if (![1, 2, 3].includes(tier.tier)) {
                return res.status(400).json({ error: `Tier "${tier.tier}" is invalid. Use tiers 1, 2, or 3.` });
            }
            if (!tier.label) {
                return res.status(400).json({ error: `Tier ${tier.tier} label is required.` });
            }
            if (!Array.isArray(tier.stages) || tier.stages.length === 0) {
                return res.status(400).json({ error: `Tier ${tier.tier} must include at least one stage.` });
            }

            for (const stage of tier.stages) {
                if (!stage.stageKey || !stage.label) {
                    return res.status(400).json({ error: `Tier ${tier.tier} has a stage missing stageKey or label.` });
                }
                if (!Array.isArray(stage.requiredRoleKeys) || stage.requiredRoleKeys.length === 0) {
                    return res.status(400).json({ error: `Stage ${stage.stageKey} in tier ${tier.tier} must require at least one role.` });
                }

                const unknownRoles = stage.requiredRoleKeys.filter(roleKey => !validRoleKeys.has(roleKey));
                if (unknownRoles.length > 0) {
                    return res.status(400).json({
                        error: `Stage ${stage.stageKey} in tier ${tier.tier} references unknown roles: ${unknownRoles.join(', ')}`
                    });
                }
            }
        }

        const sortedTiers = normalizedTiers.sort((a, b) => a.tier - b.tier);

        existing.name = typeof req.body.name === 'string' && req.body.name.trim()
            ? req.body.name.trim()
            : existing.name;
        existing.description = typeof req.body.description === 'string'
            ? req.body.description.trim()
            : existing.description;
        existing.aiGate = {
            rejectBelow: Number(req.body?.aiGate?.rejectBelow ?? existing.aiGate?.rejectBelow ?? 1.5),
            enhancedOversightMax: Number(req.body?.aiGate?.enhancedOversightMax ?? existing.aiGate?.enhancedOversightMax ?? 2.0),
            boundaryManualReviewDelta: Number(req.body?.aiGate?.boundaryManualReviewDelta ?? existing.aiGate?.boundaryManualReviewDelta ?? 0.3)
        };
        existing.escalation = {
            forcedTierOnEscalation: [1, 2, 3].includes(Number(req.body?.escalation?.forcedTierOnEscalation))
                ? Number(req.body.escalation.forcedTierOnEscalation)
                : (existing.escalation?.forcedTierOnEscalation || 3)
        };
        existing.tiers = sortedTiers;
        existing.isActive = typeof req.body.isActive === 'boolean' ? req.body.isActive : existing.isActive;

        await existing.save();
        res.json(existing);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.resetWorkflowPolicy = async (req, res) => {
    try {
        const { workflowPolicy } = await ensureGovernanceConfigForOrganization(req.organization, { forcePolicySync: true });
        res.json({ message: 'Workflow policy reset to system defaults.', workflowPolicy });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.getScoringPolicy = async (req, res) => {
    try {
        await ensureGovernanceConfigForOrganization(req.organization);

        const [policy, departments] = await Promise.all([
            getWorkflowPolicyForOrganization(req.organization),
            Department.find({ organization: req.organization }, 'name').sort({ name: 1 })
        ]);

        const departmentsById = new Map(
            departments.map((department) => [String(department._id), department.name])
        );

        const canEditGlobal = req.user?.isAdmin === true;
        const managedDepartmentIds = getScoringManageDepartmentIds(req.user, req.user.roleCatalog || {});
        const visibleDepartments = canEditGlobal
            ? departments
            : departments.filter((department) => managedDepartmentIds?.has(String(department._id)));
        const visibleOverrides = buildDepartmentWeightRows(policy, departmentsById)
            .filter((row) => canEditGlobal || managedDepartmentIds?.has(String(row.department)));

        res.json({
            scoringWeights: normalizeSingleWeights(policy.scoringWeights || {}),
            departmentScoringWeights: visibleOverrides,
            departments: visibleDepartments,
            canEditGlobal,
            managedDepartmentIds: canEditGlobal ? [] : Array.from(managedDepartmentIds || []),
            dimensions: [
                { key: 'strategicAlignment', label: 'Strategic Alignment' },
                { key: 'regulatoryRisk', label: 'Regulatory Risk' },
                { key: 'businessImpact', label: 'Business Impact' },
                { key: 'implementationComplexity', label: 'Implementation Complexity' },
                { key: 'timeToValue', label: 'Time To Value' },
                { key: 'resourceRequirements', label: 'Resource Requirements' }
            ],
            formula: '(strategic*weight)+(regulatory*weight)+(business*weight)+(complexity*weight)+(timeToValue*weight)+(resources*weight)'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.updateScoringPolicy = async (req, res) => {
    try {
        const policy = await ensureWorkflowPolicyForOrganization(req.organization);
        const departments = await Department.find({ organization: req.organization }, '_id');
        const validDepartmentIds = new Set(departments.map((department) => String(department._id)));

        const canEditGlobal = req.user?.isAdmin === true;
        const managedDepartmentIds = getScoringManageDepartmentIds(req.user, req.user.roleCatalog || {});
        if (!canEditGlobal && (!managedDepartmentIds || managedDepartmentIds.size === 0)) {
            return res.status(403).json({ error: 'You do not have department access to manage scoring policy.' });
        }

        const currentGlobalWeights = normalizeSingleWeights(policy.scoringWeights || {});
        let globalWeights = currentGlobalWeights;

        if (canEditGlobal) {
            globalWeights = normalizeSingleWeights(req.body.scoringWeights || policy.scoringWeights || {});
            if (!weightsTotalIsValid(globalWeights)) {
                return res.status(400).json({ error: 'Global scoring weights must add up to exactly 100.' });
            }
        } else if (req.body.scoringWeights) {
            const requestedGlobalWeights = normalizeSingleWeights(req.body.scoringWeights || {});
            if (JSON.stringify(requestedGlobalWeights) !== JSON.stringify(currentGlobalWeights)) {
                return res.status(403).json({ error: 'Only organization admins can update global scoring weights.' });
            }
        }

        const existingRows = Array.isArray(policy.departmentScoringWeights)
            ? policy.departmentScoringWeights
            : [];
        const hasIncomingRows = Array.isArray(req.body.departmentScoringWeights);
        const incomingRows = hasIncomingRows ? req.body.departmentScoringWeights : existingRows;

        const seenDepartments = new Set();
        const normalizedRows = [];

        // For non-admin users, preserve overrides they are not allowed to manage.
        if (!canEditGlobal) {
            for (const row of existingRows) {
                const departmentId = String(row?.department || '').trim();
                if (!departmentId) continue;
                if (managedDepartmentIds?.has(departmentId)) continue;

                const lockedWeights = normalizeSingleWeights(row.weights || {}, globalWeights);
                if (!weightsTotalIsValid(lockedWeights)) {
                    return res.status(400).json({ error: `Stored override has invalid total for department: ${departmentId}` });
                }

                seenDepartments.add(departmentId);
                normalizedRows.push({
                    department: departmentId,
                    weights: lockedWeights
                });
            }
        }

        for (const row of incomingRows) {
            const departmentId = String(row?.department || '').trim();
            if (!departmentId) continue;

            if (!validDepartmentIds.has(departmentId)) {
                return res.status(400).json({ error: `Invalid department in scoring overrides: ${departmentId}` });
            }

            if (!canEditGlobal && !managedDepartmentIds?.has(departmentId)) {
                if (hasIncomingRows) {
                    return res.status(403).json({ error: `You cannot update scoring for department: ${departmentId}` });
                }
                continue;
            }

            if (seenDepartments.has(departmentId)) {
                return res.status(400).json({ error: 'Duplicate department overrides are not allowed.' });
            }
            seenDepartments.add(departmentId);

            const weights = normalizeSingleWeights(row.weights || {}, globalWeights);
            if (!weightsTotalIsValid(weights)) {
                return res.status(400).json({ error: `Department override weights must add up to exactly 100 (department: ${departmentId}).` });
            }

            normalizedRows.push({
                department: departmentId,
                weights
            });
        }

        policy.scoringWeights = globalWeights;
        policy.departmentScoringWeights = normalizedRows;
        await policy.save();

        res.json({
            message: 'Scoring policy updated successfully.',
            scoringWeights: policy.scoringWeights,
            departmentScoringWeights: policy.departmentScoringWeights
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
