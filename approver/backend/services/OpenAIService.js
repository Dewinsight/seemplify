const OpenAI = require('openai');
const path = require('path');
const fs = require('fs');

const RULES_JSON_PATH = path.join(__dirname, '..', '..', 'mosaic_approver_rules_v2.json');

function loadScoringRubric() {
    try {
        if (!fs.existsSync(RULES_JSON_PATH)) return null;

        const data = JSON.parse(fs.readFileSync(RULES_JSON_PATH, 'utf8'));
        const model = data.priority_score_model;
        const rubrics = data.parameter_rubrics;
        if (!model || !rubrics) return null;

        const weights = model.formula?.weights || {};
        const lines = [];

        const paramOrder = [
            { key: 'strategic_alignment', name: 'Strategic Alignment' },
            { key: 'regulatory_risk', name: 'Regulatory Risk' },
            { key: 'business_impact', name: 'Business Impact' },
            { key: 'implementation_complexity', name: 'Implementation Complexity' },
            { key: 'time_to_value', name: 'Time-to-Value' },
            { key: 'resource_requirements', name: 'Resource Requirements' }
        ];

        paramOrder.forEach(({ key, name }) => {
            const rubric = rubrics[key];
            const weightPct = (weights[key] || 0) * 100;

            if (rubric?.top_level_rubric?.scale) {
                const defs = rubric.top_level_rubric.scale
                    .map(s => `Score ${s.score}: ${s.label} - ${s.definition}`)
                    .join('\n               ');
                lines.push(`${name} (${weightPct}% weight)\n               ${defs}`);
            } else if (rubric?.scale && Array.isArray(rubric.scale)) {
                const defs = rubric.scale
                    .map(s => `Score ${s.score}: ${s.definition || s.profile || s.label || ''}`)
                    .filter(Boolean)
                    .join('\n               ');
                if (defs) lines.push(`${name} (${weightPct}% weight)\n               ${defs}`);
                else if (rubric.description) lines.push(`${name} (${weightPct}% weight): ${rubric.description}`);
            } else if (rubric?.description) {
                lines.push(`${name} (${weightPct}% weight): ${rubric.description}`);
            }
        });

        const formula = model.formula?.expression || '(Strategic*0.25)+(Regulatory*0.25)+(Business*0.20)+(Complexity*0.15)+(TimeToValue*0.10)+(Resources*0.05)';
        const tiers = model.tier_classification?.tiers
            ?.map(t => `- ${t.tier}: ${t.score_range?.min}-${t.score_range?.max}`)
            .join('\n            ') || '';

        return { lines: lines.join('\n\n            '), formula, tiers };
    } catch (error) {
        console.warn('Could not load scoring rubric from rules JSON:', error.message);
        return null;
    }
}

function inferCategory(rule) {
    const explicit = String(rule.category || '').trim().toUpperCase();
    if (explicit) return explicit;
    const hint = `${rule.name || ''} ${rule.description || ''} ${rule.criteria || ''}`;
    return /(escalat|tier\s*3|trigger)/i.test(hint) ? 'ESCALATION' : 'GENERAL';
}

function stripCodeBlocks(value) {
    return String(value || '')
        .replace(/```json/gi, '')
        .replace(/```/g, '')
        .trim();
}

function parseJsonPayload(value) {
    const cleaned = stripCodeBlocks(value);

    try {
        return JSON.parse(cleaned);
    } catch (_) {
        const firstBrace = cleaned.indexOf('{');
        const lastBrace = cleaned.lastIndexOf('}');
        if (firstBrace >= 0 && lastBrace > firstBrace) {
            const slice = cleaned.slice(firstBrace, lastBrace + 1);
            return JSON.parse(slice);
        }
        throw new Error('Model response is not valid JSON.');
    }
}

function buildRulePrompts(rules) {
    return rules.map(rule => {
        const mandatoryTag = rule.isMandatory ? '[MANDATORY]' : '[OPTIONAL]';
        const category = inferCategory(rule);
        const ruleId = (rule._id || '').toString();
        const criteria = rule.criteria || rule.description || '';
        const effects = Array.isArray(rule.effects) ? rule.effects : [];
        const effectText = effects.length > 0
            ? ` | Effects: ${effects.map(effect => {
                const type = String(effect?.type || '').toUpperCase();
                const params = effect?.params || {};
                if (type === 'SET_TIER') return `SET_TIER(${params.tier || '?'})`;
                if (type === 'SET_FLAG') return `SET_FLAG(${params.key || '?'})`;
                return type || 'UNKNOWN_EFFECT';
            }).join(', ')}`
            : '';
        return `- Rule ID: ${ruleId} | Category: ${category} | ${mandatoryTag}${effectText} | ${rule.name}: ${criteria}`;
    }).join('\n');
}

