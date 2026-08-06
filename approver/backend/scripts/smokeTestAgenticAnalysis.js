/**
 * Smoke test for agentic analysis pipeline.
 *
 * What it validates:
 * 1) Sync pipeline (`analyzeProject`) creates a project with rule analyses.
 * 2) Async pipeline (`analyzeProjectAsync`) returns a job and progresses to completion.
 * 3) Escalation rules are marked as Triggered (not failed) and apply tier effects.
 * 4) Admin override endpoint works using route param ID and finalizes workflow state.
 *
 * Note:
 * This script stubs OpenAI service calls for deterministic results and does not call external APIs.
 *
 * Usage:
 *   node scripts/smokeTestAgenticAnalysis.js
 *   node scripts/smokeTestAgenticAnalysis.js --apply
 */

const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const mainController = require('../controllers/mainController');
const openAIService = require('../services/OpenAIService');
const Organization = require('../models/Organization');
const Department = require('../models/Department');
const Rule = require('../models/Rule');
const Project = require('../models/Project');
const User = require('../models/User');
const Role = require('../models/Role');
const WorkflowPolicy = require('../models/WorkflowPolicy');
const UserOrganization = require('../models/UserOrganization');
const Audit = require('../models/Audit');

const allowDbMutation =
    process.argv.includes('--apply') ||
    process.env.SMOKE_ALLOW_DB_MUTATION === 'true';

function createMockResponse() {
    let statusCode = 200;
    let payload;
    let resolveDone;
    const done = new Promise((resolve) => {
        resolveDone = resolve;
    });

    const res = {
        status(code) {
            statusCode = code;
            return this;
        },
        json(body) {
            payload = body;
            resolveDone({ statusCode, payload });
            return this;
        }
    };

    return { res, done, getState: () => ({ statusCode, payload }) };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function installDeterministicOpenAIStubs() {
    const originalAnalyzePriorityOnly = openAIService.analyzePriorityOnly.bind(openAIService);
    const originalEvaluateSingleRule = openAIService.evaluateSingleRule.bind(openAIService);
    const originalSummarizeFinalDecision = openAIService.summarizeFinalDecision.bind(openAIService);

    const includesAny = (text, list) => list.some((item) => text.includes(item));

    openAIService.analyzePriorityOnly = async () => ({
        scoringBreakdown: {
            strategicAlignment: { score: 4, reason: 'Deterministic smoke scoring.' },
            regulatoryRisk: { score: 3, reason: 'Deterministic smoke scoring.' },
            businessImpact: { score: 4, reason: 'Deterministic smoke scoring.' },
            implementationComplexity: { score: 3, reason: 'Deterministic smoke scoring.' },
            timeToValue: { score: 4, reason: 'Deterministic smoke scoring.' },
            resourceRequirements: { score: 3, reason: 'Deterministic smoke scoring.' }
        },
        summary: 'Deterministic smoke scoring summary.'
    });

    openAIService.evaluateSingleRule = async (projectContext, rule) => {
        const context = String(projectContext || '').toLowerCase();
        const name = String(rule?.name || '').toLowerCase();

        if (name.includes('heart')) {
            const pass = includesAny(context, [
                '"heartsectorclassification": "direct_heart_impact"',
                '"heartsectorclassification": "indirect_heart_impact"'
            ]);
            return {
                ruleId: String(rule?._id || ''),
                ruleName: rule?.name || '',
                status: pass ? 'Pass' : 'Fail',
                reason: pass
                    ? 'HEART classification indicates direct or indirect impact.'
                    : 'HEART classification is missing or non-HEART.',
                mandatory: rule?.isMandatory === true
            };
        }

        if (name.includes('budget')) {
            const hasBudgetYes = context.includes('"budgetavailable": "yes"');
            const amountMatch = context.match(/"budgetamount":\s*"([^"]+)"/);
            const amount = amountMatch?.[1] || '';
            const amountValue = Number(String(amount).replace(/[^\d.]/g, ''));
            const pass = hasBudgetYes && Number.isFinite(amountValue) && amountValue > 0;
            return {
                ruleId: String(rule?._id || ''),
                ruleName: rule?.name || '',
                status: pass ? 'Pass' : 'Fail',
                reason: pass
                    ? `Budget is available with amount ${amount}.`
                    : 'Budget is unavailable or amount is missing.',
                mandatory: rule?.isMandatory === true
            };
        }

        if (name.includes('sensitive data escalation')) {
            const trigger = context.includes('"involvespersonalinfo": "yes"');
            return {
                ruleId: String(rule?._id || ''),
                ruleName: rule?.name || '',
                status: trigger ? 'Fail' : 'Pass',
                conditionPresent: trigger,
                reason: trigger
                    ? 'Personal data is involved; escalation should trigger.'
                    : 'No personal data involvement; no escalation.',
                mandatory: rule?.isMandatory === true
            };
        }

        if (name.includes('cap trigger smoke rule')) {
            const trigger = context.includes('executive sponsorship');
            return {
                ruleId: String(rule?._id || ''),
                ruleName: rule?.name || '',
                status: trigger ? 'Fail' : 'Pass',
                conditionPresent: trigger,
                reason: trigger
                    ? 'Cap condition is present for smoke test.'
                    : 'Cap condition is not present.',
                mandatory: rule?.isMandatory === true
            };
        }

        return {
            ruleId: String(rule?._id || ''),
            ruleName: rule?.name || '',
            status: 'Pass',
            reason: 'Default deterministic pass for smoke test.',
            mandatory: rule?.isMandatory === true
        };
    };

    openAIService.summarizeFinalDecision = async (_projectContext, payload) =>
        `Deterministic summary. Priority ${payload?.priorityScore ?? 'N/A'}, Tier ${payload?.tier ?? 'N/A'}.`;

    return () => {
        openAIService.analyzePriorityOnly = originalAnalyzePriorityOnly;
        openAIService.evaluateSingleRule = originalEvaluateSingleRule;
        openAIService.summarizeFinalDecision = originalSummarizeFinalDecision;
    };
}

