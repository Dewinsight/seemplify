const aiGatewayService = require('./aiGatewayService');
const { PerformanceAIRuntimeError } = require('./aiGatewayService');
const { AI_ACTIVITIES } = require('../config/aiActivityCatalog');
const {
  getConversationQuestionQueue,
  getCycleQuestionEvidence
} = require('./appraisalCustomResponseService');

// Conversation phases in order
const CONVERSATION_PHASES = [
  'initialized',
  'okr_reflection',
  'cycle_questions',
  'achievements',
  'challenges',
  'learnings',
  'future_goals',
  'competencies',
  'report_generation',
  'review',
  'completed'
];

/**
 * Appraisal AI Service
 * Provides AI-powered analysis for performance appraisals
 * Uses Azure OpenAI for intelligent insights
 */
class AppraisalAIService {
  constructor() {
    this.client = null;
    this.deploymentName = process.env.AZURE_OPENAI_DEPLOYMENT_NAME
      || process.env.AZURE_OPENAI_DEPLOYMENT
      || process.env.OPENAI_MODEL
      || 'gpt-4.1-mini';
    this.provider = null;
    this.initialized = false;
  }

  /**
   * Initialize the Azure OpenAI client
   */
  async initialize() {
    if (this.initialized) return;

    try {
      this.client = aiGatewayService.openAICompatibleClient(AI_ACTIVITIES.GENERAL);
      this.provider = 'seemplify-ai-gateway';
      this.initialized = true;
      console.log(`Appraisal AI Service initialized (${this.provider})`);
    } catch (error) {
      console.error('Failed to initialize Appraisal AI Service:', error);
    }
  }

