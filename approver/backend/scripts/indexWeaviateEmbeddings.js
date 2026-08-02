/**
 * Backfill / refresh Weaviate embeddings for existing rules and initiatives.
 *
 * Usage:
 *   node scripts/indexWeaviateEmbeddings.js
 *   node scripts/indexWeaviateEmbeddings.js --organization=<orgId>
 *   node scripts/indexWeaviateEmbeddings.js --limit-projects=120
 */

const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const Organization = require('../models/Organization');
const Rule = require('../models/Rule');
const Project = require('../models/Project');
const weaviateVectorService = require('../services/WeaviateVectorService');

const argValue = (name) => {
    const raw = process.argv.find((entry) => entry.startsWith(`${name}=`));
    return raw ? raw.split('=').slice(1).join('=').trim() : '';
};

const parsePositiveInt = (value, fallback) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.floor(parsed);
};

const buildInitiativeContext = (project) => {
    const sections = [
        `Initiative Name: ${project?.name || ''}`,
        project?.description ? `Narrative Description:\n${project.description}` : '',
        `Form Data:\n${JSON.stringify(project?.formData || {}, null, 2)}`,
        `Analysis Summary:\n${project?.analysisResult?.summary || ''}`
    ].filter(Boolean);

    return sections.join('\n\n');
};

async function main() {
    if (!weaviateVectorService.isEnabled()) {
        throw new Error('Weaviate is disabled. Set USE_WEAVIATE=true first.');
    }

    await weaviateVectorService.ensureSchema();
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    const targetOrgId = argValue('--organization');
    const limitProjects = parsePositiveInt(argValue('--limit-projects'), 80);

    const orgQuery = targetOrgId ? { _id: targetOrgId } : {};
    const organizations = await Organization.find(orgQuery).select('_id name').lean();
    if (organizations.length === 0) {
        throw new Error('No organizations found for embedding backfill.');
    }

    let totalRuleEmbeddings = 0;
    let totalInitiativeEmbeddings = 0;

    for (const org of organizations) {
        console.log(`\n[Org] ${org.name} (${org._id})`);

        const rules = await Rule.find({ organization: org._id, isActive: true }).lean();
        const ruleResult = await weaviateVectorService.indexRules({
            organizationId: org._id,
            rules
        });

        if (rules.length > 0) {
            const now = new Date();
            await Rule.updateMany(
                { _id: { $in: rules.map((rule) => rule._id) } },
                {
                    $set: {
                        embeddingStatus: {
                            state: 'indexed',
                            indexedAt: now,
                            lastAttemptAt: now,
                            source: ruleResult?.embeddingSource || '',
                            error: ''
                        }
                    }
                }
            );
        }

        totalRuleEmbeddings += Number(ruleResult?.indexedRules || 0);
        console.log(`- Rules indexed: ${ruleResult?.indexedRules || 0} (embedding=${ruleResult?.embeddingSource || 'n/a'})`);

        const projects = await Project.find({ organization: org._id })
            .sort({ createdAt: -1 })
            .limit(limitProjects)
            .lean();

        let orgInitiativeCount = 0;
        for (const project of projects) {
            const initiativeContext = buildInitiativeContext(project);
            const memoryResult = await weaviateVectorService.upsertInitiativeMemory({
                organizationId: org._id,
                projectId: project._id,
                name: project.name,
                initiativeContext,
                summary: project?.analysisResult?.summary || '',
                approvalStatus: project?.approvalStatus || '',
                workflowStage: project?.workflowStage || '',
                tier: project?.tier || 0,
                priorityScore: project?.priorityScore || 0
            });

            if (memoryResult?.indexed) {
                orgInitiativeCount += 1;
                totalInitiativeEmbeddings += 1;
            }
        }

        console.log(`- Initiative memories indexed: ${orgInitiativeCount}/${projects.length}`);
    }

    console.log('\nEmbedding backfill complete.');
    console.log(`- Total rules indexed: ${totalRuleEmbeddings}`);
    console.log(`- Total initiatives indexed: ${totalInitiativeEmbeddings}`);
}

main()
    .then(async () => {
        await mongoose.disconnect();
        process.exit(0);
    })
    .catch(async (error) => {
        console.error('Embedding backfill failed:', error.message || error);
        try {
            await mongoose.disconnect();
        } catch (_) {
            // ignore disconnect errors
        }
        process.exit(1);
    });
