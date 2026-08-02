"use client";

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { 
  MessageSquare, 
  Plus, 
  Loader2, 
  TrendingUp, 
  Users, 
  Heart, 
  ThumbsUp, 
  AlertTriangle,
  CheckCircle,
  Edit3,
  Trash2,
  MoreHorizontal,
  Star,
  MessageCircle,
  Clock,
  ChevronDown,
  ChevronUp,
  BarChart3,
  Target,
  Sparkles
} from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { toast } from 'sonner';
import interviewService from '@/services/interviewService';
import { HRLogo } from "@/components/ui/HRLogo";

interface Comment {
  _id: string;
  content: string;
  authorName: string;
  authorRole: string;
  commentType: string;
  rating?: {
    overall?: number;
    technical?: number;
    communication?: number;
    cultural?: number;
  };
  categories: string[];
  visibility: string;
  createdAt: string;
  isEdited: boolean;
  reactions: Array<{
    userId: string;
    type: string;
    createdAt: string;
  }>;
  aiFlags: {
    sentiment: string;
    toxicity: number;
    keyTopics: string[];
    confidence: number;
  };
}

interface TeamAnalysis {
  analyzed: boolean;
  analyzedAt: string;
  totalComments: number;
  participantCount: number;
  overallSentiment: string;
  sentimentScore: number;
  consensus: {
    level: string;
    areas: Array<{
      topic: string;
      agreement: string;
      details: string;
    }>;
  };
  commonThemes: Array<{
    theme: string;
    frequency: number;
    sentiment: string;
    examples: string[];
  }>;
  identifiedStrengths: Array<{
    strength: string;
    mentionedBy: number;
    priority: string;
  }>;
  identifiedConcerns: Array<{
    concern: string;
    severity: string;
    mentionedBy: number;
    consensus: string;
  }>;
  finalRecommendation: {
    decision: string;
    confidence: number;
    reasoning: string;
    keyFactors: string[];
    riskFactors: string[];
    nextSteps: string[];
  };
}

interface InterviewCommentsProps {
  interviewId: string;
  teamAnalysis?: TeamAnalysis;
  onAnalysisGenerated?: (analysis: TeamAnalysis) => void;
}

const commentTypes = [
  { value: 'general', label: 'General Comment' },
  { value: 'feedback', label: 'Feedback' },
  { value: 'assessment', label: 'Assessment' },
  { value: 'concern', label: 'Concern' },
  { value: 'strength', label: 'Strength' },
  { value: 'recommendation', label: 'Recommendation' }
];

const categories = [
  'technical_skills',
  'communication',
  'problem_solving',
  'cultural_fit',
  'experience',
  'motivation',
  'leadership',
  'collaboration',
  'adaptability',
  'growth_potential',
  'red_flags',
  'next_steps'
];

const sentimentColors = {
  very_positive: 'bg-green-100 text-green-800',
  positive: 'bg-green-50 text-green-700',
  neutral: 'bg-gray-100 text-gray-800',
  negative: 'bg-red-50 text-red-700',
  very_negative: 'bg-red-100 text-red-800'
};

const consensusLevels = {
  strong_consensus: { label: 'Strong Consensus', color: 'bg-green-100 text-green-800' },
  consensus: { label: 'Consensus', color: 'bg-blue-100 text-blue-800' },
  mixed: { label: 'Mixed Opinions', color: 'bg-yellow-100 text-yellow-800' },
  no_consensus: { label: 'No Consensus', color: 'bg-orange-100 text-orange-800' },
  polarized: { label: 'Polarized', color: 'bg-red-100 text-red-800' }
};

