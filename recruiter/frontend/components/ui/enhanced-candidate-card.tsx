'use client'

import React from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  Calendar,
  Clock,
  Star,
  Phone,
  Mail,
  MapPin,
  TrendingUp,
  AlertTriangle,
  CheckCircle,
  Timer,
  ChevronLeft,
  ChevronRight,
  ArrowLeft,
  ArrowRight,
  X,
  XCircle
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { CandidateRejectionButton } from '@/components/ui/candidate-rejection-email-controls'

interface EnhancedCandidateCardProps {
  candidate: {
    _id: string
    firstName: string
    lastName: string
    email: string
    phone?: string
    avatar?: string
    position?: string
    experience?: string
    skills?: string
    location?: string
    currentStage: {
      stageId: string
      stageName: string
      enteredAt: string
    }
    interviews: Array<{
      interviewId: string
      stageId: string
      scheduledAt: string
      status: 'scheduled' | 'confirmed' | 'completed' | 'cancelled' | 'no_show'
      score?: number
    }>
    aiInsights?: {
      recommendedAction?: 'advance' | 'reject' | 'additional_assessment' | 'different_role'
      confidence: number
      overallScore: number
      keyStrengths?: string[]
      keyConcerns?: string[]
    }
    priority: 'high' | 'medium' | 'low'
    tags: string[]
    applicationDate: string
    source: string
  }
  stageId: string
  jobId?: string
  isMoving?: boolean
  onClick: () => void
  onQuickAction?: (action: string) => void
  onMoveStage?: (candidateId: string, direction: 'previous' | 'next') => void
  stages?: Array<{ _id: string; name: string; order: number }>
  currentStageOrder?: number
  getDaysInStage: (date: string) => number
  getInitials: (candidate: any) => string
  onEmailSent?: () => void
}

const getPriorityConfig = (priority: string) => {
  switch (priority) {
    case 'high':
      return {
        borderClass: 'border-l-red-500',
        bgClass: 'bg-gradient-to-br from-red-950/40 via-red-900/20 to-red-950/10 dark:from-red-950/40 dark:via-red-900/20 dark:to-red-950/10 backdrop-blur-sm',
        badgeClass: 'bg-red-500/10 text-red-400 border border-red-500/20',
        icon: <AlertTriangle className="h-3 w-3" />
      }
    case 'medium':
      return {
        borderClass: 'border-l-yellow-500',
        bgClass: 'bg-gradient-to-br from-yellow-950/40 via-yellow-900/20 to-yellow-950/10 dark:from-yellow-950/40 dark:via-yellow-900/20 dark:to-yellow-950/10 backdrop-blur-sm',
        badgeClass: 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20',
        icon: <Timer className="h-3 w-3" />
      }
    case 'low':
      return {
        borderClass: 'border-l-green-500',
        bgClass: 'bg-gradient-to-br from-green-950/40 via-green-900/20 to-green-950/10 dark:from-green-950/40 dark:via-green-900/20 dark:to-green-950/10 backdrop-blur-sm',
        badgeClass: 'bg-green-500/10 text-green-400 border border-green-500/20',
        icon: <CheckCircle className="h-3 w-3" />
      }
    default:
      return {
        borderClass: 'border-l-gray-500',
        bgClass: 'glass-card hover:bg-white/5 transition-colors',
        badgeClass: 'bg-white/10 text-gray-300 border border-white/10',
        icon: <Clock className="h-3 w-3" />
      }
  }
}

