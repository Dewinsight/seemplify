/**
 * Meeting Analysis Service
 *
 * Provides AI-powered analysis of 1:1 meeting transcripts and conversations.
 * Features:
 * - Transcript analysis and summarization
 * - AI-based scoring across multiple dimensions
 * - Sentiment and engagement analysis
 * - Key topics and action item extraction
 * - Trend analysis across meetings
 */

const { getAzureOpenAIClient } = require('./azureOpenAIService');

// Scoring dimensions for AI analysis
const SCORING_DIMENSIONS = {
  communication: {
    name: 'Communication Quality',
    description: 'Clarity, articulation, and effectiveness of communication',
    weight: 0.2
  },
  engagement: {
    name: 'Engagement Level',
    description: 'Active participation and attentiveness in the meeting',
    weight: 0.15
  },
  problemSolving: {
    name: 'Problem Solving',
    description: 'Ability to identify issues and propose solutions',
    weight: 0.2
  },
  accountability: {
    name: 'Accountability',
    description: 'Ownership of tasks and follow-through on commitments',
    weight: 0.15
  },
  growthMindset: {
    name: 'Growth Mindset',
    description: 'Openness to feedback and focus on development',
    weight: 0.15
  },
  collaboration: {
    name: 'Collaboration',
    description: 'Willingness to work together and support team goals',
    weight: 0.15
  }
};

// Manager scoring dimensions
const MANAGER_SCORING_DIMENSIONS = {
  supportiveness: {
    name: 'Supportiveness',
    description: 'Providing guidance, resources, and emotional support',
    weight: 0.2
  },
  feedbackQuality: {
    name: 'Feedback Quality',
    description: 'Constructive, specific, and actionable feedback',
    weight: 0.2
  },
  listening: {
    name: 'Active Listening',
    description: 'Demonstrating understanding and empathy',
    weight: 0.2
  },
  careerDevelopment: {
    name: 'Career Development Focus',
    description: 'Discussing growth opportunities and career path',
    weight: 0.2
  },
  followThrough: {
    name: 'Follow Through',
    description: 'Addressing previous action items and commitments',
    weight: 0.2
  }
};

/**
 * Analyze meeting transcript with AI
 */