async function ensureTestUser() {
    const existing = await User.findOne({}).select('_id username').lean();
    if (existing) return existing;

    const stamp = Date.now();
    const user = await User.create({
        username: `agentic-smoke-${stamp}`,
        email: `agentic-smoke-${stamp}@example.com`,
        password: 'not-used-in-smoke-test',
        isVerified: true
    });
    return user.toObject();
}

async function runSyncAnalysis({ organizationId, departmentId, userId }) {
    const req = {
        organization: organizationId,
        user: {
            id: String(userId),
            isAdmin: true,
            permissions: [],
            roleCatalog: {}
        },
        body: {
            name: 'Agentic Smoke Test - Sync',
            description: 'Customer support virtual assistant initiative.',
            department: departmentId,
            formData: {
                initiativeName: 'Agentic Smoke Test - Sync',
                submitterName: 'Smoke Tester',
                submitterTitle: 'QA Engineer',
                submitterEmail: 'smoke@test.local',
                groupHeadName: 'QA Lead',
                confirmGroupHeadApproval: true,
                heartSectorClassification: 'direct_heart_impact',
                problemDescription: 'Routine customer requests create long queues.',
                whoAffected: 'all',
                currentHandling: 'Manual handling through human agents only.',
                aiDirection: 'customer_experience',
                aiIdea: 'Deploy assistant for routine balance and status checks.',
                improvements: ['time', 'customer', 'errors'],
                timeSaved: '1000 hours per month',
                moneySaved: '50000000',
                customerBenefit: 'Faster response times',
                errorReduction: 'Fewer lookup errors',
                successMeasure: 'Wait time below 2 minutes',
                dataNeeded: 'Customer profiles, transaction status, FAQ',
                dataStorage: 'banking_system',
                involvesPersonalInfo: 'yes',
                urgency: 'important_6months',
                budgetAvailable: 'yes',
                budgetAmount: '75000000',
                teamTimeCommitment: 'yes',
                teamHoursPerWeek: '20',
                regulations: 'Comply with CBN and internal policy',
                additionalContext: 'Executive sponsorship confirmed',
                confirmAccuracy: true,
                confirmContactAcknowledgment: true
            }
        }
    };

    const { res, done } = createMockResponse();
    await mainController.analyzeProject(req, res);
    return await done;
}