export function InterviewComments({ interviewId, teamAnalysis, onAnalysisGenerated }: InterviewCommentsProps) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showAnalysis, setShowAnalysis] = useState(false);
  
  // Form state
  const [newComment, setNewComment] = useState('');
  const [commentType, setCommentType] = useState('general');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [rating, setRating] = useState<any>({});

  useEffect(() => {
    if (interviewId) {
      fetchComments();
    }
  }, [interviewId]);

  const fetchComments = async () => {
    try {
      setLoading(true);
      const result = await interviewService.getInterviewComments(interviewId);
      if (result.success) {
        setComments(result.comments);
      }
    } catch (error: any) {
      console.error('Error fetching comments:', error);
      toast.error('Failed to load comments');
    } finally {
      setLoading(false);
    }
  };

  const handleAddComment = async () => {
    if (!newComment.trim()) {
      toast.error('Please enter a comment');
      return;
    }

    setSubmitting(true);
    try {
      const result = await interviewService.addInterviewComment(interviewId, {
        content: newComment.trim(),
        commentType,
        rating: Object.keys(rating).length > 0 ? rating : undefined,
        categories: selectedCategories,
        visibility: 'team'
      });

      if (result.success) {
        toast.success('Comment added successfully');
        setNewComment('');
        setCommentType('general');
        setSelectedCategories([]);
        setRating({});
        setShowAddDialog(false);
        await fetchComments();
      } else {
        toast.error(result.error || 'Failed to add comment');
      }
    } catch (error: any) {
      console.error('Error adding comment:', error);
      toast.error('Failed to add comment: ' + error.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleAnalyzeComments = async () => {
    if (comments.length === 0) {
      toast.error('No comments available for analysis');
      return;
    }

    setAnalyzing(true);
    try {
      const result = await interviewService.analyzeTeamComments(interviewId);
      
      if (result.success) {
        toast.success('Team comments analyzed successfully!');
        onAnalysisGenerated?.(result.analysis);
        setShowAnalysis(true);
      } else {
        const errorMessage = result.error || 'Failed to analyze team comments';
        const errorDetails = result.details ? `\nDetails: ${result.details}` : '';
        const rawResponse = result.rawResponse ? `\nRaw Response: ${result.rawResponse}` : '';
        toast.error(`${errorMessage}${errorDetails}${rawResponse}`, {
          duration: 10000, // Show for longer
        });
      }
    } catch (error: any) {
      console.error('Error analyzing comments:', error);
      toast.error('Failed to analyze comments: ' + error.message);
    } finally {
      setAnalyzing(false);
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    try {
      const result = await interviewService.deleteInterviewComment(interviewId, commentId);
      if (result.success) {
        toast.success('Comment deleted successfully');
        await fetchComments();
      } else {
        toast.error(result.error || 'Failed to delete comment');
      }
    } catch (error: any) {
      console.error('Error deleting comment:', error);
      toast.error('Failed to delete comment: ' + error.message);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  const getInitials = (name: string) => {
    return name.split(' ').map(n => n[0]).join('').toUpperCase();
  };

  const renderRating = (rating: any) => {
    if (!rating) return null;
    
    return (
      <div className="flex gap-4 text-sm">
        {rating.overall && (
          <div className="flex items-center gap-1">
            <Star className="h-3 w-3 text-yellow-500" />
            <span>Overall: {rating.overall}/5</span>
          </div>
        )}
        {rating.technical && (
          <div className="flex items-center gap-1">
            <Target className="h-3 w-3 text-blue-500" />
            <span>Technical: {rating.technical}/5</span>
          </div>
        )}
        {rating.communication && (
          <div className="flex items-center gap-1">
            <MessageCircle className="h-3 w-3 text-green-500" />
            <span>Communication: {rating.communication}/5</span>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Comments Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="h-5 w-5" />
                Team Comments & Feedback
                {comments.length > 0 && (
                  <Badge variant="secondary">{comments.length}</Badge>
                )}
              </CardTitle>
              <CardDescription>
                Team member feedback and comments on this interview
              </CardDescription>
            </div>
            
            <div className="flex items-center gap-2">
              {comments.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleAnalyzeComments}
                  disabled={analyzing}
                >
                  {analyzing ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Analyzing...
                    </>
                  ) : (
                    <>
                      <HRLogo size="xs" className="mr-2" />
                      AI Analysis
                    </>
                  )}
                </Button>
              )}
              
              <Button onClick={() => setShowAddDialog(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Add Comment
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          {loading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="animate-pulse">
                  <div className="flex space-x-4">
                    <div className="rounded-full bg-gray-200 h-10 w-10"></div>
                    <div className="flex-1 space-y-2">
                      <div className="h-4 bg-gray-200 rounded w-1/4"></div>
                      <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : comments.length === 0 ? (
            <div className="text-center py-8">
              <MessageSquare className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">No comments yet</h3>
              <p className="text-muted-foreground mb-4">
                Be the first to share your feedback on this interview.
              </p>
              <Button onClick={() => setShowAddDialog(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Add First Comment
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {comments.map((comment) => (
                <div key={comment._id} className="border rounded-lg p-4 space-y-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3">
                      <Avatar className="h-8 w-8">
                        <AvatarFallback className="text-xs">
                          {getInitials(comment.authorName)}
                        </AvatarFallback>
                      </Avatar>
                      
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium text-sm">{comment.authorName}</span>
                          <Badge variant="outline" className="text-xs">
                            {comment.authorRole.replace('_', ' ')}
                          </Badge>
                          <Badge variant="secondary" className="text-xs">
                            {comment.commentType.replace('_', ' ')}
                          </Badge>
                          {comment.aiFlags?.sentiment && (
                            <Badge 
                              variant="outline" 
                              className={`text-xs ${sentimentColors[comment.aiFlags.sentiment as keyof typeof sentimentColors]}`}
                            >
                              {comment.aiFlags.sentiment.replace('_', ' ')}
                            </Badge>
                          )}
                        </div>
                        
                        <p className="text-gray-700 mb-2">{comment.content}</p>
                        
                        {renderRating(comment.rating)}
                        
                        {comment.categories.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {comment.categories.map((category) => (
                              <Badge key={category} variant="outline" className="text-xs">
                                {category.replace('_', ' ')}
                              </Badge>
                            ))}
                          </div>
                        )}
                        
                        <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                          <div className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {formatDate(comment.createdAt)}
                          </div>
                          {comment.isEdited && (
                            <span className="text-xs text-muted-foreground">(edited)</span>
                          )}
                        </div>
                      </div>
                    </div>
                    
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleDeleteComment(comment._id)}>
                          <Trash2 className="h-4 w-4 mr-2" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* AI Team Analysis */}
      {teamAnalysis?.analyzed && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <HRLogo size="sm" />
                  AI Team Analysis
                </CardTitle>
                <CardDescription>
                  AI analysis of team feedback and consensus • {teamAnalysis.totalComments} comments from {teamAnalysis.participantCount} team members
                </CardDescription>
              </div>
              
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowAnalysis(!showAnalysis)}
              >
                {showAnalysis ? (
                  <>
                    <ChevronUp className="h-4 w-4 mr-2" />
                    Hide Analysis
                  </>
                ) : (
                  <>
                    <ChevronDown className="h-4 w-4 mr-2" />
                    Show Analysis
                  </>
                )}
              </Button>
            </div>
          </CardHeader>

          {showAnalysis && (
            <CardContent className="space-y-6">
              {/* Overall Sentiment and Consensus */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 border rounded-lg">
                  <h3 className="font-semibold mb-2 flex items-center gap-2">
                    <TrendingUp className="h-4 w-4" />
                    Overall Sentiment
                  </h3>
                  <div className="flex items-center gap-2">
                    <Badge className={sentimentColors[teamAnalysis.overallSentiment as keyof typeof sentimentColors]}>
                      {teamAnalysis.overallSentiment.replace('_', ' ')}
                    </Badge>
                    <span className="text-sm text-muted-foreground">
                      {teamAnalysis.sentimentScore}/100
                    </span>
                  </div>
                </div>

                <div className="p-4 border rounded-lg">
                  <h3 className="font-semibold mb-2 flex items-center gap-2">
                    <Users className="h-4 w-4" />
                    Team Consensus
                  </h3>
                  <Badge className={consensusLevels[teamAnalysis.consensus.level as keyof typeof consensusLevels].color}>
                    {consensusLevels[teamAnalysis.consensus.level as keyof typeof consensusLevels].label}
                  </Badge>
                </div>
              </div>

              <Separator />

              {/* Final AI Recommendation */}
              <div className="p-4 border rounded-lg bg-blue-50">
                <h3 className="font-semibold mb-3 flex items-center gap-2">
                  <Sparkles className="h-4 w-4" />
                  Final AI Recommendation
                </h3>
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Badge variant="default" className="text-sm">
                      {teamAnalysis.finalRecommendation.decision.replace('_', ' ').toUpperCase()}
                    </Badge>
                    <span className="text-sm text-muted-foreground">
                      {teamAnalysis.finalRecommendation.confidence}% confidence
                    </span>
                  </div>
                  <p className="text-gray-700">{teamAnalysis.finalRecommendation.reasoning}</p>
                  
                  {teamAnalysis.finalRecommendation.keyFactors.length > 0 && (
                    <div>
                      <h4 className="font-medium text-sm mb-1">Key Supporting Factors:</h4>
                      <ul className="text-sm text-gray-600 space-y-1">
                        {teamAnalysis.finalRecommendation.keyFactors.map((factor, index) => (
                          <li key={index} className="flex items-start gap-2">
                            <CheckCircle className="h-3 w-3 text-green-500 mt-0.5 flex-shrink-0" />
                            {factor}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  
                  {teamAnalysis.finalRecommendation.riskFactors.length > 0 && (
                    <div>
                      <h4 className="font-medium text-sm mb-1">Risk Factors:</h4>
                      <ul className="text-sm text-gray-600 space-y-1">
                        {teamAnalysis.finalRecommendation.riskFactors.map((risk, index) => (
                          <li key={index} className="flex items-start gap-2">
                            <AlertTriangle className="h-3 w-3 text-orange-500 mt-0.5 flex-shrink-0" />
                            {risk}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>

              <Separator />

              {/* Strengths and Concerns */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {teamAnalysis.identifiedStrengths.length > 0 && (
                  <div>
                    <h3 className="font-semibold mb-3 text-green-700">
                      <CheckCircle className="h-4 w-4 inline mr-2" />
                      Team-Identified Strengths
                    </h3>
                    <div className="space-y-2">
                      {teamAnalysis.identifiedStrengths.map((strength, index) => (
                        <div key={index} className="p-2 border rounded bg-green-50">
                          <div className="flex items-center justify-between">
                            <span className="font-medium text-sm">{strength.strength}</span>
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="text-xs">
                                {strength.priority}
                              </Badge>
                              <Badge variant="secondary" className="text-xs">
                                {strength.mentionedBy} member{strength.mentionedBy !== 1 ? 's' : ''}
                              </Badge>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {teamAnalysis.identifiedConcerns.length > 0 && (
                  <div>
                    <h3 className="font-semibold mb-3 text-orange-700">
                      <AlertTriangle className="h-4 w-4 inline mr-2" />
                      Team-Identified Concerns
                    </h3>
                    <div className="space-y-2">
                      {teamAnalysis.identifiedConcerns.map((concern, index) => (
                        <div key={index} className="p-2 border rounded bg-orange-50">
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-medium text-sm">{concern.concern}</span>
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="text-xs">
                                {concern.severity} severity
                              </Badge>
                              <Badge variant="secondary" className="text-xs">
                                {concern.mentionedBy} member{concern.mentionedBy !== 1 ? 's' : ''}
                              </Badge>
                            </div>
                          </div>
                          <Badge variant="outline" className="text-xs">
                            {concern.consensus} consensus
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          )}
        </Card>
      )}

      {/* Add Comment Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="max-w-[95vw] sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add Team Feedback</DialogTitle>
            <DialogDescription>
              Share your feedback and assessment of this interview with your team.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-2 block">Comment</label>
              <Textarea
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="Share your thoughts on the candidate's performance, fit, and your recommendations..."
                rows={4}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium mb-2 block">Comment Type</label>
                <Select value={commentType} onValueChange={setCommentType}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    {commentTypes.map((type) => (
                      <SelectItem key={type.value} value={type.value}>
                        {type.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">Overall Rating (Optional)</label>
                <Select 
                  value={rating.overall?.toString() || ''} 
                  onValueChange={(value) => setRating({...rating, overall: parseInt(value)})}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Rate 1-5" />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 4, 5].map((num) => (
                      <SelectItem key={num} value={num.toString()}>
                        {num} Star{num !== 1 ? 's' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowAddDialog(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              onClick={handleAddComment}
              disabled={submitting || !newComment.trim()}
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Adding...
                </>
              ) : (
                'Add Comment'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
} 