  /**
   * Analyze document content for appraisal relevance
   */
  async analyzeDocument(documentText, context = {}, options = {}) {
    await this.initialize();
    const requireChatGpt = options.requireChatGpt === true;

    if (!this.client) {
      if (requireChatGpt) {
        throw new PerformanceAIRuntimeError(
          'ChatGPT is required to analyze conversation evidence.',
          'CHATGPT_UNAVAILABLE'
        );
      }
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
        activity: AI_ACTIVITIES.DOCUMENT_ANALYSIS,
        model: this.deploymentName,
        messages: [
          { role: 'system', content: 'You are an expert HR analyst specializing in performance management and talent development. Analyze documents objectively and provide actionable insights.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.3,
        max_tokens: 2000,
        response_format: { type: 'json_object' },
        ...(requireChatGpt ? { runtimePreference: 'chatgpt' } : {})
      });

      const content = response.choices[0]?.message?.content;
      return this.parseJsonResponse(content);
    } catch (error) {
      console.error('Document analysis error:', error);
      this.rethrowAccountPolicyError(error);
      if (requireChatGpt) throw error;
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
        activity: AI_ACTIVITIES.SELF_ASSESSMENT_REPORT,
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
      return this.parseJsonResponse(content);
    } catch (error) {
      console.error('Self-assessment analysis error:', error);
      this.rethrowAccountPolicyError(error);
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
        activity: AI_ACTIVITIES.MANAGER_REVIEW_ASSIST,
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
      const result = this.parseJsonResponse(content);
      this.requireAIResponse(
        Number.isFinite(Number(result.suggestedRating))
          && Number(result.suggestedRating) >= 1
          && Number(result.suggestedRating) <= 5
          && this.normalizeText(result.ratingJustification)
          && this.normalizeText(result.draftSummary),
        'Manager-review assistance was incomplete.'
      );
      return { ...result, overallSuggestion: result.draftSummary, success: true };
    } catch (error) {
      console.error('Manager review assist error:', error);
      this.rethrowAccountPolicyError(error);
      throw this.asInvalidAIResponse(error, 'Manager-review assistance was invalid.');
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
        activity: AI_ACTIVITIES.REVIEW_BIAS,
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
      const result = this.parseJsonResponse(content);
      this.requireAIResponse(
        typeof result.hasPotentialBias === 'boolean'
          && ['low', 'medium', 'high'].includes(result.overallRisk),
        'Bias-review output was incomplete.'
      );
      return result;
    } catch (error) {
      console.error('Bias check error:', error);
      this.rethrowAccountPolicyError(error);
      throw this.asInvalidAIResponse(error, 'Bias-review output was invalid.');
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
        activity: AI_ACTIVITIES.DEVELOPMENT_PLAN_SUGGEST,
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
      return this.parseJsonResponse(content);
    } catch (error) {
      console.error('Development plan suggestion error:', error);
      this.rethrowAccountPolicyError(error);
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
        activity: AI_ACTIVITIES.APPRAISAL_CHAT,
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
      this.rethrowAccountPolicyError(error);
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
        activity: AI_ACTIVITIES.SELF_ASSESSMENT_COACH,
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
      this.rethrowAccountPolicyError(error);
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

  // =========================================
  // CONVERSATIONAL SELF-ASSESSMENT METHODS
  // =========================================

  /**
   * Start a conversational self-assessment session
   * @param {Object} appraisal - The appraisal document
   * @param {Array} okrs - Employee's OKRs for the period
   * @param {Object} employee - Employee info
   * @returns {Object} Initial greeting and conversation state
   */
  async startSelfAssessmentConversation(appraisal, okrs, employee, options = {}) {
    await this.initialize();
    const requireChatGpt = options.requireChatGpt === true;
    const configuredQuestions = getConversationQuestionQueue(appraisal, 'employee');

    const okrSummary = okrs.map(okr => {
      const avgProgress = okr.objectives?.reduce((sum, obj) => {
        const krProgress = obj.keyResults?.reduce((krSum, kr) => {
          const progress = kr.targetValue > 0
            ? Math.min(100, (kr.currentValue / kr.targetValue) * 100)
            : 0;
          return krSum + progress;
        }, 0) / (obj.keyResults?.length || 1);
        return sum + krProgress;
      }, 0) / (okr.objectives?.length || 1);

      return {
        id: okr._id,
        title: okr.title || okr.objectives?.[0]?.title || 'Untitled OKR',
        progress: Math.round(avgProgress || okr.progress || 0),
        objectives: okr.objectives?.map(obj => ({
          title: obj.title,
          keyResults: obj.keyResults?.map(kr => ({
            title: kr.title,
            target: kr.targetValue,
            current: kr.currentValue,
            progress: kr.targetValue > 0 ? Math.round((kr.currentValue / kr.targetValue) * 100) : 0
          }))
        }))
      };
    });

    if (!this.client) {
      if (requireChatGpt) {
        throw new PerformanceAIRuntimeError(
          'ChatGPT is required to start this self-assessment conversation.',
          'CHATGPT_UNAVAILABLE'
        );
      }
      return this.getFallbackConversationStart(employee, okrSummary, configuredQuestions.length);
    }

    const prompt = `You are starting a conversational self-assessment session with an employee.

Employee: ${employee.name}
Role: ${employee.jobTitle || 'Not specified'}
Department: ${employee.department || 'Not specified'}
Review Period: ${appraisal.cycleId?.name || 'Current Period'}

Their OKRs for this period:
${okrSummary.map((okr, i) => `
${i + 1}. ${okr.title} - ${okr.progress}% complete
${okr.objectives?.map(obj => `   - ${obj.title}
${obj.keyResults?.map(kr => `     • ${kr.title}: ${kr.current}/${kr.target} (${kr.progress}%)`).join('\n') || ''}`).join('\n') || '   No objectives defined'}`).join('\n') || 'No OKRs found for this period.'}

Generate a warm, professional greeting that:
1. Addresses them by name
2. Explains this will be a conversational self-assessment
3. Briefly summarizes their OKRs and overall progress
4. Asks them which OKR they'd like to start with (they can reply with the OKR number or title). If they have no OKRs and configured review questions are available, only explain that you will begin the configured questions next; do not invent or paraphrase a question. If neither exists, ask them to list their top 2-3 priorities for the period.

Configured employee review questions available: ${configuredQuestions.length}

Keep the tone friendly but professional. Be encouraging about their progress.
Format your response as natural conversation text (not JSON).`;

    try {
      const response = await this.client.chat.completions.create({
        activity: AI_ACTIVITIES.SELF_ASSESSMENT_CHAT,
        model: this.deploymentName,
        messages: [
          {
            role: 'system',
            content: 'You are a supportive HR assistant guiding an employee through their performance self-assessment. Be warm, professional, and encouraging. Help them articulate their achievements effectively.'
          },
          { role: 'user', content: prompt }
        ],
        temperature: 0.7,
        max_tokens: 600,
        ...(requireChatGpt ? { runtimePreference: 'chatgpt' } : {})
      });

      const greeting = response.choices[0]?.message?.content;
      this.requireAIResponse(this.normalizeText(greeting), 'The self-assessment greeting was empty.');
      const tokensUsed = response.usage?.total_tokens || 0;

      return {
        greeting,
        okrSummary,
        phase: okrSummary.length > 0 ? 'okr_reflection' : (configuredQuestions.length > 0 ? 'cycle_questions' : 'okr_reflection'),
        currentOkrIndex: 0,
        tokensUsed,
        success: true
      };
    } catch (error) {
      console.error('Conversation start error:', error);
      this.rethrowAccountPolicyError(error);
      throw this.asInvalidAIResponse(error, 'The self-assessment greeting was invalid.');
    }
  }

  /**
   * Continue the conversation based on user input
   * @param {Object} appraisal - The appraisal document with conversation state
   * @param {string} userMessage - The user's message
   * @param {Array} okrs - Employee's OKRs
   * @param {Object} documentContext - Optional context from uploaded documents
   * @returns {Object} AI response and updated state
   */
  async continueConversation(appraisal, userMessage, okrs, documentContext = null, options = {}) {
    await this.initialize();
    const requireChatGpt = options.requireChatGpt === true;

    const convState = appraisal.conversationAssessment || {};
    const currentPhase = convState.currentPhase || 'okr_reflection';
    let currentOkrIndex = convState.currentOkrIndex || 0;
    const extractedData = convState.extractedData || {};
    const configuredQuestions = getConversationQuestionQueue(appraisal, 'employee');

    // If the employee replies with a bare OKR number ("2"), treat it as selecting that OKR.
    if (currentPhase === 'okr_reflection' && okrs?.length) {
      const trimmed = (userMessage || '').trim();
      const okrNumMatch = trimmed.match(/^#?(\\d+)$/);
      if (okrNumMatch) {
        const selectedNum = parseInt(okrNumMatch[1], 10);
        if (!Number.isNaN(selectedNum) && selectedNum >= 1 && selectedNum <= okrs.length) {
          currentOkrIndex = selectedNum - 1;
        }
      }
    }

    // Build conversation history (last 10 messages for context)
    const recentMessages = (appraisal.chatThread || [])
      .slice(-10)
      .map(m => ({
        role: m.sender?.role === 'ai' ? 'assistant' : 'user',
        content: m.message
      }));

    // Build context about current state
    const currentOkr = okrs[currentOkrIndex];
    const phaseContext = this.buildPhaseContext(currentPhase, currentOkr, extractedData);

    if (!this.client) {
      if (requireChatGpt) {
        throw new PerformanceAIRuntimeError(
          'ChatGPT is required to continue this self-assessment conversation.',
          'CHATGPT_UNAVAILABLE'
        );
      }
      return this.getFallbackConversationResponse(currentPhase, userMessage, {
        currentOkrIndex,
        okrCount: okrs?.length || 0
      });
    }

    const okrListForPrompt = (okrs || []).map((okr, idx) => {
      const title = okr.title || okr.objectives?.[0]?.title || 'Untitled OKR';
      return `${idx + 1}. ${title} (${okr.progress || 0}% complete)`;
    }).join('\n');

    const configuredProgression = configuredQuestions.length > 0
      ? '- okr_reflection: focus on ONE OKR at a time. After the last OKR, move to "cycle_questions". The server will ask the exact frozen questions; never invent or paraphrase them.\n- cycle_questions: controlled by the server. Do not select or rewrite a configured question.\n- after configured questions, move to "report_generation".'
      : '- okr_reflection: focus on ONE OKR at a time. If they choose a different OKR, set "selectedOkrIndex". When done with this OKR, set "shouldAdvanceOkr": true. After the last OKR, move to "achievements".\n- achievements: collect 2-5 key achievements (not necessarily tied to OKRs). Then move to "challenges".\n- challenges: collect 1-3 challenges and how they addressed them. Then move to "learnings".\n- learnings: collect 1-3 learnings/skills gained. Then move to "future_goals".\n- future_goals: collect 2-3 goals for next period. Then move to "report_generation".';

    const systemPrompt = `You are guiding ${appraisal.employee?.name || 'the employee'} through their performance self-assessment.

Current Phase: ${currentPhase}
${phaseContext}

OKRs (${okrs.length}):
${okrListForPrompt || 'No OKRs found for this period.'}
Current OKR Index: ${currentOkrIndex} (1-based: ${currentOkrIndex + 1})

${documentContext ? `\nRecently uploaded document analysis:\n${JSON.stringify(documentContext, null, 2)}` : ''}

Guidelines:
- Acknowledge their input positively
- Extract specific achievements, challenges, or learnings from their response
- Ask follow-up questions to get more detail if needed
- When you have enough information for the current topic, guide them to the next
- Be conversational and supportive, not interrogative
- If they mention quantifiable results, acknowledge those specifically

Phase progression (drive this naturally without asking them to click anything):
${configuredProgression}

After processing their message, you should:
1. Respond naturally to what they said
2. Either ask a follow-up question OR transition to the next topic
3. Keep responses concise (2-4 sentences typically)`;

    const userPrompt = `The employee just said: "${userMessage}"

Respond to them and continue the conversation. If appropriate, extract any structured data (achievements, challenges, learnings, goals) from their response.

 Return a JSON object:
 {
   "response": "Your conversational response to the employee",
   "extractedData": {
     "type": "achievement|challenge|learning|goal|skill|null",
     "data": { "text": "...", "context": "..." } // or null if nothing to extract
   },
   "suggestedNextPhase": "${currentPhase}" or a next phase from: initialized|okr_reflection|cycle_questions|achievements|challenges|learnings|future_goals|competencies|report_generation|review|completed,
  "selectedOkrNumber": null, // 1-based OKR number if the employee selected an OKR to discuss (e.g., they replied with an OKR number or title)
  "shouldAdvanceOkr": false, // true if done with current OKR and should move to next
  "confidence": 0.0-1.0
}`;

    try {
      const response = await this.client.chat.completions.create({
        activity: AI_ACTIVITIES.SELF_ASSESSMENT_CHAT,
        model: this.deploymentName,
        messages: [
          { role: 'system', content: systemPrompt },
          ...recentMessages,
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.6,
        max_tokens: 800,
        response_format: { type: 'json_object' },
        ...(requireChatGpt ? { runtimePreference: 'chatgpt' } : {})
      });

      const content = response.choices[0]?.message?.content;
      const parsed = this.parseJsonResponse(content);
      this.requireAIResponse(
        this.normalizeText(parsed.response)
          && (!parsed.suggestedNextPhase || CONVERSATION_PHASES.includes(parsed.suggestedNextPhase)),
        'The self-assessment response was incomplete.'
      );
      const tokensUsed = response.usage?.total_tokens || 0;

      // Determine next phase
      let nextPhase = currentPhase;
      let nextOkrIndex = currentOkrIndex;

      if (Number.isInteger(parsed.selectedOkrNumber) && parsed.selectedOkrNumber >= 1 && parsed.selectedOkrNumber <= okrs.length) {
        nextOkrIndex = parsed.selectedOkrNumber - 1;
      } else if (Number.isInteger(parsed.selectedOkrIndex) && parsed.selectedOkrIndex >= 0 && parsed.selectedOkrIndex < okrs.length) {
        // Back-compat if the model returns a 0-based index.
        nextOkrIndex = parsed.selectedOkrIndex;
      } else if (parsed.shouldAdvanceOkr) {
        if (currentOkrIndex < okrs.length - 1) {
          nextOkrIndex = currentOkrIndex + 1;
        } else if (currentPhase === 'okr_reflection') {
          // If we just finished the last OKR, move the conversation forward.
          nextPhase = 'achievements';
        }
      } else if (parsed.suggestedNextPhase && parsed.suggestedNextPhase !== currentPhase) {
        const phaseIndex = CONVERSATION_PHASES.indexOf(parsed.suggestedNextPhase);
        if (phaseIndex > CONVERSATION_PHASES.indexOf(currentPhase)) {
          nextPhase = parsed.suggestedNextPhase;
        }
      }

      // Never jump directly to review from an earlier phase.
      // Report generation must happen first so the frontend has a concrete draft to display.
      if (nextPhase === 'review' && currentPhase !== 'review') {
        nextPhase = 'report_generation';
      }

      // A configured appraisal uses its frozen question queue instead of the
      // generic achievement/learning sequence. The route owns the exact prompt.
      if (
        configuredQuestions.length > 0
        && currentPhase === 'okr_reflection'
        && nextPhase !== 'okr_reflection'
      ) {
        nextPhase = 'cycle_questions';
      }

      const normalizedResponse = this.normalizeText(parsed.response).toLowerCase();
      const indicatesReportGeneration = /generate(?:\\s+your|\\s+the)?\\s+(?:self-assessment|review)?\\s*report|report\\s+is\\s+ready|compile\\s+.*report/.test(normalizedResponse);
      if (
        indicatesReportGeneration
        && (nextPhase === currentPhase || nextPhase === 'future_goals' || nextPhase === 'review')
      ) {
        nextPhase = 'report_generation';
      }

      return {
        response: parsed.response,
        extractedData: parsed.extractedData,
        currentPhase: nextPhase,
        currentOkrIndex: nextOkrIndex,
        confidence: parsed.confidence || 0.7,
        tokensUsed,
        success: true
      };
    } catch (error) {
      console.error('Conversation continue error:', error);
      this.rethrowAccountPolicyError(error);
      throw this.asInvalidAIResponse(error, 'The self-assessment response was invalid.');
    }
  }

  async acknowledgeCycleQuestionResponse(appraisal, question, value, options = {}) {
    await this.initialize();
    const requireChatGpt = options.requireChatGpt === true;
    const skipped = options.skipped === true;
    if (!this.client) {
      if (requireChatGpt) {
        throw new PerformanceAIRuntimeError(
          'ChatGPT is required to continue this self-assessment conversation.',
          'CHATGPT_UNAVAILABLE'
        );
      }
      return skipped ? 'Understood. We can skip that optional question.' : 'Thank you. Your response has been saved.';
    }

    const answer = skipped
      ? '[The employee explicitly skipped this optional question]'
      : this.truncateText(typeof value === 'string' ? value : JSON.stringify(value), 1600);
    const prompt = `Acknowledge one employee response in a guided self-assessment.

Frozen question: ${question.prompt}
Employee response: ${answer}

Reply with one brief, professional sentence. Do not ask another question, choose the next topic, assess performance, or paraphrase the configured question. The server controls the next exact prompt.`;
    try {
      const response = await this.client.chat.completions.create({
        activity: AI_ACTIVITIES.SELF_ASSESSMENT_CHAT,
        model: this.deploymentName,
        messages: [
          { role: 'system', content: 'You are a supportive HR assistant. Acknowledge the response briefly without judging the employee.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.3,
        max_tokens: 100,
        ...(requireChatGpt ? { runtimePreference: 'chatgpt' } : {})
      });
      const acknowledgement = this.normalizeText(response.choices[0]?.message?.content);
      this.requireAIResponse(acknowledgement, 'The cycle-question acknowledgement was empty.');
      return acknowledgement;
    } catch (error) {
      this.rethrowAccountPolicyError(error);
      throw this.asInvalidAIResponse(error, 'The cycle-question acknowledgement was invalid.');
    }
  }

  /**
   * Incorporate uploaded document into conversation context
   * @param {Object} document - The AppraisalDocument with AI analysis
   * @param {Object} appraisal - The appraisal document
   * @returns {Object} Summary message and extracted insights
   */
  async incorporateDocumentIntoConversation(document, appraisal, options = {}) {
    await this.initialize();
    const requireChatGpt = options.requireChatGpt === true;

    const analysis = document.aiAnalysis || {};
    const currentPhase = appraisal.conversationAssessment?.currentPhase || 'achievements';

    if (!this.client || !analysis.summary) {
      if (requireChatGpt) {
        throw new PerformanceAIRuntimeError(
          'ChatGPT could not analyze this conversation evidence.',
          'CHATGPT_UNAVAILABLE'
        );
      }
      return {
        message: `I've received your document "${document.originalName}". Let me know how this relates to your work this period.`,
        insights: analysis,
        success: true
      };
    }

    const prompt = `An employee uploaded a document during their self-assessment conversation.

Document: ${document.originalName}
AI Analysis Summary: ${analysis.summary}
Key Points: ${analysis.keyPoints?.join(', ') || 'None identified'}
Extracted Achievements: ${analysis.extractedAchievements?.map(a => a.description).join('; ') || 'None'}
Identified Skills: ${analysis.identifiedSkills?.map(s => s.skill).join(', ') || 'None'}
Current Conversation Phase: ${currentPhase}

Generate a brief, conversational acknowledgment that:
1. Confirms you've reviewed the document
2. Highlights 1-2 relevant insights from it
3. Asks how they'd like to incorporate this into their self-assessment

Keep it to 2-3 sentences.`;

    try {
      const response = await this.client.chat.completions.create({
        activity: AI_ACTIVITIES.DOCUMENT_ANALYSIS,
        model: this.deploymentName,
        messages: [
          { role: 'system', content: 'You are a supportive HR assistant. Acknowledge uploaded documents warmly and help connect them to the self-assessment.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.7,
        max_tokens: 300,
        ...(requireChatGpt ? { runtimePreference: 'chatgpt' } : {})
      });

      return {
        message: response.choices[0]?.message?.content,
        insights: analysis,
        tokensUsed: response.usage?.total_tokens || 0,
        success: true
      };
    } catch (error) {
      console.error('Document incorporation error:', error);
      this.rethrowAccountPolicyError(error);
      if (requireChatGpt) throw error;
      return {
        message: `I've reviewed "${document.originalName}". ${analysis.summary || 'How would you like to incorporate this into your self-assessment?'}`,
        insights: analysis,
        success: true
      };
    }
  }

  /**
   * Generate the final self-assessment report from conversation data
   * @param {Object} appraisal - The appraisal with full conversation history
   * @param {Array} okrs - Employee's OKRs
   * @param {Array} documents - Uploaded documents with analysis
   * @returns {Object} Generated report matching selfAssessment schema
   */
  async generateSelfAssessmentReport(appraisal, okrs, documents = [], options = {}) {
    await this.initialize();
    const requireChatGpt = options.requireChatGpt === true;

    if (requireChatGpt && !this.client) {
      throw new PerformanceAIRuntimeError(
        'ChatGPT is required to generate this self-assessment report.',
        'CHATGPT_UNAVAILABLE'
      );
    }

    const convState = appraisal.conversationAssessment || {};
    const extractedData = convState.extractedData || {};
    const chatThread = appraisal.chatThread || [];
    const configuredQuestionCount = getConversationQuestionQueue(appraisal, 'employee').length;
    const cycleQuestionEvidence = getCycleQuestionEvidence(appraisal, 'employee');

    // OKR performance summary
    const okrPerformance = okrs.map(okr => ({
      id: okr._id,
      title: okr.title || okr.objectives?.[0]?.title,
      progress: this.getRatedOkrProgress(okr),
      objectives: okr.objectives?.map(obj => ({
        title: obj.title,
        keyResults: obj.keyResults?.map(kr => ({
          title: kr.title,
          achievement: kr.currentValue === null || kr.currentValue === undefined || kr.currentValue === ''
            ? null
            : kr.targetValue > 0
              ? Math.round((kr.currentValue / kr.targetValue) * 100)
              : null
        }))
      }))
    }));

    // Filter out low-signal extracted snippets (e.g., "no", "n/a")
    const configuredExtractedData = this.mapCycleQuestionEvidence(cycleQuestionEvidence);
    const sanitizedExtractedData = this.sanitizeExtractedData({
      achievements: [...(extractedData.achievements || []), ...configuredExtractedData.achievements],
      challenges: [...(extractedData.challenges || []), ...configuredExtractedData.challenges],
      skills: [...(extractedData.skills || []), ...configuredExtractedData.skills],
      goals: [...(extractedData.goals || []), ...configuredExtractedData.goals]
    });
    const groundedExtractedData = this.buildGroundedExtractedData(chatThread, sanitizedExtractedData);

    // Ground the report body in employee conversation evidence to avoid generic/demo-like output.
    const baseReport = this.getFallbackReport(groundedExtractedData, okrPerformance, cycleQuestionEvidence);
    const draftSelfAssessment = {
      overallSummary: baseReport.overallSummary,
      okrAssessment: baseReport.okrAssessment,
      overallSelfRating: null,
      competencyRatings: []
    };

    const conversationSignal = this.collectConversationSignal(chatThread, groundedExtractedData);
    // The frozen cycle design is authoritative. A completed configured queue
    // may intentionally omit one of the legacy generic categories.
    const missingInfo = configuredQuestionCount > 0
      ? []
      : this.getMissingSelfAssessmentInfo(conversationSignal);
    const hasEnoughSignal = missingInfo.length === 0;

    // Prevent "demo-ish" hallucinated reports when there's too little signal.
    if (!hasEnoughSignal) {
      let lowSignalInsights = null;
      if (this.client) {
        try {
          lowSignalInsights = await this.analyzeSelfAssessment(draftSelfAssessment, baseReport.okrAssessment || [], []);
        } catch (error) {
          console.error('Low-signal AI insights generation error:', error);
          if (requireChatGpt) throw error;
        }
      }

      return {
        ...baseReport,
        suggestedOverallRating: null,
        ratingJustification: 'Not enough evidence was captured to suggest a rating yet.',
        aiSuggestedRating: undefined,
        aiInsights: {
          strengths: lowSignalInsights?.strengths || baseReport.aiInsights?.strengths || [],
          developmentAreas: lowSignalInsights?.developmentAreas || baseReport.aiInsights?.developmentAreas || [],
          suggestions: lowSignalInsights?.suggestions || missingInfo,
          sentiment: lowSignalInsights?.sentiment || 'neutral'
        },
        missingInfo,
        tokensUsed: 0,
        success: true,
        fallback: !requireChatGpt
      };
    }

    if (!this.client) {
      return baseReport;
    }

    try {
      const [aiInsightsResult, aiSuggestionResult] = await Promise.allSettled([
        this.analyzeSelfAssessment(draftSelfAssessment, baseReport.okrAssessment || [], []),
        this.generateAISuggestedRating({
          employee: appraisal.employee,
          cycleId: appraisal.cycleId,
          selfAssessment: draftSelfAssessment
        }, okrs)
      ]);

      const aiInsights = aiInsightsResult.status === 'fulfilled' ? aiInsightsResult.value : null;
      const aiSuggestion = aiSuggestionResult.status === 'fulfilled' ? aiSuggestionResult.value : null;

      if (aiInsightsResult.status === 'rejected') {
        console.error('AI insights generation failed during report creation:', aiInsightsResult.reason);
      }
      if (aiSuggestionResult.status === 'rejected') {
        console.error('AI rating suggestion failed during report creation:', aiSuggestionResult.reason);
      }

      if (aiInsightsResult.status === 'rejected' || aiSuggestionResult.status === 'rejected') {
        const reason = aiInsightsResult.status === 'rejected'
          ? aiInsightsResult.reason : aiSuggestionResult.reason;
        this.rethrowAccountPolicyError(reason);
        throw this.asInvalidAIResponse(reason, 'The self-assessment report could not be generated safely.');
      }

      const suggestedRating = aiSuggestion?.suggestedRating ?? baseReport.suggestedOverallRating;
      const ratingJustification = aiSuggestion?.ratingJustification ?? baseReport.ratingJustification;

      return {
        ...baseReport,
        aiSuggestedRating: {
          suggestedRating,
          ratingJustification,
          keyStrengths: aiSuggestion?.keyStrengths || [],
          developmentAreas: aiSuggestion?.developmentAreas || [],
          calibrationNotes: aiSuggestion?.calibrationNotes || undefined,
          confidence: aiSuggestion?.confidenceScore || undefined
        },
        suggestedOverallRating: suggestedRating,
        ratingJustification,
        aiInsights: {
          strengths: aiInsights?.strengths || baseReport.aiInsights?.strengths || [],
          developmentAreas: aiInsights?.developmentAreas || baseReport.aiInsights?.developmentAreas || [],
          suggestions: aiInsights?.suggestions || baseReport.aiInsights?.suggestions || [],
          sentiment: aiInsights?.sentiment || 'neutral'
        },
        tokensUsed: aiSuggestion?.tokensUsed || 0,
        success: true,
        fallback: !aiInsights || !aiSuggestion
      };
    } catch (error) {
      console.error('Report generation error:', error);
      if (error instanceof PerformanceAIRuntimeError) throw error;
      if (requireChatGpt) throw error;
      return baseReport;
    }
  }

  /**
   * Calculate composite score for manager review
   * @param {Object} appraisal - The appraisal with manager review data
   * @param {Object} cycle - The appraisal cycle with weights
   * @returns {Object} Score breakdown
   */
  calculateCompositeScore(appraisal, cycle) {
    const minRating = Number(cycle?.ratingScale?.min ?? 1);
    const maxRating = Number(cycle?.ratingScale?.max ?? 5);
    const workflowDefinition = appraisal?.cycleConfigurationSnapshot?.workflowDefinition || cycle?.workflowDefinition || null;
    const configuredOkrWeight = Math.min(100, Math.max(0, Number(workflowDefinition?.scoring?.goalsWeight ?? cycle?.okrWeight ?? 40)));
    const configuredCompetencyWeight = Math.min(100, Math.max(0, Number(workflowDefinition?.scoring?.competenciesWeight ?? (100 - configuredOkrWeight))));

    // Prefer immutable launch-time evidence. Older appraisals retain a
    // compatibility fallback to their submitted OKR assessment.
    const snapshotSummary = appraisal.goalEvidenceSummary;
    const hasSnapshotScore = snapshotSummary?.rated === true && Number.isFinite(Number(snapshotSummary.score));
    const okrAssessment = appraisal.managerReview?.okrAssessment || appraisal.selfAssessment?.okrAssessment || [];
    const ratedLegacyOkrs = okrAssessment
      .map((item) => item.managerVerifiedCompletion ?? item.completionPercentage)
      .filter((value) => value !== null && value !== undefined && value !== '')
      .map(Number)
      .filter(Number.isFinite);
    const avgOkrCompletion = hasSnapshotScore
      ? Number(snapshotSummary.score)
      : ratedLegacyOkrs.length > 0
        ? ratedLegacyOkrs.reduce((sum, value) => sum + value, 0) / ratedLegacyOkrs.length
        : null;
    const okrScore = avgOkrCompletion === null
      ? null
      : minRating + ((Math.min(100, Math.max(0, avgOkrCompletion)) / 100) * (maxRating - minRating));

    // Missing competency ratings are omitted rather than silently replaced
    // with a neutral score. Configured competency weights are respected.
    const competencyRatings = (appraisal.managerReview?.competencyRatings || [])
      .map((rating) => {
        const value = Number(rating.managerRating);
        if (!Number.isFinite(value)) return null;
        const definition = (cycle?.competencies || []).find((competency) =>
          competency.id === rating.competencyId || competency.name === rating.competencyName
        );
        return { value, weight: Number(definition?.weight ?? 1) };
      })
      .filter(Boolean);
    const competencyDenominator = competencyRatings.reduce((sum, item) => sum + (item.weight > 0 ? item.weight : 1), 0);
    const avgCompetencyScore = competencyRatings.length > 0
      ? competencyRatings.reduce((sum, item) => sum + (item.value * (item.weight > 0 ? item.weight : 1)), 0) / competencyDenominator
      : null;

    // Components without evidence are omitted and the available components
    // are renormalized, making the absence explicit in the returned breakdown.
    const components = [];
    if (okrScore !== null) components.push({ name: 'okr', score: okrScore, weight: configuredOkrWeight });
    if (avgCompetencyScore !== null) components.push({ name: 'competency', score: avgCompetencyScore, weight: configuredCompetencyWeight });

    const customSectionComponents = [];
    for (const section of workflowDefinition?.sections || []) {
      if (!section?.scored || ['goals', 'competencies'].includes(section.type)) continue;
      const ratingQuestions = new Map(
        (section.questions || []).filter((item) => item.responseType === 'rating').map((item) => [item.id, item])
      );
      const scores = (appraisal.customResponses || [])
        .filter((response) => response.respondentRole === 'manager' && response.sectionId === section.id && ratingQuestions.has(response.questionId))
        .map((response) => {
          const definition = ratingQuestions.get(response.questionId);
          const value = Number(response.value);
          if (!Number.isFinite(value)) return null;
          const range = Number(definition.ratingMax) - Number(definition.ratingMin);
          if (range <= 0) return null;
          const normalized = (value - Number(definition.ratingMin)) / range;
          return minRating + (Math.min(1, Math.max(0, normalized)) * (maxRating - minRating));
        })
        .filter((value) => value !== null);
      if (scores.length === 0) continue;
      const score = scores.reduce((sum, value) => sum + value, 0) / scores.length;
      const component = { name: section.id, label: section.title, score, weight: Number(section.weight || 0) };
      components.push(component);
      customSectionComponents.push(component);
    }
    let totalWeight = components.reduce((sum, component) => sum + component.weight, 0);
    if (totalWeight === 0 && components.length > 0) {
      components.forEach((component) => { component.weight = 1; });
      totalWeight = components.length;
    }
    const compositeScore = components.length > 0
      ? components.reduce((sum, component) => sum + (component.score * component.weight), 0) / totalWeight
      : null;
    const okrEffectiveWeight = components.find((component) => component.name === 'okr')
      ? (components.find((component) => component.name === 'okr').weight / totalWeight) * 100
      : 0;
    const competencyEffectiveWeight = components.find((component) => component.name === 'competency')
      ? (components.find((component) => component.name === 'competency').weight / totalWeight) * 100
      : 0;
    const suggestedRating = compositeScore === null
      ? null
      : Math.min(maxRating, Math.max(minRating, Math.round(compositeScore)));

    return {
      okrScore: okrScore === null ? null : Math.round(okrScore * 10) / 10,
      okrCompletion: avgOkrCompletion === null ? null : Math.round(avgOkrCompletion),
      competencyScore: avgCompetencyScore === null ? null : Math.round(avgCompetencyScore * 10) / 10,
      compositeScore: compositeScore === null ? null : Math.round(compositeScore * 10) / 10,
      suggestedRating,
      breakdown: {
        okrWeight: Math.round(okrEffectiveWeight * 10) / 10,
        okrContribution: okrScore === null ? null : Math.round(okrScore * (okrEffectiveWeight / 100) * 10) / 10,
        competencyWeight: Math.round(competencyEffectiveWeight * 10) / 10,
        competencyContribution: avgCompetencyScore === null ? null : Math.round(avgCompetencyScore * (competencyEffectiveWeight / 100) * 10) / 10,
        customSections: customSectionComponents.map((section) => {
          const effectiveWeight = totalWeight > 0 ? (section.weight / totalWeight) * 100 : 0;
          return {
            sectionId: section.name,
            title: section.label,
            score: Math.round(section.score * 10) / 10,
            weight: Math.round(effectiveWeight * 10) / 10,
            contribution: Math.round(section.score * (effectiveWeight / 100) * 10) / 10
          };
        }),
        configuredOkrWeight,
        configuredCompetencyWeight,
        unavailable: {
          okr: okrScore === null,
          competency: avgCompetencyScore === null
        }
      },
      ratingLabel: suggestedRating === null
        ? 'Not enough evidence'
        : (cycle?.ratingScale?.labels || []).find((label) => Number(label.value) === suggestedRating)?.label || this.getRatingLabel(suggestedRating)
    };
  }

  /**
   * Convert percentage to 1-5 rating scale
   */
  percentageToRating(percentage) {
    if (percentage >= 120) return 5;      // Outstanding
    if (percentage >= 100) return 4;      // Exceeds Expectations
    if (percentage >= 80) return 3;       // Meets Expectations
    if (percentage >= 60) return 2;       // Partially Meets
    return 1;                             // Needs Improvement
  }

  /**
   * Return progress only when goal evidence actually exists. Missing progress
   * stays unrated so a future or unreported goal cannot reduce a rating.
   */
  getRatedOkrProgress(okr = {}) {
    if (okr?.achievement?.rated === false) return null;
    const rawProgress = okr?.progress ?? okr?.achievement?.score;
    if (rawProgress === null || rawProgress === undefined || rawProgress === '') return null;
    const numericProgress = Number(rawProgress);
    return Number.isFinite(numericProgress)
      ? Math.min(100, Math.max(0, numericProgress))
      : null;
  }

  /**
   * Get rating label from numeric rating
   */
  getRatingLabel(rating) {
    const labels = {
      1: 'Needs Improvement',
      2: 'Partially Meets Expectations',
      3: 'Meets Expectations',
      4: 'Exceeds Expectations',
      5: 'Outstanding'
    };
    return labels[rating] || 'Meets Expectations';
  }

  /**
   * Estimate a suggested rating from OKR completion + extracted data
   * Used when AI is unavailable to avoid static 3.0 ratings.
   */
  estimateSelfSuggestedRating(okrPerformance = [], extractedData = {}) {
    const ratedOkrs = okrPerformance
      .map((okr) => this.getRatedOkrProgress(okr))
      .filter((progress) => progress !== null);
    const okrAvg = ratedOkrs.length > 0
      ? ratedOkrs.reduce((sum, progress) => sum + progress, 0) / ratedOkrs.length
      : null;

    const base = okrAvg !== null ? this.percentageToRating(okrAvg) : 3;

    const achievements = extractedData.achievements?.length || 0;
    const challenges = extractedData.challenges?.length || 0;
    const skills = extractedData.skills?.length || 0;
    const goals = extractedData.goals?.length || 0;

    let bonus = 0;
    if (achievements >= 4) bonus += 0.5;
    else if (achievements >= 2) bonus += 0.25;
    if (skills >= 2) bonus += 0.2;
    if (goals >= 2) bonus += 0.1;
    if (challenges >= 2 && achievements === 0) bonus -= 0.1;

    const raw = base + bonus;
    const suggested = Math.max(1, Math.min(5, Math.round(raw)));

    return {
      suggestedRating: suggested,
      okrAverage: okrAvg,
      evidenceCount: { achievements, challenges, skills, goals }
    };
  }

  /**
   * Generate AI-suggested rating with justification for manager review
   */
  async generateAISuggestedRating(appraisal, okrs) {
    await this.initialize();

    const selfAssessment = appraisal.selfAssessment || {};
    const okrPerformance = okrs.map(okr => ({
      title: okr.title || okr.objectives?.[0]?.title,
      progress: this.getRatedOkrProgress(okr)
    }));

    if (!this.client) {
      const score = this.calculateCompositeScore(appraisal, appraisal.cycleId);
      return {
        suggestedRating: score.suggestedRating,
        ratingJustification: score.okrCompletion === null
          ? 'No goals had reportable progress, so the available competency evidence was renormalized.'
          : `Based on ${score.okrCompletion}% OKR completion and competency scores.`,
        keyStrengths: [],
        developmentAreas: [],
        calibrationNotes: 'AI analysis unavailable. Using calculated composite score.',
        success: true
      };
    }

    const prompt = `Analyze this performance data and suggest an overall rating (1-5) for manager review.

Employee: ${appraisal.employee?.name}
Role: ${appraisal.employee?.jobTitle || 'Not specified'}

Self-Assessment Summary:
- Achievements: ${selfAssessment.overallSummary?.achievements?.substring(0, 500) || 'Not provided'}
- Challenges: ${selfAssessment.overallSummary?.challenges?.substring(0, 300) || 'Not provided'}
- Self-Rating: ${selfAssessment.overallSelfRating || 'Not provided'}/5

OKR Performance:
${okrPerformance.map(o => `- ${o.title}: ${o.progress === null ? 'Not rated' : `${o.progress}%`}`).join('\n')}

Competency Self-Ratings:
${selfAssessment.competencyRatings?.map(c => `- ${c.competencyName}: ${c.selfRating}/5`).join('\n') || 'No ratings'}

Provide a recommendation in JSON format:
{
  "suggestedRating": 1-5,
  "ratingJustification": "2-3 sentence explanation for this rating",
  "keyStrengths": ["strength1", "strength2", "strength3"],
  "developmentAreas": ["area1", "area2"],
  "ratingGaps": {
    "selfVsObjective": "Analysis of gap between self-rating and objective performance",
    "concerns": ["any concerns about rating accuracy"]
  },
  "calibrationNotes": "Notes for calibration session if applicable"
}`;

    try {
      const response = await this.client.chat.completions.create({
        activity: AI_ACTIVITIES.SELF_ASSESSMENT_REPORT,
        model: this.deploymentName,
        messages: [
          { role: 'system', content: 'You are an HR analytics expert providing objective rating recommendations. Base ratings on evidence and avoid bias. Be fair but honest.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.3,
        max_tokens: 1000,
        response_format: { type: 'json_object' }
      });

      const content = response.choices[0]?.message?.content;
      const result = this.parseJsonResponse(content);
      this.requireAIResponse(
        Number.isFinite(Number(result.suggestedRating))
          && Number(result.suggestedRating) >= 1
          && Number(result.suggestedRating) <= 5
          && this.normalizeText(result.ratingJustification),
        'The AI rating recommendation was incomplete.'
      );

      return {
        ...result,
        tokensUsed: response.usage?.total_tokens || 0,
        success: true
      };
    } catch (error) {
      console.error('AI rating suggestion error:', error);
      this.rethrowAccountPolicyError(error);
      throw this.asInvalidAIResponse(error, 'The AI rating recommendation was invalid.');
    }
  }

  // =========================================
  // CONVERSATION HELPER METHODS
  // =========================================

  parseJsonResponse(content) {
    if (content && typeof content === 'object') {
      return content;
    }

    const raw = (content || '').toString().trim();
    if (!raw) {
      throw new Error('Model returned empty content when JSON was expected.');
    }

    try {
      return JSON.parse(raw);
    } catch (primaryError) {
      const fencedMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
      const candidate = fencedMatch?.[1] || raw;
      const firstBrace = candidate.indexOf('{');
      const lastBrace = candidate.lastIndexOf('}');
      if (firstBrace >= 0 && lastBrace > firstBrace) {
        const jsonSlice = candidate.slice(firstBrace, lastBrace + 1);
        return JSON.parse(jsonSlice);
      }
      throw primaryError;
    }
  }

  requireAIResponse(condition, message) {
    if (condition) return;
    throw new PerformanceAIRuntimeError(message, 'AI_RESPONSE_INVALID', 502);
  }

  asInvalidAIResponse(error, message) {
    if (error instanceof PerformanceAIRuntimeError) return error;
    return new PerformanceAIRuntimeError(message, 'AI_RESPONSE_INVALID', 502);
  }

  rethrowAccountPolicyError(error) {
    if (error instanceof PerformanceAIRuntimeError && error.code !== 'AI_RESPONSE_INVALID') {
      throw error;
    }
  }

  normalizeText(value) {
    return (value || '')
      .toString()
      .replace(/\s+/g, ' ')
      .trim();
  }

  isLowSignalText(value) {
    const normalized = this.normalizeText(value).toLowerCase();
    if (!normalized) return true;
    return /^(?:n\/a|na|none|nothing|nil|no|nope|idk|i(?:\s+do)?n'?t know|not sure|skip|pass|same|none yet|nothing yet|no comment)$/i.test(normalized);
  }

  isMeaningfulText(value, options = {}) {
    const {
      minLength = 12,
      minWords = 3,
      allowSingleWord = false
    } = options;
    const normalized = this.normalizeText(value);
    if (!normalized || this.isLowSignalText(normalized)) return false;

    if (allowSingleWord) {
      return normalized.length >= minLength;
    }

    const words = normalized.split(/\s+/).filter(Boolean);
    return normalized.length >= minLength && words.length >= minWords;
  }

  truncateText(value, maxLength = 260) {
    const normalized = this.normalizeText(value);
    if (!normalized) return '';
    if (normalized.length <= maxLength) return normalized;
    return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
  }

  isOperationalConversationMessage(value) {
    const normalized = this.normalizeText(value).toLowerCase();
    if (!normalized) return true;

    return (
      /^(?:ok|okay|yes|yeah|yep|sure|continue|next|done|got it|understood|thanks|thank you|sounds good|looks good|fine)$/i.test(normalized) ||
      /^#?\d+$/.test(normalized) ||
      /^i want to discuss the okr:/i.test(normalized) ||
      /^generate(?:\s+the|\s+my)?\s+report$/i.test(normalized) ||
      /^view report$/i.test(normalized)
    );
  }

  extractConversationSnippets(value, options = {}) {
    const {
      minLength = 12,
      minWords = 3,
      maxSnippetLength = 260
    } = options;

    const normalized = this.normalizeText(value);
    if (!this.isMeaningfulText(normalized, { minLength, minWords })) {
      return [];
    }
    if (this.isOperationalConversationMessage(normalized)) {
      return [];
    }

    const rawParts = normalized
      .split(/\n+/)
      .flatMap((line) => line.split(/\s*[;|•]\s*/))
      .map((part) => this.normalizeText(part.replace(/^[-*•\d.)\s]+/, '')))
      .filter(Boolean);

    const expandedParts = rawParts.flatMap((part) => {
      if (part.length <= maxSnippetLength * 1.4) return [part];
      return part
        .split(/(?<=[.!?])\s+/)
        .map((snippet) => this.normalizeText(snippet))
        .filter(Boolean);
    });

    return expandedParts
      .filter((part) => this.isMeaningfulText(part, { minLength, minWords }))
      .map((part) => this.truncateText(part, maxSnippetLength));
  }

  toUniqueTextItems(items = [], options = {}) {
    const {
      maxItems = 6,
      minLength = 12,
      minWords = 3,
      allowSingleWord = false,
      maxSnippetLength = 260
    } = options;

    const unique = [];
    const seen = new Set();

    for (const item of items) {
      const text = this.normalizeText(item);
      if (!this.isMeaningfulText(text, { minLength, minWords, allowSingleWord })) continue;
      if (this.isOperationalConversationMessage(text)) continue;

      const key = text.toLowerCase();
      if (seen.has(key)) continue;

      seen.add(key);
      unique.push(this.truncateText(text, maxSnippetLength));
      if (unique.length >= maxItems) break;
    }

    return unique;
  }

  mergeUniqueTextItems(primary = [], secondary = [], options = {}) {
    return this.toUniqueTextItems([...(primary || []), ...(secondary || [])], options);
  }

  findEntryByText(items = [], text = '', fields = []) {
    const target = this.normalizeText(text).toLowerCase();
    if (!target || !Array.isArray(items) || items.length === 0) return null;

    return items.find((entry) =>
      fields.some((field) => this.normalizeText(entry?.[field]).toLowerCase() === target)
    ) || null;
  }

  collectEmployeePhaseSnippets(chatThread = [], phases = [], options = {}) {
    const {
      maxItems = 6,
      minLength = 12,
      minWords = 3
    } = options;

    const phaseSet = new Set((phases || []).map((phase) => this.normalizeText(phase).toLowerCase()));
    const snippets = [];

    (chatThread || [])
      .filter((message) => message?.sender?.role === 'employee')
      .forEach((message) => {
        const phase = this.normalizeText(message?.phase).toLowerCase();
        if (phaseSet.size > 0 && !phaseSet.has(phase)) return;

        const messageText = this.normalizeText(message?.message);
        if (!messageText || this.isOperationalConversationMessage(messageText)) return;

        const parts = this.extractConversationSnippets(messageText, {
          minLength,
          minWords
        });
        snippets.push(...parts);
      });

    return this.toUniqueTextItems(snippets, {
      maxItems,
      minLength,
      minWords
    });
  }

  buildGroundedExtractedData(chatThread = [], extractedData = {}) {
    const extractedAchievements = extractedData.achievements || [];
    const conversationAchievements = extractedAchievements.filter((item) => item?.extractedFrom !== 'document');
    const documentAchievements = extractedAchievements.filter((item) => item?.extractedFrom === 'document');

    const achievementSnippets = this.collectEmployeePhaseSnippets(
      chatThread,
      ['okr_reflection', 'achievements', 'review'],
      { maxItems: 8, minLength: 8, minWords: 2 }
    );
    const challengeSnippets = this.collectEmployeePhaseSnippets(
      chatThread,
      ['challenges', 'review'],
      { maxItems: 6, minLength: 8, minWords: 2 }
    );
    const learningSnippets = this.collectEmployeePhaseSnippets(
      chatThread,
      ['learnings', 'competencies', 'review'],
      { maxItems: 6, minLength: 8, minWords: 2 }
    );
    const goalSnippets = this.collectEmployeePhaseSnippets(
      chatThread,
      ['future_goals', 'review'],
      { maxItems: 6, minLength: 8, minWords: 2 }
    );

    let achievementTexts = this.mergeUniqueTextItems(
      conversationAchievements.map((item) => item?.text),
      achievementSnippets,
      { maxItems: 8, minLength: 8, minWords: 2 }
    );

    // Use document-derived achievements only when we have no direct conversation evidence.
    if (achievementTexts.length === 0) {
      achievementTexts = this.toUniqueTextItems(
        documentAchievements.map((item) => item?.text),
        { maxItems: 6, minLength: 8, minWords: 2 }
      );
    }

    const challengeTexts = this.mergeUniqueTextItems(
      (extractedData.challenges || []).map((item) => item?.text),
      challengeSnippets,
      { maxItems: 6, minLength: 8, minWords: 2 }
    );

    const learningTexts = this.mergeUniqueTextItems(
      (extractedData.skills || []).map((item) => item?.skill || item?.text),
      learningSnippets,
      { maxItems: 6, minLength: 3, minWords: 1, allowSingleWord: true }
    );

    const goalTexts = this.mergeUniqueTextItems(
      (extractedData.goals || []).map((item) => item?.goal || item?.text),
      goalSnippets,
      { maxItems: 6, minLength: 6, minWords: 2 }
    );

    const achievements = achievementTexts.map((text) => {
      const source = this.findEntryByText(extractedAchievements, text, ['text']);
      return {
        ...source,
        text
      };
    });

    const challenges = challengeTexts.map((text) => {
      const source = this.findEntryByText(extractedData.challenges || [], text, ['text']);
      return {
        text,
        resolution: this.truncateText(source?.resolution, 220),
        learnings: this.truncateText(source?.learnings, 220)
      };
    });

    const skills = learningTexts.map((skill) => {
      const source = this.findEntryByText(extractedData.skills || [], skill, ['skill', 'text']);
      return {
        skill,
        evidence: this.truncateText(source?.evidence || source?.context, 220)
      };
    });

    const goals = goalTexts.map((goal) => {
      const source = this.findEntryByText(extractedData.goals || [], goal, ['goal', 'text']);
      return {
        goal,
        timeframe: this.truncateText(source?.timeframe, 120)
      };
    });

    return {
      achievements,
      challenges,
      skills,
      goals
    };
  }

  sanitizeExtractedData(extractedData = {}) {
    const achievements = (extractedData.achievements || [])
      .filter(item => this.isMeaningfulText(item?.text, { minLength: 8, minWords: 2 }))
      .map(item => ({
        ...item,
        text: this.normalizeText(item?.text)
      }));

    const challenges = (extractedData.challenges || [])
      .filter(item => this.isMeaningfulText(item?.text, { minLength: 8, minWords: 2 }))
      .map(item => ({
        ...item,
        text: this.normalizeText(item?.text),
        resolution: this.normalizeText(item?.resolution),
        learnings: this.normalizeText(item?.learnings)
      }));

    const skills = (extractedData.skills || [])
      .filter(item => this.isMeaningfulText(item?.skill || item?.text, { minLength: 3, allowSingleWord: true }))
      .map(item => ({
        ...item,
        skill: this.normalizeText(item?.skill || item?.text),
        evidence: this.normalizeText(item?.evidence || item?.context)
      }));

    const goals = (extractedData.goals || [])
      .filter(item => this.isMeaningfulText(item?.goal || item?.text, { minLength: 6, minWords: 2 }))
      .map(item => ({
        ...item,
        goal: this.normalizeText(item?.goal || item?.text),
        timeframe: this.normalizeText(item?.timeframe)
      }));

    return {
      achievements,
      challenges,
      skills,
      goals
    };
  }

  collectConversationSignal(chatThread = [], extractedData = {}) {
    const employeeMessages = (chatThread || [])
      .filter(m => m.sender?.role === 'employee')
      .map(m => this.normalizeText(m.message))
      .filter((msg) => msg && !this.isOperationalConversationMessage(msg));

    const meaningfulMessages = employeeMessages.filter(msg =>
      this.isMeaningfulText(msg, { minLength: 10, minWords: 2 })
    );

    const employeeWordCount = meaningfulMessages.reduce(
      (sum, msg) => sum + msg.split(/\s+/).filter(Boolean).length,
      0
    );

    const uniqueWords = new Set(
      meaningfulMessages
        .join(' ')
        .toLowerCase()
        .match(/[a-z0-9]+/g) || []
    ).size;

    const extractedCounts = {
      achievements: extractedData.achievements?.length || 0,
      challenges: extractedData.challenges?.length || 0,
      learnings: extractedData.skills?.length || 0,
      goals: extractedData.goals?.length || 0
    };

    const phaseDerivedCounts = {
      achievements: 0,
      challenges: 0,
      learnings: 0,
      goals: 0
    };

    (chatThread || [])
      .filter(m => m.sender?.role === 'employee')
      .forEach((message) => {
        const text = this.normalizeText(message?.message);
        if (this.isOperationalConversationMessage(text)) return;
        if (!this.isMeaningfulText(text, { minLength: 10, minWords: 2 })) return;

        const phase = this.normalizeText(message?.phase).toLowerCase();
        if (phase === 'okr_reflection' || phase === 'achievements') {
          phaseDerivedCounts.achievements += 1;
        } else if (phase === 'challenges') {
          phaseDerivedCounts.challenges += 1;
        } else if (phase === 'learnings' || phase === 'competencies') {
          phaseDerivedCounts.learnings += 1;
        } else if (phase === 'future_goals') {
          phaseDerivedCounts.goals += 1;
        }
      });

    const inferredCounts = {
      achievements: Math.max(extractedCounts.achievements, phaseDerivedCounts.achievements > 0 ? 1 : 0),
      challenges: Math.max(extractedCounts.challenges, phaseDerivedCounts.challenges > 0 ? 1 : 0),
      learnings: Math.max(extractedCounts.learnings, phaseDerivedCounts.learnings > 0 ? 1 : 0),
      goals: Math.max(extractedCounts.goals, phaseDerivedCounts.goals > 0 ? 1 : 0)
    };

    return {
      employeeMessageCount: employeeMessages.length,
      meaningfulMessageCount: meaningfulMessages.length,
      employeeWordCount,
      uniqueWords,
      extractedCounts,
      inferredCounts,
      phaseDerivedCounts,
      totalExtracted:
        extractedCounts.achievements +
        extractedCounts.challenges +
        extractedCounts.learnings +
        extractedCounts.goals
    };
  }

  getMissingSelfAssessmentInfo(signal) {
    const missing = [];
    const counts = signal?.inferredCounts || signal?.extractedCounts || {};

    if ((counts.achievements || 0) < 1) {
      missing.push('Add at least 1 key achievement (ideally with outcomes/metrics)');
    }
    if ((counts.challenges || 0) < 1) {
      missing.push('Add at least 1 challenge and how you addressed it');
    }
    if ((counts.learnings || 0) < 1) {
      missing.push('Add 1-2 learnings or skills you developed');
    }
    if ((counts.goals || 0) < 1) {
      missing.push('Add 1-2 goals for the next period');
    }
    if (
      ((signal?.employeeWordCount || 0) < 35 && (signal?.uniqueWords || 0) < 16) ||
      (signal?.meaningfulMessageCount || 0) < 3
    ) {
      missing.push('Provide more specific detail and examples (metrics, outcomes, and context)');
    }

    return missing;
  }

  buildPhaseContext(phase, currentOkr, extractedData) {
    const contexts = {
      okr_reflection: `Discussing OKR: "${currentOkr?.title || currentOkr?.objectives?.[0]?.title || 'Current OKR'}" (${currentOkr?.progress || 0}% complete)`,
      achievements: `Discussing key achievements and accomplishments. Already captured: ${extractedData.achievements?.length || 0} achievements.`,
      challenges: `Discussing challenges faced. Already captured: ${extractedData.challenges?.length || 0} challenges.`,
      learnings: `Discussing skills developed and lessons learned.`,
      future_goals: `Discussing goals for the next period. Already captured: ${extractedData.goals?.length || 0} goals.`,
      competencies: `Discussing competency self-assessment.`,
      cycle_questions: `Answering the frozen cycle-specific assessment questions.`,
      report_generation: `Ready to generate the self-assessment report.`
    };
    return contexts[phase] || '';
  }

  mapCycleQuestionEvidence(evidence = []) {
    const mapped = { achievements: [], challenges: [], skills: [], goals: [] };
    for (const item of evidence) {
      const value = Array.isArray(item.value) ? item.value.join(', ') : String(item.value ?? '').trim();
      if (!value) continue;
      const prompt = this.normalizeText(item.prompt).toLowerCase();
      if (item.sectionType === 'achievements') {
        if (/challenge|obstacle|blocker|difficult|slowed|respond/.test(prompt)) {
          mapped.challenges.push({ text: value, resolution: value, learnings: '' });
        } else {
          mapped.achievements.push({ text: value, extractedFrom: 'cycle_question' });
        }
      } else if (item.sectionType === 'learning') {
        mapped.skills.push({ skill: value, evidence: item.prompt });
      } else if (item.sectionType === 'development') {
        mapped.goals.push({ goal: value, measurable: false, timeframe: '' });
      }
    }
    return mapped;
  }

  getFallbackConversationStart(employee, okrSummary, configuredQuestionCount = 0) {
    const okrList = okrSummary.map((okr, i) => `${i + 1}. ${okr.title} (${okr.progress}% complete)`).join('\n');

    return {
      greeting: okrSummary.length > 0
        ? `Hi ${employee.name}! Welcome to your self-assessment conversation.\n\nI see you have ${okrSummary.length} OKR(s) for this period:\n${okrList}\n\nWhich OKR would you like to start with? Reply with the OKR number (e.g., "1") or paste the title.`
        : configuredQuestionCount > 0
          ? `Hi ${employee.name}! Welcome to your self-assessment conversation. We'll work through the questions configured for this review.`
          : `Hi ${employee.name}! Welcome to your self-assessment conversation.\n\nI couldn't find any OKRs for this period. To get started, what were your top 2-3 priorities, and what progress did you make on them?`,
      okrSummary,
      phase: okrSummary.length > 0 ? 'okr_reflection' : (configuredQuestionCount > 0 ? 'cycle_questions' : 'okr_reflection'),
      currentOkrIndex: 0,
      tokensUsed: 0,
      success: true,
      fallback: true
    };
  }

  getFallbackConversationResponse(phase, userMessage, { currentOkrIndex = 0, okrCount = 0 } = {}) {
    const text = this.truncateText(this.normalizeText(userMessage), 1200);
    const selectedOkrMatch = phase === 'okr_reflection' ? text.match(/^#?(\d+)$/) : null;

    if (selectedOkrMatch) {
      const selectedIndex = Number(selectedOkrMatch[1]) - 1;
      if (selectedIndex >= 0 && selectedIndex < okrCount) {
        return {
          response: `OKR ${selectedIndex + 1} selected. Describe the outcome, the measurable result, and what you would improve.`,
          extractedData: null,
          currentPhase: 'okr_reflection',
          currentOkrIndex: selectedIndex,
          confidence: 1,
          tokensUsed: 0,
          success: true,
          fallback: true
        };
      }
    }

    let response = 'Your response has been saved. Please continue with the next guided question.';
    let currentPhase = phase;
    let nextOkrIndex = Math.max(0, Number(currentOkrIndex) || 0);
    let extractedData = null;

    if (phase === 'okr_reflection') {
      extractedData = { type: 'achievement', data: { text, context: 'OKR reflection' } };
      if (okrCount > 0 && nextOkrIndex < okrCount - 1) {
        nextOkrIndex += 1;
        response = `That OKR evidence has been saved. Now describe the outcome and measurable result for OKR ${nextOkrIndex + 1}.`;
      } else {
        currentPhase = 'achievements';
        response = 'Your OKR evidence has been saved. What is one additional achievement you are most proud of, and what impact did it have?';
      }
    } else if (phase === 'achievements') {
      extractedData = { type: 'achievement', data: { text, context: 'Key achievement' } };
      currentPhase = 'challenges';
      response = 'Achievement saved. Describe one meaningful challenge, how you handled it, and the result.';
    } else if (phase === 'challenges') {
      extractedData = { type: 'challenge', data: { text, resolution: text, learnings: '' } };
      currentPhase = 'learnings';
      response = 'Challenge saved. What did you learn or which skill did you strengthen, and how have you applied it?';
    } else if (phase === 'learnings') {
      extractedData = { type: 'learning', data: { text, context: 'Employee reflection' } };
      currentPhase = 'future_goals';
      response = 'Learning saved. State one goal for the next period, including a measurable outcome and target date.';
    } else if (phase === 'future_goals') {
      extractedData = {
        type: 'goal',
        data: {
          text,
          measurable: /\d|percent|percentage|by\s+(?:q[1-4]|\w+\s+\d{4})/i.test(text),
          timeframe: text.match(/(?:by|before)\s+([^.,;]+)/i)?.[1] || ''
        }
      };
      currentPhase = 'report_generation';
      response = 'Future goal saved. I have enough evidence to prepare your self-assessment report for review.';
    } else if (phase === 'report_generation') {
      response = 'Your evidence is ready for report generation.';
    }

    return {
      response,
      extractedData,
      currentPhase,
      currentOkrIndex: nextOkrIndex,
      confidence: 1,
      tokensUsed: 0,
      success: true,
      fallback: true
    };
  }

  getFallbackReport(extractedData, okrPerformance, cycleQuestionEvidence = []) {
    const heuristic = this.estimateSelfSuggestedRating(okrPerformance, extractedData);
    const achievementItems = (extractedData.achievements || [])
      .map(a => this.truncateText(a?.text, 280))
      .filter(text => this.isMeaningfulText(text, { minLength: 8, minWords: 2 }))
      .map(text => `- ${text}`);
    const achievements = achievementItems.length > 0 ? achievementItems.join('\n') : 'Not provided.';

    const challengeItems = (extractedData.challenges || [])
      .map((c) => {
        const challengeText = this.truncateText(c?.text, 280);
        if (!this.isMeaningfulText(challengeText, { minLength: 8, minWords: 2 })) return null;
        const resolution = this.truncateText(c?.resolution, 220);
        if (resolution) return `- ${challengeText}\n  Resolution: ${resolution}`;
        return `- ${challengeText}`;
      })
      .filter(Boolean);
    const challenges = challengeItems.length > 0 ? challengeItems.join('\n') : 'Not provided.';

    const learningItems = (extractedData.skills || [])
      .map((s) => {
        const skill = this.truncateText(s?.skill || s?.text, 220);
        if (!this.isMeaningfulText(skill, { minLength: 3, minWords: 1, allowSingleWord: true })) return null;
        const evidence = this.truncateText(s?.evidence, 180);
        return evidence ? `- ${skill} (${evidence})` : `- ${skill}`;
      })
      .filter(Boolean);
    const learnings = learningItems.length > 0 ? learningItems.join('\n') : 'Not provided.';

    const goalItems = (extractedData.goals || [])
      .map((g) => this.truncateText(g?.goal || g?.text, 240))
      .filter((goal) => this.isMeaningfulText(goal, { minLength: 6, minWords: 2 }))
      .map((goal) => `- ${goal}`);
    const goals = goalItems.length > 0 ? goalItems.join('\n') : 'Not provided.';

    return {
      overallSummary: {
        achievements,
        challenges,
        learnings,
        improvements: 'Not provided.',
        goals
      },
      okrAssessment: okrPerformance.map(okr => ({
        okrId: okr.id,
        okrTitle: okr.title,
        completionPercentage: okr.progress,
        selfComments: ''
      })),
      suggestedOverallRating: heuristic.suggestedRating,
      ratingJustification: heuristic.okrAverage !== null
        ? `Based on ${Math.round(heuristic.okrAverage)}% average OKR completion and ${heuristic.evidenceCount.achievements} achievements captured.`
        : 'Based on the evidence captured in your conversation. Please review and adjust as needed.',
      aiInsights: {
        strengths: [],
        developmentAreas: [],
        suggestions: ['AI analysis was not available. Please review and complete manually.'],
        sentiment: 'neutral'
      },
      cycleQuestionResponses: cycleQuestionEvidence.map((item) => ({
        sectionId: item.sectionId,
        sectionTitle: item.sectionTitle,
        questionId: item.questionId,
        prompt: item.prompt,
        responseType: item.responseType,
        value: item.value
      })),
      success: true,
      fallback: true
    };
  }
}

module.exports = new AppraisalAIService();
