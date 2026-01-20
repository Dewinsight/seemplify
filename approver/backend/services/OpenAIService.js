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
            You are a strict Project Approver. Analyze the following project based on these rules:
            
            ${rulePrompts}
            
            Project Description:
            ${projectDescription}
            
            For each rule, determine if the project PASSES or FAILS. Provide a brief reason.
            Finally, give an overall "Approved" or "Rejected" status.
            
            Return the response in JSON format:
            {
                "overallStatus": "Approved" | "Rejected",
                "rulesAnalysis": [
                    { "ruleName": "Name", "status": "Pass" | "Fail", "reason": "Reasoning" }
                ],
                "summary": "Overall summary of the analysis"
            }
            `;

            const completion = await this.client.chat.completions.create({
                messages: [{ role: "system", content: "You are a helpful assistant." }, { role: "user", content: prompt }],
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
