const Interview = require('../models/Interview');
const Job = require('../models/Job');
const Candidate = require('../models/Candidate');
const AzureOpenAIService = require('./azureOpenAIService');
const { resolveLlmRuntimeConfig } = require('../config/llmRuntimeConfig');
const embeddingService = require('./embeddingService');
const transcriptSegmentationService = require('./transcriptSegmentationService');

class AIInterviewAnalysisService {
  constructor() {
    this.azureOpenAIService = new AzureOpenAIService();
  }

  /**
   * Analyze interview transcript
   */
  async analyzeInterviewTranscript(interviewId) {
    try {
      console.log(`🤖 Starting AI analysis for interview ${interviewId}`);
      
      const interview = await Interview.findById(interviewId)
        .populate('stageId')
        .populate('jobId')
        .populate('candidateId');
      
      if (!interview) {
        throw new Error('Interview not found');
      }
      
      if (!interview.transcript?.content) {
        throw new Error('No transcript available for analysis');
      }
      
      // Get stage context for analysis
      const stageContext = await this._getStageContext(interview);
      
      // Perform comprehensive analysis
      const analysis = await this._performAnalysis(interview, stageContext);
      
      // Compare with other candidates
      const comparativeAnalysis = await this._performComparativeAnalysis(interview, analysis);
      
      // Update interview with analysis results
      interview.aiAnalysis = {
        analyzed: true,
        analyzedAt: new Date(),
        modelVersion: resolveLlmRuntimeConfig().modelName,
        insights: analysis.insights,
        comparativeAnalysis
      };
      
      await interview.save();
      
      // Update pipeline recommendations
      await this._updatePipelineRecommendations(interview, analysis);
      
      // Generate embeddings for semantic search
      await this._generateAnalysisEmbeddings(interview, analysis);
      
      console.log(`✅ AI analysis completed for interview ${interviewId}`);
      return interview.aiAnalysis;
    } catch (error) {
      console.error('❌ Error in AI interview analysis:', error);
      throw error;
    }
  }

  /**
   * Perform comprehensive analysis
   */
  async _performAnalysis(interview, stageContext) {
    const analysisPrompt = this._buildAnalysisPrompt(interview.transcript, stageContext);
    
    try {
      const response = await this.azureOpenAIService.analyzeInterview(analysisPrompt);
      const parsedResponse = JSON.parse(response);
      
      return {
        insights: {
          sentimentAnalysis: this._processSentimentAnalysis(parsedResponse.sentiment),
          keySkillsMentioned: this._processSkillsAnalysis(parsedResponse.skills, stageContext),
          concerns: this._processConcerns(parsedResponse.concerns),
          strengths: this._processStrengths(parsedResponse.strengths),
          communicationAnalysis: this._processCommunicationAnalysis(parsedResponse.communication),
          recommendedNextSteps: this._processRecommendations(parsedResponse.recommendations, stageContext)
        }
      };
    } catch (error) {
      console.error('❌ Error in AI analysis:', error);
      // Return default analysis on error
      return this._getDefaultAnalysis();
    }
  }

  /**
   * Build analysis prompt
   */
  _buildAnalysisPrompt(transcript, stageContext) {
    return `You are an expert interview analyst with 20+ years of experience in talent acquisition and behavioral psychology.

INTERVIEW CONTEXT:
- Job Title: ${stageContext.job.title}
- Stage: ${stageContext.stage.name} (${stageContext.stage.type})
- Stage Order: ${stageContext.stage.order} of ${stageContext.totalStages}
- Evaluation Criteria: ${JSON.stringify(stageContext.stage.evaluationCriteria)}

JOB REQUIREMENTS:
- Experience: ${stageContext.job.experience}
- Skills: ${stageContext.job.skills}
- Education: ${stageContext.job.education}

TRANSCRIPT:
${transcript.content}

Analyze this interview transcript and provide a comprehensive assessment in the following JSON format:

{
  "sentiment": {
    "candidateConfidence": 0-100,
    "interviewerEngagement": 0-100,
    "overallTone": "very_positive|positive|neutral|negative|very_negative",
    "emotionalJourney": [
      {
        "timestamp": "MM:SS",
        "sentiment": -100 to 100,
        "note": "Brief description"
      }
    ]
  },
  "skills": [
    {
      "skill": "Skill name",
      "frequency": "Number of mentions",
      "context": "How it was discussed",
      "relevanceScore": 0-100,
      "proficiencyIndicator": "beginner|intermediate|advanced|expert",
      "evidence": ["Quote 1", "Quote 2"]
    }
  ],
  "concerns": [
    {
      "type": "experience_gap|skill_mismatch|communication_issues|culture_mismatch|availability_concerns|compensation_mismatch|other",
      "severity": "low|medium|high|critical",
      "evidence": "Direct quote or observation",
      "timestamp": "MM:SS",
      "recommendation": "How to address this concern"
    }
  ],
  "strengths": [
    {
      "area": "Strength category",
      "evidence": "Supporting quote",
      "relevanceScore": 0-100,
      "timestamp": "MM:SS",
      "examples": ["Example 1", "Example 2"]
    }
  ],
  "communication": {
    "clarity": 0-100,
    "structure": 0-100,
    "relevance": 0-100,
    "examples": 0-100,
    "observations": ["Key observation 1", "Key observation 2"]
  },
  "recommendations": {
    "shouldProceed": true|false,
    "confidence": 0-100,
    "recommendation": "advance|reject|additional_assessment|different_role",
    "suggestedFocusAreas": ["Area 1", "Area 2"],
    "suggestedInterviewers": ["Role 1", "Role 2"],
    "suggestedQuestions": ["Question 1", "Question 2"],
    "reasoning": "Detailed explanation of recommendation"
  }
}

Focus on:
1. Objective assessment based on evidence from the transcript
2. Alignment with job requirements and stage criteria
3. Specific examples and quotes to support findings
4. Actionable recommendations for next steps
5. Fair and unbiased evaluation`;
  }

