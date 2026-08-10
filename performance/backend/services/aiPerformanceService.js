const azureOpenAIService = require('./azureOpenAIService');
const { isPerformanceAIRuntimeError } = require('./aiGatewayService');
const { AI_ACTIVITIES } = require('../config/aiActivityCatalog');

class AIPerformanceService {
  constructor() {
    // Service is stateless, but we can initialize any specific configurations here if needed
  }

  // --- OKR Generation ---
  static async generateOKRs(userRole, teamGoals, companyGoals) {
    // Do not cache model responses process-wide. Inputs contain organization
    // goals and the effective model is user-specific; a shared cache could
    // leak one tenant's generated OKRs into another tenant's response.
    try {
      const prompt = `
Generate 3-5 SMART OKRs for a ${userRole} role.
Context:
- Team Goals: ${teamGoals}
- Company Goals: ${companyGoals}

Requirements:
- Structure the output as a JSON object with a key "okrs" containing an array of objects.
- Each object should have: "objective" (string), "keyResults" (array of strings), "priority" (High/Medium/Low).
- Ensure objectives are Actionable and Inspirational.
- Ensure Key Results are Measurable (contain numbers/%).
`;

      const response = await azureOpenAIService.getChatCompletions([
        { role: 'system', content: 'You are an expert HR performance consultant. You output strictly valid JSON.' },
        { role: 'user', content: prompt }
      ], { activity: AI_ACTIVITIES.OKR_GENERATE, temperature: 0.7 });

      const content = response.choices[0].message.content;
      return this.parseAIResponse(content);
    } catch (error) {
      console.error('Error generating OKRs:', error);
      if (isPerformanceAIRuntimeError(error)) throw error;
      return { success: false, error: error.message };
    }
  }

  // --- Review Analysis ---
  static async analyzePerformanceReview(selfEval, managerEval, peerReviews) {
     // No caching for specific user reviews usually, as they are unique per request instance usually.
     // However, if re-analysis is requested frequently, a cache key on review ID would be better.
     // For now, let's assume real-time analysis is preferred or cheap enough, or handled by frontend state.
    try {
      const prompt = `
Analyze the following performance review data:
Self-Eval: ${selfEval}
Manager-Eval: ${managerEval}
Peer-Reviews: ${peerReviews}

Provide a comprehensive analysis in JSON format with the following keys:
- "strengths": [array of strings]
- "improvements": [array of strings]
- "biasDetection": { "detected": boolean, "details": string }
- "sentiment": { "self": string, "manager": string, "peer": string } (positive/neutral/negative)
- "summary": string (2-3 sentences)

Focus on constructive feedback and identifying any discrepancies between self and manager evaluations.
`;

      const response = await azureOpenAIService.getChatCompletions([
        { role: "system", content: "You are an expert performance analyst. You output strictly valid JSON." },
        { role: "user", content: prompt }
      ], { activity: AI_ACTIVITIES.MANAGER_REVIEW_ASSIST, temperature: 0.5 }); // Lower temperature for analysis

      const content = response.choices[0].message.content;
      return this.parseAIResponse(content);

    } catch (error) {
      console.error('Error analyzing performance review:', error);
      if (isPerformanceAIRuntimeError(error)) throw error;
      return { success: false, error: error.message };
    }
  }

  // --- Feedback Analysis ---
  static async analyzeFeedback(feedbackText) {
      // Potentially cacheable if the same feedback text is analyzed multiple times (unlikely but possible)
    try {
      const prompt = `
Analyze this professional feedback text: "${feedbackText}"

Output a JSON object with:
- "sentimentScore": number (-1 to 1)
- "category": string (e.g., "Communication", "Technical", "Leadership", "Teamwork")
- "actionable": boolean
- "flags": [array of strings] (e.g., "Non-constructive", "Aggressive") if applicable.
`;

      const response = await azureOpenAIService.getChatCompletions([
        { role: "system", content: "You are an expert in workplace communication. You output strictly valid JSON." },
        { role: "user", content: prompt }
      ], { activity: AI_ACTIVITIES.FEEDBACK_ANALYZE, temperature: 0.3 });

      const content = response.choices[0].message.content;
      return this.parseAIResponse(content);
    } catch (error) {
      console.error('Error analyzing feedback:', error);
      if (isPerformanceAIRuntimeError(error)) throw error;
      return { success: false, error: error.message };
    }
  }

