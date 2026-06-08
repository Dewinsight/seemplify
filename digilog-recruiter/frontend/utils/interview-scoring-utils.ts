/**
 * Utility functions for standardized interview feedback score calculations
 */

/**
 * Types for feedback ratings
 */
export interface RatingBreakdown {
  overall?: number;
  technical?: number;
  communication?: number;
  cultural?: number;
}

export interface ScoreBreakdown {
  overall: number;
  technical: number;
  communication: number;
  cultural: number;
  questionSpecific: number;
  confidence: number;
}

export type RecommendationLevel = 
  'strong_yes' | 'strong_hire' | 
  'yes' | 'hire' | 
  'maybe' | 
  'no' | 'no_hire' | 
  'strong_no' | 'strong_no_hire';

export interface ScoringComponent {
  category: string;
  score: number;
  maxScore: number;
  available: boolean;
}

/**
 * Standardizes a rating from one scale to another
 * @param rating - The rating value to standardize
 * @param sourceScale - The original scale (default: 5)
 * @param targetScale - The target scale (default: 100)
 * @returns Standardized rating value or null if invalid input
 */
export const standardizeRating = (
  rating: number | undefined | null,
  sourceScale = 5,
  targetScale = 100
): number | null => {
  if (rating === undefined || rating === null) return null;
  return Math.round((rating / sourceScale) * targetScale);
};

/**
 * Calculates a valid average from array of values, handling nulls and undefined
 * @param values - Array of numeric values
 * @returns Average value or null if no valid values
 */
export const calculateValidAverage = (values: (number | undefined | null)[]): number | null => {
  const validValues = values.filter(v => v !== null && v !== undefined) as number[];
  if (validValues.length === 0) return null;
  return validValues.reduce((sum, val) => sum + val, 0) / validValues.length;
};

/**
 * Calculate statistical variance in ratings to determine consensus level
 * @param values - Array of rating values
 * @param mean - Pre-calculated mean (optional)
 * @returns Variance value or 0 if insufficient data
 */
export const calculateVariance = (
  values: (number | undefined | null)[],
  mean?: number
): number => {
  const validValues = values.filter(v => v !== null && v !== undefined) as number[];
  if (validValues.length <= 1) return 0;
  
  const avg = mean ?? validValues.reduce((sum, val) => sum + val, 0) / validValues.length;
  
  return validValues.reduce((variance, val) => 
    variance + Math.pow(val - avg, 2), 0) / validValues.length;
};

/**
 * Calculate confidence score based on amount and consistency of feedback
 * @param values - Array of rating values
 * @param assessorCount - Number of unique assessors
 * @returns Confidence score 0-100
 */
export const calculateConfidence = (
  values: (number | undefined | null)[],
  assessorCount: number
): number => {
  const validValues = values.filter(v => v !== null && v !== undefined) as number[];
  
  if (validValues.length === 0) return 0;
  
  // Base confidence on sample size (more assessors = higher confidence)
  // 1 assessor = 30%, 2 = 50%, 3 = 65%, 4 = 75%, 5+ = 80-95%
  const sampleConfidence = Math.min(95, 30 + (assessorCount - 1) * 20);
  
  // Calculate consistency bonus/penalty based on variance
  if (validValues.length > 1) {
    const mean = validValues.reduce((sum, val) => sum + val, 0) / validValues.length;
    const variance = calculateVariance(validValues, mean);
    
    // Low variance (high agreement) = bonus, high variance = penalty
    // Variance of 0 = +10%, variance of 1+ = -20%
    const consistencyAdjustment = variance < 0.25 ? 10 : 
                                  variance < 0.5 ? 5 :
                                  variance < 1.0 ? 0 :
                                  -20;
    
    const finalConfidence = Math.min(100, Math.max(10, sampleConfidence + consistencyAdjustment));
    return Math.round(finalConfidence);
  }
  
  // Single assessor - just return base confidence
  return Math.round(sampleConfidence);
};

/**
 * Calculate a normalized overall rating from a rating breakdown
 * @param rating - Rating breakdown object
 * @returns Normalized rating 0-5 or null if no valid ratings
 */
export const calculateOverallRating = (rating: RatingBreakdown): number | null => {
  const ratings = [
    rating.overall,
    rating.technical,
    rating.communication,
    rating.cultural
  ];
  
  return calculateValidAverage(ratings);
};