  /**
   * Perform comparative analysis
   */
  async _performComparativeAnalysis(interview, analysis) {
    try {
      // Get other interviews for the same job and stage
      const otherInterviews = await Interview.find({
        jobId: interview.jobId,
        stageId: interview.stageId,
        _id: { $ne: interview._id },
        'aiAnalysis.analyzed': true
      }).select('aiAnalysis candidateId');
      
      if (otherInterviews.length === 0) {
        return {
          comparedAt: new Date(),
          totalCandidatesCompared: 0,
          percentile: 100,
          rankings: {
            overall: 1,
            technical: 1,
            behavioral: 1,
            cultural: 1
          },
          strongerAreas: [],
          weakerAreas: []
        };
      }
      
      // Calculate percentiles
      const scores = this._calculateComparativeScores(analysis, otherInterviews);
      
      return {
        comparedAt: new Date(),
        totalCandidatesCompared: otherInterviews.length,
        percentile: scores.overallPercentile,
        rankings: scores.rankings,
        strongerAreas: scores.strongerAreas,
        weakerAreas: scores.weakerAreas
      };
    } catch (error) {
      console.error('⚠️ Error in comparative analysis:', error);
      return null;
    }
  }

  /**
   * Calculate comparative scores
   */
  _calculateComparativeScores(currentAnalysis, otherInterviews) {
    // Calculate current candidate's scores
    const currentScores = {
      overall: this._calculateOverallScore(currentAnalysis),
      technical: this._calculateTechnicalScore(currentAnalysis),
      behavioral: this._calculateBehavioralScore(currentAnalysis),
      cultural: this._calculateCulturalScore(currentAnalysis)
    };
    
    // Calculate scores for all candidates
    const allScores = otherInterviews.map(interview => ({
      candidateId: interview.candidateId,
      scores: {
        overall: this._calculateOverallScore(interview.aiAnalysis.insights),
        technical: this._calculateTechnicalScore(interview.aiAnalysis.insights),
        behavioral: this._calculateBehavioralScore(interview.aiAnalysis.insights),
        cultural: this._calculateCulturalScore(interview.aiAnalysis.insights)
      }
    }));
    
    // Add current candidate
    allScores.push({
      candidateId: 'current',
      scores: currentScores
    });
    
    // Calculate rankings and percentiles
    const rankings = {};
    const percentiles = {};
    
    ['overall', 'technical', 'behavioral', 'cultural'].forEach(category => {
      // Sort by score descending
      const sorted = allScores.sort((a, b) => b.scores[category] - a.scores[category]);
      const currentRank = sorted.findIndex(s => s.candidateId === 'current') + 1;
      
      rankings[category] = currentRank;
      percentiles[category] = ((allScores.length - currentRank) / (allScores.length - 1)) * 100;
    });
    
    // Identify stronger and weaker areas
    const strongerAreas = [];
    const weakerAreas = [];
    
    Object.entries(percentiles).forEach(([area, percentile]) => {
      if (area !== 'overall') {
        if (percentile >= 75) {
          strongerAreas.push({
            area: area.charAt(0).toUpperCase() + area.slice(1),
            percentile: Math.round(percentile),
            description: `Top ${100 - Math.round(percentile)}% among candidates`
          });
        } else if (percentile <= 25) {
          weakerAreas.push({
            area: area.charAt(0).toUpperCase() + area.slice(1),
            percentile: Math.round(percentile),
            improvementSuggestion: this._getImprovementSuggestion(area)
          });
        }
      }
    });
    
    return {
      overallPercentile: Math.round(percentiles.overall),
      rankings,
      strongerAreas,
      weakerAreas
    };
  }

  /**
   * Update pipeline recommendations
   */
  async _updatePipelineRecommendations(interview, analysis) {
    try {
      const job = await Job.findById(interview.jobId);
      const applicantIndex = job.applicants.findIndex(
        app => app.candidate.toString() === interview.candidateId.toString()
      );
      
      if (applicantIndex !== -1) {
        // Update applicant with AI insights
        job.applicants[applicantIndex].aiInsights = {
          lastAnalyzed: new Date(),
          recommendedAction: analysis.insights.recommendedNextSteps.recommendation,
          confidence: analysis.insights.recommendedNextSteps.confidence,
          keyStrengths: analysis.insights.strengths.slice(0, 3).map(s => s.area),
          keyConcerns: analysis.insights.concerns.slice(0, 3).map(c => c.type)
        };
        
        await job.save();
      }
    } catch (error) {
      console.error('⚠️ Error updating pipeline recommendations:', error);
    }
  }

