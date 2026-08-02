/**
 * Read-only Mosaic approval state audit.
 *
 * Usage:
 *   node scripts/auditMosaicState.js
 */

const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const Organization = require('../models/Organization');
const Rule = require('../models/Rule');
const Role = require('../models/Role');
const WorkflowPolicy = require('../models/WorkflowPolicy');
const Project = require('../models/Project');
const UserOrganization = require('../models/UserOrganization');
const { getAtomicRules, getPolicyVersion } = require('../services/mosaicPolicyService');

const LEGACY_PENDING_STAGE_KEY = {
    'Pending Center of Excellence': 'CenterOfExcellence',
    'Pending Governance': 'Governance',
    'Pending Executive': 'Executive'
};

function idString(value) {
    if (!value) return '';
    return String(value._id || value);
}

function compactOrg(org) {
    return {
        id: String(org._id),
        name: org.name,
        slug: org.slug
    };
}

async function auditRules(organizations, expectedRuleIds) {
    const byOrg = [];
    let noMosaicRules = 0;
    let partialMosaicRules = 0;
    let fullMosaicRules = 0;

    for (const org of organizations) {
        const rules = await Rule.find({
            organization: org._id,
            isSystem: true,
            systemRuleId: { $in: expectedRuleIds }
        }, 'systemRuleId isActive category name').lean();
        const presentIds = new Set(rules.map(rule => Number(rule.systemRuleId)));
        const activeIds = new Set(rules.filter(rule => rule.isActive !== false).map(rule => Number(rule.systemRuleId)));
        const missingIds = expectedRuleIds.filter(ruleId => !presentIds.has(ruleId));
        const inactiveIds = expectedRuleIds.filter(ruleId => presentIds.has(ruleId) && !activeIds.has(ruleId));

        if (presentIds.size === 0) noMosaicRules += 1;
        else if (presentIds.size < expectedRuleIds.length) partialMosaicRules += 1;
        else fullMosaicRules += 1;

        if (missingIds.length > 0 || inactiveIds.length > 0) {
            byOrg.push({
                organization: compactOrg(org),
                expectedSystemRules: expectedRuleIds.length,
                presentSystemRules: presentIds.size,
                activeSystemRules: activeIds.size,
                missingSystemRuleIds: missingIds,
                inactiveSystemRuleIds: inactiveIds
            });
        }
    }

    return {
        totals: {
            noMosaicRules,
            partialMosaicRules,
            fullMosaicRules
        },
        exceptions: byOrg
    };
}

async function auditWorkflow(organizations) {
    const rows = [];
    for (const org of organizations) {
        const policy = await WorkflowPolicy.findOne({ organization: org._id }).lean();
        if (!policy) {
            rows.push({ organization: compactOrg(org), issue: 'missing_workflow_policy' });
            continue;
        }

        const tier2 = (policy.tiers || []).find(tier => Number(tier.tier) === 2);
        const tier2Coe = (tier2?.stages || []).find(stage => stage.stageKey === 'CenterOfExcellence');
        const tier3 = (policy.tiers || []).find(tier => Number(tier.tier) === 3);
        const tier3Keys = (tier3?.stages || []).map(stage => stage.stageKey);
        const issues = [];

        if (Number(tier2Coe?.minApprovals || 0) < 2) issues.push('tier2_coe_min_approvals_below_2');
        if (!tier3Keys.includes('Governance') || !tier3Keys.includes('Executive')) issues.push('tier3_missing_governance_or_executive');
        if (Number(policy.escalation?.forcedTierOnEscalation || 0) !== 3) issues.push('escalation_not_forced_to_tier3');

        if (issues.length > 0) {
            rows.push({ organization: compactOrg(org), policyId: String(policy._id), issues });
        }
    }
    return rows;
}

async function auditRoles(organizations) {
    const rows = [];
    for (const org of organizations) {
        const roles = await Role.find({ organization: org._id, isActive: true }, 'key capabilities').lean();
        const roleKeys = new Set(roles.map(role => role.key));
        const missingKeys = ['Requester', 'CenterOfExcellence', 'GovernanceApprover', 'ExecutiveApprover']
            .filter(roleKey => !roleKeys.has(roleKey));
        if (missingKeys.length > 0) {
            rows.push({ organization: compactOrg(org), missingRoleKeys: missingKeys });
        }
    }
    return rows;
}

