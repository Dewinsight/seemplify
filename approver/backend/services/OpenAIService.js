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
            { key: 'strategic_alignment', name: 'Strategic Alignment', field: 'strategicAlignment' },
            { key: 'regulatory_risk', name: 'Regulatory Risk', field: 'regulatoryRisk' },
            { key: 'business_impact', name: 'Business Impact', field: 'businessImpact' },
            { key: 'implementation_complexity', name: 'Implementation Complexity', field: 'implementationComplexity' },
            { key: 'time_to_value', name: 'Time-to-Value', field: 'timeToValue' },
            { key: 'resource_requirements', name: 'Resource Requirements', field: 'resourceRequirements' }
        ];
        paramOrder.forEach(({ key, name }) => {
            const r = rubrics[key];
            const w = (weights[key] || 0) * 100;
            if (r?.top_level_rubric?.scale) {
                const defs = r.top_level_rubric.scale.map(s => `Score ${s.score}: ${s.label} — ${s.definition}`).join('\n               ');
                lines.push(`${name} (${w}% weight)\n               ${defs}`);
            } else if (r?.scale && Array.isArray(r.scale)) {
                const defs = r.scale.map(s => `Score ${s.score}: ${s.definition || s.profile || s.label || ''}`).filter(Boolean).join('\n               ');
                if (defs) lines.push(`${name} (${w}% weight)\n               ${defs}`);
                else if (r.description) lines.push(`${name} (${w}% weight): ${r.description}`);
            } else if (r?.description) {
                lines.push(`${name} (${w}% weight): ${r.description}`);
            }
        });
        const formula = model.formula?.expression || '(Strategic×0.25)+(Regulatory×0.25)+(Business×0.20)+(Complexity×0.15)+(TimeToValue×0.10)+(Resources×0.05)';
        const tiers = model.tier_classification?.tiers?.map(t => `- ${t.tier}: ${t.score_range?.min}–${t.score_range?.max}`).join('\n            ') || '';
        return { lines: lines.join('\n\n            '), formula, tiers };
    } catch (e) {
        console.warn('Could not load scoring rubric from rules JSON:', e.message);
        return null;
    }
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
            const rulePrompts = rules.map(r => `- ${r.name}: ${r.criteria || r.description}`).join('\n');
            const rubric = loadScoringRubric();
            const scoringSection = rubric ? `
            === TASK 2: PRIORITY SCORE CALCULATION (use rubric from rules) ===
            Score each parameter 1-5 (higher = more favorable). Use these definitions:
            
            ${rubric.lines}
            
            Formula: Priority Score = ${rubric.formula}
            
            Tier classification:
            ${rubric.tiers}
            ` : `
            === TASK 2: PRIORITY SCORE CALCULATION ===
            Score each parameter 1-5: Strategic Alignment (25%), Regulatory Risk (25%), Business Impact (20%), Implementation Complexity (15%), Time-to-Value (10%), Resource Requirements (5%).
            Formula: (Strategic×0.25)+(Regulatory×0.25)+(Business×0.20)+(Complexity×0.15)+(TimeToValue×0.10)+(Resources×0.05)
            Tiers: 1.0–2.5 = Tier 1, 2.6–3.5 = Tier 2, 3.6–5.0 = Tier 3
            `;

            const prompt = `
            You are a strict AI Initiative Approver for Sterling Financial Holdings Group. 
            Analyze the following AI initiative based on these approval rules AND calculate priority scoring.
            
            === APPROVAL RULES ===
            ${rulePrompts}
            
            === INITIATIVE DESCRIPTION ===
            ${projectDescription}
            
            === TASK 1: RULE ANALYSIS ===
            For each rule listed above, determine if the initiative PASSES or FAILS. Provide a brief reason.
            IMPORTANT: In "ruleName", use the EXACT rule name as listed above (before the colon). Do not rename or rephrase rules.
            ${scoringSection}
            
            Return the response in JSON format:
            {
                "overallStatus": "Approved" | "Rejected",
                "rulesAnalysis": [
                    { "ruleName": "Name", "status": "Pass" | "Fail", "reason": "Reasoning" }
                ],
                "scoringBreakdown": {
                    "strategicAlignment": { "score": 1-5, "reason": "Brief justification" },
                    "regulatoryRisk": { "score": 1-5, "reason": "Brief justification" },
                    "businessImpact": { "score": 1-5, "reason": "Brief justification" },
                    "implementationComplexity": { "score": 1-5, "reason": "Brief justification" },
                    "timeToValue": { "score": 1-5, "reason": "Brief justification" },
                    "resourceRequirements": { "score": 1-5, "reason": "Brief justification" }
                },
                "priorityScore": <calculated 1.0-5.0>,
                "calculatedTier": 1 | 2 | 3,
                "summary": "Overall summary of the analysis including scoring rationale"
            }
            `;

            const completion = await this.client.chat.completions.create({
                messages: [
                    { role: "system", content: "You are a helpful assistant that analyzes AI initiatives for a financial institution. Always respond with valid JSON." },
                    { role: "user", content: prompt }
                ],
                model: process.env.AZURE_OPENAI_DEPLOYMENT_NAME,
            });

            const content = completion.choices[0].message.content;
            // Basic cleanup to ensure JSON parsing if markdown code blocks are returned
            const jsonString = content.replace(/```json/g, '').replace(/```/g, '').trim();
            return JSON.parse(jsonString);

        } catch (error) {
            console.error("OpenAI Analysis Error:", error);
            throw new Error("Failed to analyze project");
        }
    }
}

module.exports = new OpenAIService();
