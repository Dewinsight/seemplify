/**
 * A/B test rule evaluation quality with and without Weaviate grounding.
 *
 * This script runs the same initiative twice:
 * 1) Baseline (USE_WEAVIATE=false)
 * 2) Grounded (USE_WEAVIATE=true + USE_WEAVIATE_RULE_GROUNDING=true)
 *
 * Usage:
 *   node scripts/abTestWeaviateGrounding.js
 *   node scripts/abTestWeaviateGrounding.js --organization=<orgId>
 *   node scripts/abTestWeaviateGrounding.js --keep
 */

const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const mainController = require('../controllers/mainController');
const Rule = require('../models/Rule');
const Project = require('../models/Project');
const Organization = require('../models/Organization');
const Department = require('../models/Department');
const User = require('../models/User');
const UserOrganization = require('../models/UserOrganization');

const argValue = (name) => {
    const raw = process.argv.find((entry) => entry.startsWith(`${name}=`));
    return raw ? raw.split('=').slice(1).join('=').trim() : '';
};

const hasFlag = (name) => process.argv.includes(name);

const createMockResponse = () => {
    let statusCode = 200;
    let payload;
    let resolver;
    const done = new Promise((resolve) => {
        resolver = resolve;
    });

    return {
        res: {
            status(code) {
                statusCode = code;
                return this;
            },
            json(body) {
                payload = body;
                resolver({ statusCode, payload });
                return this;
            }
        },
        done
    };
};

const passEquivalent = (status) => ['pass', 'triggered'].includes(String(status || '').trim().toLowerCase());

const contradictionRegex = /\b(no|not|does not|missing|absent|none|without)\b/i;
const unavailableRegex = /(no evaluation returned|evaluation unavailable|unavailable after retry)/i;

const evaluateMetrics = (project) => {
    const rulesAnalysis = Array.isArray(project?.analysisResult?.rulesAnalysis)
        ? project.analysisResult.rulesAnalysis
        : [];
    const totalRules = rulesAnalysis.length;
    const passCount = rulesAnalysis.filter((row) => passEquivalent(row.status)).length;
    const triggeredCount = rulesAnalysis.filter((row) => String(row.status).toLowerCase() === 'triggered').length;
    const mandatoryFailed = rulesAnalysis.filter((row) => row.mandatory === true && String(row.status).toLowerCase() === 'fail').length;
    const unavailableCount = rulesAnalysis.filter((row) => unavailableRegex.test(String(row.reason || ''))).length;
    const contradictionCount = rulesAnalysis.filter((row) =>
        String(row.status).toLowerCase() === 'triggered' && contradictionRegex.test(String(row.reason || ''))
    ).length;
    const averageReasonLength = totalRules > 0
        ? Math.round(rulesAnalysis.reduce((sum, row) => sum + String(row.reason || '').length, 0) / totalRules)
        : 0;

    return {
        projectId: String(project?._id || ''),
        approvalStatus: project?.approvalStatus || '',
        workflowStage: project?.workflowStage || '',
        tier: Number(project?.tier || 0),
        priorityScore: Number(project?.priorityScore || 0),
        totalRules,
        passRatePercent: totalRules > 0 ? Math.round((passCount / totalRules) * 100) : 0,
        passCount,
        triggeredCount,
        mandatoryFailed,
        unavailableCount,
        contradictionCount,
        averageReasonLength,
        hardFailures: Number(project?.analysisResult?.ruleEvaluationCoverage?.hardFailures || 0),
        groundingApplied: Number(project?.analysisResult?.ruleEvaluationCoverage?.groundingApplied || 0),
        groundingChunksFetched: Number(project?.analysisResult?.ruleEvaluationCoverage?.groundingChunksFetched || 0)
    };
};

