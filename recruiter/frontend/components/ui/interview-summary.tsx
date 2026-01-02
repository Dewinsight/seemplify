"use client";

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Brain, Loader2, RefreshCw, TrendingUp, AlertTriangle, CheckCircle, AlertCircle, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import interviewService from '@/services/interviewService';

interface InterviewSummaryProps {
  interviewId: string;
  summary?: {
    generated: boolean;
    generatedAt: string;
    content: string;
    keyInsights: string[];
    candidateStrengths: string[];
    candidateConcerns: string[];
    recommendation: 'strong_yes' | 'yes' | 'maybe' | 'no' | 'strong_no';
    confidence: number;
    methodology: string;
  };
  hasTranscript: boolean;
  onSummaryGenerated?: (summary: any) => void;
}

const recommendationConfig = {
  strong_yes: {
    label: 'Strong Yes',
    color: 'bg-green-600',
    icon: CheckCircle,
    description: 'Highly recommended for hire'
  },
  yes: {
    label: 'Yes',
    color: 'bg-green-500',
    icon: CheckCircle,
    description: 'Recommended for hire'
  },
  maybe: {
    label: 'Maybe',
    color: 'bg-yellow-500',
    icon: AlertCircle,
    description: 'Requires further evaluation'
  },
  no: {
    label: 'No',
    color: 'bg-red-500',
    icon: AlertTriangle,
    description: 'Not recommended for hire'
  },
  strong_no: {
    label: 'Strong No',
    color: 'bg-red-600',
    icon: AlertTriangle,
    description: 'Strongly not recommended for hire'
  }
};

export function InterviewSummary({
  interviewId,
  summary,
  hasTranscript,
  onSummaryGenerated
}: InterviewSummaryProps) {
  const [generating, setGenerating] = useState(false);

  const handleGenerateSummary = async () => {
    if (!hasTranscript) {
      toast.error('No transcript available for analysis');
      return;
    }

    setGenerating(true);
    try {
      const result = await interviewService.generateAISummary(interviewId);

      if (result.success) {
        toast.success('AI summary generated successfully!');
        onSummaryGenerated?.(result.summary);
      } else {
        toast.error(result.error || 'Failed to generate AI summary');
      }
    } catch (error: any) {
      console.error('Error generating AI summary:', error);
      toast.error('Failed to generate AI summary: ' + error.message);
    } finally {
      setGenerating(false);
    }
  };

  const getRecommendationConfig = (recommendation: string) => {
    return recommendationConfig[recommendation as keyof typeof recommendationConfig] || recommendationConfig.maybe;
  };

  if (!summary?.generated && !hasTranscript) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5" />
            AI Interview Summary
          </CardTitle>
          <CardDescription>
            AI-powered analysis and recommendation based on interview transcript
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              No transcript available yet. AI summary will be available once the interview transcript is ready.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  if (!summary?.generated) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5" />
            AI Interview Summary
          </CardTitle>
          <CardDescription>
            Generate an AI-powered analysis and recommendation based on the interview transcript
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-center py-6">
            <Brain className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">Ready to Generate AI Summary</h3>
            <p className="text-muted-foreground mb-4">
              Our AI will analyze the interview transcript to provide comprehensive insights,
              candidate assessment, and hiring recommendations.
            </p>
            <Button
              onClick={handleGenerateSummary}
              disabled={generating || !hasTranscript}
              size="lg"
              className="gap-2"
            >
              {generating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Generating AI Summary...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Generate AI Summary
                </>
              )}
            </Button>
          </div>

          {!hasTranscript && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Transcript must be available before generating AI summary.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    );
  }

  const config = getRecommendationConfig(summary.recommendation);
  const RecommendationIcon = config.icon;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Brain className="h-5 w-5" />
              AI Interview Summary
            </CardTitle>
            <CardDescription>
              Generated on {new Date(summary.generatedAt).toLocaleString()}
            </CardDescription>
          </div>

          <div className="flex items-center gap-2">
            <Badge variant="outline" className="gap-1">
              <TrendingUp className="h-3 w-3" />
              {summary.confidence}% Confidence
            </Badge>

            <Button
              variant="outline"
              size="sm"
              onClick={handleGenerateSummary}
              disabled={generating}
            >
              {generating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Regenerating...
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Regenerate
                </>
              )}
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Main Summary */}
        <div>
          <h3 className="text-lg font-semibold mb-3">Summary</h3>
          <p className="text-gray-700 dark:text-gray-300 leading-relaxed">{summary.content}</p>
        </div>

        <Separator />

        {/* Recommendation */}
        <div>
          <h3 className="text-lg font-semibold mb-3">AI Recommendation</h3>
          <div className="flex items-center gap-3 p-4 rounded-lg border border-gray-200 dark:border-border bg-gray-50 dark:bg-muted/30">
            <div className={`p-2 rounded-full ${config.color}`}>
              <RecommendationIcon className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="font-semibold text-lg">{config.label}</p>
              <p className="text-sm text-muted-foreground">{config.description}</p>
            </div>
            <div className="ml-auto">
              <Badge variant="outline">{summary.confidence}% confidence</Badge>
            </div>
          </div>
        </div>

        <Separator />

        {/* Key Insights */}
        {summary.keyInsights && summary.keyInsights.length > 0 && (
          <div>
            <h3 className="text-lg font-semibold mb-3">Key Insights</h3>
            <ul className="space-y-2">
              {summary.keyInsights.map((insight, index) => (
                <li key={index} className="flex items-start gap-2">
                  <div className="w-2 h-2 bg-blue-500 rounded-full mt-2 flex-shrink-0"></div>
                  <span className="text-gray-700 dark:text-gray-300">{insight}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <Separator />

        {/* Strengths and Concerns */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Candidate Strengths */}
          {summary.candidateStrengths && summary.candidateStrengths.length > 0 && (
            <div>
              <h3 className="text-lg font-semibold mb-3 text-green-700">
                <CheckCircle className="h-5 w-5 inline mr-2" />
                Strengths
              </h3>
              <ul className="space-y-2">
                {summary.candidateStrengths.map((strength, index) => (
                  <li key={index} className="flex items-start gap-2">
                    <CheckCircle className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
                    <span className="text-gray-700 dark:text-gray-300">{strength}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Candidate Concerns */}
          {summary.candidateConcerns && summary.candidateConcerns.length > 0 && (
            <div>
              <h3 className="text-lg font-semibold mb-3 text-orange-700">
                <AlertTriangle className="h-5 w-5 inline mr-2" />
                Areas for Consideration
              </h3>
              <ul className="space-y-2">
                {summary.candidateConcerns.map((concern, index) => (
                  <li key={index} className="flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 text-orange-500 mt-0.5 flex-shrink-0" />
                    <span className="text-gray-700 dark:text-gray-300">{concern}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Methodology */}
        {summary.methodology && (
          <>
            <Separator />
            <div>
              <h3 className="text-sm font-semibold mb-2 text-muted-foreground">Analysis Methodology</h3>
              <p className="text-sm text-muted-foreground">{summary.methodology}</p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
} 