/**
 * Convert a percentage score to a standardized recommendation level
 * @param percentage - Score percentage (0-100)
 * @returns Recommendation level
 */
export const getRecommendationFromPercentage = (percentage: number): RecommendationLevel => {
  if (percentage >= 80) return 'strong_yes';
  if (percentage >= 65) return 'yes';
  if (percentage >= 50) return 'maybe';
  if (percentage >= 35) return 'no';
  return 'strong_no';
};

/**
 * Get recommendation from a 0-5 scale rating
 * @param rating - Rating value (0-5)
 * @returns Recommendation level
 */
export const getRecommendationFromRating = (rating: number): RecommendationLevel => {
  // Ensure the rating is within the expected scale (0-5)
  const validRating = Math.max(0, Math.min(5, rating));
  
  // Add logging to help debug
  console.log(`Converting rating ${rating} to recommendation`);
  
  // More granular and reliable mapping
  if (validRating >= 4.5) return 'strong_hire';
  if (validRating >= 4.0) return 'hire';
  if (validRating >= 3.0) return 'maybe';
  if (validRating >= 2.0) return 'no_hire';
  return 'strong_no_hire';
};

/**
 * Generate a human-readable recommendation string
 * @param recommendation - Recommendation level
 * @returns Human-readable recommendation string
 */
export const getRecommendationText = (recommendation: RecommendationLevel): string => {
  switch (recommendation) {
    case 'strong_yes':
    case 'strong_hire':
      return 'Strongly Recommended for Hire';
    case 'yes':
    case 'hire':
      return 'Recommended for Hire';
    case 'maybe':
      return 'Consider for Next Round';
    case 'no':
    case 'no_hire':
      return 'Requires Further Evaluation';
    case 'strong_no':
    case 'strong_no_hire':
      return 'Not Recommended';
    default:
      return 'Requires Further Evaluation';
  }
};

/**
 * Get CSS class for coloring based on score percentage
 * @param percentage - Score percentage (0-100)
 * @returns CSS class name for the score color
 */
export const getScoreColorClass = (percentage: number): string => {
  if (percentage >= 80) return 'text-green-600';
  if (percentage >= 65) return 'text-blue-600';
  if (percentage >= 50) return 'text-yellow-600';
  if (percentage >= 35) return 'text-orange-600';
  return 'text-red-600';
};

/**
 * Get progress bar color class based on rating
 * @param rating - Rating value (0-5)
 * @returns CSS class name for the progress bar color
 */
export const getProgressColorClass = (rating: number): string => {
  if (rating >= 4.5) return 'bg-green-500';
  if (rating >= 4.0) return 'bg-emerald-500';
  if (rating >= 3.5) return 'bg-yellow-500';
  if (rating >= 3.0) return 'bg-orange-500';
  return 'bg-red-500';
};

/**
 * Calculate AI-based score for transcript page
 * @param aiSummary - AI summary data with recommendation and confidence
 * @returns Score on 0-30 scale
 */
export const calculateAIScore = (aiSummary: any): number => {
  if (!aiSummary) return 0;
  
  let score = 0;
  const rec = aiSummary.recommendation;
  
  // Base score from recommendation (0-20)
  if (rec === 'strong_yes') score += 20;
  else if (rec === 'yes') score += 15;
  else if (rec === 'maybe') score += 10;
  else if (rec === 'no') score += 5;
  else if (rec === 'strong_no') score += 0;
  
  // Confidence adjustment (0-10)
  const confidence = aiSummary.confidence || 0;
  score += Math.round((confidence / 100) * 10);
  
  return Math.min(score, 30);
};

/**
 * Calculate team feedback score for transcript page
 * @param comments - Array of feedback comments
 * @returns Score on 0-40 scale
 */
export const calculateTeamScore = (comments: any[]): number => {
  if (!comments || comments.length === 0) return 0;
  
  const validRatings: number[] = [];
  
  comments.forEach(comment => {
    if (comment.rating) {
      const ratings = [
        comment.rating.overall,
        comment.rating.technical,
        comment.rating.communication,
        comment.rating.cultural
      ].filter(r => r !== undefined && r !== null) as number[];
      
      if (ratings.length > 0) {
        const avgRating = ratings.reduce((sum, r) => sum + r, 0) / ratings.length;
        validRatings.push(avgRating);
      }
    }
  });
  
  if (validRatings.length === 0) return 0;
  
  const avgScore = validRatings.reduce((sum, rating) => sum + rating, 0) / validRatings.length;
  return Math.round((avgScore / 5) * 40);
};