async function runAsyncAnalysis({ organizationId, departmentId, userId }) {
    const req = {
        organization: organizationId,
        user: {
            id: String(userId),
            isAdmin: true,
            permissions: [],
            roleCatalog: {}
        },
        body: {
            name: 'Agentic Smoke Test - Async',
            description: 'Async job analysis for initiative.',
            department: departmentId,
            formData: {
                initiativeName: 'Agentic Smoke Test - Async',
                submitterName: 'Smoke Tester',
                submitterTitle: 'QA Engineer',
                submitterEmail: 'smoke@test.local',
                groupHeadName: 'QA Lead',
                confirmGroupHeadApproval: true,
                heartSectorClassification: 'direct_heart_impact',
                problemDescription: 'Routine customer requests create long queues.',
                whoAffected: 'all',
                currentHandling: 'Manual handling through human agents only.',
                aiDirection: 'customer_experience',
                aiIdea: 'Deploy assistant for routine balance and status checks.',
                improvements: ['time', 'customer', 'errors'],
                timeSaved: '1000 hours per month',
                moneySaved: '50000000',
                customerBenefit: 'Faster response times',
                errorReduction: 'Fewer lookup errors',
                successMeasure: 'Wait time below 2 minutes',
                dataNeeded: 'Customer profiles, transaction status, FAQ',
                dataStorage: 'banking_system',
                involvesPersonalInfo: 'yes',
                urgency: 'important_6months',
                budgetAvailable: 'yes',
                budgetAmount: '75000000',
                teamTimeCommitment: 'yes',
                teamHoursPerWeek: '20',
                regulations: 'Comply with CBN and internal policy',
                additionalContext: 'Executive sponsorship confirmed',
                confirmAccuracy: true,
                confirmContactAcknowledgment: true
            }
        }
    };

    const start = createMockResponse();
    await mainController.analyzeProjectAsync(req, start.res);
    const kickoff = await start.done;

    if (kickoff.statusCode !== 202 || !kickoff.payload?.jobId) {
        throw new Error(`Async kickoff failed: status=${kickoff.statusCode}, body=${JSON.stringify(kickoff.payload)}`);
    }

    const jobId = kickoff.payload.jobId;
    const statusReq = {
        organization: organizationId,
        user: {
            id: String(userId),
            isAdmin: true
        },
        params: { jobId }
    };

    let lastPayload = null;
    const maxPolls = 180;
    for (let i = 0; i < maxPolls; i += 1) {
        const statusRes = createMockResponse();
        await mainController.getAnalyzeJobStatus(statusReq, statusRes.res);
        const statusResult = await statusRes.done;
        if (statusResult.statusCode !== 200) {
            throw new Error(`Async status fetch failed: status=${statusResult.statusCode}`);
        }

        lastPayload = statusResult.payload;
        if (lastPayload.status === 'completed') {
            return lastPayload;
        }
        if (lastPayload.status === 'failed') {
            throw new Error(`Async job failed: ${lastPayload.error || 'unknown'}`);
        }

        await sleep(1000);
    }

    throw new Error(`Async job timed out. Last status: ${JSON.stringify(lastPayload)}`);
}

async function runAdminOverride({ organizationId, projectId, userId, newStatus }) {
    const req = {
        organization: organizationId,
        user: {
            id: String(userId),
            isAdmin: true
        },
        params: { id: String(projectId) },
        body: {
            newStatus,
            reason: 'Smoke test admin override'
        }
    };

    const { res, done } = createMockResponse();
    await mainController.overrideProject(req, res);
    const result = await done;

    if (result.statusCode !== 200) {
        throw new Error(`Override failed: status=${result.statusCode}, body=${JSON.stringify(result.payload)}`);
    }

    const project = await Project.findById(projectId).lean();
    if (!project) throw new Error(`Project not found after override: ${projectId}`);

    if (project.approvalStatus !== newStatus) {
        throw new Error(`Override approvalStatus mismatch: expected ${newStatus}, got ${project.approvalStatus}`);
    }
    if (project.status !== newStatus) {
        throw new Error(`Override status mismatch: expected ${newStatus}, got ${project.status}`);
    }
    if (project.workflowStage !== 'Complete') {
        throw new Error(`Override workflowStage mismatch: expected Complete, got ${project.workflowStage}`);
    }
    if (project.currentStageKey !== null) {
        throw new Error(`Override currentStageKey mismatch: expected null, got ${project.currentStageKey}`);
    }

    const history = Array.isArray(project.approvalHistory) ? project.approvalHistory : [];
    const overrideEntry = history.find((row) => String(row.stage) === 'AdminOverride' && String(row.action) === newStatus);
    if (!overrideEntry) {
        throw new Error('Override history entry not found on project.');
    }
}