  /**
   * Get candidate insights across all interviews
   */
  async getCandidateInsights(candidateId, jobId) {
    try {
      const interviews = await Interview.find({
        candidateId,
        jobId,
        'aiAnalysis.analyzed': true
      }).populate('stageId');
      
      if (interviews.length === 0) {
        return {
          totalInterviews: 0,
          analyzedInterviews: 0,
          overallRecommendation: 'insufficient_data',
          insights: null
        };
      }
      
      // Aggregate insights across all interviews
      const aggregatedInsights = this._aggregateInsights(interviews);
      
      return {
        totalInterviews: interviews.length,
        analyzedInterviews: interviews.length,
        overallRecommendation: this._determineOverallRecommendation(interviews),
        insights: aggregatedInsights,
        stageBreakdown: interviews.map(i => ({
          stageName: i.stageId?.name || 'Unknown',
          stageType: i.stageId?.type || 'unknown',
          recommendation: i.aiAnalysis.insights.recommendedNextSteps.recommendation,
          confidence: i.aiAnalysis.insights.recommendedNextSteps.confidence,
          keyStrengths: i.aiAnalysis.insights.strengths.slice(0, 3).map(s => s.area),
          keyConcerns: i.aiAnalysis.insights.concerns.slice(0, 3).map(c => c.type)
        }))
      };
    } catch (error) {
      console.error('❌ Error getting candidate insights:', error);
      throw error;
    }
  }

  /**
   * Get comparative analysis for a job
   */
  async getComparativeAnalysis(jobId, stageId = null) {
    try {
      const query = {
        jobId,
        'aiAnalysis.analyzed': true
      };
      
      if (stageId) {
        query.stageId = stageId;
      }
      
      const interviews = await Interview.find(query)
        .populate('candidateId', 'firstName lastName')
        .populate('stageId', 'name type');
      
      if (interviews.length === 0) {
        return {
          totalCandidates: 0,
          analyzedCandidates: 0,
          rankings: []
        };
      }
      
      // Calculate scores for all candidates
      const candidateScores = interviews.map(interview => ({
        candidateId: interview.candidateId._id,
        candidateName: `${interview.candidateId.firstName} ${interview.candidateId.lastName}`,
        stageName: interview.stageId?.name || 'Unknown',
        scores: {
          overall: this._calculateOverallScore(interview.aiAnalysis.insights),
          technical: this._calculateTechnicalScore(interview.aiAnalysis.insights),
          behavioral: this._calculateBehavioralScore(interview.aiAnalysis.insights),
          cultural: this._calculateCulturalScore(interview.aiAnalysis.insights)
        },
        recommendation: interview.aiAnalysis.insights.recommendedNextSteps.recommendation,
        confidence: interview.aiAnalysis.insights.recommendedNextSteps.confidence
      }));
      
      // Sort by overall score
      candidateScores.sort((a, b) => b.scores.overall - a.scores.overall);
      
      return {
        totalCandidates: candidateScores.length,
        analyzedCandidates: candidateScores.length,
        rankings: candidateScores.map((candidate, index) => ({
          rank: index + 1,
          ...candidate
        }))
      };
    } catch (error) {
      console.error('❌ Error getting comparative analysis:', error);
      throw error;
    }
  }

  /**
   * Get next step recommendations
   */
  async getNextStepRecommendations(interviewId) {
    try {
      const interview = await Interview.findById(interviewId)
        .populate('stageId')
        .populate('jobId');
      
      if (!interview?.aiAnalysis?.analyzed) {
        throw new Error('Interview not analyzed yet');
      }
      
      const recommendations = interview.aiAnalysis.insights.recommendedNextSteps;
      
      // Get stage progression info
      const nextStage = await interview.stageId.getNextStage();
      
      return {
        recommendation: recommendations.recommendation,
        confidence: recommendations.confidence,
        reasoning: recommendations.reasoning,
        suggestedFocusAreas: recommendations.suggestedFocusAreas,
        suggestedQuestions: recommendations.suggestedQuestions,
        nextStage: nextStage ? {
          id: nextStage._id,
          name: nextStage.name,
          type: nextStage.type,
          description: nextStage.description
        } : null,
        actions: this._getRecommendedActions(recommendations, nextStage)
      };
    } catch (error) {
      console.error('❌ Error getting recommendations:', error);
      throw error;
    }
  }

  /**
   * Bulk analyze interviews
   */
  async bulkAnalyzeInterviews(jobId, stageId = null) {
    try {
      const query = {
        jobId,
        'transcript.content': { $exists: true, $ne: null },
        'aiAnalysis.analyzed': { $ne: true }
      };
      
      if (stageId) {
        query.stageId = stageId;
      }
      
      const interviews = await Interview.find(query);
      
      if (interviews.length === 0) {
        return {
          totalInterviews: 0,
          analyzedInterviews: 0,
          results: []
        };
      }
      
      console.log(`🔄 Starting bulk analysis for ${interviews.length} interviews`);
      
      const results = [];
      
      for (const interview of interviews) {
        try {
          const analysis = await this.analyzeInterviewTranscript(interview._id);
          results.push({
            interviewId: interview._id,
            success: true,
            analysis
          });
        } catch (error) {
          results.push({
            interviewId: interview._id,
            success: false,
            error: error.message
          });
        }
      }
      
      const successCount = results.filter(r => r.success).length;
      console.log(`✅ Bulk analysis completed: ${successCount}/${interviews.length} successful`);
      
      return {
        totalInterviews: interviews.length,
        analyzedInterviews: successCount,
        results
      };
    } catch (error) {
      console.error('❌ Error in bulk analysis:', error);
      throw error;
    }
  }

