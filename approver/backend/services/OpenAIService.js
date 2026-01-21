const OpenAI = require('openai');

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
            const rulePrompts = rules.map(r => `- ${r.name}: ${r.criteria}`).join('\n');
            const prompt = `
            You are a strict AI Initiative Approver for Sterling Financial Holdings Group. 
            Analyze the following AI initiative based on these approval rules AND calculate priority scoring.
            
            === APPROVAL RULES ===
            ${rulePrompts}
            
            === INITIATIVE DESCRIPTION ===
            ${projectDescription}
            
            === TASK 1: RULE ANALYSIS ===
            For each rule, determine if the initiative PASSES or FAILS. Provide a brief reason.
            
            === TASK 2: PRIORITY SCORE CALCULATION ===
            Score the initiative on each parameter from 1-5 (higher = more favorable):
            
            1. Strategic Alignment (25% weight)
               - Score 1: Tangential to strategy, no clear business need
               - Score 5: Transformational/competitive differentiator
               
            2. Regulatory Risk (25% weight)
               - Score 1: Low-risk compliance gap, minimal urgency
               - Score 5: Critical regulatory mandate, high urgency
               
            3. Business Impact (20% weight)
               - Score 1: <₦50M annual value, limited scope
               - Score 5: >₦500M or transformational impact
               
            4. Implementation Complexity (15% weight)
               - Score 1: >12 months timeline, major barriers
               - Score 5: <3 months, straightforward implementation
               
            5. Time-to-Value (10% weight)
               - Score 1: >18 months to realize value
               - Score 5: <3 months to value realization
               
            6. Resource Requirements (5% weight)
               - Score 1: Extensive (large team, major infrastructure)
               - Score 5: Minimal (existing capacity)
            
            Calculate Priority Score using:
            Priority Score = (Strategic × 0.25) + (Regulatory × 0.25) + (Business × 0.20) + (Complexity × 0.15) + (TimeToValue × 0.10) + (Resources × 0.05)
            
            Determine Tier based on Priority Score:
            - Tier 1 (Low Risk): 1.0 – 2.5
            - Tier 2 (Moderate): 2.6 – 3.5
            - Tier 3 (High Risk): 3.6 – 5.0
            
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
