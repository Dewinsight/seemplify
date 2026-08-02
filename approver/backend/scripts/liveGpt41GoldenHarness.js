/**
 * Optional live GPT-4.1 drift harness.
 *
 * This makes live Azure OpenAI calls and never gates CI by default.
 *
 * Usage:
 *   node scripts/liveGpt41GoldenHarness.js --run-live
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const shouldRun =
    process.argv.includes('--run-live') ||
    process.env.LIVE_GPT41_HARNESS === 'true';

if (!shouldRun) {
    console.log(JSON.stringify({
        mode: 'skipped',
        message: 'Live GPT-4.1 golden harness skipped. Re-run with --run-live or LIVE_GPT41_HARNESS=true.'
    }, null, 2));
    process.exit(0);
}

const openAIService = require('../services/OpenAIService');
const {
    calculateWeightedPriorityScore,
    determineTierFromScore
} = require('../services/approvalEngine');
const {
    DEFAULT_WORKFLOW_POLICY,
    DEFAULT_SCORING_WEIGHTS
} = require('../services/governanceConfigService');

const GOLDENS = [
    {
        name: 'well-formed-customer-service-assistant',
        expectedTierRange: [2, 3],
        context: `
Initiative Name: Customer Service Virtual Assistant
Structured Form Fields:
- Group Head Name: Operations Director
- Confirm Group Head Approval: Yes
- HEART Classification: Direct HEART Impact
- Problem Description: Customer service teams spend 1,200 hours monthly on routine account status and FAQ questions.
- AI Direction: Customer Experience
- AI Idea: Deploy a virtual assistant grounded in approved FAQs and customer service workflows.
- Data Needed: Approved FAQs, customer service ticket metadata, anonymized historical inquiries.
- Involves Personal Info: Yes
- Regulations: CBN and internal data privacy controls apply.
- Urgency: Important within 6 months
- Budget Available: Yes
- Budget Amount: 75000000
- Team Time Commitment: Yes
`
    },
    {
        name: 'vague-no-budget-idea',
        expectedTierRange: [1, 1],
        context: `
Initiative Name: Fun AI Ideas Portal
Structured Form Fields:
- Group Head Name: Not provided
- Confirm Group Head Approval: No
- HEART Classification: Non-HEART
- Problem Description: We want to try something with AI, but the business problem is not clear.
- AI Direction: Not sure
- Data Needed: Not sure
- Involves Personal Info: Not sure
- Urgency: Nice to have
- Budget Available: No
- Team Time Commitment: Limited
`
    }
];

async function run() {
    const results = [];
    for (const golden of GOLDENS) {
        try {
            const response = await openAIService.analyzePriorityOnly(golden.context);
            const priorityScore = calculateWeightedPriorityScore(response.scoringBreakdown, DEFAULT_SCORING_WEIGHTS);
            const tier = determineTierFromScore(priorityScore, DEFAULT_WORKFLOW_POLICY);
            const [minTier, maxTier] = golden.expectedTierRange;
            results.push({
                name: golden.name,
                priorityScore,
                tier,
                expectedTierRange: golden.expectedTierRange,
                drift: tier < minTier || tier > maxTier,
                summary: response.summary || ''
            });
        } catch (error) {
            results.push({
                name: golden.name,
                error: error.message,
                drift: true
            });
        }
    }

    console.log(JSON.stringify({
        provider: openAIService.config?.provider || 'unknown',
        generatedAt: new Date().toISOString(),
        results
    }, null, 2));
}

run().catch((error) => {
    console.error(JSON.stringify({ error: error.message }, null, 2));
    process.exit(0);
});
