"use client";

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './card';
import { Badge } from './badge';
import { Button } from './button';
import { Alert, AlertDescription } from './alert';
import { Avatar, AvatarFallback } from './avatar';
import { Progress } from './progress';
import { Separator } from './separator';
import { 
  MessageSquare, 
  User, 
  Globe,
  Star,
  RefreshCw,
  ExternalLink,
  Calendar,
  Clock,
  Mail,
  Loader2,
  TrendingUp,
  BarChart3,
  Target,
  Award,
  Users,
  CheckCircle,
  AlertCircle,
  ThumbsUp,
  Brain,
  Zap,
  PieChart,
  Activity,
  Sparkles,
  FileDown
} from 'lucide-react';
import { toast } from 'sonner';
import { apiRequest } from '@/services/apiConfig';
import { 
  calculateValidAverage,
  calculateOverallRating,
  getRecommendationFromRating,
  getProgressColorClass,
  RecommendationLevel,
  ScoreBreakdown
} from '@/utils/interview-scoring-utils';
import pdfService, { PDFReportData } from '@/services/pdfService';

interface Question {
  _id: string;
  question: string;
  type: string;
  category?: string;
  difficulty?: string;
}

interface FeedbackItem {
  _id: string;
  questionId?: {
    _id: string;
    question: string;
    type: string;
  } | string | null;
  authorName: string;
  authorRole: string;
  content: string;
  rating?: {
    overall?: number;
    technical?: number;
    communication?: number;
    cultural?: number;
  };
  publicFeedback?: {
    email: string;
    name: string;
    isVerified: boolean;
  };
  stageId?: string;
  stageName?: string;
  stageOrder?: number;
  createdAt: string;
}


interface AnalyticsData {
  totalAssessors: number;
  totalFeedback: number;
  averageScore: number;
  scoreBreakdown: ScoreBreakdown;
  recommendation: 'strong_hire' | 'hire' | 'maybe' | 'no_hire' | 'strong_no_hire';
  strengths: string[];
  concerns: string[];
  topPerformingQuestions: Array<{ questionId: string; question: string; score: number }>;
  assessorConsensus: number; // 0-100% agreement
}

interface ComprehensiveAnalyticsData {
  totalScore: number;
  normalizedScore: number;
  totalAssessors: number;
  totalRatingSources: number;
  breakdown: {
    systemFields: Record<string, { average: number; weight: number; contribution: number }>;
    customFields: Record<string, { average: number; weight: number; contribution: number }>;
    questions: Record<string, { average: number; weight: number; contribution: number }>;
    calculatedFields: Record<string, { value: number; formula: string }>;
  };
  weights: { perSource: number };
  recommendation: string;
  assessorConsensus: number;
}

interface InterviewFeedbackProps {
  interviewId: string;
}