  // Helper methods for score calculation
  _calculateOverallScore(insights) {
    const sentiment = insights.sentimentAnalysis?.candidateConfidence || 50;
    const communication = (
      (insights.communicationAnalysis?.clarity || 50) +
      (insights.communicationAnalysis?.structure || 50) +
      (insights.communicationAnalysis?.relevance || 50) +
      (insights.communicationAnalysis?.examples || 50)
    ) / 4;
    const recommendation = insights.recommendedNextSteps?.confidence || 50;
    
    return (sentiment * 0.3 + communication * 0.4 + recommendation * 0.3);
  }

  _calculateTechnicalScore(insights) {
    const skills = insights.keySkillsMentioned || [];
    const avgRelevance = skills.length > 0
      ? skills.reduce((sum, skill) => sum + (skill.relevanceScore || 0), 0) / skills.length
      : 50;
    
    const technicalConcerns = insights.concerns?.filter(c => 
      c.type === 'skill_mismatch' || c.type === 'experience_gap'
    ).length || 0;
    
    return Math.max(0, avgRelevance - (technicalConcerns * 10));
  }

  _calculateBehavioralScore(insights) {
    const communication = insights.communicationAnalysis || {};
    const behavioralStrengths = insights.strengths?.filter(s => 
      s.area.toLowerCase().includes('communication') ||
      s.area.toLowerCase().includes('leadership') ||
      s.area.toLowerCase().includes('teamwork')
    ).length || 0;
    
    return (
      (communication.clarity || 50) * 0.3 +
      (communication.structure || 50) * 0.3 +
      (communication.examples || 50) * 0.2 +
      (behavioralStrengths * 10) * 0.2
    );
  }

  _calculateCulturalScore(insights) {
    const sentiment = insights.sentimentAnalysis?.overallTone || 'neutral';
    const toneScore = {
      'very_positive': 90,
      'positive': 75,
      'neutral': 50,
      'negative': 25,
      'very_negative': 10
    }[sentiment] || 50;
    
    const cultureConcerns = insights.concerns?.filter(c => 
      c.type === 'culture_mismatch'
    ).length || 0;
    
    return Math.max(0, toneScore - (cultureConcerns * 20));
  }

  _getImprovementSuggestion(area) {
    const suggestions = {
      technical: 'Consider additional technical assessments or coding challenges',
      behavioral: 'Focus on STAR method responses and specific examples',
      cultural: 'Explore alignment with company values and team dynamics'
    };
    
    return suggestions[area] || 'Further evaluation recommended';
  }

  // Process helper methods
  _processSentimentAnalysis(sentiment) {
    return {
      candidateConfidence: Math.min(100, Math.max(0, sentiment?.candidateConfidence || 50)),
      interviewerEngagement: Math.min(100, Math.max(0, sentiment?.interviewerEngagement || 50)),
      overallTone: sentiment?.overallTone || 'neutral',
      emotionalJourney: sentiment?.emotionalJourney || []
    };
  }

  _processSkillsAnalysis(skills, stageContext) {
    const jobSkills = stageContext.job.skills?.split(',').map(s => s.trim().toLowerCase()) || [];
    
    return (skills || []).map(skill => ({
      ...skill,
      relevanceScore: this._calculateSkillRelevance(skill.skill, jobSkills),
      proficiencyIndicator: skill.proficiencyIndicator || 'intermediate'
    }));
  }

  _calculateSkillRelevance(skill, jobSkills) {
    const skillLower = skill.toLowerCase();
    
    // Direct match
    if (jobSkills.includes(skillLower)) return 100;
    
    // Partial match
    const partialMatch = jobSkills.some(js => 
      js.includes(skillLower) || skillLower.includes(js)
    );
    if (partialMatch) return 80;
    
    // Related skills (simplified - could use embeddings for better matching)
    const relatedSkills = {
      'javascript': ['react', 'node', 'typescript', 'js'],
      'python': ['django', 'flask', 'pandas', 'numpy'],
      'management': ['leadership', 'team lead', 'project management'],
      // Add more mappings
    };
    
    for (const [key, related] of Object.entries(relatedSkills)) {
      if (jobSkills.includes(key) && related.includes(skillLower)) return 70;
    }
    
    return 50; // Default relevance
  }

  _processConcerns(concerns) {
    return (concerns || []).map(concern => ({
      type: concern.type || 'other',
      severity: concern.severity || 'medium',
      evidence: concern.evidence || '',
      timestamp: concern.timestamp || '',
      recommendation: concern.recommendation || 'Further evaluation needed'
    }));
  }

