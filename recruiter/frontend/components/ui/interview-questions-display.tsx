"use client";

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './card';
import { Button } from './button';
import { Badge } from './badge';
import { AlertCircle, CheckCircle, MessageCircle, Send, RefreshCw } from 'lucide-react';
import { Alert, AlertDescription } from './alert';
import { Separator } from './separator';
import { toast } from 'sonner';
import { ScrollArea } from './scroll-area';
import interviewService from '@/services/interviewService';
import { InterviewQuestion } from '@/services/interviewService';

interface InterviewQuestionsDisplayProps {
  interviewId: string;
}

export function InterviewQuestionsDisplay({ interviewId }: InterviewQuestionsDisplayProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [questions, setQuestions] = useState<InterviewQuestion[]>([]);
  const [questionsEnabled, setQuestionsEnabled] = useState(false);
  const [questionsSendTime, setQuestionsSendTime] = useState(60);
  const [questionsSentAt, setQuestionsSentAt] = useState<string | null>(null);
  
  useEffect(() => {
    fetchSelectedQuestions();
  }, [interviewId]);
  
  const fetchSelectedQuestions = async () => {
    try {
      setLoading(true);
      setError(null);
      
      console.log('📋 Fetching selected questions for interview:', interviewId);
      const data = await interviewService.getSelectedInterviewQuestions(interviewId);
      console.log('📊 Received questions data:', data);
      
      setQuestions(data.questions || []);
      setQuestionsEnabled(data.questionsEnabled);
      setQuestionsSendTime(data.questionsSendTime);
      setQuestionsSentAt(data.questionsSentAt);
      
    } catch (err: any) {
      setError(err.message || 'Failed to load selected questions');
      console.error('Error fetching selected questions:', err);
    } finally {
      setLoading(false);
    }
  };
  
  const sendQuestionsManually = async () => {
    try {
      setSending(true);
      
      const result = await interviewService.sendInterviewQuestionsManually(interviewId);
      
      if (result.success) {
        toast.success('Interview questions sent successfully to interviewers');
        setQuestionsSentAt(new Date().toISOString());
      } else {
        toast.error(result.message || 'Failed to send interview questions');
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to send interview questions');
      console.error('Error sending questions:', err);
    } finally {
      setSending(false);
    }
  };
  
  // Format time options
  const formatSendTime = (minutes: number) => {
    if (minutes >= 60) {
      const hours = Math.floor(minutes / 60);
      const remainingMinutes = minutes % 60;
      return `${hours} hour${hours > 1 ? 's' : ''}${remainingMinutes > 0 ? ` ${remainingMinutes} minute${remainingMinutes > 1 ? 's' : ''}` : ''}`;
    }
    return `${minutes} minute${minutes > 1 ? 's' : ''}`;
  };
  
  // Format the question type for display
  const formatQuestionType = (type: string) => {
    return type.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
  };
  
  // Get styling for different question types
  const getQuestionTypeStyles = (type: string) => {
    switch (type) {
      case 'technical':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'behavioral':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'situational':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'cultural_fit':
        return 'bg-purple-100 text-purple-800 border-purple-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };
  
  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageCircle className="h-5 w-5" />
            Interview Questions
          </CardTitle>
        </CardHeader>
        <CardContent className="text-center py-8">
          <RefreshCw className="h-8 w-8 mx-auto mb-2 animate-spin text-muted-foreground" />
          <p className="text-muted-foreground">Loading interview questions...</p>
        </CardContent>
      </Card>
    );
  }
  
  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageCircle className="h-5 w-5" />
            Interview Questions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }
  
  if (!questionsEnabled || questions.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageCircle className="h-5 w-5" />
            Interview Questions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              No interview questions have been selected for this interview.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }
  
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <MessageCircle className="h-5 w-5" />
          Interview Questions
        </CardTitle>
        <CardDescription>
          {questionsSentAt ? (
            <div className="flex items-center text-green-600">
              <CheckCircle className="h-4 w-4 mr-1" />
              Questions sent to interviewers on {new Date(questionsSentAt).toLocaleString()}
            </div>
          ) : (
            <div className="flex justify-between items-center">
              <span>
                Scheduled to send {formatSendTime(questionsSendTime)} before interview
              </span>
              <Button 
                size="sm" 
                onClick={sendQuestionsManually} 
                disabled={sending || !questionsEnabled}
              >
                {sending ? (
                  <>
                    <RefreshCw className="mr-1 h-3 w-3 animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Send className="mr-1 h-3 w-3" />
                    Send Now
                  </>
                )}
              </Button>
            </div>
          )}
        </CardDescription>
      </CardHeader>
      
      <CardContent>
        <Separator className="mb-4" />
        
        <ScrollArea className="h-[400px] pr-4">
          <div className="space-y-4">
            {questions.map((question, index) => (
              <div 
                key={question._id} 
                className="border rounded-lg p-4 hover:border-primary transition-colors"
              >
                <div className="flex items-start gap-2 mb-3">
                  <div className="flex items-center justify-center bg-primary text-primary-foreground w-6 h-6 rounded-full text-xs font-medium">
                    {index + 1}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <Badge className={getQuestionTypeStyles(question.type)}>
                        {formatQuestionType(question.type)}
                      </Badge>
                      <Badge variant="outline">
                        {question.difficulty.charAt(0).toUpperCase() + question.difficulty.slice(1)}
                      </Badge>
                    </div>
                    <p className="text-base font-medium">{question.question}</p>
                  </div>
                </div>
                
                {question.expectedAnswer && (
                  <div className="mt-3 pt-3 border-t text-sm">
                    <p className="font-medium text-xs text-muted-foreground mb-1">Suggested answer/criteria:</p>
                    <p className="text-muted-foreground">{question.expectedAnswer}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