class OpenAIService {
    constructor() {
        this.client = new OpenAI({
            apiKey: process.env.AZURE_OPENAI_API_KEY,
            baseURL: `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments/${process.env.AZURE_OPENAI_DEPLOYMENT_NAME}`,
            defaultQuery: { 'api-version': process.env.AZURE_OPENAI_API_VERSION },
            defaultHeaders: { 'api-key': process.env.AZURE_OPENAI_API_KEY }
        });
    }

    async createCompletion(messages, options = {}) {
        const {
            temperature = 0,
            parseJson = true
        } = options;

        const completion = await this.client.chat.completions.create({
            messages,
            model: process.env.AZURE_OPENAI_DEPLOYMENT_NAME,
            temperature
        });

        const content = completion?.choices?.[0]?.message?.content || '';
        return parseJson ? parseJsonPayload(content) : content;
    }

    async analyzeProject(projectContext, rules) {
        try {
            const rulePrompts = buildRulePrompts(rules);

            const rubric = loadScoringRubric();
            const scoringSection = rubric ? `
            === TASK 2: PRIORITY SCORING DIMENSIONS (use rubric definitions) ===
            Score each parameter 1-5 (higher = more favorable). Use these definitions.
            IMPORTANT: Backend applies organization-specific weights after this step.

            ${rubric.lines}
            ` : `
            === TASK 2: PRIORITY SCORING DIMENSIONS ===
            Score each parameter 1-5:
            Strategic Alignment (25%), Regulatory Risk (25%), Business Impact (20%),
            Implementation Complexity (15%), Time-to-Value (10%), Resource Requirements (5%).
            Backend applies dynamic organization weights and tier ranges.
            `;

            const prompt = `
            You are a strict AI Initiative Approver for Sterling Financial Holdings Group.
            Analyze the initiative against all rules and calculate priority scoring.

            === APPROVAL RULES ===
            ${rulePrompts}

            === INITIATIVE CONTEXT ===
            ${projectContext}

            === TASK 1: RULE ANALYSIS ===
            Evaluate EVERY listed rule exactly once.
            Return one rulesAnalysis entry for each Rule ID.
            You must not skip any rule.
            If evidence is weak or uncertain, still return Pass or Fail with a short reason.

            Rule status meaning:
            - For GATE and GENERAL rules: Pass means requirement satisfied. Fail means not satisfied.
            - For ESCALATION rules: Pass means trigger condition is NOT present.
              Fail means trigger condition IS present (this indicates escalation trigger).

            Rules marked [MANDATORY] are critical.
            ${scoringSection}

            Return strict JSON only:
            {
                "overallStatus": "Approved" | "Rejected",
                "rulesAnalysis": [
                    {
                        "ruleId": "exact Rule ID from input",
                        "ruleName": "Rule name",
                        "status": "Pass" | "Fail",
                        "reason": "Brief reason",
                        "mandatory": true | false
                    }
                ],
                "mandatoryFailed": true | false,
                "failedMandatoryRules": ["name of any mandatory rule that failed"],
                "scoringBreakdown": {
                    "strategicAlignment": { "score": 1-5, "reason": "Brief justification" },
                    "regulatoryRisk": { "score": 1-5, "reason": "Brief justification" },
                    "businessImpact": { "score": 1-5, "reason": "Brief justification" },
                    "implementationComplexity": { "score": 1-5, "reason": "Brief justification" },
                    "timeToValue": { "score": 1-5, "reason": "Brief justification" },
                    "resourceRequirements": { "score": 1-5, "reason": "Brief justification" }
                },
                "priorityScore": 1.0,
                "calculatedTier": 1,
                "summary": "Overall summary of the analysis including scoring rationale"
            }
            `;

            return await this.createCompletion([
                {
                    role: 'system',
                    content: 'You analyze AI initiatives for a financial institution. Always respond with valid JSON only.'
                },
                { role: 'user', content: prompt }
            ]);
        } catch (error) {
            console.error('OpenAI Analysis Error:', error);
            throw new Error('Failed to analyze project');
        }
    }

