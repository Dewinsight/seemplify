'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Progress } from '@/components/ui/progress'
import { 
  Trophy, 
  TrendingUp, 
  Users, 
  Award,
  Star,
  MessageSquare,
  User,
  Loader2,
  ChevronDown,
  ChevronUp,
  Medal,
  BarChart3,
  FileText
} from 'lucide-react'
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import leaderboardService, { 
  type LeaderboardData, 
  type StageLeaderboard, 
  type LeaderboardCandidate,
  type JobFeedbackData,
  type FeedbackComment
} from '@/services/leaderboardService'
import { cn } from '@/lib/utils'
import Link from 'next/link'

interface FeedbackLeaderboardProps {
  jobId: string
}

export function FeedbackLeaderboard({ jobId }: FeedbackLeaderboardProps) {
  const [leaderboardData, setLeaderboardData] = useState<LeaderboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedStage, setSelectedStage] = useState('all')
  const [sortBy, setSortBy] = useState('overallScore')
  const [expandedStages, setExpandedStages] = useState<Set<string>>(new Set())

  useEffect(() => {
    fetchAndOrganizeFeedback()
  }, [jobId])

  useEffect(() => {
    // Re-organize when filters change
    if (leaderboardData) {
      const organized = organizeFeedbackData(leaderboardData as any, selectedStage, sortBy)
      setLeaderboardData(organized)
    }
  }, [selectedStage, sortBy])

  const fetchAndOrganizeFeedback = async () => {
    try {
      setLoading(true)
      // Fetch ALL feedback for the job
      const feedbackData = await leaderboardService.getAllJobFeedback(jobId)
      
      console.log('📊 [LEADERBOARD] Fetched feedback data:', feedbackData)
      
      // Organize feedback by stage on the frontend
      const organized = organizeFeedbackData(feedbackData, selectedStage, sortBy)
      setLeaderboardData(organized)
      
      // Expand the first stage by default
      if (organized.stages.length > 0) {
        setExpandedStages(new Set([organized.stages[0].stageId]))
      }
    } catch (error) {
      console.error('Error fetching leaderboard:', error)
    } finally {
      setLoading(false)
    }
  }

  const organizeFeedbackData = (
    feedbackData: JobFeedbackData, 
    filterStageId: string,
    sortField: string
  ): LeaderboardData => {
    // Group feedback by stage
    const stageMap = new Map<string, {
      stageId: string
      stageName: string
      stageOrder: number
      candidates: Map<string, any>
    }>()

    console.log('📊 [ORGANIZE] Processing', feedbackData.feedback.length, 'feedback comments')

    feedbackData.feedback.forEach(comment => {
      const interview = comment.interviewId
      if (!interview || !interview.candidateId) {
        console.log('⚠️ [ORGANIZE] Skipping comment - missing interview or candidate')
        return
      }

      // Get stage info from interview
      const stageId = interview.stageId?._id || interview.stageId as any
      const stageName = interview.stageId?.name || interview.stageName || 'Unknown Stage'
      const stageOrder = interview.stageId?.order ?? interview.stageOrder ?? 0

      if (!stageId) {
        console.log('⚠️ [ORGANIZE] Skipping comment - no stageId')
        return
      }

      // Initialize stage if not exists
      if (!stageMap.has(stageId)) {
        stageMap.set(stageId, {
          stageId,
          stageName,
          stageOrder,
          candidates: new Map()
        })
      }

      const stage = stageMap.get(stageId)!
      const candidateId = interview.candidateId._id

      // Initialize candidate if not exists
      if (!stage.candidates.has(candidateId)) {
        stage.candidates.set(candidateId, {
          candidateId,
          candidateName: `${interview.candidateId.firstName} ${interview.candidateId.lastName}`,
          candidateEmail: interview.candidateId.email,
          candidatePosition: interview.candidateId.position || '',
          candidateAvatar: interview.candidateId.avatar,
          interviewId: interview._id,
          interviewStatus: interview.status,
          feedback: [],
          ratings: {
            overall: [],
            technical: [],
            communication: [],
            cultural: []
          }
        })
      }

      const candidate = stage.candidates.get(candidateId)!
      candidate.feedback.push(comment)

      // Collect ratings
      if (comment.rating) {
        if (comment.rating.overall) candidate.ratings.overall.push(comment.rating.overall)
        if (comment.rating.technical) candidate.ratings.technical.push(comment.rating.technical)
        if (comment.rating.communication) candidate.ratings.communication.push(comment.rating.communication)
        if (comment.rating.cultural) candidate.ratings.cultural.push(comment.rating.cultural)
      }
    })

    console.log('📊 [ORGANIZE] Found', stageMap.size, 'stages with candidates')

    // Calculate scores and build leaderboards
    const stages: StageLeaderboard[] = []
    
    stageMap.forEach((stageData) => {
      const candidates: LeaderboardCandidate[] = []

      stageData.candidates.forEach((candidateData) => {
        const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0

        // Check for structured feedback first
        const structuredScore = candidateData.feedback[0]?.interviewId?.structuredFeedback?.overallScore
        
        let overallScore = 0
        if (structuredScore) {
          overallScore = structuredScore
        } else if (candidateData.ratings.overall.length > 0) {
          // Convert 1-5 rating to 0-100 scale
          overallScore = (avg(candidateData.ratings.overall) / 5) * 100
        }

        // Only include candidates with scores
        if (overallScore === 0) {
          console.log('⚠️ [ORGANIZE] Skipping candidate - no score:', candidateData.candidateName)
          return
        }

        const scoreBreakdown: any = {
          technical: (avg(candidateData.ratings.technical) / 5) * 100,
          communication: (avg(candidateData.ratings.communication) / 5) * 100,
          cultural: (avg(candidateData.ratings.cultural) / 5) * 100
        }

        // Performance rating
        const performanceRating = 
          overallScore >= 90 ? 'excellent' :
          overallScore >= 80 ? 'strong' :
          overallScore >= 70 ? 'good' :
          overallScore >= 60 ? 'fair' : 'needs_improvement'

        // Get unique assessors
        const assessors = new Set(candidateData.feedback.map((f: any) => f.authorId?._id).filter(Boolean))

        candidates.push({
          rank: 0, // Will set after sorting
          candidateId: candidateData.candidateId,
          candidateName: candidateData.candidateName,
          candidateEmail: candidateData.candidateEmail,
          candidatePosition: candidateData.candidatePosition,
          candidateAvatar: candidateData.candidateAvatar,
          overallScore,
          performanceRating: performanceRating as any,
          scoreBreakdown,
          recommendation: 'pending',
          feedbackStats: {
            totalResponses: candidateData.feedback.length,
            totalAssessors: assessors.size,
            lastFeedbackAt: candidateData.feedback[0]?.createdAt || null
          },
          interviewDetails: {
            interviewId: candidateData.interviewId,
            scheduledAt: candidateData.feedback[0]?.interviewId?.scheduledAt || '',
            completedAt: '',
            status: candidateData.interviewStatus
          }
        })
      })

      // Sort candidates
      candidates.sort((a, b) => b.overallScore - a.overallScore)
      
      // Assign ranks
      candidates.forEach((c, i) => {
        c.rank = i + 1
      })

      console.log('📊 [ORGANIZE] Stage', stageData.stageName, '- Candidates:', candidates.length)

      // Calculate statistics
      const scores = candidates.map(c => c.overallScore)
      const averageScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0

      const scoreDistribution = {
        excellent: candidates.filter(c => c.overallScore >= 90).length,
        strong: candidates.filter(c => c.overallScore >= 80 && c.overallScore < 90).length,
        good: candidates.filter(c => c.overallScore >= 70 && c.overallScore < 80).length,
        fair: candidates.filter(c => c.overallScore >= 60 && c.overallScore < 70).length,
        needsImprovement: candidates.filter(c => c.overallScore < 60).length
      }

      stages.push({
        stageId: stageData.stageId,
        stageName: stageData.stageName,
        stageOrder: stageData.stageOrder,
        statistics: {
          totalCandidates: candidates.length,
          averageScore,
          completionRate: candidates.length > 0 ? 1 : 0,
          topPerformer: candidates.length > 0 ? {
            candidateId: candidates[0].candidateId,
            name: candidates[0].candidateName,
            score: candidates[0].overallScore
          } : null,
          scoreDistribution
        },
        leaderboard: candidates
      })
    })

    // Sort stages by order
    stages.sort((a, b) => a.stageOrder - b.stageOrder)

    // Filter by stage if needed
    const filteredStages = filterStageId === 'all' 
      ? stages 
      : stages.filter(s => s.stageId === filterStageId)

    // Calculate overall statistics
    const allCandidates = filteredStages.flatMap(s => s.leaderboard)
    const totalScores = allCandidates.map(c => c.overallScore)
    const totalFeedback = allCandidates.reduce((sum, c) => sum + c.feedbackStats.totalResponses, 0)

    return {
      success: true,
      jobId: feedbackData.jobId,
      jobTitle: feedbackData.jobTitle,
      stages: filteredStages,
      overallStatistics: {
        totalCandidatesInterviewed: allCandidates.length,
        averageScoreAllStages: totalScores.length > 0 ? totalScores.reduce((a, b) => a + b, 0) / totalScores.length : 0,
        totalFeedbackResponses: totalFeedback,
        totalStages: filteredStages.length
      }
    }
  }

  const toggleStageExpansion = (stageId: string) => {
    const newExpanded = new Set(expandedStages)
    if (newExpanded.has(stageId)) {
      newExpanded.delete(stageId)
    } else {
      newExpanded.add(stageId)
    }
    setExpandedStages(newExpanded)
  }

  const getPerformanceColor = (rating: string) => {
    const colors = {
      excellent: 'text-green-600 bg-green-50 border-green-200',
      strong: 'text-blue-600 bg-blue-50 border-blue-200',
      good: 'text-yellow-600 bg-yellow-50 border-yellow-200',
      fair: 'text-orange-600 bg-orange-50 border-orange-200',
      needs_improvement: 'text-red-600 bg-red-50 border-red-200'
    }
    return colors[rating as keyof typeof colors] || colors.fair
  }

  const getPerformanceLabel = (rating: string) => {
    const labels = {
      excellent: 'Excellent',
      strong: 'Strong',
      good: 'Good',
      fair: 'Fair',
      needs_improvement: 'Needs Improvement'
    }
    return labels[rating as keyof typeof labels] || rating
  }

  const getRankMedal = (rank: number) => {
    if (rank === 1) return <span className="text-2xl">🥇</span>
    if (rank === 2) return <span className="text-2xl">🥈</span>
    if (rank === 3) return <span className="text-2xl">🥉</span>
    return (
      <div className="w-8 h-8 rounded-full bg-muted/50 dark:bg-card/40 flex items-center justify-center">
        <span className="text-sm font-bold text-foreground">{rank}</span>
      </div>
    )
  }

  const renderStarRating = (score: number) => {
    const stars = Math.round((score / 100) * 5)
    return (
      <div className="flex items-center gap-0.5">
        {[...Array(5)].map((_, i) => (
          <Star
            key={i}
            className={cn(
              "h-4 w-4",
              i < stars ? "fill-yellow-400 text-yellow-400" : "fill-gray-200 text-gray-200"
            )}
          />
        ))}
      </div>
    )
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="p-12 flex flex-col items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600 mb-4" />
          <p className="text-muted-foreground">Loading leaderboard...</p>
        </CardContent>
      </Card>
    )
  }

  if (!leaderboardData || leaderboardData.stages.length === 0) {
    return (
      <Card>
        <CardContent className="p-12 flex flex-col items-center justify-center text-center">
          <Trophy className="h-16 w-16 text-muted-foreground/60 mb-4" />
          <h3 className="text-lg font-semibold text-foreground mb-2">No Feedback Data Available</h3>
          <p className="text-muted-foreground max-w-md">
            There is no interview feedback available yet for this job. 
            Feedback will appear here once interviews are completed and assessors submit their evaluations.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header with Statistics */}
      <Card className="border-0 bg-gradient-to-br from-blue-500 to-purple-600 text-white shadow-xl">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-2xl">
                <Trophy className="h-7 w-7" />
                Feedback Leaderboard
              </CardTitle>
              <CardDescription className="text-blue-100">
                {leaderboardData.jobTitle}
              </CardDescription>
            </div>
            <Link href={`/jobs/${jobId}/feedback`}>
              <Button variant="secondary" size="sm">
                <FileText className="h-4 w-4 mr-2" />
                View All Feedback
              </Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4">
              <div className="text-white/80 text-sm mb-1">Total Candidates</div>
              <div className="text-3xl font-bold">
                {leaderboardData.overallStatistics.totalCandidatesInterviewed}
              </div>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4">
              <div className="text-white/80 text-sm mb-1">Average Score</div>
              <div className="text-3xl font-bold">
                {leaderboardData.overallStatistics.averageScoreAllStages.toFixed(1)}
              </div>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4">
              <div className="text-white/80 text-sm mb-1">Total Feedback</div>
              <div className="text-3xl font-bold">
                {leaderboardData.overallStatistics.totalFeedbackResponses}
              </div>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4">
              <div className="text-white/80 text-sm mb-1">Interview Stages</div>
              <div className="text-3xl font-bold">
                {leaderboardData.overallStatistics.totalStages}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1">
              <label className="text-sm font-medium text-gray-700 mb-2 block">Filter by Stage</label>
              <Select value={selectedStage} onValueChange={setSelectedStage}>
                <SelectTrigger>
                  <SelectValue placeholder="All Stages" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Stages</SelectItem>
                  {leaderboardData.stages.map((stage) => (
                    <SelectItem key={stage.stageId} value={stage.stageId}>
                      Round {stage.stageOrder}: {stage.stageName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1">
              <label className="text-sm font-medium text-gray-700 mb-2 block">Sort By</label>
              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger>
                  <SelectValue placeholder="Overall Score" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="overallScore">Overall Score (Highest)</SelectItem>
                  <SelectItem value="candidateName">Candidate Name (A-Z)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stage Leaderboards */}
      {leaderboardData.stages.map((stage) => (
        <StageLeaderboardSection
          key={stage.stageId}
          stage={stage}
          isExpanded={expandedStages.has(stage.stageId)}
          onToggle={() => toggleStageExpansion(stage.stageId)}
          getRankMedal={getRankMedal}
          renderStarRating={renderStarRating}
          getPerformanceColor={getPerformanceColor}
          getPerformanceLabel={getPerformanceLabel}
        />
      ))}
    </div>
  )
}

interface StageLeaderboardSectionProps {
  stage: StageLeaderboard
  isExpanded: boolean
  onToggle: () => void
  getRankMedal: (rank: number) => JSX.Element
  renderStarRating: (score: number) => JSX.Element
  getPerformanceColor: (rating: string) => string
  getPerformanceLabel: (rating: string) => string
}

function StageLeaderboardSection({
  stage,
  isExpanded,
  onToggle,
  getRankMedal,
  renderStarRating,
  getPerformanceColor,
  getPerformanceLabel
}: StageLeaderboardSectionProps) {
  const { statistics, leaderboard } = stage

  return (
    <Card>
      <CardHeader 
        className="cursor-pointer hover:bg-muted/30 dark:hover:bg-gray-800 transition-colors"
        onClick={onToggle}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center">
              <span className="text-sm font-bold text-blue-700 dark:text-blue-300">
                R{stage.stageOrder}
              </span>
            </div>
            <div>
              <CardTitle className="text-lg">{stage.stageName}</CardTitle>
              <CardDescription>
                {statistics.totalCandidates} candidates • Avg Score: {statistics.averageScore.toFixed(1)}
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {statistics.topPerformer && (
              <div className="hidden md:flex items-center gap-2 text-sm text-muted-foreground">
                <Medal className="h-4 w-4 text-yellow-500" />
                <span>Top: {statistics.topPerformer.name} ({statistics.topPerformer.score.toFixed(1)})</span>
              </div>
            )}
            {isExpanded ? (
              <ChevronUp className="h-5 w-5 text-gray-400" />
            ) : (
              <ChevronDown className="h-5 w-5 text-gray-400" />
            )}
          </div>
        </div>

        {/* Score Distribution */}
        {statistics.totalCandidates > 0 && (
          <div className="mt-4 flex items-center gap-2 text-sm">
            <BarChart3 className="h-4 w-4 text-gray-400" />
            <div className="flex-1 flex gap-2">
              {statistics.scoreDistribution.excellent > 0 && (
                <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                  Excellent: {statistics.scoreDistribution.excellent}
                </Badge>
              )}
              {statistics.scoreDistribution.strong > 0 && (
                <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                  Strong: {statistics.scoreDistribution.strong}
                </Badge>
              )}
              {statistics.scoreDistribution.good > 0 && (
                <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200">
                  Good: {statistics.scoreDistribution.good}
                </Badge>
              )}
            </div>
          </div>
        )}
      </CardHeader>

      {isExpanded && leaderboard.length > 0 && (
        <CardContent className="space-y-4">
          {leaderboard.map((candidate) => (
            <CandidateCard
              key={candidate.candidateId}
              candidate={candidate}
              getRankMedal={getRankMedal}
              renderStarRating={renderStarRating}
              getPerformanceColor={getPerformanceColor}
              getPerformanceLabel={getPerformanceLabel}
            />
          ))}
        </CardContent>
      )}

      {isExpanded && leaderboard.length === 0 && (
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            <Users className="h-12 w-12 mx-auto mb-3 text-muted-foreground/60" />
            <p>No candidates with feedback in this stage yet.</p>
          </div>
        </CardContent>
      )}
    </Card>
  )
}

interface CandidateCardProps {
  candidate: LeaderboardCandidate
  getRankMedal: (rank: number) => JSX.Element
  renderStarRating: (score: number) => JSX.Element
  getPerformanceColor: (rating: string) => string
  getPerformanceLabel: (rating: string) => string
}

function CandidateCard({
  candidate,
  getRankMedal,
  renderStarRating,
  getPerformanceColor,
  getPerformanceLabel
}: CandidateCardProps) {
  return (
    <div className="border rounded-lg p-4 hover:shadow-lg transition-shadow glass-card bg-popover/40 dark:bg-card/30 border-border/60">
      <div className="flex items-start gap-4">
        {/* Rank Badge */}
        <div className="flex-shrink-0 pt-1">
          {getRankMedal(candidate.rank)}
        </div>

        {/* Candidate Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-3">
              <Avatar className="h-10 w-10">
                <AvatarImage src={candidate.candidateAvatar} />
                <AvatarFallback>
                  {candidate.candidateName.split(' ').map(n => n[0]).join('').toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div>
                <Link 
                  href={`/candidates/${candidate.candidateId}`}
                  className="font-semibold text-foreground dark:text-gray-100 hover:text-blue-600 dark:hover:text-blue-400"
                >
                  {candidate.candidateName}
                </Link>
                <p className="text-sm text-muted-foreground">{candidate.candidatePosition || 'Candidate'}</p>
              </div>
            </div>
            
            {/* Overall Score */}
            <div className="text-right">
              <div className="text-3xl font-bold text-blue-600">{candidate.overallScore.toFixed(1)}</div>
              <div className="text-xs text-muted-foreground">out of 100</div>
            </div>
          </div>

          {/* Performance Rating & Stars */}
          <div className="flex items-center gap-3 mb-3">
            {renderStarRating(candidate.overallScore)}
            <Badge className={cn("border", getPerformanceColor(candidate.performanceRating))}>
              {getPerformanceLabel(candidate.performanceRating)}
            </Badge>
          </div>

          {/* Score Breakdown */}
          <div className="space-y-2 mb-3">
            {/* System Fields (New Comprehensive Format) */}
            {candidate.scoreBreakdown?.systemFields && Object.entries(candidate.scoreBreakdown.systemFields).map(([label, data]: [string, any]) => (
              <div key={label}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-medium">{((data.average / 5) * 100).toFixed(0)}</span>
                </div>
                <Progress value={(data.average / 5) * 100} className="h-2" />
              </div>
            ))}

            {/* Custom Fields (New Comprehensive Format) */}
            {candidate.scoreBreakdown?.customFields && Object.entries(candidate.scoreBreakdown.customFields).map(([label, data]: [string, any]) => (
              <div key={label}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-purple-600 dark:text-purple-400">{label}</span>
                  <span className="font-medium">{((data.average / 5) * 100).toFixed(0)}</span>
                </div>
                <Progress value={(data.average / 5) * 100} className="h-2 bg-purple-100" />
              </div>
            ))}

            {/* Calculated Fields (New Comprehensive Format) */}
            {candidate.scoreBreakdown?.calculatedFields && Object.entries(candidate.scoreBreakdown.calculatedFields).map(([label, data]: [string, any]) => (
              <div key={label}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-amber-600 dark:text-amber-400">{label}</span>
                  <span className="font-medium">{data.value.toFixed(2)}</span>
                </div>
                <div className="text-xs text-muted-foreground font-mono truncate" title={data.formula}>
                  {data.formula}
                </div>
              </div>
            ))}

            {/* Fallback: Old Format (for backward compatibility) */}
            {!candidate.scoreBreakdown?.systemFields && candidate.scoreBreakdown?.technical !== undefined && candidate.scoreBreakdown.technical > 0 && (
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-muted-foreground">Technical</span>
                  <span className="font-medium">{candidate.scoreBreakdown.technical.toFixed(0)}</span>
                </div>
                <Progress value={candidate.scoreBreakdown.technical} className="h-2" />
              </div>
            )}
            {!candidate.scoreBreakdown?.systemFields && candidate.scoreBreakdown?.communication !== undefined && candidate.scoreBreakdown.communication > 0 && (
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-muted-foreground">Communication</span>
                  <span className="font-medium">{candidate.scoreBreakdown.communication.toFixed(0)}</span>
                </div>
                <Progress value={candidate.scoreBreakdown.communication} className="h-2" />
              </div>
            )}
            {!candidate.scoreBreakdown?.systemFields && candidate.scoreBreakdown?.cultural !== undefined && candidate.scoreBreakdown.cultural > 0 && (
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-muted-foreground">Cultural Fit</span>
                  <span className="font-medium">{candidate.scoreBreakdown.cultural.toFixed(0)}</span>
                </div>
                <Progress value={candidate.scoreBreakdown.cultural} className="h-2" />
              </div>
            )}
          </div>

          {/* Feedback Stats */}
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <div className="flex items-center gap-1">
              <MessageSquare className="h-4 w-4" />
              <span>{candidate.feedbackStats.totalResponses} responses</span>
            </div>
            <div className="flex items-center gap-1">
              <User className="h-4 w-4" />
              <span>{candidate.feedbackStats.totalAssessors} assessors</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

