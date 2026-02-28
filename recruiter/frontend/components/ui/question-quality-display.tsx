"use client";

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './card';
import { Badge } from './badge';
import { Progress } from './progress';
import { 
  CheckCircle, 
  AlertTriangle, 
  XCircle, 
  Shield, 
  Target, 
  BarChart3,
  TrendingUp,
  Users,
  Globe,
  Heart,
  Home,
  ChevronDown,
  ChevronUp,
  Eye,
  AlertCircle,
  Info,
  Search
} from 'lucide-react';
import { InterviewQuestion, QuestionQualityAnalysis, BiasDetectionFactor } from '../../services/interviewService';
import { Button } from './button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './collapsible';

interface QuestionQualityDisplayProps {
  question: InterviewQuestion;
  qualityAnalysis?: QuestionQualityAnalysis;
  onAnalyze?: () => void;
  isAnalyzing?: boolean;
}

export function QuestionQualityDisplay({ 
  question, 
  qualityAnalysis, 
  onAnalyze, 
  isAnalyzing = false 
}: QuestionQualityDisplayProps) {
  const [isExpanded, setIsExpanded] = React.useState(false);

  const getScoreColor = (score: number) => {
    if (score >= 0.8) return "text-green-600";
    if (score >= 0.6) return "text-yellow-600";
    return "text-red-600";
  };

  const getScoreIcon = (score: number) => {
    if (score >= 0.8) return <CheckCircle className="h-4 w-4 text-green-600" />;
    if (score >= 0.6) return <AlertTriangle className="h-4 w-4 text-yellow-600" />;
    return <XCircle className="h-4 w-4 text-red-600" />;
  };

  const getBiasIcon = (type: string) => {
    const lowerType = type.toLowerCase();
    if (lowerType.includes('age')) return <Users className="h-4 w-4" />;
    if (lowerType.includes('gender')) return <Users className="h-4 w-4" />;
    if (lowerType.includes('nationality') || lowerType.includes('cultural')) return <Globe className="h-4 w-4" />;
    if (lowerType.includes('family') || lowerType.includes('marital')) return <Home className="h-4 w-4" />;
    if (lowerType.includes('religious')) return <Heart className="h-4 w-4" />;
    return <Shield className="h-4 w-4" />;
  };

  const formatBiasType = (type: string) => {
    // Handle complex bias types from backend
    return type.split(/[_\s]+/).map(word => 
      word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    ).join(' ');
  };

  const getBiasLevelColor = (score: number) => {
    if (score === 0) return "text-green-600";
    if (score <= 0.3) return "text-yellow-600";
    return "text-red-600";
  };

  const getBiasLevelText = (score: number) => {
    if (score === 0) return "No Bias";
    if (score <= 0.3) return "Low Bias";
    return "High Bias";
  };

  const hasQualityMetrics = question.qualityMetrics || qualityAnalysis;
  
  // Get quality metrics from question or analysis, with proper defaults
  const getQualityMetrics = () => {
    if (qualityAnalysis) {
      return {
        biasScore: qualityAnalysis.overallBiasScore ?? qualityAnalysis.biasScore ?? 0,
        diversityIndex: qualityAnalysis.diversityIndex || 0,
        difficultyCalibration: qualityAnalysis.difficultyCalibration || 0,
        legalCompliance: qualityAnalysis.legalCompliance !== undefined ? qualityAnalysis.legalCompliance : true,
        biasAnalysis: qualityAnalysis.biasAnalysis || {},
        detectedBiasFactors: qualityAnalysis.detectedBiasFactors || [],
        neutralityConfidence: qualityAnalysis.neutralityConfidence,
        recommendation: qualityAnalysis.recommendation,
        isBiased: qualityAnalysis.isBiased
      };
    }
    
    if (question.qualityMetrics) {
      return {
        biasScore: question.qualityMetrics.biasScore || 0,
        diversityIndex: question.qualityMetrics.diversityIndex || 0,
        difficultyCalibration: question.qualityMetrics.difficultyCalibration || 0,
        legalCompliance: question.qualityMetrics.legalCompliance !== undefined ? question.qualityMetrics.legalCompliance : true,
        biasAnalysis: question.qualityMetrics.biasAnalysis || {},
        detectedBiasFactors: [],
        neutralityConfidence: undefined,
        recommendation: undefined,
        isBiased: undefined
      };
    }
    
    // Default values for questions without analysis
    return {
      biasScore: 0,
      diversityIndex: 0,
      difficultyCalibration: 0,
      legalCompliance: true,
      biasAnalysis: {},
      detectedBiasFactors: [],
      neutralityConfidence: undefined,
      recommendation: undefined,
      isBiased: undefined
    };
  };
  
  const metrics = getQualityMetrics();

  return (
    <Card className="border-l-4 border-l-purple-500">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Target className="h-4 w-4 text-purple-600" />
              Quality Metrics
              {question.isAIGenerated && (
                <Badge variant="secondary" className="text-xs">
                  AI Generated
                </Badge>
              )}
              {metrics.isBiased && (
                <Badge variant="destructive" className="text-xs">
                  Bias Detected
                </Badge>
              )}
            </CardTitle>
            <CardDescription className="text-xs">
              Question assessment and bias analysis
            </CardDescription>
          </div>
          
          {!hasQualityMetrics && onAnalyze && (
            <Button
              size="sm"
              variant="outline"
              onClick={onAnalyze}
              disabled={isAnalyzing}
              className="text-xs"
            >
              {isAnalyzing ? "Analyzing..." : "Analyze"}
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="pt-0 space-y-4">
        {hasQualityMetrics ? (
          <>
            {/* Main Quality Scores */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Quality Score</span>
                  <div className="flex items-center gap-1">
                    {getScoreIcon(1 - metrics.biasScore)}
                    <span className={`text-sm font-medium ${getScoreColor(1 - metrics.biasScore)}`}>
                      {Math.round((1 - metrics.biasScore) * 100)}%
                    </span>
                  </div>
                </div>
                <Progress 
                  value={(1 - metrics.biasScore) * 100} 
                  className="h-2"
                />
                <p className="text-xs text-gray-500">
                  Higher is better (100% = bias-free)
                </p>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Bias Level</span>
                  <div className="flex items-center gap-1">
                    {metrics.biasScore === 0 ? (
                      <CheckCircle className="h-4 w-4 text-green-600" />
                    ) : metrics.biasScore <= 0.3 ? (
                      <AlertTriangle className="h-4 w-4 text-yellow-600" />
                    ) : (
                      <XCircle className="h-4 w-4 text-red-600" />
                    )}
                    <span className={`text-sm font-medium ${getBiasLevelColor(metrics.biasScore)}`}>
                      {getBiasLevelText(metrics.biasScore)}
                    </span>
                  </div>
                </div>
                <Progress 
                  value={metrics.biasScore * 100} 
                  className="h-2"
                />
                <p className="text-xs text-gray-500">
                  Raw bias score: {(metrics.biasScore * 100).toFixed(1)}%
                </p>
              </div>
            </div>

            {/* Neutrality Confidence */}
            {metrics.neutralityConfidence !== undefined && (
              <div className="flex items-center justify-between p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                <div className="flex items-center gap-2">
                  <Eye className="h-4 w-4 text-blue-600" />
                  <span className="text-sm font-medium">Neutrality Confidence</span>
                </div>
                <div className="flex items-center gap-2">
                  <Progress value={metrics.neutralityConfidence * 100} className="w-16 h-2" />
                  <span className="text-sm font-medium text-blue-600">
                    {Math.round(metrics.neutralityConfidence * 100)}%
                  </span>
                </div>
              </div>
            )}

            {/* Legal Compliance */}
            <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-blue-600" />
                <span className="text-sm font-medium">Legal Compliance</span>
              </div>
              <div className="flex items-center gap-1">
                {metrics.legalCompliance ? (
                  <>
                    <CheckCircle className="h-4 w-4 text-green-600" />
                    <span className="text-sm font-medium text-green-600">Compliant</span>
                  </>
                ) : (
                  <>
                    <XCircle className="h-4 w-4 text-red-600" />
                    <span className="text-sm font-medium text-red-600">Review Needed</span>
                  </>
                )}
              </div>
            </div>

            {/* AI Recommendation */}
            {metrics.recommendation && (
              <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
                <div className="flex items-start gap-2">
                  <Info className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-amber-800 dark:text-amber-200 mb-1">
                      AI Recommendation
                    </p>
                    <p className="text-sm text-amber-700 dark:text-amber-300">
                      {metrics.recommendation}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Expandable Detailed Analysis */}
            <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" className="w-full justify-between p-0 h-auto">
                  <span className="text-sm font-medium">Detailed Analysis</span>
                  {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </Button>
              </CollapsibleTrigger>
              
              <CollapsibleContent className="space-y-4 mt-4">
                {/* Detected Bias Factors */}
                {metrics.detectedBiasFactors && metrics.detectedBiasFactors.length > 0 && (
                  <div className="space-y-3">
                    <h4 className="text-sm font-medium flex items-center gap-2">
                      <AlertCircle className="h-4 w-4 text-red-600" />
                      Detected Bias Factors
                    </h4>
                    <div className="space-y-3">
                      {metrics.detectedBiasFactors.map((factor, index) => (
                        <div key={index} className="border border-red-200 dark:border-red-800 rounded-lg p-3 bg-red-50 dark:bg-red-900/20">
                          <div className="flex items-start gap-3">
                            <div className="flex-shrink-0">
                              {getBiasIcon(factor.type)}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-2">
                                <span className="text-sm font-medium text-red-800 dark:text-red-200">
                                  {formatBiasType(factor.type)}
                                </span>
                                <Badge variant="destructive" className="text-xs">
                                  Score: {(factor.score * 100).toFixed(1)}%
                                </Badge>
                              </div>
                              
                              {factor.keywordsFound && factor.keywordsFound.length > 0 && (
                                <div className="mb-2">
                                  <p className="text-xs text-red-700 dark:text-red-300 mb-1 flex items-center gap-1">
                                    <Search className="h-3 w-3" />
                                    Keywords Found:
                                  </p>
                                  <div className="flex flex-wrap gap-1">
                                    {factor.keywordsFound.map((keyword, kidx) => (
                                      <Badge key={kidx} variant="outline" className="text-xs bg-red-100 dark:bg-red-800/50 text-red-700 dark:text-red-300">
                                        "{keyword}"
                                      </Badge>
                                    ))}
                                  </div>
                                </div>
                              )}
                              
                              <p className="text-sm text-red-700 dark:text-red-300">
                                {factor.explanation}
                              </p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Legacy Bias Breakdown */}
                {metrics.biasAnalysis && Object.keys(metrics.biasAnalysis).length > 0 && (
                  <div className="space-y-3">
                    <h4 className="text-sm font-medium flex items-center gap-2">
                      <BarChart3 className="h-4 w-4" />
                      Bias Category Analysis
                    </h4>
                    <div className="grid grid-cols-1 gap-2">
                      {Object.entries(metrics.biasAnalysis).map(([type, score]) => (
                        score !== undefined && (
                          <div key={type} className="flex items-center justify-between p-2 bg-white dark:bg-gray-800 border rounded">
                            <div className="flex items-center gap-2">
                              {getBiasIcon(type)}
                              <span className="text-sm">{formatBiasType(type)}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Progress value={(1 - score) * 100} className="w-16 h-2" />
                              <span className={`text-xs font-medium ${getScoreColor(1 - score)}`}>
                                {Math.round((1 - score) * 100)}%
                              </span>
                            </div>
                          </div>
                        )
                      ))}
                    </div>
                  </div>
                )}

                {/* Additional Metrics */}
                <div className="grid grid-cols-2 gap-4">
                  {metrics.diversityIndex !== undefined && (
                    <div className="space-y-2">
                      <span className="text-sm font-medium">Diversity Index</span>
                      <div className="flex items-center gap-2">
                        <Progress value={metrics.diversityIndex * 100} className="flex-1 h-2" />
                        <span className="text-sm font-medium">
                          {Math.round(metrics.diversityIndex * 100)}%
                        </span>
                      </div>
                    </div>
                  )}

                  {metrics.difficultyCalibration !== undefined && (
                    <div className="space-y-2">
                      <span className="text-sm font-medium">Difficulty Match</span>
                      <div className="flex items-center gap-2">
                        <Progress value={metrics.difficultyCalibration * 100} className="flex-1 h-2" />
                        <span className="text-sm font-medium">
                          {Math.round(metrics.difficultyCalibration * 100)}%
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                {/* General Recommendations */}
                {qualityAnalysis?.recommendations && qualityAnalysis.recommendations.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium flex items-center gap-2">
                      <TrendingUp className="h-4 w-4" />
                      Recommendations
                    </h4>
                    <div className="space-y-1">
                      {qualityAnalysis.recommendations.map((rec, index) => (
                        <div key={index} className="text-sm p-2 bg-blue-50 dark:bg-blue-900/20 border-l-2 border-blue-200 dark:border-blue-700 rounded">
                          {rec}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CollapsibleContent>
            </Collapsible>

            {/* AI Generation Metadata */}
            {question.isAIGenerated && question.aiGenerationMetadata && (
              <div className="text-xs text-gray-500 pt-2 border-t">
                <div className="flex justify-between">
                  <span>Model: {question.aiGenerationMetadata.model}</span>
                  <span>Confidence: {Math.round(question.aiGenerationMetadata.confidence * 100)}%</span>
                </div>
                <div className="mt-1">
                  Generated: {new Date(question.aiGenerationMetadata.generatedAt).toLocaleDateString()}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-4 text-gray-500">
            <Shield className="h-8 w-8 mx-auto mb-2 text-gray-400" />
            <p className="text-sm">No quality analysis available</p>
            <p className="text-xs mt-1">Click "Analyze" to generate quality metrics</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
} 