async function validateProject({
    projectId,
    expectedRules,
    expectEscalationTriggered = false,
    expectCapTriggered = false
}) {
    const project = await Project.findById(projectId).lean();
    if (!project) throw new Error(`Project not found: ${projectId}`);

    const rulesAnalysis = Array.isArray(project.analysisResult?.rulesAnalysis)
        ? project.analysisResult.rulesAnalysis
        : [];

    if (rulesAnalysis.length !== expectedRules) {
        throw new Error(`rulesAnalysis length mismatch: expected ${expectedRules}, got ${rulesAnalysis.length}`);
    }

    const missingFallbacks = rulesAnalysis.filter((row) =>
        String(row.reason || '').includes('No evaluation returned by model')
    );
    if (missingFallbacks.length > 0) {
        throw new Error(`Found ${missingFallbacks.length} rows with omitted-rule fallback text.`);
    }

    if (expectEscalationTriggered) {
        const escalationRule = rulesAnalysis.find((row) => String(row.ruleName || '').toLowerCase().includes('sensitive data escalation'));
        if (!escalationRule) {
            throw new Error('Sensitive Data Escalation rule result was not found.');
        }
        if (escalationRule.status !== 'Triggered') {
            throw new Error(`Expected escalation rule status Triggered, got ${escalationRule.status}`);
        }
        if (Number(project.tier) !== 3) {
            throw new Error(`Expected tier 3 due escalation SET_TIER effect, got tier ${project.tier}`);
        }
        if (Number(project.score) !== 100) {
            throw new Error(`Expected score 100 with pass-equivalent statuses, got ${project.score}`);
        }
    }

    if (expectCapTriggered) {
        const capRule = rulesAnalysis.find((row) => String(row.ruleName || '').toLowerCase().includes('cap trigger smoke rule'));
        if (!capRule) {
            throw new Error('Cap Trigger Smoke Rule result was not found.');
        }
        if (capRule.status !== 'Triggered') {
            throw new Error(`Expected CAP rule status Triggered, got ${capRule.status}`);
        }
        if (project.approvalStatus === 'AI Rejected') {
            throw new Error('Mandatory CAP trigger incorrectly caused AI rejection.');
        }
    }

    return project;
}

async function cleanup(ids) {
    const { orgId, deptId } = ids;

    await Promise.all([
        Project.deleteMany({ organization: orgId }),
        Audit.deleteMany({ organization: orgId }),
        Rule.deleteMany({ organization: orgId }),
        Department.deleteMany({ organization: orgId }),
        Role.deleteMany({ organization: orgId }),
        WorkflowPolicy.deleteMany({ organization: orgId }),
        UserOrganization.deleteMany({ organization: orgId }),
        Organization.deleteMany({ _id: orgId }),
        Department.deleteMany({ _id: deptId })
    ]);
}