export function InterviewFeedbackSimple({ interviewId }: InterviewFeedbackProps) {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [feedback, setFeedback] = useState<FeedbackItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [candidateInfo, setCandidateInfo] = useState<any>(null);
  const [interviewInfo, setInterviewInfo] = useState<any>(null);
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);
  const [comprehensiveAnalytics, setComprehensiveAnalytics] = useState<ComprehensiveAnalyticsData | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);


  useEffect(() => {
    loadData();
  }, [interviewId]);

  // Auto-save analytics when feedback changes (disabled to prevent hooks issue)
  // Will implement manual save button instead
  // useEffect(() => {
  //   if (feedback.length > 0) {
  //     const analytics = calculateAnalytics();
  //     saveAnalyticsScore(analytics);
  //   }
  // }, [feedback.length]);

  const loadData = async () => {
    try {
      setLoading(true);
      await Promise.all([
        fetchQuestions(),
        fetchFeedback()
      ]);
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchQuestions = async () => {
    try {
      const response = await apiRequest(`/api/interviews/${interviewId}/feedback/questions`);
      if (!response.ok) throw new Error('Failed to fetch questions');
      
      const data = await response.json();
      setQuestions(data.questions || []);
      setCandidateInfo(data.candidateInfo);
      setInterviewInfo(data.interviewInfo || null);
    } catch (error) {
      console.error('Error fetching questions:', error);
      toast.error('Failed to load questions');
    }
  };

  const fetchFeedback = async () => {
    try {
      const token = localStorage.getItem('jwt');
      const response = await apiRequest(`/api/interviews/${interviewId}/comments`, {
        method: 'GET'
      });
      
      if (!response.ok) throw new Error('Failed to fetch feedback');
      
      const data = await response.json();
      // Filter only feedback comments
      const feedbackComments = (data.comments || []).filter((c: any) => c.commentType === 'feedback');
      setFeedback(feedbackComments);
      
      // Fetch comprehensive analytics after feedback is loaded
      if (feedbackComments.length > 0) {
        fetchComprehensiveAnalytics();
      }
    } catch (error) {
      console.error('Error fetching feedback:', error);
      toast.error('Failed to load feedback');
    }
  };

  const fetchComprehensiveAnalytics = async () => {
    try {
      setAnalyticsLoading(true);
      const response = await apiRequest(`/api/interviews/${interviewId}/comprehensive-analytics`);
      
      if (!response.ok) {
        throw new Error('Failed to fetch comprehensive analytics');
      }
      
      const data = await response.json();
      setComprehensiveAnalytics(data);
      console.log('📊 Comprehensive analytics loaded:', data);
    } catch (error) {
      console.error('Error fetching comprehensive analytics:', error);
      // Don't show error toast - fall back to local calculation if API fails
      setComprehensiveAnalytics(null);
    } finally {
      setAnalyticsLoading(false);
    }
  };

  const getPublicFeedbackUrl = () => {
    const baseUrl = window.location.origin;
    return `${baseUrl}/public/feedback/${interviewId}`;
  };

  // Generate PDF report
  const handleGeneratePDF = async () => {
    try {
      setIsGeneratingPDF(true);
      const userFeedback = groupFeedbackByUser();
      const analytics = calculateAnalytics();

      // Prepare assessor feedback data
      const assessorFeedback = Object.keys(userFeedback).map((userKey) => {
        const userData = userFeedback[userKey];
        const userRatings: number[] = [];
        
        [...userData.general, ...Object.values(userData.questions).flat()].forEach(item => {
          if (item.rating?.overall) userRatings.push(item.rating.overall);
        });
        
        const avgScore = userRatings.length > 0 
          ? userRatings.reduce((a, b) => a + b, 0) / userRatings.length 
          : 0;

        return {
          assessorName: userData.user.name,
          assessorRole: userData.user.role,
          assessorEmail: userData.user.email,
          avgScore,
          generalFeedback: userData.general.map(item => ({
            content: item.content,
            rating: item.rating,
            stageName: item.stageName,
            stageOrder: item.stageOrder,
            createdAt: item.createdAt
          })),
          questionFeedback: Object.keys(userData.questions).flatMap((questionId) => {
            const question = getQuestionById(questionId);
            return userData.questions[questionId].map(item => ({
              question: question?.question || 'Unknown Question',
              questionType: question?.type || 'general',
              content: item.content,
              rating: item.rating,
              stageName: item.stageName,
              stageOrder: item.stageOrder,
              createdAt: item.createdAt
            }));
          })
        };
      });

      const pdfData: PDFReportData = {
        candidateName: candidateInfo?.name || 'Unknown Candidate',
        candidateEmail: candidateInfo?.email,
        interviewTitle: interviewInfo?.title || 'Interview',
        interviewDate: interviewInfo?.scheduledAt || new Date().toISOString(),
        jobTitle: interviewInfo?.jobTitle,
        stageName: interviewInfo?.stageName,
        stageOrder: interviewInfo?.stageOrder,
        overallScore: analytics.averageScore,
        scoreBreakdown: analytics.scoreBreakdown,
        recommendation: analytics.recommendation,
        totalAssessors: analytics.totalAssessors,
        totalFeedback: analytics.totalFeedback,
        assessorFeedback,
        topPerformingQuestions: analytics.topPerformingQuestions
      };

      await pdfService.generateFeedbackReport(pdfData);
      toast.success('PDF report generated successfully!');
    } catch (error) {
      console.error('Error generating PDF:', error);
      toast.error('Failed to generate PDF report');
    } finally {
      setIsGeneratingPDF(false);
    }
  };

  // Group feedback by user/assessor
  const groupFeedbackByUser = () => {
    const grouped: { [key: string]: { 
      user: { name: string; email?: string; role: string };
      general: FeedbackItem[];
      questions: { [questionId: string]: FeedbackItem[] };
    } } = {};

    feedback.forEach(item => {
      // Create unique key for each assessor
      const userKey = item.publicFeedback?.email || item.authorName || 'unknown';
      
      if (!grouped[userKey]) {
        grouped[userKey] = {
          user: {
            name: item.authorName,
            email: item.publicFeedback?.email,
            role: item.authorRole
          },
          general: [],
          questions: {}
        };
      }

      if (!item.questionId) {
        // General feedback
        grouped[userKey].general.push(item);
      } else {
        // Question-specific feedback
        const questionId = typeof item.questionId === 'string' 
          ? item.questionId 
          : item.questionId._id;
          
        if (!grouped[userKey].questions[questionId]) {
          grouped[userKey].questions[questionId] = [];
        }
        grouped[userKey].questions[questionId].push(item);
      }
    });

    return grouped;
  };

  const getQuestionById = (questionId: string) => {
    return questions.find(q => q._id === questionId);
  };

  // Calculate comprehensive analytics using our shared utilities
  const calculateAnalytics = (): AnalyticsData => {
    const userFeedback = groupFeedbackByUser();
    const userKeys = Object.keys(userFeedback);
    
    if (userKeys.length === 0) {
      return {
        totalAssessors: 0,
        totalFeedback: 0,
        averageScore: 0,
        scoreBreakdown: { overall: 0, technical: 0, communication: 0, cultural: 0, questionSpecific: 0, confidence: 0 },
        recommendation: 'maybe',
        strengths: [],
        concerns: [],
        topPerformingQuestions: [],
        assessorConsensus: 0
      };
    }

    // Arrays to store all ratings by category
    const ratings = {
      overall: [] as number[],
      technical: [] as number[],
      communication: [] as number[],
      cultural: [] as number[]
    };
    let allScores: number[] = [];
    let questionScores: { [key: string]: number[] } = {};

    // Collect all ratings
    feedback.forEach(item => {
      if (item.rating) {
        ['overall', 'technical', 'communication', 'cultural'].forEach(key => {
          const rating = item.rating?.[key as keyof typeof item.rating];
          if (rating !== undefined && rating !== null) {
            ratings[key as keyof typeof ratings].push(rating);
            allScores.push(rating);
            
            // Track question-specific scores
            if (item.questionId) {
              const questionId = typeof item.questionId === 'string' ? item.questionId : item.questionId._id;
              if (!questionScores[questionId]) questionScores[questionId] = [];
              questionScores[questionId].push(rating);
            }
          }
        });
      }
    });

    // Calculate averages using our utility function
    const scoreBreakdown: ScoreBreakdown = {
      overall: calculateValidAverage(ratings.overall) || 0,
      technical: calculateValidAverage(ratings.technical) || 0,
      communication: calculateValidAverage(ratings.communication) || 0,
      cultural: calculateValidAverage(ratings.cultural) || 0,
      questionSpecific: 0,
      confidence: 0 // Removed confidence calculation
    };

    // Calculate question-specific average using our utility
    const questionAverages = Object.values(questionScores).map(scores => 
      calculateValidAverage(scores) || 0
    );
    
    const questionAverage = questionAverages.length > 0
      ? calculateValidAverage(questionAverages) || 0
      : 0;
    
    scoreBreakdown.questionSpecific = questionAverage;

    // The overall rating is already the average across the board from assessors
    // This is our base final score
    let averageScore = scoreBreakdown.overall;
    
    // If we have question-specific ratings, include them in the final score
    // Use weighted average: 70% overall rating + 30% question-specific ratings
    if (questionAverage > 0 && scoreBreakdown.overall > 0) {
      averageScore = (scoreBreakdown.overall * 0.7) + (questionAverage * 0.3);
    } else if (questionAverage > 0 && scoreBreakdown.overall === 0) {
      // If we only have question ratings, use those
      averageScore = questionAverage;
    }
    
    // Round to 2 decimal places
    averageScore = Math.round(averageScore * 100) / 100;

    // Determine recommendation using our utility
    const recommendation = getRecommendationFromRating(averageScore) as AnalyticsData['recommendation'];

    // Top performing questions
    const topPerformingQuestions = Object.entries(questionScores)
      .map(([questionId, scores]) => ({
        questionId,
        question: getQuestionById(questionId)?.question || 'Unknown Question',
        score: calculateValidAverage(scores) || 0
      }))
      .filter(q => q.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    return {
      totalAssessors: userKeys.length,
      totalFeedback: feedback.length,
      averageScore,
      scoreBreakdown,
      recommendation,
      strengths: [], // Could analyze feedback content for keywords
      concerns: [], // Could analyze feedback content for keywords
      topPerformingQuestions,
      assessorConsensus: 0 // Removed consensus calculation
    };
  };

  // Save analytics score to backend
  const saveAnalyticsScore = async (analytics: AnalyticsData) => {
    try {
      const token = localStorage.getItem('jwt');
      await apiRequest(`/api/interviews/${interviewId}/analytics-score`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          averageScore: analytics.averageScore,
          scoreBreakdown: analytics.scoreBreakdown,
          recommendation: analytics.recommendation,
          totalAssessors: analytics.totalAssessors,
          assessorConsensus: analytics.assessorConsensus,
          calculatedAt: new Date().toISOString()
        })
      });
      toast.success('Analytics score saved successfully!');
    } catch (error) {
      console.error('Error saving analytics score:', error);
      toast.error('Failed to save analytics score');
    }
  };

  const formatRating = (rating?: number) => {
    if (!rating) return null;
    return (
      <div className="flex items-center gap-1">
        <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
        <span className="font-medium">{rating}/5</span>
      </div>
    );
  };

  const renderFeedbackItem = (item: FeedbackItem) => (
    <div key={item._id} className="bg-background border rounded-lg p-4 space-y-3">
      <div className="flex items-start justify-between">
        <div className="text-sm text-muted-foreground flex items-center gap-2 flex-wrap">
          <Calendar className="h-3 w-3" />
          {new Date(item.createdAt).toLocaleDateString()}
          <Clock className="h-3 w-3" />
          {new Date(item.createdAt).toLocaleTimeString()}
          {item.stageName && (
            <>
              <span className="text-muted-foreground">•</span>
              <Badge variant="secondary" className="text-[10px] h-5 px-1.5">
                {item.stageOrder && `R${item.stageOrder}: `}{item.stageName}
              </Badge>
            </>
          )}
        </div>
        
        {item.rating?.overall && (
          <div className="text-right">
            {formatRating(item.rating.overall)}
          </div>
        )}
      </div>
      
      <div className="text-sm leading-relaxed">
        {item.content}
      </div>
      
      {item.rating && Object.keys(item.rating).length > 1 && (
        <div className="flex gap-4 text-sm">
          {item.rating.technical && (
            <div className="flex items-center gap-1">
              <span className="text-muted-foreground">Technical:</span>
              {formatRating(item.rating.technical)}
            </div>
          )}
          {item.rating.communication && (
            <div className="flex items-center gap-1">
              <span className="text-muted-foreground">Communication:</span>
              {formatRating(item.rating.communication)}
            </div>
          )}
          {item.rating.cultural && (
            <div className="flex items-center gap-1">
              <span className="text-muted-foreground">Cultural:</span>
              {formatRating(item.rating.cultural)}
            </div>
          )}
        </div>
      )}
    </div>
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin mr-2" />
        Loading feedback...
      </div>
    );
  }

  const userFeedback = groupFeedbackByUser();
  const userKeys = Object.keys(userFeedback);
  const analytics = calculateAnalytics();


  const getRecommendationColor = (rec: string) => {
    switch (rec) {
      case 'strong_hire': return 'text-green-600 bg-green-50 border-green-200';
      case 'hire': return 'text-emerald-600 bg-emerald-50 border-emerald-200';
      case 'maybe': return 'text-yellow-600 bg-yellow-50 border-yellow-200';
      case 'no_hire': return 'text-red-600 bg-red-50 border-red-200';
      case 'strong_no_hire': return 'text-red-700 bg-red-100 border-red-300';
      default: return 'text-gray-600 bg-gray-50 border-gray-200';
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 4.5) return 'text-green-600';
    if (score >= 4.0) return 'text-emerald-600';
    if (score >= 3.5) return 'text-yellow-600';
    if (score >= 3.0) return 'text-orange-600';
    return 'text-red-600';
  };

  // Use the imported getProgressColorClass

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-gradient-to-r from-blue-500 to-purple-600 rounded-lg">
              <BarChart3 className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Interview Analytics</h1>
              {candidateInfo && (
                <p className="text-muted-foreground">
                  Comprehensive assessment for {candidateInfo.name}
                </p>
              )}
              {interviewInfo?.stageName && (
                <div className="flex items-center gap-2 mt-1">
                  <Badge variant="outline" className="text-xs font-medium bg-indigo-50 text-indigo-700 border-indigo-200">
                    {interviewInfo.stageOrder && `Round ${interviewInfo.stageOrder}: `}
                    {interviewInfo.stageName}
                  </Badge>
                  {interviewInfo.scheduledAt && (
                    <span className="text-xs text-muted-foreground">
                      • {new Date(interviewInfo.scheduledAt).toLocaleDateString('en-US', { 
                        month: 'short', 
                        day: 'numeric', 
                        year: 'numeric' 
                      })}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={loadData}
            className="hover:bg-blue-50"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          {analytics.totalFeedback > 0 && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => saveAnalyticsScore(analytics)}
                className="hover:bg-green-50 border-green-200 text-green-700"
              >
                <Sparkles className="h-4 w-4 mr-2" />
                Save Analytics
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleGeneratePDF}
                disabled={isGeneratingPDF}
                className="hover:bg-indigo-50 border-indigo-200 text-indigo-700"
              >
                {isGeneratingPDF ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <FileDown className="h-4 w-4 mr-2" />
                    Download PDF
                  </>
                )}
              </Button>
            </>
          )}
          <Button
            size="sm"
            onClick={() => window.open(getPublicFeedbackUrl(), '_blank')}
            className="bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700"
          >
            <ExternalLink className="h-4 w-4 mr-2" />
            Submit Feedback
          </Button>
        </div>
      </div>

      {/* Analytics Dashboard */}
      {analytics.totalFeedback > 0 && (
        <>
          {/* Key Metrics Overview */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Overall Score */}
            <Card className="bg-gradient-to-br from-blue-50 to-indigo-50 border-blue-200">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-blue-600 mb-1">Overall Score</p>
                    <p className={`text-3xl font-bold ${getScoreColor(analytics.averageScore)}`}>
                      {analytics.averageScore.toFixed(1)}
                    </p>
                    <p className="text-xs text-muted-foreground">out of 5.0</p>
                    {analytics.scoreBreakdown.questionSpecific > 0 && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Overall: {analytics.scoreBreakdown.overall.toFixed(1)} • 
                        Questions: {analytics.scoreBreakdown.questionSpecific.toFixed(1)}
                      </p>
                    )}
                  </div>
                  <div className="p-3 bg-blue-100 rounded-full">
                    <Target className="h-6 w-6 text-blue-600" />
                  </div>
                </div>
                <Progress 
                  value={(analytics.averageScore / 5) * 100} 
                  className={`mt-3 ${getProgressColorClass(analytics.averageScore)}`}
                />
              </CardContent>
            </Card>

            {/* Recommendation */}
            <Card className={`border-2 ${getRecommendationColor(analytics.recommendation)}`}>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium mb-1">Recommendation</p>
                    <p className="text-lg font-bold capitalize">
                      {analytics.recommendation.replace('_', ' ')}
                    </p>
                  </div>
                  <div className="p-3 rounded-full opacity-75">
                    {analytics.recommendation.includes('hire') ? 
                      <ThumbsUp className="h-6 w-6" /> : 
                      <AlertCircle className="h-6 w-6" />
                    }
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Assessors */}
            <Card className="bg-gradient-to-br from-emerald-50 to-green-50 border-emerald-200">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-emerald-600 mb-1">Assessors</p>
                    <p className="text-3xl font-bold text-emerald-700">{analytics.totalAssessors}</p>
                    <p className="text-xs text-muted-foreground">{analytics.totalFeedback} responses</p>
                  </div>
                  <div className="p-3 bg-emerald-100 rounded-full">
                    <Users className="h-6 w-6 text-emerald-600" />
                  </div>
                </div>
              </CardContent>
            </Card>

          </div>

          {/* Detailed Score Breakdown */}
          {comprehensiveAnalytics ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <PieChart className="h-5 w-5" />
                  Comprehensive Score Analysis
                </CardTitle>
                <CardDescription>
                  Dynamic scoring across all configured rating fields ({comprehensiveAnalytics.totalRatingSources} sources)
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-6">
                  {/* System Fields */}
                  {comprehensiveAnalytics.breakdown.systemFields && Object.keys(comprehensiveAnalytics.breakdown.systemFields).length > 0 && (
                    <div>
                      <h3 className="font-semibold text-sm text-muted-foreground mb-3 flex items-center gap-2">
                        <Target className="h-4 w-4" />
                        System Ratings
                      </h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                        {Object.entries(comprehensiveAnalytics.breakdown.systemFields).map(([label, data]) => (
                          <div key={label} className="bg-muted/30 rounded-lg p-4 space-y-2">
                            <p className="text-xs font-medium text-muted-foreground uppercase">{label}</p>
                            <p className={`text-2xl font-bold ${getScoreColor(data.average)}`}>
                              {data.average.toFixed(2)}
                            </p>
                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                              <span>Weight: {(data.weight * 100).toFixed(0)}%</span>
                              <span className="font-medium">+{data.contribution.toFixed(2)}</span>
                            </div>
                            <Progress value={(data.average / 5) * 100} className="h-2" />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Custom Fields */}
                  {comprehensiveAnalytics.breakdown.customFields && Object.keys(comprehensiveAnalytics.breakdown.customFields).length > 0 && (
                    <div>
                      <h3 className="font-semibold text-sm text-muted-foreground mb-3 flex items-center gap-2">
                        <Sparkles className="h-4 w-4" />
                        Custom Criteria
                      </h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                        {Object.entries(comprehensiveAnalytics.breakdown.customFields).map(([label, data]: [string, any]) => {
                          const hasResponses = data.hasResponses !== false; // Backward compatible - assume true if not specified
                          return (
                            <div key={label} className={`rounded-lg p-4 space-y-2 border ${
                              hasResponses
                                ? 'bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800'
                                : 'bg-slate-50 dark:bg-slate-900/50 border-slate-200 dark:border-slate-700'
                            }`}>
                              <p className={`text-xs font-medium uppercase ${
                                hasResponses ? 'text-purple-600 dark:text-purple-400' : 'text-slate-500 dark:text-slate-400'
                              }`}>
                                {label}
                              </p>
                              <div className="flex items-baseline gap-2">
                                <p className={`text-2xl font-bold ${
                                  hasResponses ? getScoreColor(data.average) : 'text-slate-400 dark:text-slate-500'
                                }`}>
                                  {data.average.toFixed(2)}
                                </p>
                                {!hasResponses && (
                                  <span className="text-xs text-slate-500 dark:text-slate-400">No responses yet</span>
                                )}
                              </div>
                              <div className="flex items-center justify-between text-xs text-muted-foreground">
                                <span>Weight: {(data.weight * 100).toFixed(0)}%</span>
                                <span className="font-medium">+{data.contribution.toFixed(2)}</span>
                              </div>
                              <Progress value={(data.average / 5) * 100} className={`h-2 ${
                                hasResponses ? '' : 'opacity-40'
                              }`} />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Calculated Fields */}
                  {comprehensiveAnalytics.breakdown.calculatedFields && Object.keys(comprehensiveAnalytics.breakdown.calculatedFields).length > 0 && (
                    <div>
                      <h3 className="font-semibold text-sm text-muted-foreground mb-3 flex items-center gap-2">
                        <Brain className="h-4 w-4" />
                        Calculated Scores
                      </h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {Object.entries(comprehensiveAnalytics.breakdown.calculatedFields).map(([label, data]) => (
                          <div key={label} className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-4 space-y-2 border border-amber-200 dark:border-amber-800">
                            <p className="text-xs font-medium text-amber-600 dark:text-amber-400 uppercase">{label}</p>
                            <p className="text-2xl font-bold text-amber-900 dark:text-amber-100">
                              {data.value.toFixed(2)}
                            </p>
                            <div className="text-xs text-muted-foreground font-mono bg-amber-100 dark:bg-amber-900/30 p-2 rounded">
                              {data.formula}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <PieChart className="h-5 w-5" />
                  Detailed Score Analysis
                </CardTitle>
                <CardDescription>
                  Comprehensive breakdown across all evaluation dimensions
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                  {[
                    { key: 'overall', label: 'Overall Assessment', icon: Target },
                    { key: 'technical', label: 'Technical Skills', icon: Zap },
                    { key: 'communication', label: 'Communication', icon: MessageSquare },
                    { key: 'cultural', label: 'Cultural Fit', icon: Users }
                  ].map(({ key, label, icon: Icon }) => {
                    const score = analytics.scoreBreakdown[key as keyof ScoreBreakdown] as number;
                    return (
                      <div key={key} className="text-center space-y-2">
                        <div className="flex justify-center">
                          <div className="p-3 bg-muted/50 rounded-full">
                            <Icon className="h-5 w-5 text-muted-foreground" />
                          </div>
                        </div>
                        <div>
                          <p className="text-sm font-medium text-muted-foreground">{label}</p>
                          <p className={`text-2xl font-bold ${getScoreColor(score)}`}>
                            {score.toFixed(1)}
                          </p>
                          <Progress 
                            value={(score / 5) * 100} 
                            className="mt-2"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Top Performing Questions */}
          {analytics.topPerformingQuestions.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Award className="h-5 w-5" />
                  Top Performing Questions
                </CardTitle>
                <CardDescription>
                  Questions where the candidate performed best
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {analytics.topPerformingQuestions.map((q, index) => (
                    <div key={q.questionId} className="flex items-start gap-3 p-3 bg-muted/30 rounded-lg">
                      <div className="flex-shrink-0">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${
                          index === 0 ? 'bg-yellow-400 text-yellow-900' :
                          index === 1 ? 'bg-gray-400 text-gray-900' :
                          'bg-orange-400 text-orange-900'
                        }`}>
                          {index + 1}
                        </div>
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium line-clamp-2">{q.question}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <div className={`text-lg font-bold ${getScoreColor(q.score)}`}>
                            {q.score.toFixed(1)}
                          </div>
                          <div className="flex">
                            {[1, 2, 3, 4, 5].map((star) => (
                              <Star
                                key={star}
                                className={`h-4 w-4 ${
                                  star <= q.score ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300'
                                }`}
                              />
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Individual Assessor Feedback */}
      <div className="space-y-6">
        <div className="flex items-center gap-2 mb-4">
          <Sparkles className="h-5 w-5 text-blue-600" />
          <h2 className="text-xl font-semibold">Individual Assessor Feedback</h2>
        </div>
        
        {userKeys.map((userKey) => {
          const userData = userFeedback[userKey];
          const questionKeys = Object.keys(userData.questions);
          
          // Calculate user's average score
          const userRatings: number[] = [];
          [...userData.general, ...Object.values(userData.questions).flat()].forEach(item => {
            if (item.rating?.overall) userRatings.push(item.rating.overall);
          });
          const userAverage = userRatings.length > 0 ? userRatings.reduce((a, b) => a + b, 0) / userRatings.length : 0;
          
          return (
            <Card key={userKey} className="overflow-hidden border-l-4 border-l-blue-500">
              {/* Enhanced User Header */}
              <CardHeader className="bg-gradient-to-r from-blue-50 to-indigo-50">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <Avatar className="h-12 w-12 border-2 border-white shadow-md">
                      <AvatarFallback className={userData.user.role === 'public' ? 'bg-purple-500 text-white' : 'bg-blue-500 text-white'}>
                        {userData.user.role === 'public' ? (
                          <Globe className="h-6 w-6" />
                        ) : (
                          <User className="h-6 w-6" />
                        )}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1">
                      <div className="font-bold text-xl">{userData.user.name}</div>
                      <div className="flex items-center gap-3 text-sm text-muted-foreground">
                        <Badge 
                          variant={userData.user.role === 'public' ? 'secondary' : 'outline'} 
                          className="text-xs font-medium"
                        >
                          {userData.user.role === 'public' ? 'External Assessor' : userData.user.role.replace('_', ' ')}
                        </Badge>
                        {userData.user.email && (
                          <div className="flex items-center gap-1">
                            <Mail className="h-3 w-3" />
                            <span>{userData.user.email}</span>
                          </div>
                        )}
                        <div className="flex items-center gap-1">
                          <Activity className="h-3 w-3" />
                          <span>{userData.general.length + Object.values(userData.questions).flat().length} responses</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  {userAverage > 0 && (
                    <div className="text-right">
                      <div className={`text-2xl font-bold ${getScoreColor(userAverage)}`}>
                        {userAverage.toFixed(1)}
                      </div>
                      <div className="text-xs text-muted-foreground">Avg Score</div>
                      <div className="flex mt-1">
                        {[1, 2, 3, 4, 5].map((star) => (
                          <Star
                            key={star}
                            className={`h-3 w-3 ${
                              star <= userAverage ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300'
                            }`}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </CardHeader>

              <CardContent className="space-y-6 pt-6">
                {/* Overall Interview Assessment */}
                {userData.general.length > 0 && (
                  <div>
                    <h3 className="font-semibold mb-3 flex items-center gap-2">
                      <Target className="h-4 w-4 text-blue-600" />
                      Overall Interview Assessment
                    </h3>
                    <div className="space-y-3">
                      {userData.general.map(renderFeedbackItem)}
                    </div>
                  </div>
                )}

                {/* Question-Specific Feedback */}
                {questionKeys.length > 0 && (
                  <div>
                    <h3 className="font-semibold mb-3 flex items-center gap-2">
                      <MessageSquare className="h-4 w-4 text-green-600" />
                      Question-Specific Feedback
                      <Badge variant="secondary" className="ml-2">
                        {questionKeys.length} questions
                      </Badge>
                    </h3>
                    <div className="space-y-4">
                      {questionKeys.map((questionId) => {
                        const question = getQuestionById(questionId);
                        const questionFeedback = userData.questions[questionId];
                        
                        if (!question) return null;
                        
                        return (
                          <div key={questionId} className="border-2 border-dashed border-gray-200 rounded-lg p-4 bg-gradient-to-r from-gray-50 to-gray-100">
                            {/* Enhanced Question Header */}
                            <div className="mb-4">
                              <div className="flex items-start justify-between mb-2">
                                <div className="flex items-center gap-2">
                                  <Badge variant="outline" className="text-xs font-medium">
                                    {question.type.replace('_', ' ')}
                                  </Badge>
                                  {question.difficulty && (
                                    <Badge variant="secondary" className="text-xs">
                                      {question.difficulty}
                                    </Badge>
                                  )}
                                  {question.category && (
                                    <Badge variant="secondary" className="text-xs">
                                      {question.category}
                                    </Badge>
                                  )}
                                </div>
                                {questionFeedback[0]?.rating?.overall && (
                                  <div className={`text-lg font-bold ${getScoreColor(questionFeedback[0].rating.overall)}`}>
                                    {questionFeedback[0].rating.overall}/5
                                  </div>
                                )}
                              </div>
                              <div className="text-sm font-medium text-gray-700 bg-white rounded p-3 border-l-4 border-l-blue-400">
                                {question.question}
                              </div>
                            </div>
                            
                            {/* Enhanced Question Feedback */}
                            <div className="space-y-3">
                              {questionFeedback.map((item) => (
                                <div key={item._id} className="bg-white border rounded-lg p-4 shadow-sm">
                                  <div className="flex items-start justify-between mb-3">
                                    <div className="text-sm text-muted-foreground flex items-center gap-2">
                                      <Calendar className="h-3 w-3" />
                                      {new Date(item.createdAt).toLocaleDateString()}
                                      <Clock className="h-3 w-3" />
                                      {new Date(item.createdAt).toLocaleTimeString()}
                                    </div>
                                  </div>
                                  
                                  <div className="text-sm leading-relaxed mb-3 p-3 bg-gray-50 rounded">
                                    {item.content}
                                  </div>
                                  
                                  {item.rating && Object.keys(item.rating).length > 1 && (
                                    <div className="flex gap-4 text-sm border-t pt-3">
                                      {Object.entries(item.rating).map(([key, value]) => (
                                        <div key={key} className="flex items-center gap-2">
                                          <span className="text-muted-foreground capitalize font-medium">{key}:</span>
                                          <div className={`font-bold ${getScoreColor(value)}`}>{value}/5</div>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Empty state for user with no feedback */}
                {userData.general.length === 0 && questionKeys.length === 0 && (
                  <div className="text-center py-8 bg-muted/20 rounded-lg">
                    <AlertCircle className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                    <p className="text-muted-foreground">
                      This assessor hasn't provided any feedback yet.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Empty State */}
      {userKeys.length === 0 && (
        <Card className="border-dashed border-2">
          <CardContent className="py-12 text-center">
            <div className="mb-4">
              <MessageSquare className="h-16 w-16 mx-auto mb-4 text-muted-foreground opacity-50" />
            </div>
            <h3 className="text-xl font-semibold mb-2">No Feedback Yet</h3>
            <p className="text-muted-foreground mb-6 max-w-md mx-auto">
              Be the first to provide comprehensive feedback for this interview. Your assessment will help make better hiring decisions.
            </p>
            <Button 
              onClick={() => window.open(getPublicFeedbackUrl(), '_blank')}
              size="lg"
              className="bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700"
            >
              <ExternalLink className="h-5 w-5 mr-2" />
              Submit Detailed Feedback
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
