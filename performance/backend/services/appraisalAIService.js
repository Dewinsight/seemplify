const { AzureOpenAI } = require('openai');

// Conversation phases in order
const CONVERSATION_PHASES = [
  'initialized',
  'okr_reflection',
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
    this.deploymentName = process.env.AZURE_OPENAI_DEPLOYMENT_NAME || process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4';
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
  async startSelfAssessmentConversation(appraisal, okrs, employee) {
    await this.initialize();

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
      return this.getFallbackConversationStart(employee, okrSummary);
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
4. Asks them which OKR they'd like to start with (they can reply with the OKR number or title). If they have no OKRs, ask them to list their top 2-3 priorities for the period.

Keep the tone friendly but professional. Be encouraging about their progress.
Format your response as natural conversation text (not JSON).`;

    try {
      const response = await this.client.chat.completions.create({
        model: this.deploymentName,
        messages: [
          {
            role: 'system',
            content: 'You are a supportive HR assistant guiding an employee through their performance self-assessment. Be warm, professional, and encouraging. Help them articulate their achievements effectively.'
          },
          { role: 'user', content: prompt }
        ],
        temperature: 0.7,
        max_tokens: 600
      });

      const greeting = response.choices[0]?.message?.content;
      const tokensUsed = response.usage?.total_tokens || 0;

      return {
        greeting,
        okrSummary,
        phase: 'okr_reflection',
        currentOkrIndex: 0,
        tokensUsed,
        success: true
      };
    } catch (error) {
      console.error('Conversation start error:', error);
      return this.getFallbackConversationStart(employee, okrSummary);
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
  async continueConversation(appraisal, userMessage, okrs, documentContext = null) {
    await this.initialize();

    const convState = appraisal.conversationAssessment || {};
    const currentPhase = convState.currentPhase || 'okr_reflection';
    let currentOkrIndex = convState.currentOkrIndex || 0;
    const extractedData = convState.extractedData || {};

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
      return this.getFallbackConversationResponse(currentPhase, userMessage);
    }

    const okrListForPrompt = (okrs || []).map((okr, idx) => {
      const title = okr.title || okr.objectives?.[0]?.title || 'Untitled OKR';
      return `${idx + 1}. ${title} (${okr.progress || 0}% complete)`;
    }).join('\n');

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
- okr_reflection: focus on ONE OKR at a time. If they choose a different OKR, set "selectedOkrIndex". When done with this OKR, set "shouldAdvanceOkr": true. After the last OKR, move to "achievements".
- achievements: collect 2-5 key achievements (not necessarily tied to OKRs). Then move to "challenges".
- challenges: collect 1-3 challenges and how they addressed them. Then move to "learnings".
- learnings: collect 1-3 learnings/skills gained. Then move to "future_goals".
- future_goals: collect 2-3 goals for next period. Then move to "report_generation".

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
  "suggestedNextPhase": "${currentPhase}" or a next phase from: initialized|okr_reflection|achievements|challenges|learnings|future_goals|competencies|report_generation|review|completed,
  "selectedOkrNumber": null, // 1-based OKR number if the employee selected an OKR to discuss (e.g., they replied with an OKR number or title)
  "shouldAdvanceOkr": false, // true if done with current OKR and should move to next
  "confidence": 0.0-1.0
}`;

    try {
      const response = await this.client.chat.completions.create({
        model: this.deploymentName,
        messages: [
          { role: 'system', content: systemPrompt },
          ...recentMessages,
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.6,
        max_tokens: 800,
        response_format: { type: 'json_object' }
      });

      const content = response.choices[0]?.message?.content;
      const parsed = JSON.parse(content);
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
      return this.getFallbackConversationResponse(currentPhase, userMessage);
    }
  }

  /**
   * Incorporate uploaded document into conversation context
   * @param {Object} document - The AppraisalDocument with AI analysis
   * @param {Object} appraisal - The appraisal document
   * @returns {Object} Summary message and extracted insights
   */
  async incorporateDocumentIntoConversation(document, appraisal) {
    await this.initialize();

    const analysis = document.aiAnalysis || {};
    const currentPhase = appraisal.conversationAssessment?.currentPhase || 'achievements';

    if (!this.client || !analysis.summary) {
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
        model: this.deploymentName,
        messages: [
          { role: 'system', content: 'You are a supportive HR assistant. Acknowledge uploaded documents warmly and help connect them to the self-assessment.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.7,
        max_tokens: 300
      });

      return {
        message: response.choices[0]?.message?.content,
        insights: analysis,
        tokensUsed: response.usage?.total_tokens || 0,
        success: true
      };
    } catch (error) {
      console.error('Document incorporation error:', error);
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
  async generateSelfAssessmentReport(appraisal, okrs, documents = []) {
    await this.initialize();

    const convState = appraisal.conversationAssessment || {};
    const extractedData = convState.extractedData || {};
    const chatThread = appraisal.chatThread || [];

    // Compile conversation highlights
    const employeeMessages = chatThread
      .filter(m => m.sender?.role === 'employee')
      .map(m => m.message)
      .join('\n\n');

    // OKR performance summary
    const okrPerformance = okrs.map(okr => ({
      id: okr._id,
      title: okr.title || okr.objectives?.[0]?.title,
      progress: okr.progress || 0,
      objectives: okr.objectives?.map(obj => ({
        title: obj.title,
        keyResults: obj.keyResults?.map(kr => ({
          title: kr.title,
          achievement: kr.targetValue > 0 ? Math.round((kr.currentValue / kr.targetValue) * 100) : 0
        }))
      }))
    }));

    // Ground the report body in extracted data (deterministic) to avoid "demo-ish" hallucinations.
    const baseReport = this.getFallbackReport(extractedData, okrPerformance);

    // Prevent "demo-ish" hallucinated reports when there's too little signal.
    const extractedCount =
      (extractedData.achievements?.length || 0) +
      (extractedData.challenges?.length || 0) +
      (extractedData.skills?.length || 0) +
      (extractedData.goals?.length || 0);
    const employeeTextLen = (employeeMessages || '').trim().length;
    const hasEnoughSignal = employeeTextLen >= 200 || extractedCount >= 3;

    if (!hasEnoughSignal) {
      return {
        ...baseReport,
        suggestedOverallRating: null,
        ratingJustification: 'Not enough evidence was captured to suggest a rating yet.',
        aiSuggestedRating: undefined,
        missingInfo: [
          'Add 2-3 key achievements (ideally with outcomes/metrics)',
          'Add 1-2 challenges and how you addressed them',
          'Add 1-2 learnings and 1-2 goals for next period'
        ],
        tokensUsed: 0,
        success: true,
        fallback: true
      };
    }

    if (!this.client) {
      return baseReport;
    }

    try {
      const draftSelfAssessment = {
        overallSummary: baseReport.overallSummary,
        okrAssessment: baseReport.okrAssessment,
        overallSelfRating: null,
        competencyRatings: []
      };

      const [aiInsights, aiSuggestion] = await Promise.all([
        this.analyzeSelfAssessment(draftSelfAssessment, baseReport.okrAssessment || [], []),
        this.generateAISuggestedRating({
          employee: appraisal.employee,
          cycleId: appraisal.cycleId,
          selfAssessment: draftSelfAssessment
        }, okrs)
      ]);

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
          strengths: aiInsights?.strengths || [],
          developmentAreas: aiInsights?.developmentAreas || [],
          suggestions: aiInsights?.suggestions || [],
          sentiment: aiInsights?.sentiment || 'neutral'
        },
        tokensUsed: aiSuggestion?.tokensUsed || 0,
        success: true,
        fallback: false
      };
    } catch (error) {
      console.error('Report generation error:', error);
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
    const okrWeight = (cycle?.okrWeight || 40) / 100;
    const competencyWeight = 1 - okrWeight;

    // OKR Score Calculation
    const okrAssessment = appraisal.managerReview?.okrAssessment || appraisal.selfAssessment?.okrAssessment || [];
    const avgOkrCompletion = okrAssessment.length > 0
      ? okrAssessment.reduce((sum, o) => sum + (o.managerVerifiedCompletion ?? o.completionPercentage ?? 0), 0) / okrAssessment.length
      : 0;

    // Convert percentage to 1-5 scale
    const okrScore = this.percentageToRating(avgOkrCompletion);

    // Competency Score Calculation
    const competencyRatings = appraisal.managerReview?.competencyRatings || [];
    const avgCompetencyScore = competencyRatings.length > 0
      ? competencyRatings.reduce((sum, c) => sum + (c.managerRating || 3), 0) / competencyRatings.length
      : 3;

    // Composite Score
    const compositeScore = (okrScore * okrWeight) + (avgCompetencyScore * competencyWeight);

    return {
      okrScore: Math.round(okrScore * 10) / 10,
      okrCompletion: Math.round(avgOkrCompletion),
      competencyScore: Math.round(avgCompetencyScore * 10) / 10,
      compositeScore: Math.round(compositeScore * 10) / 10,
      suggestedRating: Math.round(compositeScore),
      breakdown: {
        okrWeight: cycle?.okrWeight || 40,
        okrContribution: Math.round(okrScore * okrWeight * 10) / 10,
        competencyWeight: 100 - (cycle?.okrWeight || 40),
        competencyContribution: Math.round(avgCompetencyScore * competencyWeight * 10) / 10
      },
      ratingLabel: this.getRatingLabel(Math.round(compositeScore))
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
    const okrAvg = okrPerformance.length > 0
      ? okrPerformance.reduce((sum, o) => sum + (o.progress || 0), 0) / okrPerformance.length
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
      progress: okr.progress || 0
    }));

    if (!this.client) {
      const score = this.calculateCompositeScore(appraisal, appraisal.cycleId);
      return {
        suggestedRating: score.suggestedRating,
        ratingJustification: `Based on ${score.okrCompletion}% OKR completion and competency scores.`,
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
${okrPerformance.map(o => `- ${o.title}: ${o.progress}%`).join('\n')}

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
      const result = JSON.parse(content);

      return {
        ...result,
        tokensUsed: response.usage?.total_tokens || 0,
        success: true
      };
    } catch (error) {
      console.error('AI rating suggestion error:', error);
      const score = this.calculateCompositeScore(appraisal, appraisal.cycleId);
      return {
        suggestedRating: score.suggestedRating,
        ratingJustification: `Based on ${score.okrCompletion}% OKR completion and competency assessment.`,
        keyStrengths: [],
        developmentAreas: [],
        calibrationNotes: 'AI analysis encountered an error. Using calculated composite score.',
        success: false
      };
    }
  }

  // =========================================
  // CONVERSATION HELPER METHODS
  // =========================================

  buildPhaseContext(phase, currentOkr, extractedData) {
    const contexts = {
      okr_reflection: `Discussing OKR: "${currentOkr?.title || currentOkr?.objectives?.[0]?.title || 'Current OKR'}" (${currentOkr?.progress || 0}% complete)`,
      achievements: `Discussing key achievements and accomplishments. Already captured: ${extractedData.achievements?.length || 0} achievements.`,
      challenges: `Discussing challenges faced. Already captured: ${extractedData.challenges?.length || 0} challenges.`,
      learnings: `Discussing skills developed and lessons learned.`,
      future_goals: `Discussing goals for the next period. Already captured: ${extractedData.goals?.length || 0} goals.`,
      competencies: `Discussing competency self-assessment.`,
      report_generation: `Ready to generate the self-assessment report.`
    };
    return contexts[phase] || '';
  }

  getFallbackConversationStart(employee, okrSummary) {
    const okrList = okrSummary.map((okr, i) => `${i + 1}. ${okr.title} (${okr.progress}% complete)`).join('\n');

    return {
      greeting: okrSummary.length > 0
        ? `Hi ${employee.name}! Welcome to your self-assessment conversation.\n\nI see you have ${okrSummary.length} OKR(s) for this period:\n${okrList}\n\nWhich OKR would you like to start with? Reply with the OKR number (e.g., "1") or paste the title.`
        : `Hi ${employee.name}! Welcome to your self-assessment conversation.\n\nI couldn't find any OKRs for this period. To get started, what were your top 2-3 priorities, and what progress did you make on them?`,
      okrSummary,
      phase: 'okr_reflection',
      currentOkrIndex: 0,
      tokensUsed: 0,
      success: true,
      fallback: true
    };
  }

  getFallbackConversationResponse(phase, userMessage) {
    const responses = {
      okr_reflection: "Thank you for sharing that. Can you tell me more about the specific results or metrics you achieved?",
      achievements: "That's great progress. Were there any other notable accomplishments you'd like to mention?",
      challenges: "I appreciate you sharing that challenge. How did you address it, and what did you learn from the experience?",
      learnings: "Those are valuable insights. What skills would you like to develop further?",
      future_goals: "Good goals. Can you make them more specific with measurable outcomes and timeframes?",
      competencies: "Thank you for that self-assessment. Are there any competencies you'd like to focus on improving?",
      report_generation: "I have enough information to generate your self-assessment report. Would you like me to proceed?"
    };

    return {
      response: responses[phase] || "Thank you for sharing. Please continue with your thoughts.",
      extractedData: null,
      currentPhase: phase,
      confidence: 0.5,
      tokensUsed: 0,
      success: true,
      fallback: true
    };
  }

  getFallbackReport(extractedData, okrPerformance) {
    const heuristic = this.estimateSelfSuggestedRating(okrPerformance, extractedData);
    const achievements = extractedData.achievements?.length
      ? extractedData.achievements.map(a => `- ${a.text}`).join('\n')
      : 'Not provided.';

    const challenges = extractedData.challenges?.length
      ? extractedData.challenges.map(c => {
        if (c.resolution) return `- ${c.text}\n  Resolution: ${c.resolution}`;
        return `- ${c.text}`;
      }).join('\n')
      : 'Not provided.';

    const learnings = extractedData.skills?.length
      ? extractedData.skills.map(s => s.evidence ? `- ${s.skill} (${s.evidence})` : `- ${s.skill}`).join('\n')
      : 'Not provided.';

    const goals = extractedData.goals?.length
      ? extractedData.goals.map(g => `- ${g.goal}`).join('\n')
      : 'Not provided.';

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
      success: true,
      fallback: true
    };
  }
}

module.exports = new AppraisalAIService();