const runAnalysis = async ({ organizationId, departmentId, requesterId, runLabel, useWeaviate }) => {
    process.env.USE_WEAVIATE = useWeaviate ? 'true' : 'false';
    process.env.USE_WEAVIATE_RULE_GROUNDING = useWeaviate ? 'true' : 'false';
    process.env.USE_WEAVIATE_INITIATIVE_MEMORY = useWeaviate ? 'true' : 'false';

    const body = {
        name: `A/B Test Initiative - ${runLabel} - ${Date.now()}`,
        description: [
            'Customer service assistant for routine account inquiries.',
            'Includes escalation to human agents for complex cases.',
            'Goal is to reduce wait time and improve customer satisfaction.'
        ].join(' '),
        department: String(departmentId),
        formData: {
            initiativeName: 'Customer Service AI Assistant',
            submitterName: 'Sarah Johnson',
            submitterTitle: 'Head of Customer Experience',
            submitterEmail: 'sarah.johnson@sterling.com',
            submitterPhone: '+234 801 234 5678',
            groupHeadName: 'Michael Adeyemi',
            confirmGroupHeadApproval: true,
            heartSectorClassification: 'direct_heart_impact',
            problemDescription: 'Long wait times and repetitive tasks for customer service agents.',
            whoAffected: 'all',
            currentHandling: 'Manual IVR routing plus human agent lookup.',
            aiDirection: 'customer_experience',
            aiIdea: 'AI assistant handles routine balance/status questions and escalates complex cases.',
            improvements: ['time', 'customer', 'errors'],
            timeSaved: '2000 hours per month',
            moneySaved: '50000000',
            customerBenefit: '24/7 fast response',
            errorReduction: 'Fewer lookup mistakes',
            successMeasure: 'Wait time under 2 minutes and CSAT up by 20%',
            dataNeeded: 'Customer account info, transaction history, FAQ, call logs',
            dataStorage: 'banking_system',
            involvesPersonalInfo: 'yes',
            urgency: 'important_6months',
            budgetAvailable: 'yes',
            budgetAmount: '75000000',
            teamTimeCommitment: 'yes',
            teamHoursPerWeek: '20',
            previousAttempts: 'A basic chatbot pilot was run 2 years ago and underperformed.',
            regulations: 'CBN data protection compliance and internal data governance.',
            additionalContext: 'Executive sponsorship confirmed and technical feasibility checked.',
            confirmAccuracy: true,
            confirmContactAcknowledgment: true
        }
    };

    const req = {
        organization: organizationId,
        user: {
            id: String(requesterId),
            isAdmin: true,
            permissions: [],
            roleCatalog: {}
        },
        body
    };

    const mock = createMockResponse();
    await mainController.analyzeProject(req, mock.res);
    const result = await mock.done;
    if (result.statusCode !== 200) {
        throw new Error(`${runLabel} analysis failed: status=${result.statusCode}, body=${JSON.stringify(result.payload)}`);
    }
    return result.payload;
};