const analyzeTranscript = async (transcript, context = {}) => {
  const client = getAzureOpenAIClient();

  if (!client) {
    console.warn('Azure OpenAI not configured, using mock analysis');
    return getMockAnalysis(transcript, context);
  }

  try {
    const systemPrompt = `You are an expert HR analyst specializing in performance management and 1:1 meeting analysis.
Your task is to analyze the following 1:1 meeting transcript and provide:

1. A concise summary (2-3 paragraphs)
2. Key discussion topics with brief descriptions
3. Action items mentioned (with assignee if identifiable)
4. Employee sentiment and engagement indicators
5. Areas of concern or red flags (if any)
6. Positive highlights and wins discussed
7. Career development topics covered
8. Blockers or challenges mentioned

Context about the meeting:
- Meeting Type: ${context.meetingType || '1:1 Check-in'}
- Employee Role: ${context.employeeRole || 'Team Member'}
- Manager Role: ${context.managerRole || 'Manager'}
- Previous Meeting Topics: ${context.previousTopics?.join(', ') || 'N/A'}

Provide your analysis in a structured JSON format.`;

    const response = await client.chat.completions.create({
      model: process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Meeting Transcript:\n\n${transcript}` }
      ],
      temperature: 0.3,
      max_tokens: 2000,
      response_format: { type: 'json_object' }
    });

    const analysis = JSON.parse(response.choices[0].message.content);

    return {
      success: true,
      summary: analysis.summary || '',
      keyTopics: analysis.keyTopics || analysis.key_topics || [],
      actionItems: analysis.actionItems || analysis.action_items || [],
      sentiment: analysis.sentiment || 'neutral',
      engagementLevel: analysis.engagementLevel || analysis.engagement_level || 'moderate',
      concerns: analysis.concerns || analysis.areas_of_concern || [],
      highlights: analysis.highlights || analysis.positive_highlights || [],
      careerDevelopment: analysis.careerDevelopment || analysis.career_development || [],
      blockers: analysis.blockers || analysis.challenges || [],
      rawAnalysis: analysis
    };
  } catch (error) {
    console.error('Transcript analysis error:', error);
    return getMockAnalysis(transcript, context);
  }
};

/**
 * Score employee performance based on meeting transcript
 */
const scoreEmployeePerformance = async (transcript, context = {}) => {
  const client = getAzureOpenAIClient();

  if (!client) {
    console.warn('Azure OpenAI not configured, using mock scoring');
    return getMockEmployeeScoring();
  }

  try {
    const dimensionsDesc = Object.entries(SCORING_DIMENSIONS)
      .map(([key, dim]) => `- ${key}: ${dim.name} - ${dim.description}`)
      .join('\n');

    const systemPrompt = `You are an expert HR analyst specializing in employee performance evaluation.
Analyze the following 1:1 meeting transcript and score the EMPLOYEE's performance across these dimensions:

${dimensionsDesc}

For each dimension:
1. Provide a score from 1-5 (1=Poor, 2=Below Average, 3=Average, 4=Good, 5=Excellent)
2. Include specific evidence from the transcript supporting your score
3. Provide a brief recommendation for improvement if score < 4

Consider:
- What the employee says and how they say it
- Their attitude and engagement level
- Examples they provide of their work
- How they respond to feedback
- Their preparation and follow-up on action items

Context:
- Employee's Previous Average Score: ${context.previousScore || 'N/A'}
- Meeting Number: ${context.meetingNumber || 'N/A'}
- Time Period: ${context.timePeriod || 'N/A'}

Return your analysis as a structured JSON object with scores and evidence for each dimension.`;

    const response = await client.chat.completions.create({
      model: process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Meeting Transcript:\n\n${transcript}` }
      ],
      temperature: 0.2,
      max_tokens: 2000,
      response_format: { type: 'json_object' }
    });

    const scoring = JSON.parse(response.choices[0].message.content);

    // Calculate weighted overall score
    const scores = {};
    let weightedTotal = 0;
    let totalWeight = 0;

    Object.entries(SCORING_DIMENSIONS).forEach(([key, dim]) => {
      const dimScore = scoring[key] || scoring.dimensions?.[key];
      if (dimScore) {
        scores[key] = {
          score: dimScore.score || dimScore,
          evidence: dimScore.evidence || dimScore.reasoning || '',
          recommendation: dimScore.recommendation || ''
        };
        weightedTotal += (dimScore.score || dimScore) * dim.weight;
        totalWeight += dim.weight;
      }
    });

    const overallScore = totalWeight > 0 ? (weightedTotal / totalWeight).toFixed(2) : 0;

    return {
      success: true,
      dimensions: scores,
      overallScore: parseFloat(overallScore),
      strengths: scoring.strengths || [],
      areasForImprovement: scoring.areasForImprovement || scoring.areas_for_improvement || [],
      recommendations: scoring.recommendations || [],
      confidenceLevel: scoring.confidenceLevel || 'moderate',
      scoredAt: new Date()
    };
  } catch (error) {
    console.error('Employee scoring error:', error);
    return getMockEmployeeScoring();
  }
};

/**
 * Score manager effectiveness based on meeting transcript
 */