  _processStrengths(strengths) {
    return (strengths || []).map(strength => ({
      area: strength.area || '',
      evidence: strength.evidence || '',
      relevanceScore: Math.min(100, Math.max(0, strength.relevanceScore || 50)),
      timestamp: strength.timestamp || '',
      examples: strength.examples || []
    }));
  }

  _processCommunicationAnalysis(communication) {
    return {
      clarity: Math.min(100, Math.max(0, communication?.clarity || 50)),
      structure: Math.min(100, Math.max(0, communication?.structure || 50)),
      relevance: Math.min(100, Math.max(0, communication?.relevance || 50)),
      examples: Math.min(100, Math.max(0, communication?.examples || 50))
    };
  }

  _processRecommendations(recommendations, stageContext) {
    return {
      shouldProceed: recommendations?.shouldProceed || false,
      confidence: Math.min(100, Math.max(0, recommendations?.confidence || 50)),
      recommendation: recommendations?.recommendation || 'additional_assessment',
      suggestedFocusAreas: recommendations?.suggestedFocusAreas || [],
      suggestedInterviewers: recommendations?.suggestedInterviewers || [],
      suggestedQuestions: recommendations?.suggestedQuestions || [],
      reasoning: recommendations?.reasoning || 'Requires further evaluation'
    };
  }

  async _getStageContext(interview) {
    return {
      job: interview.jobId,
      stage: interview.stageId,
      totalStages: await Interview.countDocuments({ jobId: interview.jobId })
    };
  }

  _getDefaultAnalysis() {
    return {
      insights: {
        sentimentAnalysis: {
          candidateConfidence: 50,
          interviewerEngagement: 50,
          overallTone: 'neutral',
          emotionalJourney: []
        },
        keySkillsMentioned: [],
        concerns: [],
        strengths: [],
        communicationAnalysis: {
          clarity: 50,
          structure: 50,
          relevance: 50,
          examples: 50
        },
        recommendedNextSteps: {
          shouldProceed: false,
          confidence: 0,
          recommendation: 'additional_assessment',
          suggestedFocusAreas: [],
          suggestedInterviewers: [],
          suggestedQuestions: [],
          reasoning: 'Analysis failed - manual review required'
        }
      }
    };
  }

  async _generateAnalysisEmbeddings(interview, analysis) {
    try {
      // Generate embeddings for semantic search
      const embeddingText = `
        Interview for ${interview.jobId.title} - ${interview.stageId.name}
        Candidate: ${interview.candidateId.firstName} ${interview.candidateId.lastName}
        Key Skills: ${analysis.insights.keySkillsMentioned.map(s => s.skill).join(', ')}
        Strengths: ${analysis.insights.strengths.map(s => s.area).join(', ')}
        Recommendation: ${analysis.insights.recommendedNextSteps.recommendation}
      `;
      
      if (embeddingService.createInterviewEmbedding) {
        await embeddingService.createInterviewEmbedding(interview._id, embeddingText);
      }
    } catch (error) {
      console.error('⚠️ Error generating embeddings:', error);
    }
  }

  _aggregateInsights(interviews) {
    // Aggregate insights across multiple interviews
    const allInsights = interviews.map(i => i.aiAnalysis.insights);
    
    // Combine skills mentioned
    const allSkills = [];
    allInsights.forEach(insight => {
      if (insight.keySkillsMentioned) {
        allSkills.push(...insight.keySkillsMentioned);
      }
    });
    
    // Combine concerns
    const allConcerns = [];
    allInsights.forEach(insight => {
      if (insight.concerns) {
        allConcerns.push(...insight.concerns);
      }
    });
    
    // Combine strengths
    const allStrengths = [];
    allInsights.forEach(insight => {
      if (insight.strengths) {
        allStrengths.push(...insight.strengths);
      }
    });
    
    return {
      aggregatedSkills: this._aggregateSkills(allSkills),
      aggregatedConcerns: this._aggregateConcerns(allConcerns),
      aggregatedStrengths: this._aggregateStrengths(allStrengths),
      overallCommunication: this._aggregateCommunication(allInsights)
    };
  }

  _aggregateSkills(skills) {
    const skillMap = {};
    skills.forEach(skill => {
      if (!skillMap[skill.skill]) {
        skillMap[skill.skill] = {
          skill: skill.skill,
          mentions: 0,
          totalRelevance: 0,
          contexts: []
        };
      }
      skillMap[skill.skill].mentions++;
      skillMap[skill.skill].totalRelevance += skill.relevanceScore || 0;
      skillMap[skill.skill].contexts.push(skill.context);
    });
    
    return Object.values(skillMap).map(skill => ({
      ...skill,
      averageRelevance: skill.totalRelevance / skill.mentions
    })).sort((a, b) => b.mentions - a.mentions);
  }

  _aggregateConcerns(concerns) {
    const concernMap = {};
    concerns.forEach(concern => {
      if (!concernMap[concern.type]) {
        concernMap[concern.type] = {
          type: concern.type,
          count: 0,
          severities: [],
          evidences: []
        };
      }
      concernMap[concern.type].count++;
      concernMap[concern.type].severities.push(concern.severity);
      concernMap[concern.type].evidences.push(concern.evidence);
    });
    
    return Object.values(concernMap).sort((a, b) => b.count - a.count);
  }