async function pickTestContext(organizationArg) {
    let organizationId = organizationArg;
    if (!organizationId) {
        const topOrg = await Rule.aggregate([
            { $match: { isActive: true } },
            { $group: { _id: '$organization', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 1 }
        ]);
        organizationId = topOrg?.[0]?._id ? String(topOrg[0]._id) : '';
    }

    if (!organizationId) {
        const firstOrg = await Organization.findOne({}).select('_id').lean();
        organizationId = firstOrg?._id ? String(firstOrg._id) : '';
    }
    if (!organizationId) {
        throw new Error('No organization found for A/B test.');
    }

    const activeRuleCount = await Rule.countDocuments({ organization: organizationId, isActive: true });
    if (activeRuleCount === 0) {
        throw new Error(`Organization ${organizationId} has no active rules.`);
    }

    let department = await Department.findOne({ organization: organizationId, name: 'General' }).select('_id').lean();
    if (!department) {
        department = await Department.findOne({ organization: organizationId }).select('_id').lean();
    }
    if (!department?._id) {
        throw new Error(`No department found for organization ${organizationId}.`);
    }

    let member = await UserOrganization.findOne({ organization: organizationId, isAdmin: true }).select('user').lean();
    if (!member) {
        member = await UserOrganization.findOne({ organization: organizationId }).select('user').lean();
    }
    if (!member?.user) {
        const anyUser = await User.findOne({}).select('_id').lean();
        if (!anyUser?._id) throw new Error('No user found for A/B test.');
        member = { user: anyUser._id };
    }

    return {
        organizationId,
        departmentId: String(department._id),
        requesterId: String(member.user),
        activeRuleCount
    };
}

async function main() {
    const organizationArg = argValue('--organization');
    const keep = hasFlag('--keep');
    const reportDir = path.join(__dirname, 'reports');
    fs.mkdirSync(reportDir, { recursive: true });

    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    const context = await pickTestContext(organizationArg);
    console.log(`Using organization ${context.organizationId} with ${context.activeRuleCount} active rules.`);

    const originalFlags = {
        USE_WEAVIATE: process.env.USE_WEAVIATE,
        USE_WEAVIATE_RULE_GROUNDING: process.env.USE_WEAVIATE_RULE_GROUNDING,
        USE_WEAVIATE_INITIATIVE_MEMORY: process.env.USE_WEAVIATE_INITIATIVE_MEMORY
    };

    const createdProjects = [];
    try {
        const baselineProject = await runAnalysis({
            ...context,
            runLabel: 'baseline-no-weaviate',
            useWeaviate: false
        });
        createdProjects.push(String(baselineProject._id));
        const baseline = evaluateMetrics(baselineProject);

        const groundedProject = await runAnalysis({
            ...context,
            runLabel: 'grounded-weaviate',
            useWeaviate: true
        });
        createdProjects.push(String(groundedProject._id));
        const grounded = evaluateMetrics(groundedProject);

        const comparison = {
            generatedAt: new Date().toISOString(),
            organizationId: context.organizationId,
            activeRuleCount: context.activeRuleCount,
            baseline,
            grounded,
            delta: {
                passRatePercent: grounded.passRatePercent - baseline.passRatePercent,
                mandatoryFailed: grounded.mandatoryFailed - baseline.mandatoryFailed,
                unavailableCount: grounded.unavailableCount - baseline.unavailableCount,
                contradictionCount: grounded.contradictionCount - baseline.contradictionCount,
                hardFailures: grounded.hardFailures - baseline.hardFailures
            }
        };

        const reportPath = path.join(reportDir, `weaviate-abtest-${Date.now()}.json`);
        fs.writeFileSync(reportPath, JSON.stringify(comparison, null, 2));

        console.log('\nA/B Test Summary');
        console.log(`- Baseline pass rate: ${baseline.passRatePercent}%`);
        console.log(`- Grounded pass rate: ${grounded.passRatePercent}%`);
        console.log(`- Baseline mandatory failed: ${baseline.mandatoryFailed}`);
        console.log(`- Grounded mandatory failed: ${grounded.mandatoryFailed}`);
        console.log(`- Baseline unavailable rules: ${baseline.unavailableCount}`);
        console.log(`- Grounded unavailable rules: ${grounded.unavailableCount}`);
        console.log(`- Baseline hard failures: ${baseline.hardFailures}`);
        console.log(`- Grounded hard failures: ${grounded.hardFailures}`);
        console.log(`- Grounded retrieval applied: ${grounded.groundingApplied}`);
        console.log(`- Grounded chunks fetched: ${grounded.groundingChunksFetched}`);
        console.log(`- Report: ${reportPath}`);

        if (!keep) {
            await Project.deleteMany({ _id: { $in: createdProjects } });
            console.log(`- Cleaned up ${createdProjects.length} test projects.`);
        }
    } finally {
        process.env.USE_WEAVIATE = originalFlags.USE_WEAVIATE;
        process.env.USE_WEAVIATE_RULE_GROUNDING = originalFlags.USE_WEAVIATE_RULE_GROUNDING;
        process.env.USE_WEAVIATE_INITIATIVE_MEMORY = originalFlags.USE_WEAVIATE_INITIATIVE_MEMORY;
    }
}

main()
    .then(async () => {
        await mongoose.disconnect();
        process.exit(0);
    })
    .catch(async (error) => {
        console.error('A/B test failed:', error.message || error);
        try {
            await mongoose.disconnect();
        } catch (_) {
            // ignore disconnect errors
        }
        process.exit(1);
    });