  // --- Bias Detection ---
  static async detectBias(reviewText) {
    try {
        const prompt = `
Analyze the following text for unconscious bias (gender, racial, recency, attribution bias, etc.):
"${reviewText}"

Output JSON:
- "hasBias": boolean
- "biasType": string (or null)
- "explanation": string
- "suggestion": string (rewrite suggestion or advice)
`;
        const response = await azureOpenAIService.getChatCompletions([
            { role: "system", content: "You are a D&I expert tool for flagging bias in performance reviews. Output strictly valid JSON." },
            { role: "user", content: prompt }
        ], { activity: AI_ACTIVITIES.REVIEW_BIAS, temperature: 0.2 });

        const content = response.choices[0].message.content;
        return this.parseAIResponse(content);

    } catch (error) {
        console.error('Error detecting bias:', error);
        if (isPerformanceAIRuntimeError(error)) throw error;
        return { success: false, error: error.message };
    }
  }

  // --- Team Insights ---
  static async generateTeamInsights(teamData, performanceMetrics) {
    try {
      const response = await azureOpenAIService.getChatCompletions([
        {
          role: 'system',
          content: 'You are an HR analytics partner. Identify evidence-backed team patterns without exposing private individual commentary. Output strictly valid JSON.'
        },
        {
          role: 'user',
          content: `Analyze this team performance context.\nTeam: ${JSON.stringify(teamData)}\nMetrics: ${JSON.stringify(performanceMetrics)}\n\nReturn JSON with strengths, risks, coachingPriorities, and recommendedActions.`
        }
      ], { activity: AI_ACTIVITIES.TEAM_INSIGHTS, temperature: 0.3 });
      return this.parseAIResponse(response.choices[0].message.content);
    } catch (error) {
      console.error('Error generating team insights:', error);
      if (isPerformanceAIRuntimeError(error)) throw error;
      return { success: false, error: error.message };
    }
  }

  // --- Review Writing Assistant ---
  static async generateReviewWritingAssistant(reviewContext, targetType) {
    try {
      const response = await azureOpenAIService.getChatCompletions([
        {
          role: 'system',
          content: 'You are a performance coach. Draft fair, specific, evidence-based review language and avoid invented examples. Output strictly valid JSON.'
        },
        {
          role: 'user',
          content: `Help write the ${targetType || 'performance review'} section from this context:\n${JSON.stringify(reviewContext)}\n\nReturn JSON with draft, evidenceToAdd, questionsToClarify, and toneChecks.`
        }
      ], { activity: AI_ACTIVITIES.MANAGER_REVIEW_ASSIST, temperature: 0.4 });
      return this.parseAIResponse(response.choices[0].message.content);
    } catch (error) {
      console.error('Error generating review writing assistance:', error);
      if (isPerformanceAIRuntimeError(error)) throw error;
      return { success: false, error: error.message };
    }
  }

  // --- Helper: Parse Response ---
  static parseAIResponse(aiResponse) {
    try {
        // Find JSON object in the string (in case of extra text)
        const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            return {
                success: true,
                data: JSON.parse(jsonMatch[0])
            };
        }
        throw new Error("No JSON found in response");
    } catch (error) {
        console.warn("Failed to parse AI response as JSON:", aiResponse);
        return {
            success: false,
            data: aiResponse, // Return raw text if parsing fails
            error: "Parsing failed"
        };
    }
  }

  // --- Health Check ---
  static async healthCheck() {
      try {
          const response = await azureOpenAIService.getChatCompletions([
              { role: "user", content: "ping" }
          ], { activity: AI_ACTIVITIES.GENERAL, maxTokens: 5 });
          return { healthy: true, response: response.choices[0].message.content };
      } catch (error) {
          return { healthy: false, error: error.message };
      }
  }
}

module.exports = AIPerformanceService;