  _aggregateStrengths(strengths) {
    const strengthMap = {};
    strengths.forEach(strength => {
      if (!strengthMap[strength.area]) {
        strengthMap[strength.area] = {
          area: strength.area,
          count: 0,
          totalRelevance: 0,
          evidences: []
        };
      }
      strengthMap[strength.area].count++;
      strengthMap[strength.area].totalRelevance += strength.relevanceScore || 0;
      strengthMap[strength.area].evidences.push(strength.evidence);
    });
    
    return Object.values(strengthMap).map(strength => ({
      ...strength,
      averageRelevance: strength.totalRelevance / strength.count
    })).sort((a, b) => b.count - a.count);
  }

  _aggregateCommunication(insights) {
    const communications = insights.map(i => i.communicationAnalysis).filter(c => c);
    
    if (communications.length === 0) {
      return {
        clarity: 50,
        structure: 50,
        relevance: 50,
        examples: 50
      };
    }
    
    return {
      clarity: communications.reduce((sum, c) => sum + (c.clarity || 0), 0) / communications.length,
      structure: communications.reduce((sum, c) => sum + (c.structure || 0), 0) / communications.length,
      relevance: communications.reduce((sum, c) => sum + (c.relevance || 0), 0) / communications.length,
      examples: communications.reduce((sum, c) => sum + (c.examples || 0), 0) / communications.length
    };
  }

  _determineOverallRecommendation(interviews) {
    const recommendations = interviews.map(i => i.aiAnalysis.insights.recommendedNextSteps.recommendation);
    
    if (recommendations.includes('advance')) return 'advance';
    if (recommendations.includes('reject')) return 'reject';
    if (recommendations.includes('additional_assessment')) return 'additional_assessment';
    
    return 'needs_review';
  }

  _getRecommendedActions(recommendations, nextStage) {
    const actions = [];
    
    switch (recommendations.recommendation) {
      case 'advance':
        if (nextStage) {
          actions.push({
            type: 'schedule_interview',
            description: `Schedule ${nextStage.name} interview`,
            priority: 'high'
          });
        } else {
          actions.push({
            type: 'make_offer',
            description: 'Consider making job offer',
            priority: 'high'
          });
        }
        break;
      case 'reject':
        actions.push({
          type: 'send_rejection',
          description: 'Send rejection email with feedback',
          priority: 'medium'
        });
        break;
      case 'additional_assessment':
        actions.push({
          type: 'schedule_followup',
          description: 'Schedule follow-up interview',
          priority: 'medium'
        });
        break;
    }
    
    return actions;
  }

  /**
   * Analyze multi-candidate interview session
   * @param {String} sessionId - Multi-candidate session ID
   * @returns {Object} Comparative analysis of all candidates
   */
  async analyzeMultiCandidateSession(sessionId) {
    try {
      console.log(`🤖 Starting multi-candidate session analysis for: ${sessionId}`);
      
      // Get all interviews in this session
      const interviews = await Interview.find({ 
        multiCandidateSessionId: sessionId 
      })
      .populate('candidateId')
      .populate('jobId')
      .sort({ multiCandidateOrder: 1 });

      if (!interviews || interviews.length === 0) {
        throw new Error('No interviews found for this session');
      }

      // Get the full transcript (usually stored in the first interview)
      const transcriptHolder = interviews.find(i => i.transcript?.content) || interviews[0];
      
      if (!transcriptHolder.transcript?.content) {
        throw new Error('No transcript available for analysis');
      }

      // Segment the transcript by candidates
      const segmentedData = await transcriptSegmentationService.segmentTranscriptBySession(
        sessionId,
        transcriptHolder.transcript.content
      );

      // Analyze each candidate's segment
      const candidateAnalyses = [];
      
      for (const interview of interviews) {
        const segment = segmentedData.segments[interview._id];
        
        if (!segment || !segment.transcript) {
          console.log(`⚠️ No transcript segment found for interview ${interview._id}`);
          continue;
        }

        // Perform individual analysis
        const analysis = await this._analyzeSegment(
          interview,
          segment,
          interview.jobId
        );
        
        candidateAnalyses.push({
          interviewId: interview._id,
          candidateId: interview.candidateId?._id,
          candidateName: interview.candidateId?.name,
          analysis,
          speakerStats: segment.speakerStats,
          duration: segment.duration,
          hasOverflow: segment.overflow?.length > 0
        });
      }

      // Perform comparative analysis
      const comparativeAnalysis = await this._compareCandidates(
        candidateAnalyses,
        interviews[0].jobId
      );

      // Update each interview with its analysis
      for (const candidateAnalysis of candidateAnalyses) {
        await Interview.findByIdAndUpdate(
          candidateAnalysis.interviewId,
          {
            'aiInterviewSummary': candidateAnalysis.analysis,
            'comparativeAnalysis': {
              comparedAt: new Date(),
              totalCandidatesCompared: candidateAnalyses.length,
              percentile: candidateAnalysis.analysis.percentile,
              rankings: comparativeAnalysis.rankings[candidateAnalysis.candidateId],
              strongerAreas: candidateAnalysis.analysis.strongerAreas,
              weakerAreas: candidateAnalysis.analysis.weakerAreas
            }
          }
        );
      }

      return {
        sessionId,
        totalCandidates: candidateAnalyses.length,
        analyses: candidateAnalyses,
        comparativeAnalysis,
        recommendations: this._generateSessionRecommendations(
          candidateAnalyses,
          comparativeAnalysis
        )
      };
    } catch (error) {
      console.error('Error analyzing multi-candidate session:', error);
      throw error;
    }
  }