const getAIRecommendationConfig = (action?: string) => {
  switch (action) {
    case 'advance':
      return { color: 'text-green-600 dark:text-green-400', bg: 'bg-green-50 dark:bg-green-950/30', label: 'Advance' }
    case 'additional_assessment':
      return { color: 'text-yellow-600 dark:text-yellow-400', bg: 'bg-yellow-50 dark:bg-yellow-950/30', label: 'Review' }
    case 'different_role':
      return { color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-950/30', label: 'Other Role' }
    case 'reject':
      return { color: 'text-red-600 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-950/30', label: 'Reject' }
    default:
      return { color: 'text-muted-foreground dark:text-muted-foreground/70', bg: 'bg-muted/30 dark:bg-gray-950/30', label: 'Pending' }
  }
}

export function EnhancedCandidateCard({
  candidate,
  stageId,
  jobId,
  isMoving = false,
  onClick,
  onQuickAction,
  onMoveStage,
  stages = [],
  currentStageOrder = 0,
  getDaysInStage,
  getInitials,
  onEmailSent
}: EnhancedCandidateCardProps) {
  const priorityConfig = getPriorityConfig(candidate.priority)
  const daysInStage = getDaysInStage(candidate.currentStage.enteredAt)
  const isOverdue = daysInStage > 7 // Consider 7+ days as overdue
  const aiRecommendation = getAIRecommendationConfig(candidate.aiInsights?.recommendedAction)
  const isRejected = candidate.status === 'rejected'

  // Get current stage interviews
  const stageInterviews = candidate.interviews.filter(i => i.stageId === stageId)
  const upcomingInterview = stageInterviews.find(i => i.status === 'scheduled' || i.status === 'confirmed')
  const completedInterviews = stageInterviews.filter(i => i.status === 'completed')

  return (
    <Card
      className={cn(
        "cursor-pointer transition-all duration-300 group relative border-l-[3px] transform-gpu border-0 shadow-lg",
        isRejected
          ? "bg-red-950/10 border-l-red-500/50 border-white/5 opacity-60 hover:opacity-90 hover:shadow-red-900/10"
          : "hover:shadow-xl hover:scale-[1.02] border-white/5 ring-1 ring-white/5 " + priorityConfig.borderClass + " " + priorityConfig.bgClass,
        isMoving && "opacity-50 scale-95"
      )}
      onClick={onClick}
    >
      <CardContent className="p-4 sm:p-4 space-y-3 sm:space-y-3 relative">
        {/* Rejected Status Indicator */}
        {isRejected && (
          <div className="absolute top-2 right-2 z-10">
            <div className="bg-red-500/20 backdrop-blur-sm rounded-full p-1.5 border border-red-300 dark:border-red-600">
              <X className="h-3 w-3 text-red-600 dark:text-red-400" />
            </div>
          </div>
        )}
        {/* Header Section */}
        <div className="flex items-start justify-between">
          <div className="flex items-center space-x-3 min-w-0 flex-1">
            <div className="relative">
              <Avatar className="h-12 w-12 ring-2 ring-white/10 shadow-lg bg-black/40">
                <AvatarImage src={candidate.avatar} alt={`${candidate.firstName} ${candidate.lastName}`} />
                <AvatarFallback className="bg-gradient-to-br from-blue-600 to-purple-700 text-white font-semibold text-sm">
                  {getInitials(candidate)}
                </AvatarFallback>
              </Avatar>
              {/* Online/Status Indicator */}
              <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-green-500 rounded-full border-2 border-white dark:border-slate-800 flex items-center justify-center">
                <div className="w-2 h-2 bg-white rounded-full"></div>
              </div>
            </div>

            <div className="min-w-0 flex-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <h3 className={`font-semibold truncate cursor-help text-base ${isRejected
                      ? 'text-gray-500 line-through'
                      : 'text-white group-hover:text-blue-200 transition-colors'
                    }`}>
                    {candidate.firstName} {candidate.lastName}
                  </h3>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{candidate.firstName} {candidate.lastName}</p>
                </TooltipContent>
              </Tooltip>

              <div className="hidden sm:flex items-center space-x-1 mt-1">
                <Mail className="h-3 w-3 text-gray-400" />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <p className="text-sm text-gray-400 truncate cursor-help max-w-[160px]">
                      {candidate.email}
                    </p>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{candidate.email}</p>
                  </TooltipContent>
                </Tooltip>
              </div>

              {candidate.location && (
                <div className="hidden sm:flex items-center space-x-1 mt-1">
                  <MapPin className="h-3 w-3 text-gray-400" />
                  <p className="text-xs text-gray-400 truncate">
                    {candidate.location}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Priority Badge - Mobile Optimized */}
          <Badge className={cn(
            "text-xs font-medium flex items-center space-x-1 px-2 py-0.5 shadow-sm",
            priorityConfig.badgeClass
          )}>
            {priorityConfig.icon}
            <span className="capitalize hidden sm:inline">{candidate.priority}</span>
            <span className="capitalize sm:hidden">{candidate.priority.charAt(0)}</span>
          </Badge>
        </div>

        {/* Position & Experience */}
        {(candidate.position || candidate.experience) && (
          <div className="space-y-1">
            {candidate.position && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <p className="font-semibold text-gray-200 text-base sm:text-sm truncate cursor-help">
                    {candidate.position}
                  </p>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{candidate.position}</p>
                </TooltipContent>
              </Tooltip>
            )}
            {candidate.experience && (
              <p className="hidden sm:block text-xs text-gray-400 truncate">{candidate.experience}</p>
            )}
          </div>
        )}

        {/* Skills Preview */}
        {candidate.skills && (
          <div className="flex flex-wrap gap-1">
            {candidate.skills.split(',').slice(0, 3).map((skill, index) => (
              <Badge key={index} variant="secondary" className="text-xs px-2 py-0.5 bg-blue-500/10 text-blue-300 border border-blue-500/20">
                {skill.trim()}
              </Badge>
            ))}
            {candidate.skills.split(',').length > 3 && (
              <Badge variant="outline" className="text-xs px-2 py-0.5">
                +{candidate.skills.split(',').length - 3} more
              </Badge>
            )}
          </div>
        )}

        {/* AI Insights */}
        {candidate.aiInsights && (
          <div className={cn("hidden sm:block p-3 rounded-lg border border-white/5", aiRecommendation.bg)}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center space-x-2">
                <TrendingUp className="h-4 w-4 text-blue-400" />
                <span className="text-sm font-medium text-gray-200">AI Score</span>
              </div>
              <div className="flex items-center space-x-2">
                <Star className="h-4 w-4 text-yellow-500" />
                <span className="font-bold text-sm">{Math.round(candidate.aiInsights.overallScore || 0)}%</span>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">Recommendation:</span>
              <Badge variant="outline" className={cn("text-xs capitalize border-0", aiRecommendation.color)}>
                {aiRecommendation.label}
              </Badge>
            </div>
          </div>
        )}

        {/* Interview Status */}
        <div className="space-y-2">
          {upcomingInterview && (
            <div className="flex items-center justify-between p-2 bg-blue-500/10 rounded-lg border border-blue-500/20">
              <div className="flex items-center space-x-2">
                <Calendar className="h-4 w-4 text-blue-400" />
                <div>
                  <p className="text-sm font-medium text-blue-100">Next Interview</p>
                  <p className="text-xs text-blue-300">
                    {new Date(upcomingInterview.scheduledAt).toLocaleDateString()}
                  </p>
                </div>
              </div>
              <Badge className="bg-blue-500/20 text-blue-200 border-0 text-xs">
                {upcomingInterview.status}
              </Badge>
            </div>
          )}

          {completedInterviews.length > 0 && (
            <div className="hidden sm:flex items-center justify-between text-xs text-muted-foreground">
              <span>Completed interviews: {completedInterviews.length}</span>
              {completedInterviews[0]?.score && (
                <span className="font-medium">Last score: {completedInterviews[0].score}/10</span>
              )}
            </div>
          )}
        </div>

        {/* Time in Stage & Status */}
        <div className="flex items-center justify-between pt-2 border-t border-white/5">
          <div className="flex items-center gap-1.5">
            <Clock className={cn("h-3.5 w-3.5 sm:h-4 sm:w-4", isOverdue ? "text-red-400" : "text-gray-500")} />
            <span className={cn("text-xs font-medium", isOverdue ? "text-red-400" : "text-gray-500")}>
              <span className="sm:hidden">{daysInStage}d</span>
              <span className="hidden sm:inline">{daysInStage} day{daysInStage !== 1 ? 's' : ''} in stage</span>
            </span>
          </div>

          <div className="hidden sm:flex items-center space-x-1">
            <div className="text-xs text-muted-foreground">
              from {candidate.source}
            </div>
          </div>
        </div>

        {/* Tags */}
        {candidate.tags.length > 0 && (
          <div className="hidden sm:flex flex-wrap gap-1">
            {candidate.tags.slice(0, 2).map((tag, index) => (
              <Badge key={index} variant="outline" className="text-xs px-1.5 py-0.5 bg-white/5 text-gray-400 border-white/10">
                {tag}
              </Badge>
            ))}
            {candidate.tags.length > 2 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="outline" className="text-xs px-1.5 py-0.5 cursor-help">
                    +{candidate.tags.length - 2}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{candidate.tags.slice(2).join(', ')}</p>
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        )}

        {/* Stage Movement Controls */}
        {onMoveStage && stages.length > 1 && (
          <div className="flex items-center justify-between pt-3 border-t border-white/5">
            <span className="text-xs text-gray-500 font-medium hidden sm:inline">Quick Move:</span>
            <span className="text-xs text-muted-foreground font-medium sm:hidden">Move:</span>
            <div className="flex items-center space-x-2">
              {/* Move to Previous Stage */}
              {currentStageOrder > 0 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 w-8 sm:h-6 sm:w-6 p-0 hover:bg-blue-500/20 hover:border-blue-500/50 border-white/10 bg-transparent touch-manipulation text-gray-400 hover:text-blue-400"
                      onClick={(e) => {
                        e.stopPropagation()
                        onMoveStage(candidate._id, 'previous')
                      }}
                    >
                      <ChevronLeft className="h-4 w-4 sm:h-3 sm:w-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Move to previous stage</p>
                  </TooltipContent>
                </Tooltip>
              )}

              {/* Stage Indicator */}
              <div className="px-2 py-1 bg-white/5 rounded text-xs font-medium text-gray-400">
                {currentStageOrder + 1}/{stages.length}
              </div>

              {/* Move to Next Stage */}
              {currentStageOrder < stages.length - 1 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 w-8 sm:h-6 sm:w-6 p-0 hover:bg-green-500/20 hover:border-green-500/50 border-white/10 bg-transparent touch-manipulation text-gray-400 hover:text-green-400"
                      onClick={(e) => {
                        e.stopPropagation()
                        onMoveStage(candidate._id, 'next')
                      }}
                    >
                      <ChevronRight className="h-4 w-4 sm:h-3 sm:w-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Move to next stage</p>
                  </TooltipContent>
                </Tooltip>
              )}

              {/* Rejection Button - Only show if not already rejected */}
              {jobId && !isRejected && (
                <div className="ml-2">
                  <CandidateRejectionButton
                    candidate={{
                      _id: candidate._id,
                      firstName: candidate.firstName,
                      lastName: candidate.lastName,
                      email: candidate.email,
                      currentStage: candidate.currentStage,
                      status: 'interviewing'
                    }}
                    jobId={jobId}
                    onEmailSent={onEmailSent}
                    isShortlistRejection={false}
                    size="sm"
                    variant="ghost"
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Rejected Status Message - Subtle and Clean */}
        {isRejected && (
          <div className="flex items-center justify-center pt-2">
            {/* Mobile: Very compact badge */}
            <Badge variant="outline" className="sm:hidden border-red-300 text-red-700 dark:border-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/20 text-xs px-2 py-0.5">
              <X className="h-2.5 w-2.5 mr-1" />
              Rejected
            </Badge>

            {/* Desktop: Compact status */}
            <div className="hidden sm:flex items-center text-red-600 dark:text-red-400 text-sm">
              <XCircle className="h-3.5 w-3.5 mr-1.5" />
              <span className="font-medium">Rejected</span>
            </div>
          </div>
        )}

        {/* Loading Overlay */}
        {isMoving && (
          <div className="absolute inset-0 bg-white/80 dark:bg-slate-800/80 rounded-lg flex items-center justify-center">
            <div className="flex flex-col items-center space-y-2">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
              <span className="text-xs text-muted-foreground">Moving...</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
