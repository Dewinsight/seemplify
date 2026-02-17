const Role = require('../models/Role');
const WorkflowPolicy = require('../models/WorkflowPolicy');

const DEFAULT_ROLE_DEFINITIONS = [
    {
        key: 'Requester',
        name: 'Requester',
        description: 'Can submit initiatives for analysis.',
        capabilities: ['projects.submit']
    },
    {
        key: 'CenterOfExcellence',
        name: 'Center of Excellence',
        description: 'Performs tiered Center of Excellence review.',
        capabilities: ['projects.review.coe', 'dashboard.review']
    },
    {
        key: 'GovernanceApprover',
        name: 'Governance Approver',
        description: 'Performs governance review and manages business rules.',
        capabilities: ['projects.review.governance', 'rules.manage', 'projects.override', 'dashboard.review']
    },
    {
        key: 'ExecutiveApprover',
        name: 'Executive Approver',
        description: 'Performs final executive approvals and can manage system rules.',
        capabilities: [
            'projects.review.executive',
            'projects.review.governance',
            'rules.manage',
            'rules.manage.system',
            'projects.override',
            'dashboard.review'
        ]
    }
];

const DEFAULT_WORKFLOW_TIERS = [
    {
        tier: 1,
        label: 'Tier 1',
        minPriorityScore: 1.0,
        maxPriorityScore: 2.5,
        stages: [
            {
                stageKey: 'CenterOfExcellence',
                label: 'Center of Excellence Review',
                requiredRoleKeys: ['CenterOfExcellence'],
                minApprovals: 1,
                onReject: 'REJECT',
                pendingStatusLabel: 'Pending Center of Excellence',
                approvedStatusLabel: 'Approved',
                rejectedStatusLabel: 'Center of Excellence Rejected'
            }
        ]
    },
    {
        tier: 2,
        label: 'Tier 2',
        minPriorityScore: 2.6,
        maxPriorityScore: 3.5,
        stages: [
            {
                stageKey: 'CenterOfExcellence',
                label: 'Center of Excellence Review',
                requiredRoleKeys: ['CenterOfExcellence'],
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
    {
        tier: 3,
        label: 'Tier 3',
        minPriorityScore: 3.6,
        maxPriorityScore: 5.0,
        stages: [
            {
                stageKey: 'CenterOfExcellence',
                label: 'Center of Excellence Review',
                requiredRoleKeys: ['CenterOfExcellence'],
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
];

const DEFAULT_WORKFLOW_POLICY = {
    name: 'System Default Workflow Policy',
    description: 'Default tier routing and reviewer requirements for initiative approvals.',
    aiGate: {
        rejectBelow: 1.5,
        enhancedOversightMax: 2.0
    },
    escalation: {
        forcedTierOnEscalation: 3
    },
    tiers: DEFAULT_WORKFLOW_TIERS
};

const deepClone = (value) => JSON.parse(JSON.stringify(value));

const normalizeRoleKey = (value) => {
    const text = String(value || '').trim();
    if (!text) return '';
    const split = text
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/[^a-zA-Z0-9]+/g, ' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean);

    if (split.length === 0) return '';

    return split
        .map(token => token.charAt(0).toUpperCase() + token.slice(1))
        .join('');
};

const buildDefaultWorkflowPolicyPayload = () => deepClone(DEFAULT_WORKFLOW_POLICY);

async function upsertSystemRolesForOrganization(organizationId) {
    for (const roleDefinition of DEFAULT_ROLE_DEFINITIONS) {
        await Role.findOneAndUpdate(
            { organization: organizationId, key: roleDefinition.key },
            {
                $set: {
                    name: roleDefinition.name,
                    description: roleDefinition.description,
                    capabilities: roleDefinition.capabilities,
                    isSystem: true,
                    isActive: true
                },
                $setOnInsert: {
                    organization: organizationId,
                    key: roleDefinition.key
                }
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );
    }

    return Role.find({ organization: organizationId }).sort({ isSystem: -1, name: 1 });
}

async function ensureWorkflowPolicyForOrganization(organizationId, options = {}) {
    const { forceSync = false } = options;
    const payload = buildDefaultWorkflowPolicyPayload();

    let workflowPolicy = await WorkflowPolicy.findOne({ organization: organizationId });

    if (!workflowPolicy) {
        workflowPolicy = await WorkflowPolicy.create({
            organization: organizationId,
            isSystem: true,
            ...payload
        });
        return workflowPolicy;
    }

    if (forceSync) {
        const preserveIsActive = workflowPolicy.isActive;
        workflowPolicy.name = payload.name;
        workflowPolicy.description = payload.description;
        workflowPolicy.aiGate = payload.aiGate;
        workflowPolicy.escalation = payload.escalation;
        workflowPolicy.tiers = payload.tiers;
        workflowPolicy.isSystem = true;
        workflowPolicy.isActive = preserveIsActive;
        await workflowPolicy.save();
    }

    return workflowPolicy;
}

async function ensureGovernanceConfigForOrganization(organizationId, options = {}) {
    const { forcePolicySync = false, forceRoleSync = false } = options;
    const existingRoleCount = await Role.countDocuments({ organization: organizationId });
    const roles = (forceRoleSync || existingRoleCount === 0)
        ? await upsertSystemRolesForOrganization(organizationId)
        : await Role.find({ organization: organizationId }).sort({ isSystem: -1, name: 1 });
    const workflowPolicy = await ensureWorkflowPolicyForOrganization(organizationId, { forceSync: forcePolicySync });
    return { roles, workflowPolicy };
}

async function getWorkflowPolicyForOrganization(organizationId) {
    let workflowPolicy = await WorkflowPolicy.findOne({ organization: organizationId, isActive: true });
    if (!workflowPolicy) {
        const ensured = await ensureGovernanceConfigForOrganization(organizationId);
        workflowPolicy = ensured.workflowPolicy;
    }
    return workflowPolicy;
}

const buildRuleEffectsFromCategory = (category) => {
    const normalized = String(category || '').trim().toUpperCase();
    if (normalized === 'ESCALATION') {
        return [{ type: 'SET_TIER', params: { tier: 3, source: 'ESCALATION_RULE' } }];
    }
    return [];
};

module.exports = {
    DEFAULT_ROLE_DEFINITIONS,
    DEFAULT_WORKFLOW_TIERS,
    DEFAULT_WORKFLOW_POLICY,
    normalizeRoleKey,
    buildDefaultWorkflowPolicyPayload,
    upsertSystemRolesForOrganization,
    ensureWorkflowPolicyForOrganization,
    ensureGovernanceConfigForOrganization,
    getWorkflowPolicyForOrganization,
    buildRuleEffectsFromCategory
};
