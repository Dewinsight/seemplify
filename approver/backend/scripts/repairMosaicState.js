/**
 * Dry-run/apply repair for Mosaic approval state.
 *
 * Default is dry-run. Use --apply to mutate data.
 *
 * Usage:
 *   node scripts/repairMosaicState.js --dry-run
 *   node scripts/repairMosaicState.js --apply
 */

const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const Organization = require('../models/Organization');
const Rule = require('../models/Rule');
const Project = require('../models/Project');
const UserOrganization = require('../models/UserOrganization');
const { getAtomicRules, getPolicyVersion } = require('../services/mosaicPolicyService');
const { seedSystemRulesForOrganization } = require('../services/systemRuleSeedService');

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

async function getExpectedRuleState(orgId, expectedRuleIds) {
    const rules = await Rule.find({
        organization: orgId,
        isSystem: true,
        systemRuleId: { $in: expectedRuleIds }
    }, 'systemRuleId isActive').lean();
    const presentIds = new Set(rules.map(rule => Number(rule.systemRuleId)));
    const activeIds = new Set(rules.filter(rule => rule.isActive !== false).map(rule => Number(rule.systemRuleId)));
    return {
        presentCount: presentIds.size,
        activeCount: activeIds.size,
        missingIds: expectedRuleIds.filter(ruleId => !presentIds.has(ruleId)),
        inactiveIds: expectedRuleIds.filter(ruleId => presentIds.has(ruleId) && !activeIds.has(ruleId))
    };
}

async function inferOrganizationFromRequester(project) {
    if (!project.requester) {
        return {
            inferredOrganization: null,
            reason: 'Project has no requester.'
        };
    }

    const memberships = await UserOrganization.find(
        { user: project.requester },
        'organization'
    ).lean();
    const organizationIds = Array.from(new Set(
        memberships.map(membership => idString(membership.organization)).filter(Boolean)
    ));

    if (organizationIds.length === 1) {
        return {
            inferredOrganization: organizationIds[0],
            reason: 'Requester belongs to exactly one organization.'
        };
    }

    return {
        inferredOrganization: null,
        reason: organizationIds.length === 0
            ? 'Requester has no organization membership.'
            : `Requester has multiple organization memberships: ${organizationIds.join(', ')}.`
    };
}

async function repairSystemRules({ organizations, expectedRuleIds, apply, report }) {
    for (const org of organizations) {
        const state = await getExpectedRuleState(org._id, expectedRuleIds);
        if (state.missingIds.length === 0) {
            if (state.inactiveIds.length > 0) {
                report.ruleRuntimeTogglesPreserved.push({
                    organization: compactOrg(org),
                    inactiveSystemRuleIds: state.inactiveIds
                });
            }
            continue;
        }

        const entry = {
            organization: compactOrg(org),
            presentSystemRules: state.presentCount,
            activeSystemRules: state.activeCount,
            expectedSystemRules: expectedRuleIds.length,
            missingSystemRuleIds: state.missingIds
        };

        if (apply) {
            entry.result = await seedSystemRulesForOrganization(org._id, {
                forcePolicySync: false,
                preserveRuntimeToggles: true,
                removeProcessRules: true
            });
        } else {
            entry.action = 'would_seed_missing_mosaic_system_rules';
        }

        report.ruleSeeding.push(entry);
    }
}

async function repairProjectOrganizations({ organizations, apply, report }) {
    const organizationIds = new Set(organizations.map(org => String(org._id)));
    const candidates = await Project.find({
        $or: [
            { organization: { $exists: false } },
            { organization: null },
            { organization: { $nin: Array.from(organizationIds) } }
        ]
    }, 'name requester organization status approvalStatus createdAt').lean();

    for (const project of candidates) {
        const currentOrganization = idString(project.organization);
        if (currentOrganization && organizationIds.has(currentOrganization)) continue;

        const inference = await inferOrganizationFromRequester(project);
        const entry = {
            projectId: String(project._id),
            name: project.name,
            currentOrganization: currentOrganization || null,
            requester: idString(project.requester),
            reason: inference.reason
        };

        if (!inference.inferredOrganization) {
            report.ambiguousProjects.push(entry);
            continue;
        }

        entry.inferredOrganization = inference.inferredOrganization;
        if (apply) {
            await Project.updateOne(
                { _id: project._id },
                { $set: { organization: inference.inferredOrganization } }
            );
            entry.action = 'updated_project_organization';
        } else {
            entry.action = 'would_update_project_organization';
        }
        report.projectOrganizationBackfills.push(entry);
    }
}

async function repairCurrentStageKeys({ apply, report }) {
    const candidates = await Project.find({
        status: 'Under Review',
        $or: [
            { currentStageKey: { $exists: false } },
            { currentStageKey: null },
            { currentStageKey: '' }
        ]
    }, 'name organization approvalStatus currentStageKey status tier createdAt').lean();

    for (const project of candidates) {
        const inferredStageKey = LEGACY_PENDING_STAGE_KEY[project.approvalStatus];
        const entry = {
            projectId: String(project._id),
            name: project.name,
            organization: idString(project.organization),
            approvalStatus: project.approvalStatus,
            tier: project.tier
        };

        if (!inferredStageKey) {
            report.ambiguousStageBackfills.push({
                ...entry,
                reason: 'No legacy pending status matched this project.'
            });
            continue;
        }

        entry.currentStageKey = inferredStageKey;
        if (apply) {
            await Project.updateOne(
                { _id: project._id },
                { $set: { currentStageKey: inferredStageKey } }
            );
            entry.action = 'updated_current_stage_key';
        } else {
            entry.action = 'would_update_current_stage_key';
        }
        report.stageBackfills.push(entry);
    }
}

async function run() {
    const args = process.argv.slice(2);
    const apply = args.includes('--apply');
    if (apply && args.includes('--dry-run')) {
        throw new Error('Use either --apply or --dry-run, not both.');
    }

    await mongoose.connect(process.env.MONGO_URI);

    const organizations = await Organization.find({}).sort({ name: 1 }).lean();
    const expectedRuleIds = getAtomicRules({ includeProcessRules: false }).map(rule => Number(rule.id));
    const report = {
        generatedAt: new Date().toISOString(),
        mode: apply ? 'apply' : 'dry-run',
        policyVersion: getPolicyVersion(),
        expectedMosaicSystemRulesPerOrg: expectedRuleIds.length,
        ruleSeeding: [],
        ruleRuntimeTogglesPreserved: [],
        projectOrganizationBackfills: [],
        stageBackfills: [],
        ambiguousProjects: [],
        ambiguousStageBackfills: []
    };

    await repairSystemRules({ organizations, expectedRuleIds, apply, report });
    await repairProjectOrganizations({ organizations, apply, report });
    await repairCurrentStageKeys({ apply, report });

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