/**
 * Calculate team consensus score for transcript page
 * @param teamAnalysis - Team analysis data
 * @returns Score on 0-30 scale
 */
export const calculateConsensusScore = (teamAnalysis: any): number => {
  if (!teamAnalysis) return 0;
  
  let score = 0;
  
  // Consensus level (0-15)
  const consensus = teamAnalysis.consensus?.level;
  if (consensus === 'strong_consensus') score += 15;
  else if (consensus === 'consensus') score += 12;
  else if (consensus === 'mixed') score += 8;
  else if (consensus === 'no_consensus') score += 4;
  else if (consensus === 'polarized') score += 0;
  
  // Sentiment score (0-15)
  const sentiment = teamAnalysis.overallSentiment;
  if (sentiment === 'very_positive') score += 15;
  else if (sentiment === 'positive') score += 12;
  else if (sentiment === 'neutral') score += 8;
  else if (sentiment === 'negative') score += 4;
  else if (sentiment === 'very_negative') score += 0;
  
  return Math.min(score, 30);
};

/**
 * Calculate comprehensive feedback report for transcript page
 * @param transcript - Interview transcript data
 * @param aiSummary - AI summary data
 * @param teamAnalysis - Team analysis data
 * @param comments - Feedback comments array
 * @returns Comprehensive report object
 */
export const calculateComprehensiveReport = (
  transcript: any, 
  aiSummary: any, 
  teamAnalysis: any, 
  comments: any[] = []
) => {
  // Calculate scores based on available data
  let totalScore = 0;
  let maxPossibleScore = 0;
  let scoreComponents: ScoringComponent[] = [];

  // AI Insights Score (0-30 points)
  if (aiSummary?.generated) {
    const aiScore = calculateAIScore(aiSummary);
    totalScore += aiScore;
    maxPossibleScore += 30;
    scoreComponents.push({
      category: 'AI Analysis',
      score: aiScore,
      maxScore: 30,
      available: true
    });
  } else {
    maxPossibleScore += 30;
    scoreComponents.push({
      category: 'AI Analysis',
      score: 0,
      maxScore: 30,
      available: false
    });
  }

  // Team Comments Score (0-40 points)
  if (comments && comments.length > 0) {
    const teamScore = calculateTeamScore(comments);
    totalScore += teamScore;
    maxPossibleScore += 40;
    scoreComponents.push({
      category: 'Team Feedback',
      score: teamScore,
      maxScore: 40,
      available: true
    });
  } else {
    maxPossibleScore += 40;
    scoreComponents.push({
      category: 'Team Feedback',
      score: 0,
      maxScore: 40,
      available: false
    });
  }

  // Team Consensus Score (0-30 points)
  if (teamAnalysis?.analyzed) {
    const consensusScore = calculateConsensusScore(teamAnalysis);
    totalScore += consensusScore;
    maxPossibleScore += 30;
    scoreComponents.push({
      category: 'Team Consensus',
      score: consensusScore,
      maxScore: 30,
      available: true
    });
  } else {
    maxPossibleScore += 30;
    scoreComponents.push({
      category: 'Team Consensus',
      score: 0,
      maxScore: 30,
      available: false
    });
  }

  // Calculate final percentage
  const finalPercentage = maxPossibleScore > 0 
    ? Math.round((totalScore / maxPossibleScore) * 100) 
    : 0;

  // Determine recommendation
  const recommendation = getRecommendationFromPercentage(finalPercentage);
  const recommendationText = getRecommendationText(recommendation);

  return {
    finalScore: totalScore,
    maxScore: maxPossibleScore,
    percentage: finalPercentage,
    scoreComponents,
    recommendation,
    recommendationText,
    dataAvailability: {
      hasAIInsights: aiSummary?.generated || false,
      hasTeamComments: (comments && comments.length > 0) || false,
      hasTeamAnalysis: teamAnalysis?.analyzed || false
    },
    timestamp: new Date().toISOString()
  };
};