const scoreManagerEffectiveness = async (transcript, context = {}) => {
  const client = getAzureOpenAIClient();

  if (!client) {
    console.warn('Azure OpenAI not configured, using mock manager scoring');
    return getMockManagerScoring();
  }

  try {
    const dimensionsDesc = Object.entries(MANAGER_SCORING_DIMENSIONS)
      .map(([key, dim]) => `- ${key}: ${dim.name} - ${dim.description}`)
      .join('\n');

    const systemPrompt = `You are an expert in leadership development and management effectiveness.
Analyze the following 1:1 meeting transcript and evaluate the MANAGER's effectiveness across these dimensions:

${dimensionsDesc}

For each dimension:
1. Provide a score from 1-5 (1=Needs Improvement, 2=Developing, 3=Competent, 4=Proficient, 5=Exemplary)
2. Include specific evidence from the transcript
3. Provide coaching suggestions if score < 4

Consider:
- How the manager creates psychological safety
- The quality and specificity of their feedback
- Whether they ask open-ended questions
- How they handle concerns raised by the employee
- Their follow-up on previous commitments

Return your analysis as a structured JSON object.`;

    const response = await client.chat.completions.create({
      model: process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Meeting Transcript:\n\n${transcript}` }
      ],
      temperature: 0.2,
      max_tokens: 2000,
      response_format: { type: 'json_object' }
    });

    const scoring = JSON.parse(response.choices[0].message.content);

    // Calculate weighted overall score
    const scores = {};
    let weightedTotal = 0;
    let totalWeight = 0;

    Object.entries(MANAGER_SCORING_DIMENSIONS).forEach(([key, dim]) => {
      const dimScore = scoring[key] || scoring.dimensions?.[key];
      if (dimScore) {
        scores[key] = {
          score: dimScore.score || dimScore,
          evidence: dimScore.evidence || '',
          coachingSuggestion: dimScore.coachingSuggestion || dimScore.coaching_suggestion || ''
        };
        weightedTotal += (dimScore.score || dimScore) * dim.weight;
        totalWeight += dim.weight;
      }
    });

    const overallScore = totalWeight > 0 ? (weightedTotal / totalWeight).toFixed(2) : 0;

    return {
      success: true,
      dimensions: scores,
      overallScore: parseFloat(overallScore),
      strengths: scoring.strengths || [],
      developmentAreas: scoring.developmentAreas || scoring.development_areas || [],
      coachingTips: scoring.coachingTips || scoring.coaching_tips || [],
      scoredAt: new Date()
    };
  } catch (error) {
    console.error('Manager scoring error:', error);
    return getMockManagerScoring();
  }
};

/**
 * Analyze sentiment throughout the meeting
 */
const analyzeSentiment = async (transcript) => {
  const client = getAzureOpenAIClient();

  if (!client) {
    return {
      overall: 'neutral',
      employeeSentiment: 'neutral',
      managerSentiment: 'neutral',
      sentimentProgression: ['neutral'],
      emotionalIndicators: []
    };
  }

  try {
    const response = await client.chat.completions.create({
      model: process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `Analyze the sentiment in this 1:1 meeting transcript. Identify:
1. Overall meeting sentiment (positive/neutral/negative)
2. Employee's sentiment throughout
3. Manager's sentiment throughout
4. Sentiment progression (how it changed during the meeting)
5. Specific emotional indicators or concerning language
Return as JSON.`
        },
        { role: 'user', content: transcript }
      ],
      temperature: 0.2,
      max_tokens: 1000,
      response_format: { type: 'json_object' }
    });

    return JSON.parse(response.choices[0].message.content);
  } catch (error) {
    console.error('Sentiment analysis error:', error);
    return {
      overall: 'neutral',
      employeeSentiment: 'neutral',
      managerSentiment: 'neutral'
    };
  }
};

/**
 * Extract action items from transcript
 */
const extractActionItems = async (transcript) => {
  const client = getAzureOpenAIClient();

  if (!client) {
    return { actionItems: [], confidence: 'low' };
  }

  try {
    const response = await client.chat.completions.create({
      model: process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `Extract all action items from this 1:1 meeting transcript. For each action item identify:
1. Description of the task
2. Who is responsible (manager/employee)
3. Due date if mentioned
4. Priority (high/medium/low) based on context
5. Related topic/category
Return as JSON array of action items.`
        },
        { role: 'user', content: transcript }
      ],
      temperature: 0.2,
      max_tokens: 1000,
      response_format: { type: 'json_object' }
    });

    const result = JSON.parse(response.choices[0].message.content);
    return {
      actionItems: result.actionItems || result.action_items || [],
      confidence: 'high'
    };
  } catch (error) {
    console.error('Action item extraction error:', error);
    return { actionItems: [], confidence: 'low' };
  }
};

/**
 * Analyze meeting trends over time
 */
const analyzeTrends = async (meetings) => {
  if (!meetings || meetings.length < 2) {
    return {
      trend: 'insufficient_data',
      message: 'Need at least 2 meetings for trend analysis'
    };
  }

  const client = getAzureOpenAIClient();

  if (!client) {
    return calculateBasicTrends(meetings);
  }

  try {
    const meetingSummaries = meetings.map((m, i) => ({
      number: i + 1,
      date: m.scheduledDate,
      aiScores: m.aiScoring?.employee?.overallScore,
      managerScore: m.managerScoring?.overallScore,
      mood: m.employeeMood?.score,
      topics: m.aiAnalysis?.keyTopics?.slice(0, 3),
      sentiment: m.aiAnalysis?.sentiment
    }));

    const response = await client.chat.completions.create({
      model: process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `Analyze trends across these 1:1 meetings. Identify:
1. Performance trend (improving/stable/declining)
2. Engagement trend
3. Recurring themes or persistent issues
4. Areas of consistent strength
5. Areas needing attention
6. Recommendations for future meetings
Return as JSON.`
        },
        { role: 'user', content: JSON.stringify(meetingSummaries) }
      ],
      temperature: 0.3,
      max_tokens: 1500,
      response_format: { type: 'json_object' }
    });

    return JSON.parse(response.choices[0].message.content);
  } catch (error) {
    console.error('Trend analysis error:', error);
    return calculateBasicTrends(meetings);
  }
};

/**
 * Generate meeting preparation suggestions
 */
const generateMeetingPrep = async (context) => {
  const client = getAzureOpenAIClient();

  if (!client) {
    return {
      suggestedTopics: [
        'Review progress on current projects',
        'Discuss any blockers or challenges',
        'Career development check-in',
        'Feedback exchange'
      ],
      questionsForEmployee: [
        'What accomplishments are you most proud of since our last meeting?',
        'What challenges are you facing?',
        'How can I better support you?'
      ],
      previousActionItemsToReview: context.previousActionItems || []
    };
  }

  try {
    const response = await client.chat.completions.create({
      model: process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `Generate 1:1 meeting preparation suggestions for a manager. Context:
- Employee Role: ${context.employeeRole || 'Team Member'}
- Last Meeting: ${context.lastMeetingDate || 'N/A'}
- Previous Topics: ${context.previousTopics?.join(', ') || 'N/A'}
- Open Action Items: ${context.openActionItems || 0}
- Employee Mood Trend: ${context.moodTrend || 'N/A'}
- Recent OKR Progress: ${context.okrProgress || 'N/A'}

Provide:
1. Suggested discussion topics (5-7)
2. Thoughtful questions to ask the employee (5-7)
3. Previous items to follow up on
4. Development-focused questions
Return as JSON.`
        },
        { role: 'user', content: 'Generate meeting preparation suggestions.' }
      ],
      temperature: 0.4,
      max_tokens: 1500,
      response_format: { type: 'json_object' }
    });

    return JSON.parse(response.choices[0].message.content);
  } catch (error) {
    console.error('Meeting prep generation error:', error);
    return {
      suggestedTopics: ['Review current work', 'Discuss challenges', 'Career development'],
      questionsForEmployee: ['What are you working on?', 'How can I help?']
    };
  }
};

/**
 * Calculate basic trends without AI
 */
const calculateBasicTrends = (meetings) => {
  const scores = meetings
    .filter(m => m.aiScoring?.employee?.overallScore)
    .map(m => m.aiScoring.employee.overallScore);

  const moods = meetings
    .filter(m => m.employeeMood?.score)
    .map(m => m.employeeMood.score);

  let performanceTrend = 'stable';
  let engagementTrend = 'stable';

  if (scores.length >= 2) {
    const recentAvg = scores.slice(-3).reduce((a, b) => a + b, 0) / Math.min(3, scores.length);
    const overallAvg = scores.reduce((a, b) => a + b, 0) / scores.length;

    if (recentAvg > overallAvg + 0.3) performanceTrend = 'improving';
    else if (recentAvg < overallAvg - 0.3) performanceTrend = 'declining';
  }

  if (moods.length >= 2) {
    const recentMood = moods.slice(-3).reduce((a, b) => a + b, 0) / Math.min(3, moods.length);
    const overallMood = moods.reduce((a, b) => a + b, 0) / moods.length;

    if (recentMood > overallMood + 0.3) engagementTrend = 'improving';
    else if (recentMood < overallMood - 0.3) engagementTrend = 'declining';
  }

  return {
    performanceTrend,
    engagementTrend,
    averageScore: scores.length > 0 ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2) : null,
    averageMood: moods.length > 0 ? (moods.reduce((a, b) => a + b, 0) / moods.length).toFixed(2) : null,
    meetingsAnalyzed: meetings.length
  };
};

/**
 * Mock analysis for when AI is not available
 */
const getMockAnalysis = (transcript, context) => {
  return {
    success: true,
    summary: 'Meeting transcript analysis requires AI configuration. Please configure Azure OpenAI to enable full analysis.',
    keyTopics: [],
    actionItems: [],
    sentiment: 'neutral',
    engagementLevel: 'moderate',
    concerns: [],
    highlights: [],
    careerDevelopment: [],
    blockers: [],
    note: 'AI analysis not available - mock data returned'
  };
};

/**
 * Mock employee scoring
 */
const getMockEmployeeScoring = () => {
  return {
    success: true,
    dimensions: {},
    overallScore: 0,
    strengths: [],
    areasForImprovement: [],
    recommendations: [],
    note: 'AI scoring not available - configure Azure OpenAI for automatic scoring',
    scoredAt: new Date()
  };
};

/**
 * Mock manager scoring
 */
const getMockManagerScoring = () => {
  return {
    success: true,
    dimensions: {},
    overallScore: 0,
    strengths: [],
    developmentAreas: [],
    coachingTips: [],
    note: 'AI scoring not available - configure Azure OpenAI for automatic scoring',
    scoredAt: new Date()
  };
};

module.exports = {
  SCORING_DIMENSIONS,
  MANAGER_SCORING_DIMENSIONS,
  analyzeTranscript,
  scoreEmployeePerformance,
  scoreManagerEffectiveness,
  analyzeSentiment,
  extractActionItems,
  analyzeTrends,
  generateMeetingPrep,
  calculateBasicTrends
};