    async analyzePriorityOnly(projectContext) {
        try {
            const rubric = loadScoringRubric();
            const scoringSection = rubric ? `
            Use these rubric definitions to score each dimension from 1-5:

            ${rubric.lines}
            ` : `
            Score each dimension 1-5:
            Strategic Alignment, Regulatory Risk, Business Impact,
            Implementation Complexity, Time-to-Value, Resource Requirements.
            `;

            const prompt = `
            You are a strict AI Initiative Approver for Sterling Financial Holdings Group.
            Evaluate the initiative context and produce only the scoring breakdown.

            === INITIATIVE CONTEXT ===
            ${projectContext}

            === TASK ===
            ${scoringSection}

            Return strict JSON only:
            {
                "scoringBreakdown": {
                    "strategicAlignment": { "score": 1-5, "reason": "Brief justification" },
                    "regulatoryRisk": { "score": 1-5, "reason": "Brief justification" },
                    "businessImpact": { "score": 1-5, "reason": "Brief justification" },
                    "implementationComplexity": { "score": 1-5, "reason": "Brief justification" },
                    "timeToValue": { "score": 1-5, "reason": "Brief justification" },
                    "resourceRequirements": { "score": 1-5, "reason": "Brief justification" }
                },
                "summary": "Short summary of scoring rationale"
            }
            `;

            return await this.createCompletion([
                {
                    role: 'system',
                    content: 'You evaluate initiative scoring dimensions. Return valid JSON only.'
                },
                { role: 'user', content: prompt }
            ]);
        } catch (error) {
            console.error('OpenAI Priority-Only Analysis Error:', error);
            throw new Error('Failed to analyze priority scoring');
        }
    }

    async evaluateSingleRule(projectContext, rule) {
        try {
            const category = inferCategory(rule);
            const ruleId = (rule._id || '').toString();
            const criteria = rule.criteria || rule.description || '';
            const mandatoryTag = rule.isMandatory ? '[MANDATORY]' : '[OPTIONAL]';

            const prompt = `
            You are a strict AI Initiative Approver for Sterling Financial Holdings Group.
            Evaluate one rule against the initiative context.

            === RULE ===
            Rule ID: ${ruleId}
            Rule Name: ${rule.name}
            Category: ${category}
            Mandatory: ${mandatoryTag}
            Criteria: ${criteria}

            === INITIATIVE CONTEXT ===
            ${projectContext}

            === DECISION INSTRUCTIONS ===
            - Return exactly one decision for this rule.
            - For GATE and GENERAL rules: Pass means requirement satisfied, Fail means not satisfied.
            - For ESCALATION rules: Pass means trigger condition NOT present, Fail means trigger present.
            - If uncertain, still return a best-judgment Pass or Fail with concise reason.

            Return strict JSON only:
            {
                "ruleId": "${ruleId}",
                "ruleName": "${rule.name}",
                "status": "Pass" | "Fail",
                "reason": "Brief reason",
                "mandatory": ${rule.isMandatory === true ? 'true' : 'false'}
            }
            `;

            return await this.createCompletion([
                {
                    role: 'system',
                    content: 'You evaluate one policy rule at a time. Return valid JSON only.'
                },
                { role: 'user', content: prompt }
            ]);
        } catch (error) {
            console.error('OpenAI Single-Rule Evaluation Error:', error);
            throw new Error('Failed to evaluate rule');
        }
    }

    async summarizeFinalDecision(projectContext, payload) {
        try {
            const prompt = `
            You are a strict AI Initiative Approver for Sterling Financial Holdings Group.
            Write a concise executive summary using the structured analysis payload.

            === INITIATIVE CONTEXT ===
            ${projectContext}

            === ANALYSIS PAYLOAD ===
            ${JSON.stringify(payload, null, 2)}

            Output requirements:
            - 1 short paragraph.
            - Mention strongest positives and key concerns.
            - Mention score and tier in plain language.
            - Do not invent facts.
            `;

            const content = await this.createCompletion([
                {
                    role: 'system',
                    content: 'You summarize initiative analysis clearly and concisely.'
                },
                { role: 'user', content: prompt }
            ], { parseJson: false, temperature: 0 });

            return stripCodeBlocks(content);
        } catch (error) {
            console.error('OpenAI Final Summary Error:', error);
            return '';
        }
    }

    async analyzeRulesOnly(projectContext, rules) {
        try {
            const rulePrompts = buildRulePrompts(rules);

            const prompt = `
            You are a strict AI Initiative Approver for Sterling Financial Holdings Group.
            Evaluate the initiative against all listed rules.

            === APPROVAL RULES ===
            ${rulePrompts}

            === INITIATIVE CONTEXT ===
            ${projectContext}

            Return one rulesAnalysis entry for every rule listed above.
            You must not skip any rule.
            If uncertain, still return Pass or Fail with a short reason.

            Return strict JSON only:
            {
                "rulesAnalysis": [
                    {
                        "ruleId": "exact Rule ID from input",
                        "ruleName": "Rule name",
                        "status": "Pass" | "Fail",
                        "reason": "Brief reason",
                        "mandatory": true | false
                    }
                ]
            }
            `;

            return await this.createCompletion([
                {
                    role: 'system',
                    content: 'You analyze AI initiatives for a financial institution. Always respond with valid JSON only.'
                },
                { role: 'user', content: prompt }
            ]);
        } catch (error) {
            console.error('OpenAI Rules-Only Analysis Error:', error);
            throw new Error('Failed to analyze rules');
        }
    }
}

module.exports = new OpenAIService();
