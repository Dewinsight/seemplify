const { AzureOpenAI } = require('@azure/openai');

/**
 * Appraisal AI Service
 * Provides AI-powered analysis for performance appraisals
 * Uses Azure OpenAI for intelligent insights
 */
class AppraisalAIService {
  constructor() {
    this.client = null;
    this.deploymentName = process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4';
    this.initialized = false;
  }

  /**
   * Initialize the Azure OpenAI client
   */
  async initialize() {
    if (this.initialized) return;

    const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
    const apiKey = process.env.AZURE_OPENAI_API_KEY;

    if (!endpoint || !apiKey) {
      console.warn('Azure OpenAI credentials not configured. AI features will be limited.');
      return;
    }

    try {
      this.client = new AzureOpenAI({
        endpoint,
        apiKey,
        apiVersion: process.env.AZURE_OPENAI_API_VERSION || '2024-02-15-preview'
      });
      this.initialized = true;
      console.log('Appraisal AI Service initialized');
    } catch (error) {
      console.error('Failed to initialize Appraisal AI Service:', error);
    }
  }

  /**
   * Analyze document content for appraisal relevance
   */
  async analyzeDocument(documentText, context = {}) {
    await this.initialize();

    if (!this.client) {
      return this.getFallbackDocumentAnalysis(documentText);
    }

    const prompt = `Analyze the following document in the context of a performance appraisal.

Document Content:
${documentText.substring(0, 8000)}

${context.employeeName ? `Employee: ${context.employeeName}` : ''}
${context.department ? `Department: ${context.department}` : ''}
${context.period ? `Review Period: ${context.period}` : ''}

Please provide:
1. A brief summary (2-3 sentences)
2. Key achievements or accomplishments mentioned
3. Skills and competencies demonstrated
4. Metrics or quantifiable results found
5. Areas of strength
6. Potential areas for development
7. Overall relevance score (0-100) for performance appraisal
8. Sentiment analysis (positive, neutral, negative, mixed)

Respond in JSON format:
{
  "summary": "...",
  "keyPoints": ["..."],
  "extractedAchievements": [{"description": "...", "category": "...", "impact": "...", "confidence": 0.9}],
  "identifiedSkills": [{"skill": "...", "context": "...", "proficiencyLevel": "..."}],
  "extractedMetrics": [{"metricName": "...", "value": "...", "context": "..."}],
  "strengths": ["..."],
  "developmentAreas": ["..."],
  "relevanceScore": 85,
  "relevanceExplanation": "...",
  "sentiment": {"overall": "positive", "score": 0.8},
  "suggestions": ["..."]
}`;

    try {
      const response = await this.client.chat.completions.create({
        model: this.deploymentName,
        messages: [
          { role: 'system', content: 'You are an expert HR analyst specializing in performance management and talent development. Analyze documents objectively and provide actionable insights.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.3,
        max_tokens: 2000,
        response_format: { type: 'json_object' }
      });

      const content = response.choices[0]?.message?.content;
      return JSON.parse(content);
    } catch (error) {
      console.error('Document analysis error:', error);
      return this.getFallbackDocumentAnalysis(documentText);
    }
  }

  /**
   * Generate AI insights for self-assessment
   */
  async analyzeSelfAssessment(selfAssessment, okrData = [], competencies = []) {
    await this.initialize();

    if (!this.client) {
      return this.getFallbackSelfAssessmentAnalysis();
    }

    const prompt = `Analyze this employee's self-assessment for a performance review:

Self-Assessment Summary:
- Achievements: ${selfAssessment.overallSummary?.achievements || 'Not provided'}
- Challenges: ${selfAssessment.overallSummary?.challenges || 'Not provided'}
- Learnings: ${selfAssessment.overallSummary?.learnings || 'Not provided'}
- Areas for Improvement: ${selfAssessment.overallSummary?.improvements || 'Not provided'}

OKR Performance:
${okrData.map(o => `- ${o.okrTitle}: ${o.completionPercentage}% complete`).join('\n') || 'No OKR data'}

Competency Self-Ratings:
${selfAssessment.competencyRatings?.map(c => `- ${c.competencyName}: ${c.selfRating}/5`).join('\n') || 'No ratings'}

Provide analysis:
1. Identified strengths based on self-assessment
2. Areas that need development
3. Consistency between OKR results and self-rating
4. Suggestions for the manager to discuss
5. Potential coaching opportunities
6. Overall sentiment of the self-assessment

Respond in JSON format:
{
  "strengths": ["..."],
  "developmentAreas": ["..."],
  "suggestions": ["..."],
  "coachingOpportunities": ["..."],
  "sentiment": "positive|neutral|negative|mixed",
  "consistencyCheck": {"isConsistent": true, "notes": "..."},
  "discussionPoints": ["..."]
}`;

    try {
      const response = await this.client.chat.completions.create({
        model: this.deploymentName,
        messages: [
          { role: 'system', content: 'You are an HR coach helping managers prepare for performance discussions. Be constructive, specific, and development-focused.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.4,
        max_tokens: 1500,
        response_format: { type: 'json_object' }
      });

      const content = response.choices[0]?.message?.content;
      return JSON.parse(content);
    } catch (error) {
      console.error('Self-assessment analysis error:', error);
      return this.getFallbackSelfAssessmentAnalysis();
    }
  }

  /**
   * Assist manager with review writing
   */
  async assistManagerReview(selfAssessment, managerNotes, okrData = [], context = {}) {
    await this.initialize();

    if (!this.client) {
      return { suggestions: ['AI assistance not available. Please complete the review manually.'] };
    }

    const prompt = `Help a manager write a constructive performance review.

Employee Self-Assessment:
${JSON.stringify(selfAssessment?.overallSummary || {}, null, 2)}

Manager's Notes:
${managerNotes || 'No notes provided'}

OKR Performance:
${okrData.map(o => `- ${o.okrTitle}: ${o.completionPercentage}% (Target: ${o.targetValue}, Achieved: ${o.achievedValue})`).join('\n') || 'No OKR data'}

${context.promotionConsideration ? 'The employee is being considered for promotion.' : ''}

Provide:
1. Suggested overall rating (1-5) with justification
2. Key strengths to highlight
3. Constructive feedback on improvement areas
4. Specific examples to include (based on OKRs)
5. Development recommendations
6. Draft text for overall summary

Respond in JSON format:
{
  "suggestedRating": 4,
  "ratingJustification": "...",
  "strengthsToHighlight": ["..."],
  "constructiveFeedback": ["..."],
  "specificExamples": ["..."],
  "developmentRecommendations": ["..."],
  "draftSummary": "...",
  "discussionTips": ["..."]
}`;

    try {
      const response = await this.client.chat.completions.create({
        model: this.deploymentName,
        messages: [
          { role: 'system', content: 'You are an experienced HR leader helping managers write fair, constructive, and development-focused performance reviews. Avoid generic statements and provide specific, actionable feedback.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.5,
        max_tokens: 2000,
        response_format: { type: 'json_object' }
      });

      const content = response.choices[0]?.message?.content;
      return JSON.parse(content);
    } catch (error) {
      console.error('Manager review assist error:', error);
      return { suggestions: ['AI assistance temporarily unavailable.'] };
    }
  }

  /**
   * Check for potential bias in manager's review
   */
  async checkForBias(managerReview, selfAssessment, context = {}) {
    await this.initialize();

    if (!this.client) {
      return { hasPotentialBias: false, message: 'Bias check not available' };
    }

    const prompt = `Analyze this performance review for potential biases.

Manager's Review:
- Overall Rating: ${managerReview.overallManagerRating}/5
- Summary: ${managerReview.overallSummary?.achievements || ''}
- Areas for Improvement: ${managerReview.overallSummary?.improvements || ''}

Employee's Self-Rating: ${selfAssessment?.overallSelfRating}/5

Competency Rating Gaps:
${managerReview.competencyRatings?.map(c => {
  const selfRating = selfAssessment?.competencyRatings?.find(s => s.competencyId === c.competencyId);
  return `- ${c.competencyName}: Manager ${c.managerRating}/5, Self ${selfRating?.selfRating || 'N/A'}/5`;
}).join('\n') || 'No data'}

${context.tenure ? `Employee Tenure: ${context.tenure}` : ''}
${context.previousRating ? `Previous Rating: ${context.previousRating}` : ''}

Check for:
1. Recency bias (focusing too much on recent events)
2. Halo/Horn effect (one trait affecting all ratings)
3. Central tendency (avoiding extreme ratings)
4. Leniency/Strictness bias
5. Similar-to-me bias
6. Significant gaps between self and manager ratings

Respond in JSON format:
{
  "hasPotentialBias": true/false,
  "biasTypes": [{"type": "...", "severity": "low|medium|high", "evidence": "...", "suggestion": "..."}],
  "overallRisk": "low|medium|high",
  "recommendations": ["..."],
  "calibrationNeeded": true/false
}`;

    try {
      const response = await this.client.chat.completions.create({
        model: this.deploymentName,
        messages: [
          { role: 'system', content: 'You are an HR expert specializing in fair performance evaluation. Identify potential biases objectively and provide constructive suggestions.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.2,
        max_tokens: 1000,
        response_format: { type: 'json_object' }
      });

      const content = response.choices[0]?.message?.content;
      return JSON.parse(content);
    } catch (error) {
      console.error('Bias check error:', error);
      return { hasPotentialBias: false, error: 'Bias check failed' };
    }
  }

  /**
   * Generate development plan suggestions
   */
  async suggestDevelopmentPlan(appraisal, okrData = [], context = {}) {
    await this.initialize();

    if (!this.client) {
      return { suggestions: [] };
    }

    const prompt = `Create a personalized development plan based on this performance appraisal.

Employee: ${context.employeeName || 'Employee'}
Role: ${context.jobTitle || 'Not specified'}
Career Aspiration: ${appraisal.discussion?.notes?.careerAspirations || 'Not specified'}

Identified Strengths:
${appraisal.managerReview?.overallSummary?.strengths || appraisal.selfAssessment?.aiInsights?.strengths?.join(', ') || 'Not specified'}

Areas for Improvement:
${appraisal.managerReview?.overallSummary?.improvements || 'Not specified'}

OKR Performance Gaps:
${okrData.filter(o => o.completionPercentage < 80).map(o => `- ${o.okrTitle}: ${o.completionPercentage}%`).join('\n') || 'None identified'}

Competency Gaps:
${appraisal.managerReview?.competencyRatings?.filter(c => c.managerRating < 3).map(c => `- ${c.competencyName}: ${c.managerRating}/5`).join('\n') || 'None identified'}

Create a 6-12 month development plan with:
1. Priority development areas (max 3)
2. Specific, measurable goals for each area
3. Recommended learning resources/training
4. On-the-job development opportunities
5. Mentoring/coaching suggestions
6. Progress milestones

Respond in JSON format:
{
  "developmentAreas": [
    {
      "area": "...",
      "priority": "high|medium|low",
      "currentLevel": "...",
      "targetLevel": "...",
      "goals": ["..."],
      "actions": ["..."],
      "resources": ["..."],
      "timeline": "...",
      "milestones": [{"milestone": "...", "targetDate": "..."}]
    }
  ],
  "mentoringRecommendations": ["..."],
  "trainingPrograms": ["..."],
  "stretchAssignments": ["..."],
  "reviewCadence": "monthly|quarterly"
}`;

    try {
      const response = await this.client.chat.completions.create({
        model: this.deploymentName,
        messages: [
          { role: 'system', content: 'You are a career development coach creating personalized, actionable development plans. Focus on practical, achievable goals with clear milestones.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.6,
        max_tokens: 2000,
        response_format: { type: 'json_object' }
      });

      const content = response.choices[0]?.message?.content;
      return JSON.parse(content);
    } catch (error) {
      console.error('Development plan suggestion error:', error);
      return { suggestions: [] };
    }
  }

  /**
   * Generate chat response for appraisal discussion
   */
  async generateChatResponse(chatHistory, currentMessage, appraisalContext, senderRole) {
    await this.initialize();

    if (!this.client) {
      return { response: "I'm currently unavailable. Please continue your discussion directly.", isAI: true };
    }

    const systemPrompt = senderRole === 'employee'
      ? 'You are an AI assistant helping an employee prepare for their performance discussion with their manager. Be supportive, help them articulate their achievements, and suggest how to discuss areas for growth constructively.'
      : 'You are an AI assistant helping a manager conduct a constructive performance discussion. Help them give balanced feedback, ask powerful questions, and create a development-focused dialogue.';

    const recentHistory = chatHistory.slice(-10).map(m => ({
      role: m.sender.role === 'ai' ? 'assistant' : 'user',
      content: `[${m.sender.name} - ${m.sender.role}]: ${m.message}`
    }));

    const prompt = `Appraisal Context:
- Employee: ${appraisalContext.employeeName}
- Current Rating: ${appraisalContext.currentRating || 'Not yet rated'}
- Key Topics: ${appraisalContext.keyTopics?.join(', ') || 'General discussion'}

Current message from ${senderRole}:
${currentMessage}

Provide a helpful, concise response that:
1. Addresses the specific question or concern
2. Offers constructive guidance
3. Keeps the conversation productive
4. If appropriate, suggests questions to explore further`;

    try {
      const response = await this.client.chat.completions.create({
        model: this.deploymentName,
        messages: [
          { role: 'system', content: systemPrompt },
          ...recentHistory,
          { role: 'user', content: prompt }
        ],
        temperature: 0.7,
        max_tokens: 500
      });

      return {
        response: response.choices[0]?.message?.content,
        isAI: true,
        modelUsed: this.deploymentName
      };
    } catch (error) {
      console.error('Chat response error:', error);
      return { response: "I couldn't process that request. Please try again.", isAI: true, error: true };
    }
  }

  /**
   * Fallback analysis when AI is not available
   */
  getFallbackDocumentAnalysis(text) {
    const wordCount = text.split(/\s+/).length;
    return {
      summary: 'Document analysis requires AI service configuration.',
      keyPoints: [],
      extractedAchievements: [],
      identifiedSkills: [],
      extractedMetrics: [],
      relevanceScore: 50,
      relevanceExplanation: 'Unable to analyze - AI service not configured',
      sentiment: { overall: 'neutral', score: 0.5 },
      suggestions: ['Configure Azure OpenAI to enable document analysis'],
      wordCount,
      fallback: true
    };
  }

  getFallbackSelfAssessmentAnalysis() {
    return {
      strengths: [],
      developmentAreas: [],
      suggestions: ['AI analysis not available'],
      sentiment: 'neutral',
      consistencyCheck: { isConsistent: true, notes: 'Manual review recommended' },
      discussionPoints: [],
      fallback: true
    };
  }

  /**
   * Generate self-assessment writing suggestions
   */
  async generateSelfAssessmentSuggestion(field, context, existingContent, options = {}) {
    await this.initialize();

    if (!this.client) {
      return this.getFallbackSuggestion(field);
    }

    const fieldPrompts = {
      achievements: `Help me write about my key achievements and accomplishments for my performance review.
Context: ${context}
${existingContent ? `I've already written: "${existingContent}"` : ''}

Provide 2-3 specific, impactful achievement statements that:
- Use action verbs and quantify results where possible
- Highlight the impact on the team/company
- Show initiative and ownership`,

      challenges: `Help me describe the challenges I faced professionally during this period.
Context: ${context}
${existingContent ? `I've already written: "${existingContent}"` : ''}

Provide suggestions that:
- Frame challenges as learning opportunities
- Show problem-solving and resilience
- Demonstrate professional growth`,

      learnings: `Help me articulate what I learned professionally during this period.
Context: ${context}
${existingContent ? `I've already written: "${existingContent}"` : ''}

Suggest descriptions of:
- New skills acquired
- Knowledge areas developed
- Professional insights gained`,

      improvements: `Help me identify areas where I can improve.
Context: ${context}
${existingContent ? `I've already written: "${existingContent}"` : ''}

Suggest honest but constructive descriptions of:
- Skills to develop
- Behaviors to enhance
- Knowledge gaps to fill
Note: Be specific but not overly self-critical.`,

      goals: `Help me set professional goals for the next period.
Context: ${context}
${existingContent ? `I've already written: "${existingContent}"` : ''}

Suggest SMART goals that are:
- Specific and measurable
- Aligned with career aspirations
- Challenging but achievable`
    };

    const prompt = fieldPrompts[field] || `Help me write about ${field} for my performance review. Context: ${context}`;

    try {
      const response = await this.client.chat.completions.create({
        model: this.deploymentName,
        messages: [
          {
            role: 'system',
            content: `You are a helpful career coach assisting ${options.employeeName || 'an employee'} in writing their performance self-assessment. Provide specific, professional, and concise suggestions. Focus on helping them articulate their value and growth.`
          },
          { role: 'user', content: prompt }
        ],
        temperature: 0.7,
        max_tokens: 500
      });

      return response.choices[0]?.message?.content || this.getFallbackSuggestion(field);
    } catch (error) {
      console.error('Self-assessment suggestion error:', error);
      return this.getFallbackSuggestion(field);
    }
  }

  getFallbackSuggestion(field) {
    const suggestions = {
      achievements: 'Consider listing your top 3 accomplishments with specific metrics and outcomes.',
      challenges: 'Describe a significant challenge you overcame and what you learned from it.',
      learnings: 'Reflect on new skills you developed or knowledge you gained this period.',
      improvements: 'Identify 1-2 areas where focused effort could enhance your performance.',
      goals: 'Set 2-3 goals that align with your career aspirations and team objectives.'
    };
    return suggestions[field] || 'AI suggestions are currently unavailable. Please write your own response.';
  }
}

module.exports = new AppraisalAIService();