  /**
   * Analyze individual candidate segment
   */
  async _analyzeSegment(interview, segment, job) {
    const prompt = `
      Analyze this interview transcript segment for ${segment.candidateName}.
      
      Job Role: ${job?.title || 'Unknown'}
      Interview Duration: ${segment.duration} seconds
      
      Transcript:
      ${JSON.stringify(segment.transcript.slice(0, 100))} // Limit for analysis
      
      Provide analysis including:
      1. Key strengths demonstrated
      2. Areas of concern
      3. Technical competency assessment
      4. Communication skills
      5. Cultural fit indicators
      6. Overall recommendation
      
      Format as JSON.
    `;

    const response = await this.azureOpenAIService.generateCompletion(prompt, {
      temperature: 0.3,
      maxTokens: 1500
    });

    const parsed = this.azureOpenAIService.extractJsonObject(response);
    return this._normalizeSegmentAnalysis(parsed);
  }

  _normalizeSegmentAnalysis(rawAnalysis) {
    const source = rawAnalysis?.analysis && typeof rawAnalysis.analysis === 'object'
      ? rawAnalysis.analysis
      : rawAnalysis || {};

    const pickArray = (...values) => {
      for (const value of values) {
        if (Array.isArray(value)) {
          return value
            .map((item) => {
              if (typeof item === 'string') return item;
              if (item && typeof item === 'object') {
                return item.strength || item.concern || item.text || item.description || JSON.stringify(item);
              }
              return String(item || '').trim();
            })
            .filter(Boolean);
        }
      }
      return [];
    };

    const toScore = (value) => {
      if (typeof value === 'number' && Number.isFinite(value)) {
        return Math.max(0, Math.min(100, value));
      }

      const text = String(value || '').toLowerCase();
      if (!text) return null;
      if (text.includes('excellent') || text.includes('outstanding') || text.includes('expert')) return 90;
      if (text.includes('strong') || text.includes('very good') || text.includes('advanced')) return 82;
      if (text.includes('good')) return 75;
      if (text.includes('intermediate') || text.includes('fair')) return 65;
      if (text.includes('neutral') || text.includes('average')) return 55;
      if (text.includes('weak') || text.includes('poor') || text.includes('limited')) return 40;
      return null;
    };

    const strengths = pickArray(
      source.strengths,
      source.key_strengths,
      source.keyStrengths,
      source.identifiedStrengths
    );

    const concerns = pickArray(
      source.concerns,
      source.areas_of_concern,
      source.areasOfConcern,
      source.identifiedConcerns
    );

    const technical = source.technicalCompetency || source.technical_competency || source.technical || {};
    const communication = source.communicationSkills || source.communication_skills || source.communication || {};
    const cultural = source.culturalFit || source.cultural_fit || source.culture || {};

    const technicalScore = toScore(technical.score ?? technical.assessment ?? technical.rating);
    const communicationScore = toScore(communication.score ?? communication.assessment ?? communication.rating);
    const culturalScore = toScore(cultural.score ?? cultural.assessment ?? cultural.rating);

    const explicitScore = toScore(
      source.overallScore ??
      source.overall_score ??
      source.score ??
      source.totalScore ??
      source.finalScore
    );

    const fallbackScores = [technicalScore, communicationScore, culturalScore].filter((value) => value !== null);
    const calculatedScore = fallbackScores.length > 0
      ? Math.round(fallbackScores.reduce((sum, value) => sum + value, 0) / fallbackScores.length)
      : 60;

    const overallScore = explicitScore ?? calculatedScore;

    const decisionText = String(
      source.recommendation ||
      source.overall_recommendation?.decision ||
      source.overallRecommendation?.decision ||
      source.finalRecommendation?.decision ||
      ''
    ).toLowerCase();

    let recommendation = 'additional_assessment';
    if (decisionText.includes('strong_yes') || decisionText.includes('yes') || decisionText.includes('advance') || decisionText.includes('proceed')) {
      recommendation = 'advance';
    } else if (decisionText.includes('strong_no') || decisionText.includes('no') || decisionText.includes('reject')) {
      recommendation = 'reject';
    } else if (decisionText.includes('maybe') || decisionText.includes('caution') || decisionText.includes('additional')) {
      recommendation = 'additional_assessment';
    }

    const rationale =
      source.rationale ||
      source.reasoning ||
      source.overall_recommendation?.rationale ||
      source.overallRecommendation?.reasoning ||
      '';

    return {
      strengths,
      concerns,
      technicalCompetency: technical,
      communicationSkills: communication,
      culturalFit: cultural,
      overallScore,
      recommendation,
      rationale,
      strongerAreas: strengths.slice(0, 3).map((item) => ({ area: item })),
      weakerAreas: concerns.slice(0, 3).map((item) => ({ area: item })),
      raw: rawAnalysis
    };
  }

