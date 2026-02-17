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

class OpenAIService {
    constructor() {
        this.client = new OpenAI({
            apiKey: process.env.AZURE_OPENAI_API_KEY,
            baseURL: `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments/${process.env.AZURE_OPENAI_DEPLOYMENT_NAME}`,
            defaultQuery: { 'api-version': process.env.AZURE_OPENAI_API_VERSION },
            defaultHeaders: { 'api-key': process.env.AZURE_OPENAI_API_KEY }
        });
    }

    async analyzeProject(projectDescription, rules) {
        try {
            const rulePrompts = rules.map(rule => {
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
                        if (type === 'ROUTE_TO_STAGE') return `ROUTE_TO_STAGE(${params.stageKey || '?'})`;
                        if (type === 'SET_FLAG') return `SET_FLAG(${params.key || '?'})`;
                        return type || 'UNKNOWN_EFFECT';
                    }).join(', ')}`
                    : '';
                return `- Rule ID: ${ruleId} | Category: ${category} | ${mandatoryTag}${effectText} | ${rule.name}: ${criteria}`;
            }).join('\n');

            const rubric = loadScoringRubric();
            const scoringSection = rubric ? `
            === TASK 2: PRIORITY SCORE CALCULATION (use rubric definitions) ===
            Score each parameter 1-5 (higher = more favorable). Use these definitions:

            ${rubric.lines}

            Formula: Priority Score = ${rubric.formula}

            Tier classification:
            ${rubric.tiers}
            ` : `
            === TASK 2: PRIORITY SCORE CALCULATION ===
            Score each parameter 1-5:
            Strategic Alignment (25%), Regulatory Risk (25%), Business Impact (20%),
            Implementation Complexity (15%), Time-to-Value (10%), Resource Requirements (5%).
            Formula: (Strategic*0.25)+(Regulatory*0.25)+(Business*0.20)+(Complexity*0.15)+(TimeToValue*0.10)+(Resources*0.05)
            Tiers: 1.0-2.5 = Tier 1, 2.6-3.5 = Tier 2, 3.6-5.0 = Tier 3
            `;

            const prompt = `
            You are a strict AI Initiative Approver for Sterling Financial Holdings Group.
            Analyze the initiative against all rules and calculate priority scoring.

            === APPROVAL RULES ===
            ${rulePrompts}

            === INITIATIVE DESCRIPTION ===
            ${projectDescription}

            === TASK 1: RULE ANALYSIS ===
            Evaluate EVERY listed rule exactly once.
            Return one rulesAnalysis entry for each Rule ID.

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

            const completion = await this.client.chat.completions.create({
                messages: [
                    {
                        role: 'system',
                        content: 'You analyze AI initiatives for a financial institution. Always respond with valid JSON only.'
                    },
                    { role: 'user', content: prompt }
                ],
                model: process.env.AZURE_OPENAI_DEPLOYMENT_NAME,
            });

            const content = completion.choices[0].message.content || '';
            const jsonString = content.replace(/```json/gi, '').replace(/```/g, '').trim();
            return JSON.parse(jsonString);
        } catch (error) {
            console.error('OpenAI Analysis Error:', error);
            throw new Error('Failed to analyze project');
        }
    }
}

module.exports = new OpenAIService();