async function auditProjects(organizations) {
    const organizationIds = new Set(organizations.map(org => String(org._id)));
    const pendingStatuses = Object.keys(LEGACY_PENDING_STAGE_KEY);
    const missingOrganization = [];
    const stuckReviewStages = [];
    const duplicateSlugs = [];

    const orphanCandidates = await Project.find({
        $or: [
            { organization: { $exists: false } },
            { organization: null }
        ]
    }, 'name requester organization department approvalStatus status currentStageKey createdAt').lean();

    for (const project of orphanCandidates) {
        missingOrganization.push({
            id: String(project._id),
            name: project.name,
            requester: idString(project.requester),
            approvalStatus: project.approvalStatus,
            status: project.status
        });
    }

    const invalidOrgProjects = await Project.find({
        organization: { $exists: true, $ne: null }
    }, 'name requester organization department approvalStatus status currentStageKey createdAt').lean();

    invalidOrgProjects
        .filter(project => !organizationIds.has(String(project.organization)))
        .forEach(project => {
            missingOrganization.push({
                id: String(project._id),
                name: project.name,
                requester: idString(project.requester),
                organization: idString(project.organization),
                approvalStatus: project.approvalStatus,
                status: project.status,
                issue: 'organization_id_not_found'
            });
        });

    const stuckProjects = await Project.find({
        status: 'Under Review',
        $or: [
            { currentStageKey: { $exists: false } },
            { currentStageKey: null },
            { currentStageKey: '' }
        ]
    }, 'name organization approvalStatus status currentStageKey tier createdAt').lean();

    stuckProjects.forEach(project => {
        stuckReviewStages.push({
            id: String(project._id),
            name: project.name,
            organization: idString(project.organization),
            approvalStatus: project.approvalStatus,
            inferredStageKey: LEGACY_PENDING_STAGE_KEY[project.approvalStatus] || null,
            tier: project.tier
        });
    });

    const projectSlugDuplicates = await Project.collection.aggregate([
        { $match: { slug: { $type: 'string', $ne: '' } } },
        { $group: { _id: '$slug', count: { $sum: 1 }, projectIds: { $push: '$_id' } } },
        { $match: { count: { $gt: 1 } } },
        { $sort: { count: -1 } }
    ]).toArray();

    projectSlugDuplicates.forEach(row => {
        duplicateSlugs.push({
            slug: row._id,
            count: row.count,
            projectIds: row.projectIds.map(String)
        });
    });

    const underReviewNoPendingLabel = await Project.countDocuments({
        status: 'Under Review',
        currentStageKey: { $in: [null, ''] },
        approvalStatus: { $nin: pendingStatuses }
    });

    return {
        missingOrganization,
        stuckReviewStages,
        underReviewNoPendingLabel,
        duplicateSlugs
    };
}

async function auditMemberships() {
    const rows = [];
    const memberships = await UserOrganization.find({}).populate('organization', 'name slug').lean();
    memberships.forEach((membership) => {
        (membership.permissions || []).forEach((permission) => {
            const hasRoles = Array.isArray(permission.roles) && permission.roles.length > 0;
            if (!hasRoles) return;
            if (!permission.department) {
                rows.push({
                    membershipId: String(membership._id),
                    organization: membership.organization ? compactOrg(membership.organization) : null,
                    user: idString(membership.user),
                    roles: permission.roles,
                    scope: 'org_wide'
                });
            }
        });
    });
    return rows;
}

async function run() {
    await mongoose.connect(process.env.MONGO_URI);

    const organizations = await Organization.find({}).sort({ name: 1 }).lean();
    const expectedRuleIds = getAtomicRules({ includeProcessRules: false }).map(rule => Number(rule.id));

    const report = {
        generatedAt: new Date().toISOString(),
        policyVersion: getPolicyVersion(),
        totals: {
            organizations: organizations.length,
            expectedMosaicSystemRulesPerOrg: expectedRuleIds.length,
            projects: await Project.countDocuments({}),
            memberships: await UserOrganization.countDocuments({})
        },
        rules: await auditRules(organizations, expectedRuleIds),
        workflowPolicies: await auditWorkflow(organizations),
        roles: await auditRoles(organizations),
        projects: await auditProjects(organizations),
        orgWideReviewerPermissions: await auditMemberships()
    };

    console.log(JSON.stringify(report, null, 2));
    await mongoose.connection.close();
}

run().catch(async (error) => {
    console.error(JSON.stringify({ error: error.message }, null, 2));
    try {
        await mongoose.connection.close();
    } catch (_) {
        // Ignore close failures on process exit.
    }
    process.exit(1);
});