  /**
   * Compare candidates within the same session
   */
  async _compareCandidates(candidateAnalyses, job) {
    const prompt = `
      Compare these ${candidateAnalyses.length} candidates interviewed for ${job?.title || 'the position'}:
      
      ${candidateAnalyses.map((ca, idx) => `
        Candidate ${idx + 1}: ${ca.candidateName}
        Strengths: ${ca.analysis.strengths?.join(', ')}
        Concerns: ${ca.analysis.concerns?.join(', ')}
        Overall Score: ${ca.analysis.overallScore}/100
      `).join('\n')}
      
      Provide:
      1. Ranking of candidates (1 = best)
      2. Key differentiators between candidates
      3. Hiring recommendations
      4. Which candidate(s) should proceed to next round
      
      Format as JSON with rankings, differentiators, and recommendations.
    `;

    const response = await this.azureOpenAIService.generateCompletion(prompt, {
      temperature: 0.2,
      maxTokens: 1000
    });

    const parsed = this.azureOpenAIService.extractJsonObject(response);
    return this._normalizeComparativeAnalysis(parsed, candidateAnalyses);
  }

  _normalizeComparativeAnalysis(rawComparative, candidateAnalyses) {
    const toArray = (value) => {
      if (Array.isArray(value)) return value;
      if (value === null || value === undefined || value === '') return [];
      return [value];
    };

    const normalized = {
      rankings: {},
      differentiators: toArray(rawComparative?.differentiators || rawComparative?.keyDifferentiators),
      recommendations: toArray(rawComparative?.recommendations || rawComparative?.hiringRecommendations),
      raw: rawComparative
    };

    const sortedByScore = [...candidateAnalyses].sort((a, b) => (b.analysis?.overallScore || 0) - (a.analysis?.overallScore || 0));
    sortedByScore.forEach((candidate, index) => {
      const candidateId = String(candidate.candidateId || candidate.interviewId || index);
      normalized.rankings[candidateId] = {
        overall: index + 1,
        score: candidate.analysis?.overallScore || 0,
        recommendation: candidate.analysis?.recommendation || 'additional_assessment'
      };
    });

    const findCandidateId = (value) => {
      const lowerValue = String(value || '').toLowerCase();
      if (!lowerValue) return null;

      const direct = candidateAnalyses.find((candidate) => String(candidate.candidateId || '').toLowerCase() === lowerValue);
      if (direct) return String(direct.candidateId);

      const byName = candidateAnalyses.find((candidate) => String(candidate.candidateName || '').toLowerCase() === lowerValue);
      if (byName) return String(byName.candidateId);

      return null;
    };

    const rawRankings = rawComparative?.rankings;
    if (Array.isArray(rawRankings)) {
      rawRankings.forEach((item) => {
        const candidateId = findCandidateId(item?.candidateId || item?.candidate || item?.name);
        if (!candidateId) return;

        normalized.rankings[candidateId] = {
          ...normalized.rankings[candidateId],
          overall: Number(item.rank || item.overall || normalized.rankings[candidateId].overall),
          score: Number(item.score ?? normalized.rankings[candidateId].score)
        };
      });
    } else if (rawRankings && typeof rawRankings === 'object') {
      Object.entries(rawRankings).forEach(([key, value]) => {
        const candidateId = findCandidateId(key) || findCandidateId(value?.candidateId || value?.candidate || value?.name);
        if (!candidateId) return;

        normalized.rankings[candidateId] = {
          ...normalized.rankings[candidateId],
          overall: Number(value?.overall || value?.rank || normalized.rankings[candidateId]?.overall || 1),
          score: Number(value?.score ?? normalized.rankings[candidateId]?.score ?? 0),
          recommendation: value?.recommendation || normalized.rankings[candidateId]?.recommendation || 'additional_assessment'
        };
      });
    }

    return normalized;
  }

  /**
   * Generate session-wide recommendations
   */
  _generateSessionRecommendations(candidateAnalyses, comparativeAnalysis) {
    const recommendations = [];
    
    // Find top candidates
    const topCandidates = [...candidateAnalyses]
      .sort((a, b) => (b.analysis.overallScore || 0) - (a.analysis.overallScore || 0))
      .slice(0, 2);
    
    if (topCandidates.length > 0) {
      recommendations.push({
        type: 'advance_candidates',
        candidates: topCandidates.map(c => ({
          id: c.candidateId,
          name: c.candidateName,
          score: c.analysis.overallScore
        })),
        priority: 'high',
        action: 'Move to next interview round'
      });
    }
    
    // Identify candidates needing additional assessment
    const needsAssessment = candidateAnalyses.filter(ca => 
      ca.analysis.recommendation === 'additional_assessment'
    );
    
    if (needsAssessment.length > 0) {
      recommendations.push({
        type: 'additional_assessment',
        candidates: needsAssessment.map(c => c.candidateName),
        priority: 'medium',
        action: 'Schedule technical assessment or additional interview'
      });
    }
    
    return recommendations;
  }
}

module.exports = new AIInterviewAnalysisService(); 
