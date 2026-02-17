/**
 * Smoke test for agentic analysis pipeline.
 *
 * What it validates:
 * 1) Sync pipeline (`analyzeProject`) creates a project with rule analyses.
 * 2) Async pipeline (`analyzeProjectAsync`) returns a job and progresses to completion.
 * 3) Every configured rule receives an evaluation result (no omitted-rule fallback text).
 *
 * Usage:
 *   node scripts/smokeTestAgenticAnalysis.js
 */

const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const mainController = require('../controllers/mainController');
const Organization = require('../models/Organization');
const Department = require('../models/Department');
const Rule = require('../models/Rule');
const Project = require('../models/Project');
const User = require('../models/User');
const Role = require('../models/Role');
const WorkflowPolicy = require('../models/WorkflowPolicy');
const UserOrganization = require('../models/UserOrganization');

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

async function validateProject({ projectId, expectedRules }) {
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

    return project;
}

async function cleanup(ids) {
    const { orgId, deptId } = ids;

    await Promise.all([
        Project.deleteMany({ organization: orgId }),
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
    const stamp = Date.now();
    const tempOrgName = `Agentic Smoke Org ${stamp}`;
    let tempOrg = null;
    let tempDept = null;

    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to MongoDB');

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
            expectedRules
        });
        console.log(`Sync pipeline passed. Project=${syncProject._id}, Score=${syncProject.score}, Tier=${syncProject.tier}`);

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
            expectedRules
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
    }
}

main();
