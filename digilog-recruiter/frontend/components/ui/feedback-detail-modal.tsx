"use client";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { 
  User, 
  Mail, 
  Calendar, 
  Star, 
  MessageSquare,
  Globe,
  FileText,
  CheckCircle,
  Heart,
  Target,
  BarChart3,
  Shield,
  TrendingUp
} from 'lucide-react';
import { Progress } from '@/components/ui/progress';

interface FeedbackDetailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  feedback: any;
  question?: any;
}

export function FeedbackDetailModal({ open, onOpenChange, feedback, question }: FeedbackDetailModalProps) {
  if (!feedback) return null;

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getRoleColor = (role: string) => {
    switch (role) {
      case 'hr_manager': return 'bg-purple-100 text-purple-800 border-purple-200';
      case 'recruiter': return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'interviewer': return 'bg-green-100 text-green-800 border-green-200';
      case 'hiring_manager': return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'public': return 'bg-gray-100 text-gray-800 border-gray-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getQuestionTypeColor = (type: string) => {
    switch (type) {
      case 'technical': return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'behavioral': return 'bg-green-100 text-green-800 border-green-200';
      case 'situational': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'cultural_fit': return 'bg-purple-100 text-purple-800 border-purple-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            Feedback Details
          </DialogTitle>
          <DialogDescription>
            Detailed view of the feedback submission
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] mt-4">
          <div className="space-y-6 pr-4">
            {/* Assessor Information */}
            <div className="bg-gradient-to-r from-[#F1ECFF] to-[#E9E2FB] dark:from-[#1E0059] dark:to-[#1E0059] rounded-lg p-4">
              <h3 className="font-semibold mb-3 flex items-center gap-2">
                <User className="h-4 w-4" />
                Assessor Information
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex items-center gap-3">
                  <Avatar className="h-10 w-10">
                    <AvatarFallback className="bg-gradient-to-br from-[#754BE5] to-[#6935CF] text-white">
                      {feedback.authorRole === 'public' ? (
                        <Globe className="h-5 w-5" />
                      ) : (
                        feedback.authorName?.charAt(0)?.toUpperCase() || 'U'
                      )}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="font-semibold">{feedback.authorName}</p>
                    <Badge className={`${getRoleColor(feedback.authorRole)} text-xs`}>
                      {feedback.authorRole === 'public' ? 'External' : feedback.authorRole?.replace('_', ' ')}
                    </Badge>
                  </div>
                </div>
                
                {feedback.publicFeedback?.email && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Mail className="h-4 w-4" />
                    <span>{feedback.publicFeedback.email}</span>
                    {feedback.publicFeedback.isVerified && (
                      <Badge variant="outline" className="text-xs text-green-600 border-green-600">
                        <CheckCircle className="h-3 w-3 mr-1" />
                        Verified
                      </Badge>
                    )}
                  </div>
                )}
              </div>
              
              <div className="flex items-center gap-4 mt-3 text-sm text-muted-foreground">
                <div className="flex items-center gap-1">
                  <Calendar className="h-4 w-4" />
                  <span>{formatDate(feedback.createdAt)}</span>
                </div>
                {feedback.isEdited && (
                  <Badge variant="outline" className="text-xs">
                    Edited
                  </Badge>
                )}
              </div>
            </div>

            {/* Question Information (if applicable) */}
            {question && (
              <div className="bg-slate-50 dark:bg-slate-900/50 rounded-lg p-4">
                <h3 className="font-semibold mb-3 flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  Question Details
                </h3>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Badge className={getQuestionTypeColor(question.type)}>
                      {question.type?.replace('_', ' ')}
                    </Badge>
                    {question.difficulty && (
                      <Badge variant="outline">
                        {question.difficulty}
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm font-medium mt-2">{question.question}</p>
                </div>
              </div>
            )}

            {/* Comprehensive Rating Analysis */}
            {feedback.rating && (
              <div className="bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/20 dark:to-orange-950/20 rounded-lg p-6">
                <h3 className="font-semibold mb-4 flex items-center gap-2">
                  <BarChart3 className="h-5 w-5" />
                  Rating Analysis
                </h3>
                
                {/* Overall Rating Display */}
                {feedback.rating.overall && (
                  <div className="mb-6">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-lg font-semibold">Overall Rating</span>
                      <div className="flex items-center gap-2">
                        <span className="text-3xl font-bold text-amber-600">{feedback.rating.overall}</span>
                        <span className="text-lg text-muted-foreground">/5</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mb-3">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <Star
                          key={star}
                          className={`h-7 w-7 ${
                            feedback.rating.overall >= star
                              ? 'text-yellow-500 fill-current'
                              : 'text-gray-300'
                          }`}
                        />
                      ))}
                    </div>
                    <Progress value={(feedback.rating.overall / 5) * 100} className="h-3" />
                    <div className="flex justify-between text-xs text-muted-foreground mt-2">
                      <span>Poor</span>
                      <span>Average</span>
                      <span>Excellent</span>
                    </div>
                  </div>
                )}
                
                {/* Detailed Rating Breakdown */}
                {(feedback.rating.technical || feedback.rating.communication || feedback.rating.cultural) && (
                  <div>
                    <h4 className="font-semibold mb-3 flex items-center gap-2">
                      <Target className="h-4 w-4" />
                      Detailed Breakdown
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      {feedback.rating.technical && (
                        <div className="bg-white/50 dark:bg-white/5 rounded-lg p-4 text-center">
                          <div className="text-2xl font-bold text-blue-600 mb-1">
                            {feedback.rating.technical}
                          </div>
                          <div className="text-sm text-muted-foreground mb-2">Technical Skills</div>
                          <Progress value={(feedback.rating.technical / 5) * 100} className="h-2" />
                        </div>
                      )}
                      {feedback.rating.communication && (
                        <div className="bg-white/50 dark:bg-white/5 rounded-lg p-4 text-center">
                          <div className="text-2xl font-bold text-green-600 mb-1">
                            {feedback.rating.communication}
                          </div>
                          <div className="text-sm text-muted-foreground mb-2">Communication</div>
                          <Progress value={(feedback.rating.communication / 5) * 100} className="h-2" />
                        </div>
                      )}
                      {feedback.rating.cultural && (
                        <div className="bg-white/50 dark:bg-white/5 rounded-lg p-4 text-center">
                          <div className="text-2xl font-bold text-purple-600 mb-1">
                            {feedback.rating.cultural}
                          </div>
                          <div className="text-sm text-muted-foreground mb-2">Cultural Fit</div>
                          <Progress value={(feedback.rating.cultural / 5) * 100} className="h-2" />
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Feedback Content */}
            <div className="bg-white dark:bg-gray-900 rounded-lg border p-6">
              <h3 className="font-semibold mb-4 flex items-center gap-2">
                <MessageSquare className="h-5 w-5" />
                Feedback Content
              </h3>
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-4 border-l-4 border-blue-500">
                  <p className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed">
                    {feedback.content}
                  </p>
                </div>
              </div>
              
              {/* Content Analytics */}
              <div className="mt-4 grid grid-cols-3 gap-4 text-center text-sm">
                <div>
                  <div className="font-semibold text-blue-600">{feedback.content?.length || 0}</div>
                  <div className="text-muted-foreground">Characters</div>
                </div>
                <div>
                  <div className="font-semibold text-green-600">{feedback.content?.split(' ').length || 0}</div>
                  <div className="text-muted-foreground">Words</div>
                </div>
                <div>
                  <div className="font-semibold text-purple-600">
                    {feedback.content?.length > 200 ? 'Detailed' : feedback.content?.length > 50 ? 'Moderate' : 'Brief'}
                  </div>
                  <div className="text-muted-foreground">Length</div>
                </div>
              </div>
            </div>

            {/* Categories/Tags */}
            {feedback.categories && feedback.categories.length > 0 && (
              <div>
                <h3 className="font-semibold mb-2 text-sm">Categories</h3>
                <div className="flex flex-wrap gap-2">
                  {feedback.categories.map((category: string, index: number) => (
                    <Badge key={index} variant="secondary" className="text-xs">
                      {category.replace('_', ' ')}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* AI Analysis (if available) */}
            {feedback.aiFlags && (
              <div className="bg-gradient-to-r from-purple-50 to-[#F1ECFF] dark:from-purple-950 dark:to-[#1E0059] rounded-lg p-4">
                <h3 className="font-semibold mb-3 flex items-center gap-2">
                  <Heart className="h-4 w-4" />
                  AI Analysis
                </h3>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  {feedback.aiFlags.sentiment && (
                    <div>
                      <p className="text-muted-foreground">Sentiment</p>
                      <Badge variant="outline" className="mt-1">
                        {feedback.aiFlags.sentiment.replace('_', ' ')}
                      </Badge>
                    </div>
                  )}
                  {feedback.aiFlags.confidence !== undefined && (
                    <div>
                      <p className="text-muted-foreground">Confidence</p>
                      <p className="font-semibold">{(feedback.aiFlags.confidence * 100).toFixed(0)}%</p>
                    </div>
                  )}
                </div>
                {feedback.aiFlags.keyTopics && feedback.aiFlags.keyTopics.length > 0 && (
                  <div className="mt-3">
                    <p className="text-muted-foreground text-sm mb-2">Key Topics</p>
                    <div className="flex flex-wrap gap-1">
                      {feedback.aiFlags.keyTopics.map((topic: string, index: number) => (
                        <Badge key={index} variant="outline" className="text-xs">
                          {topic}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
