import { apiRequest } from './apiConfig';

export interface AIAnalysisResult {
  _id: string;
  interviewId: string;
  analyzed: boolean;
  analyzedAt: string;
  modelVersion: string;
  insights: AIInsights;
  comparativeAnalysis: ComparativeAnalysis;
}

export interface AIInsights {
  sentimentAnalysis: SentimentAnalysis;
  keySkillsMentioned: SkillMention[];
  concerns: ConcernFlag[];
  strengths: StrengthArea[];
  communicationAnalysis: CommunicationAnalysis;
  recommendedNextSteps: NextStepRecommendation;
}

export interface SentimentAnalysis {
  candidateConfidence: number;
  interviewerEngagement: number;
  overallTone: 'very_positive' | 'positive' | 'neutral' | 'negative' | 'very_negative';
  emotionalJourney: EmotionalJourneyPoint[];
}

export interface EmotionalJourneyPoint {
  timestamp: string;
  sentiment: number;
  note: string;
}

export interface SkillMention {
  skill: string;
  frequency: number;
  context: string;
  relevanceScore: number;
  proficiencyIndicator: 'beginner' | 'intermediate' | 'advanced' | 'expert';
  evidence: string[];
}

export interface ConcernFlag {
  type: 'experience_gap' | 'skill_mismatch' | 'communication_issues' | 'culture_mismatch' | 'availability_concerns' | 'compensation_mismatch' | 'other';
  severity: 'low' | 'medium' | 'high' | 'critical';
  evidence: string;
  timestamp: string;
  recommendation: string;
}

export interface StrengthArea {
  area: string;
  evidence: string;
  relevanceScore: number;
  timestamp: string;
  examples: string[];
}

export interface CommunicationAnalysis {
  clarity: number;
  structure: number;
  relevance: number;
  examples: number;
  observations: string[];
}

export interface NextStepRecommendation {
  shouldProceed: boolean;
  confidence: number;
  recommendation: 'advance' | 'reject' | 'additional_assessment' | 'different_role';
  suggestedFocusAreas: string[];
  suggestedInterviewers: string[];
  suggestedQuestions: string[];
  reasoning: string;
}

export interface ComparativeAnalysis {
  comparedAt: string;
  totalCandidatesCompared: number;
  percentile: number;
  rankings: {
    overall: number;
    technical: number;
    behavioral: number;
    cultural: number;
  };
  strongerAreas: ComparisonArea[];
  weakerAreas: ComparisonArea[];
}

export interface ComparisonArea {
  area: string;
  percentile: number;
  description?: string;
  improvementSuggestion?: string;
}

export interface CandidateInsights {
  candidateId: string;
  totalInterviews: number;
  analyzedInterviews: number;
  overallScore: number;
  averageConfidence: number;
  topSkills: SkillSummary[];
  keyConcerns: ConcernSummary[];
  strengthsProgression: StrengthProgression[];
  stagePerformance: StagePerformance[];
  aiRecommendation: string;
  lastAnalyzed: string;
}

export interface SkillSummary {
  skill: string;
  averageRelevance: number;
  mentionCount: number;
  proficiencyTrend: string;
}

export interface ConcernSummary {
  type: string;
  frequency: number;
  averageSeverity: string;
  resolved: boolean;
}

export interface StrengthProgression {
  area: string;
  firstMention: string;
  latestScore: number;
  trend: 'improving' | 'stable' | 'declining';
}

export interface StagePerformance {
  stageName: string;
  stageType: string;
  score: number;
  confidence: number;
  passedStage: boolean;
  concerns: number;
  strengths: number;
}

export interface JobComparativeAnalysis {
  jobId: string;
  totalCandidates: number;
  analyzedCandidates: number;
  averageScore: number;
  topPerformers: TopPerformer[];
  skillDistribution: SkillDistribution[];
  concernsBreakdown: ConcernBreakdown[];
  stageAnalytics: StageAnalytics[];
  recommendations: JobRecommendation[];
}

export interface TopPerformer {
  candidateId: string;
  candidateName: string;
  overallScore: number;
  percentile: number;
  standoutStrengths: string[];
}

export interface SkillDistribution {
  skill: string;
  candidateCount: number;
  averageRelevance: number;
  proficiencyBreakdown: Record<string, number>;
}