async function main() {
    if (!allowDbMutation) {
        console.log(JSON.stringify({
            mode: 'dry-run',
            message: 'Agentic smoke test mutates the configured database. Re-run with --apply or SMOKE_ALLOW_DB_MUTATION=true to create and clean up sandbox records.'
        }, null, 2));
        process.exit(0);
        return;
    }

    const stamp = Date.now();
    const tempOrgName = `Agentic Smoke Org ${stamp}`;
    let tempOrg = null;
    let tempDept = null;
    let restoreOpenAIStubs = null;

    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to MongoDB');
        restoreOpenAIStubs = installDeterministicOpenAIStubs();
        console.log('Installed deterministic OpenAI stubs for smoke test');

        const user = await ensureTestUser();
        console.log(`Using user: ${user.username} (${user._id})`);

        tempOrg = await Organization.create({
            name: tempOrgName,
            description: 'Temporary org for smoke test',
            createdBy: user._id
        });

        tempDept = await Department.create({
            name: `Smoke Dept ${stamp}`,
            description: 'Temporary department for smoke test',
            organization: tempOrg._id
        });

        const rules = await Rule.insertMany([
            {
                name: 'HEART Classification Required',
                criteria: 'Pass only if the initiative has a HEART classification and it indicates direct or indirect HEART impact.',
                weight: 5,
                isMandatory: true,
                organization: tempOrg._id,
                department: null,
                isActive: true,
                isSystem: false,
                category: 'GATE',
                effects: []
            },
            {
                name: 'Budget Required',
                criteria: 'Pass only if budget is marked available and an amount is provided.',
                weight: 5,
                isMandatory: true,
                organization: tempOrg._id,
                department: null,
                isActive: true,
                isSystem: false,
                category: 'GATE',
                effects: []
            },
            {
                name: 'Sensitive Data Escalation',
                criteria: 'Fail this rule (trigger escalation) if the initiative involves personal data.',
                weight: 4,
                isMandatory: false,
                organization: tempOrg._id,
                department: null,
                isActive: true,
                isSystem: false,
                category: 'ESCALATION',
                effects: [{ type: 'SET_TIER', params: { tier: 3 } }]
            },
            {
                name: 'Cap Trigger Smoke Rule',
                criteria: 'If initiative has executive sponsorship, cap priority score at 3.0.',
                weight: 7,
                isMandatory: true,
                organization: tempOrg._id,
                department: null,
                isActive: true,
                isSystem: false,
                category: 'CAP',
                effects: []
            }
        ]);

        const expectedRules = rules.length;
        console.log(`Created temp org with ${expectedRules} active rules.`);

        console.log('Running sync pipeline smoke test...');
        const syncResult = await runSyncAnalysis({
            organizationId: String(tempOrg._id),
            departmentId: String(tempDept._id),
            userId: String(user._id)
        });

        if (syncResult.statusCode !== 200 || !syncResult.payload?._id) {
            throw new Error(`Sync analysis failed: status=${syncResult.statusCode}, body=${JSON.stringify(syncResult.payload)}`);
        }

        const syncProject = await validateProject({
            projectId: syncResult.payload._id,
            expectedRules,
            expectEscalationTriggered: true,
            expectCapTriggered: true
        });
        console.log(`Sync pipeline passed. Project=${syncProject._id}, Score=${syncProject.score}, Tier=${syncProject.tier}`);

        console.log('Running admin override smoke test...');
        await runAdminOverride({
            organizationId: String(tempOrg._id),
            projectId: String(syncProject._id),
            userId: String(user._id),
            newStatus: 'Rejected'
        });
        console.log('Admin override smoke test passed.');

        console.log('Running async pipeline smoke test...');
        const asyncJob = await runAsyncAnalysis({
            organizationId: String(tempOrg._id),
            departmentId: String(tempDept._id),
            userId: String(user._id)
        });

        if (!asyncJob.projectId) {
            throw new Error(`Async job completed without projectId: ${JSON.stringify(asyncJob)}`);
        }

        const asyncProject = await validateProject({
            projectId: asyncJob.projectId,
            expectedRules,
            expectEscalationTriggered: true,
            expectCapTriggered: true
        });
        console.log(`Async pipeline passed. Project=${asyncProject._id}, Score=${asyncProject.score}, Tier=${asyncProject.tier}`);

        console.log('\nAgentic pipeline smoke test: PASSED');
        await cleanup({ orgId: tempOrg._id, deptId: tempDept._id });
        await mongoose.connection.close();
        process.exit(0);
    } catch (error) {
        console.error('\nAgentic pipeline smoke test: FAILED');
        console.error(error);

        try {
            if (tempOrg?._id || tempDept?._id) {
                await cleanup({ orgId: tempOrg?._id, deptId: tempDept?._id });
            }
        } catch (cleanupError) {
            console.error('Cleanup failed:', cleanupError.message);
        }

        try {
            await mongoose.connection.close();
        } catch (_) {
            // ignore
        }
        process.exit(1);
    } finally {
        if (typeof restoreOpenAIStubs === 'function') {
            restoreOpenAIStubs();
        }
    }
}

main();