export interface ConcernBreakdown {
  type: string;
  count: number;
  averageSeverity: string;
  resolution: number;
}

export interface StageAnalytics {
  stageId: string;
  stageName: string;
  averageScore: number;
  passRate: number;
  commonConcerns: string[];
  topSkills: string[];
}

export interface JobRecommendation {
  type: 'hiring' | 'process' | 'requirements';
  priority: 'high' | 'medium' | 'low';
  title: string;
  description: string;
  impact: string;
}

export interface BulkAnalysisResult {
  jobId: string;
  processedInterviews: number;
  successfulAnalyses: number;
  failedAnalyses: number;
  averageProcessingTime: number;
  results: AIAnalysisResult[];
  errors: AnalysisError[];
}

export interface AnalysisError {
  interviewId: string;
  error: string;
  timestamp: string;
}

class AIAnalysisService {
  /**
   * Analyze a single interview transcript
   */
  async analyzeInterview(interviewId: string): Promise<AIAnalysisResult> {
    const response = await apiRequest(`/ai-analysis/interviews/${interviewId}/analyze`, {
      method: 'POST'
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to analyze interview');
    }
    
    const result = await response.json();
    return result.analysis;
  }

  /**
   * Get AI insights for a candidate across all interviews
   */
  async getCandidateInsights(candidateId: string, jobId?: string): Promise<CandidateInsights> {
    const url = `/ai-analysis/candidates/${candidateId}/ai-insights${jobId ? `?jobId=${jobId}` : ''}`;
    const response = await apiRequest(url, {
      method: 'GET'
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to fetch candidate insights');
    }
    
    const result = await response.json();
    return result.insights;
  }

  /**
   * Get comparative analysis for a job
   */
  async getJobComparativeAnalysis(jobId: string, stageId?: string): Promise<JobComparativeAnalysis> {
    const url = `/ai-analysis/jobs/${jobId}/comparative-analysis${stageId ? `?stageId=${stageId}` : ''}`;
    const response = await apiRequest(url, {
      method: 'GET'
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to fetch comparative analysis');
    }
    
    const result = await response.json();
    return result.analysis;
  }

  /**
   * Get AI recommendations for next steps
   */
  async getNextStepRecommendations(interviewId: string): Promise<NextStepRecommendation> {
    const response = await apiRequest(`/ai-analysis/interviews/${interviewId}/recommendations`, {
      method: 'GET'
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to fetch recommendations');
    }
    
    const result = await response.json();
    return result.recommendations;
  }

  /**
   * Bulk analyze interviews for a job
   */
  async bulkAnalyzeInterviews(jobId: string, stageId?: string): Promise<BulkAnalysisResult> {
    const response = await apiRequest(`/ai-analysis/jobs/${jobId}/analyze-all`, {
      method: 'POST',
      body: JSON.stringify({ stageId })
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to start bulk analysis');
    }
    
    const result = await response.json();
    return result.results;
  }

  /**
   * Get analysis status for an interview
   */
  async getAnalysisStatus(interviewId: string): Promise<{ analyzed: boolean; analyzedAt?: string; modelVersion?: string }> {
    const response = await apiRequest(`/ai-analysis/interviews/${interviewId}/analysis-status`, {
      method: 'GET'
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to fetch analysis status');
    }
    
    const result = await response.json();
    return result.status;
  }

  /**
   * Get AI analysis summary for a job
   */
  async getJobAnalysisSummary(jobId: string): Promise<{
    totalInterviews: number;
    analyzedInterviews: number;
    averageConfidence: number;
    topSkills: SkillSummary[];
    commonConcerns: ConcernSummary[];
    recommendationDistribution: Record<string, number>;
  }> {
    const response = await apiRequest(`/ai-analysis/jobs/${jobId}/analysis-summary`, {
      method: 'GET'
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to fetch analysis summary');
    }
    
    const result = await response.json();
    return result.summary;
  }

  /**
   * Get detailed interview analysis
   */
  async getInterviewAnalysis(interviewId: string): Promise<AIAnalysisResult | null> {
    const response = await apiRequest(`/ai-analysis/interviews/${interviewId}/analysis`, {
      method: 'GET'
    });
    
    if (!response.ok) {
      const error = await response.json();
      if (error.message?.includes('not found') || error.message?.includes('not analyzed')) {
        return null;
      }
      throw new Error(error.message || 'Failed to fetch interview analysis');
    }
    
    const result = await response.json();
    return result.analysis;
  }

  /**
   * Retry failed analysis
   */
  async retryAnalysis(interviewId: string): Promise<AIAnalysisResult> {
    const response = await apiRequest(`/ai-analysis/interviews/${interviewId}/re-analyze`, {
      method: 'POST'
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to retry analysis');
    }
    
    const result = await response.json();
    return result.analysis;
  }

  /**
   * Get analysis confidence metrics
   */
  async getConfidenceMetrics(jobId: string): Promise<{
    averageConfidence: number;
    confidenceDistribution: Record<string, number>;
    lowConfidenceInterviews: Array<{
      interviewId: string;
      candidateName: string;
      confidence: number;
      reasons: string[];
    }>;
  }> {
    const response = await apiRequest(`/ai-analysis/jobs/${jobId}/confidence-metrics`, {
      method: 'GET'
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to fetch confidence metrics');
    }
    
    const result = await response.json();
    return result.metrics;
  }

  /**
   * Export analysis data
   */
  async exportAnalysisData(jobId: string, format: 'csv' | 'json' = 'csv'): Promise<Blob> {
    const response = await apiRequest(`/ai-analysis/jobs/${jobId}/export?format=${format}`, {
      method: 'GET'
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to export analysis data');
    }
    
    return response.blob();
  }

  /**
   * Get bias detection results
   */
  async getBiasDetection(jobId: string): Promise<{
    overallBiasScore: number;
    biasIndicators: Array<{
      type: string;
      severity: string;
      description: string;
      affectedInterviews: number;
      recommendation: string;
    }>;
    fairnessMetrics: Record<string, number>;
  }> {
    const response = await apiRequest(`/ai-analysis/jobs/${jobId}/bias-detection`, {
      method: 'GET'
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to fetch bias detection results');
    }
    
    const result = await response.json();
    return result.biasAnalysis;
  }

  /**
   * Get trend analysis
   */
  async getTrendAnalysis(jobId: string, timeframe: '7d' | '30d' | '90d' = '30d'): Promise<{
    scoreTrend: Array<{ date: string; averageScore: number; interviewCount: number }>;
    skillTrends: Array<{ skill: string; trend: 'rising' | 'stable' | 'declining'; change: number }>;
    concernTrends: Array<{ concern: string; trend: 'increasing' | 'stable' | 'decreasing'; change: number }>;
  }> {
    const response = await apiRequest(`/ai-analysis/jobs/${jobId}/trends?timeframe=${timeframe}`, {
      method: 'GET'
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to fetch trend analysis');
    }
    
    const result = await response.json();
    return result.trends;
  }

  /**
   * Utility methods
   */

  /**
   * Format sentiment analysis for display
   */
  formatSentimentAnalysis(sentiment: SentimentAnalysis): {
    confidenceLevel: string;
    engagementLevel: string;
    toneDescription: string;
    toneColor: string;
  } {
    const getLevel = (score: number) => {
      if (score >= 80) return 'Very High';
      if (score >= 60) return 'High';
      if (score >= 40) return 'Medium';
      if (score >= 20) return 'Low';
      return 'Very Low';
    };

    const getToneDetails = (tone: string) => {
      const toneMap = {
        'very_positive': { description: 'Very Positive', color: 'text-green-600' },
        'positive': { description: 'Positive', color: 'text-green-500' },
        'neutral': { description: 'Neutral', color: 'text-gray-500' },
        'negative': { description: 'Negative', color: 'text-red-500' },
        'very_negative': { description: 'Very Negative', color: 'text-red-600' }
      };
      return toneMap[tone as keyof typeof toneMap] || { description: 'Unknown', color: 'text-gray-500' };
    };

    const toneDetails = getToneDetails(sentiment.overallTone);

    return {
      confidenceLevel: getLevel(sentiment.candidateConfidence),
      engagementLevel: getLevel(sentiment.interviewerEngagement),
      toneDescription: toneDetails.description,
      toneColor: toneDetails.color
    };
  }

  /**
   * Get recommendation color and icon
   */
  getRecommendationDisplay(recommendation: string): {
    color: string;
    bgColor: string;
    icon: string;
    label: string;
  } {
    const recommendationMap = {
      'advance': {
        color: 'text-green-600',
        bgColor: 'bg-green-50',
        icon: '✓',
        label: 'Advance'
      },
      'reject': {
        color: 'text-red-600',
        bgColor: 'bg-red-50',
        icon: '✗',
        label: 'Reject'
      },
      'additional_assessment': {
        color: 'text-yellow-600',
        bgColor: 'bg-yellow-50',
        icon: '?',
        label: 'Additional Assessment'
      },
      'different_role': {
        color: 'text-blue-600',
        bgColor: 'bg-blue-50',
        icon: '→',
        label: 'Different Role'
      }
    };

    return recommendationMap[recommendation as keyof typeof recommendationMap] || {
      color: 'text-gray-600',
      bgColor: 'bg-gray-50',
      icon: '•',
      label: 'Unknown'
    };
  }

  /**
   * Get concern severity display
   */
  getConcernSeverityDisplay(severity: string): {
    color: string;
    bgColor: string;
    label: string;
  } {
    const severityMap = {
      'low': { color: 'text-yellow-600', bgColor: 'bg-yellow-50', label: 'Low' },
      'medium': { color: 'text-orange-600', bgColor: 'bg-orange-50', label: 'Medium' },
      'high': { color: 'text-red-600', bgColor: 'bg-red-50', label: 'High' },
      'critical': { color: 'text-red-700', bgColor: 'bg-red-100', label: 'Critical' }
    };

    return severityMap[severity as keyof typeof severityMap] || {
      color: 'text-gray-600',
      bgColor: 'bg-gray-50',
      label: 'Unknown'
    };
  }

  /**
   * Calculate overall candidate score
   */
  calculateOverallScore(insights: AIInsights): number {
    const communication = (
      insights.communicationAnalysis.clarity +
      insights.communicationAnalysis.structure +
      insights.communicationAnalysis.relevance +
      insights.communicationAnalysis.examples
    ) / 4;

    const skillsScore = insights.keySkillsMentioned.length > 0
      ? insights.keySkillsMentioned.reduce((sum, skill) => sum + skill.relevanceScore, 0) / insights.keySkillsMentioned.length
      : 50;

    const concernsPenalty = insights.concerns.reduce((penalty, concern) => {
      const severityPenalty = {
        'low': 2,
        'medium': 5,
        'high': 10,
        'critical': 20
      };
      return penalty + (severityPenalty[concern.severity] || 0);
    }, 0);

    const confidenceScore = insights.sentimentAnalysis.candidateConfidence;

    const baseScore = (communication * 0.3 + skillsScore * 0.4 + confidenceScore * 0.3);
    const finalScore = Math.max(0, Math.min(100, baseScore - concernsPenalty));

    return Math.round(finalScore);
  }

  /**
   * Generate insights summary
   */
  generateInsightsSummary(insights: AIInsights): {
    overallAssessment: string;
    keyHighlights: string[];
    mainConcerns: string[];
    recommendation: string;
  } {
    const score = this.calculateOverallScore(insights);
    const recommendation = this.getRecommendationDisplay(insights.recommendedNextSteps.recommendation);

    let overallAssessment = '';
    if (score >= 80) {
      overallAssessment = 'Excellent candidate with strong performance across multiple areas';
    } else if (score >= 60) {
      overallAssessment = 'Good candidate with solid performance and potential';
    } else if (score >= 40) {
      overallAssessment = 'Mixed performance with both strengths and areas for improvement';
    } else {
      overallAssessment = 'Below expectations with significant concerns identified';
    }

    const keyHighlights = insights.strengths
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, 3)
      .map(strength => strength.area);

    const mainConcerns = insights.concerns
      .filter(concern => concern.severity === 'high' || concern.severity === 'critical')
      .slice(0, 3)
      .map(concern => concern.type.replace('_', ' '));

    return {
      overallAssessment,
      keyHighlights,
      mainConcerns,
      recommendation: recommendation.label
    };
  }
}

export default new AIAnalysisService(); 