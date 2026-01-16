'use client'

import React, { useState, useEffect, useRef } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Progress } from '@/components/ui/progress'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from '@/components/ui/carousel'
import { MultiStepInterviewScheduler } from '@/components/ui/multi-step-interview-scheduler'
import { EnhancedCandidateCard } from '@/components/ui/enhanced-candidate-card'
import { EnhancedCandidatePopup } from '@/components/ui/enhanced-candidate-popup'
import { BulkMoveModal } from '@/components/jobs/BulkMoveModal'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel
} from '@/components/ui/dropdown-menu'
import {
  Users, Calendar, Clock, AlertTriangle, CalendarPlus, Trash2, Search,
  RefreshCw, Mail, Phone, Star, ArrowRight, ArrowLeft, MoreHorizontal,
  Settings, Copy, ExternalLink, User, MoveRight
} from 'lucide-react'
import { toast } from 'sonner'
import pipelineService from '@/services/pipelineService'

interface ImprovedPipelineBoardProps {
  jobId: string
  jobTitle: string
  refreshTrigger?: number
  onCandidateSelect?: (candidateId: string) => void
  onStageUpdate?: () => void
  onNavigateToStages?: () => void
}

interface PipelineCandidate {
  _id: string
  firstName: string
  lastName: string
  email: string
  phone?: string
  avatar?: string
  resumeUrl?: string
  skills?: string
  position?: string
  experience?: string
  currentStage: {
    stageId: string
    stageName: string
    enteredAt: string
  }
  stageHistory: Array<{
    stageId: string
    stageName: string
    enteredAt: string
    exitedAt?: string
    result?: 'passed' | 'failed' | 'on_hold' | 'withdrawn'
    score?: number
    feedback?: string
  }>
  interviews: Array<{
    interviewId: string
    stageId: string
    scheduledAt: string
    status: 'scheduled' | 'confirmed' | 'completed' | 'cancelled' | 'no_show'
    score?: number
  }>
  aiInsights?: {
    lastAnalyzed: string
    recommendedAction?: 'advance' | 'reject' | 'additional_assessment' | 'different_role'
    confidence: number
    overallScore: number
    keyStrengths?: string[]
    keyConcerns?: string[]
  }
  applicationDate: string
  source: string
  status: 'applied' | 'reviewing' | 'shortlisted' | 'interviewing' | 'offered' | 'hired' | 'rejected'
  priority: 'high' | 'medium' | 'low'
  tags: string[]
}

interface StageColumn {
  stage: {
    _id: string
    name: string
    type: string
    description?: string
    defaultDuration: number
    requiredInterviewers: number
    order: number
  }
  candidates: PipelineCandidate[]
  analytics: {
    totalCandidates: number
    newThisWeek: number
    averageTimeInStage: number
    passRate: number
    scheduledInterviews: number
    overdueCandidates: number
    healthScore: number
  }
}

export function ImprovedPipelineBoard({
  jobId,
  onCandidateSelect,
  onStageUpdate,
  onNavigateToStages,
  jobTitle,
  refreshTrigger
}: ImprovedPipelineBoardProps) {
  const [stageColumns, setStageColumns] = useState<StageColumn[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [selectedCandidate, setSelectedCandidate] = useState<PipelineCandidate | null>(null)
  const [movingCandidate, setMovingCandidate] = useState<Set<string>>(new Set())

  // Bulk move selection state
  const [selectedCandidates, setSelectedCandidates] = useState<Set<string>>(new Set())
  const [showBulkMoveModal, setShowBulkMoveModal] = useState(false)

  // Filtering and search
  const [searchTerm, setSearchTerm] = useState('')
  const [filterBy, setFilterBy] = useState<'all' | 'priority' | 'source' | 'recent' | 'needs_action'>('all')
  const [sortBy, setSortBy] = useState<'name' | 'date' | 'score' | 'ai_confidence'>('date')

  // Interview scheduling
  const [showScheduleDialog, setShowScheduleDialog] = useState(false)
  const [scheduleCandidate, setScheduleCandidate] = useState<any>(null)
  const [scheduleStage, setScheduleStage] = useState<any>(null)

  const searchInputRef = useRef<HTMLInputElement>(null)

  // Bulk selection handlers
  const toggleCandidateSelection = (candidateId: string) => {
    setSelectedCandidates(prev => {
      const newSet = new Set(prev)
      if (newSet.has(candidateId)) {
        newSet.delete(candidateId)
      } else {
        newSet.add(candidateId)
      }
      return newSet
    })
  }

  const clearSelection = () => {
    setSelectedCandidates(new Set())
  }

  const handleBulkMoveConfirm = async (targetStageId: string) => {
    try {
      const candidateIds = Array.from(selectedCandidates)
      const result = await pipelineService.bulkMoveApplicants(jobId, {
        candidateIds,
        targetStageId
      })

      if (result.success) {
        toast.success(`Successfully moved ${result.results.successful.length} candidate${result.results.successful.length !== 1 ? 's' : ''}`)
      } else if (result.partialSuccess) {
        toast.warning(
          `${result.results.successful.length} moved, ${result.results.failed.length} failed`,
          {
            description: result.results.failed.map(f => f.reason).join(', ')
          }
        )
      }

      clearSelection()
      fetchPipelineData()
    } catch (error: any) {
      toast.error('Failed to move candidates', {
        description: error.message
      })
    }
  }

  // Helper functions
  const getStageColor = (stageType: string, order: number) => {
    const colors = ['#3B82F6', '#8B5CF6', '#10B981', '#047857', '#EF4444', '#F59E0B']
    return colors[order % colors.length] || '#6B7280'
  }

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high': return 'border-l-red-500 bg-gradient-to-br from-red-950/40 via-red-900/20 to-red-950/10 dark:from-red-950/40 dark:via-red-900/20 dark:to-red-950/10 shadow-lg'
      case 'medium': return 'border-l-yellow-500 bg-gradient-to-br from-yellow-950/40 via-yellow-900/20 to-yellow-950/10 dark:from-yellow-950/40 dark:via-yellow-900/20 dark:to-yellow-950/10 shadow-lg'
      case 'low': return 'border-l-green-500 bg-gradient-to-br from-green-950/40 via-green-900/20 to-green-950/10 dark:from-green-950/40 dark:via-green-900/20 dark:to-green-950/10 shadow-lg'
      default: return 'border-l-gray-500 bg-card/30 glass-card'
    }
  }

  const getCandidateDisplayName = (candidate: PipelineCandidate, maxLength: number = 25) => {
    const fullName = `${candidate.firstName || ''} ${candidate.lastName || ''}`.trim()
    if (fullName.length <= maxLength) return fullName
    return `${fullName.substring(0, maxLength)}...`
  }

  const getInitials = (candidate: PipelineCandidate) => {
    const firstName = candidate.firstName || ''
    const lastName = candidate.lastName || ''
    return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase() || 'U'
  }

  const getDaysInStage = (enteredAt: string) => {
    return Math.floor((new Date().getTime() - new Date(enteredAt).getTime()) / (1000 * 60 * 60 * 24))
  }

  const calculateEnhancedStageAnalytics = (stage: any, candidates: PipelineCandidate[]) => {
    const oneWeekAgo = new Date()
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7)

    const newThisWeek = candidates.filter(c => new Date(c.currentStage.enteredAt) >= oneWeekAgo).length
    const averageTimeInStage = candidates.reduce((acc, c) => acc + getDaysInStage(c.currentStage.enteredAt), 0) / (candidates.length || 1)
    const passedCandidates = candidates.filter(c => c.stageHistory.some(sh => sh.stageId === stage._id && sh.result === 'passed')).length
    const passRate = candidates.length > 0 ? (passedCandidates / candidates.length) * 100 : 0
    const scheduledInterviews = candidates.reduce((acc, c) => acc + c.interviews.filter(i => i.stageId === stage._id && i.status === 'scheduled').length, 0)
    const overdueCandidates = candidates.filter(c => getDaysInStage(c.currentStage.enteredAt) > (stage.defaultDuration / 1440) * 2).length

    let healthScore = 100
    if (overdueCandidates > 0) healthScore -= (overdueCandidates / candidates.length) * 30
    if (passRate < 50) healthScore -= (50 - passRate) * 0.5
    if (averageTimeInStage > 14) healthScore -= 20
    healthScore = Math.max(0, Math.round(healthScore))

    return {
      totalCandidates: candidates.length,
      newThisWeek,
      averageTimeInStage: Math.round(averageTimeInStage),
      passRate: Math.round(passRate),
      scheduledInterviews,
      overdueCandidates,
      healthScore
    }
  }

  const filterAndSortCandidates = (candidates: PipelineCandidate[]) => {
    let filtered = candidates

    if (searchTerm) {
      const term = searchTerm.toLowerCase()
      filtered = filtered.filter(candidate =>
        candidate.firstName.toLowerCase().includes(term) ||
        candidate.lastName.toLowerCase().includes(term) ||
        candidate.email.toLowerCase().includes(term) ||
        candidate.skills?.toLowerCase().includes(term) ||
        candidate.position?.toLowerCase().includes(term)
      )
    }

    switch (filterBy) {
      case 'priority':
        filtered = filtered.filter(c => c.priority === 'high')
        break
      case 'recent':
        const threeDaysAgo = new Date()
        threeDaysAgo.setDate(threeDaysAgo.getDate() - 3)
        filtered = filtered.filter(c => new Date(c.applicationDate) >= threeDaysAgo)
        break
      case 'needs_action':
        filtered = filtered.filter(c => {
          const daysInStage = getDaysInStage(c.currentStage.enteredAt)
          return daysInStage > 7 || c.interviews.some(i => i.status === 'scheduled')
        })
        break
    }

    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'name':
          return `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`)
        case 'score':
          return (b.aiInsights?.overallScore || 0) - (a.aiInsights?.overallScore || 0)
        case 'ai_confidence':
          return (b.aiInsights?.confidence || 0) - (a.aiInsights?.confidence || 0)
        case 'date':
        default:
          return new Date(b.applicationDate).getTime() - new Date(a.applicationDate).getTime()
      }
    })

    return filtered
  }

  useEffect(() => {
    fetchPipelineData()
  }, [jobId, filterBy, sortBy, refreshTrigger, searchTerm])

  const fetchPipelineData = async () => {
    try {
      setLoading(true)
      const { pipeline } = await pipelineService.getDetailedPipeline(jobId)
      const { stages } = pipeline

      const columns: StageColumn[] = (stages || []).map((stage: any, index: number) => {
        const stageObj = stage.stage || stage
        const candidates = (stage.candidates || []).map((applicant: any) => {
          const candidate = applicant.candidate || {}

          let skillsValue = undefined
          if (candidate.skills) {
            if (typeof candidate.skills === 'string') {
              skillsValue = candidate.skills
            } else if (typeof candidate.skills === 'object') {
              if (candidate.skills.matchedSkills || candidate.skills.bonusSkills) {
                skillsValue = [
                  ...(candidate.skills.matchedSkills || []),
                  ...(candidate.skills.bonusSkills || [])
                ].join(', ')
              } else {
                skillsValue = JSON.stringify(candidate.skills)
              }
            }
          }

          return {
            _id: candidate._id || applicant._id,
            firstName: candidate.firstName || '',
            lastName: candidate.lastName || '',
            email: candidate.email || '',
            phone: candidate.phone,
            avatar: candidate.avatar,
            resumeUrl: candidate.resumeUrl,
            skills: skillsValue,
            position: candidate.position || '',
            experience: candidate.experience || '',
            currentStage: applicant.currentStage || {
              stageId: stageObj._id,
              stageName: stageObj.name,
              enteredAt: applicant.addedAt || new Date().toISOString()
            },
            stageHistory: applicant.stageHistory || [],
            interviews: applicant.interviews || [],
            aiInsights: applicant.aiInsights,
            applicationDate: applicant.appliedAt || applicant.addedAt || new Date().toISOString(),
            source: applicant.source || 'direct',
            status: applicant.status || 'applied',
            priority: applicant.priority || 'medium',
            tags: applicant.tags || []
          }
        })

        return {
          stage: stageObj,
          candidates: filterAndSortCandidates(candidates),
          analytics: calculateEnhancedStageAnalytics(stageObj, candidates)
        }
      })

      setStageColumns(columns)
    } catch (error) {
      console.error('Error fetching pipeline data:', error)
      toast.error('Failed to load pipeline data')
    } finally {
      setLoading(false)
    }
  }

  const handleMoveCandidate = async (candidateId: string, destStageId: string) => {
    if (movingCandidate.has(candidateId)) return

    try {
      setMovingCandidate(prev => new Set([...prev, candidateId]))
      const candidate = stageColumns.flatMap(col => col.candidates).find(c => c._id === candidateId)
      const destStage = stageColumns.find(col => col.stage._id === destStageId)

      if (!candidate || !destStage) return

      toast.loading(`Moving ${candidate.firstName} ${candidate.lastName} to ${destStage.stage.name}...`, {
        id: `move-${candidateId}`
      })

      await pipelineService.advanceCandidateToStage(jobId, candidateId, destStageId, `Moved to ${destStage.stage.name}`)

      toast.success(`${candidate.firstName} ${candidate.lastName} moved to ${destStage.stage.name}`, {
        id: `move-${candidateId}`
      })

      fetchPipelineData()
      onStageUpdate?.()
    } catch (error: any) {
      console.error('Error moving candidate:', error)
      toast.error('Failed to move candidate', { id: `move-${candidateId}` })
    } finally {
      setMovingCandidate(prev => {
        const newSet = new Set(prev)
        newSet.delete(candidateId)
        return newSet
      })
    }
  }

  const handleQuickMoveStage = async (candidateId: string, direction: 'previous' | 'next') => {
    const candidate = stageColumns.flatMap(col => col.candidates).find(c => c._id === candidateId)
    if (!candidate) return

    const currentStageIndex = stageColumns.findIndex(col => col.stage._id === candidate.currentStage.stageId)
    if (currentStageIndex === -1) return

    let targetStageIndex: number
    if (direction === 'next') {
      targetStageIndex = currentStageIndex + 1
    } else {
      targetStageIndex = currentStageIndex - 1
    }

    if (targetStageIndex < 0 || targetStageIndex >= stageColumns.length) return

    const targetStage = stageColumns[targetStageIndex]
    await handleMoveCandidate(candidateId, targetStage.stage._id)
  }

  const handleScheduleInterview = (candidate: any, stage: any) => {
    console.log('🎯 handleScheduleInterview called:', {
      candidateId: candidate._id,
      candidateName: `${candidate.firstName} ${candidate.lastName}`,
      stageId: stage._id,
      stageName: stage.name,
      currentDialogState: showScheduleDialog
    });

    setScheduleCandidate(candidate)
    setScheduleStage(stage)
    setShowScheduleDialog(true)

    console.log('✅ Interview scheduling dialog state set to open');
  }

  const handleInterviewScheduled = async () => {
    setShowScheduleDialog(false)
    setSelectedCandidate(null) // Close candidate popup after successful interview scheduling
    toast.success('Interview scheduled successfully!')
    await fetchPipelineData()
    onStageUpdate?.()
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading pipeline...</p>
        </div>
      </div>
    )
  }

  if (stageColumns.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] p-6 glass-card rounded-xl border border-white/5 shadow-2xl">
        <div className="text-center max-w-md">
          <div className="mb-4 bg-blue-500/10 p-4 rounded-full inline-flex border border-blue-500/20">
            <AlertTriangle className="h-10 w-10 text-blue-400" />
          </div>
          <h3 className="text-xl font-semibold mb-2 text-blue-100">No Interview Stages Configured</h3>
          <p className="text-gray-400 mb-6">
            You need to set up interview stages before you can use the pipeline.
          </p>
          <Button
            onClick={() => onNavigateToStages?.()}
            size="lg"
            className="bg-blue-600 hover:bg-blue-700 text-white"
          >
            <Settings className="mr-2 h-4 w-4" />
            Configure Stages
          </Button>
        </div>
      </div>
    )
  }

  return (
    <TooltipProvider>
      <div className="space-y-4 sm:space-y-6">
        {/* Header with Controls */}
        <div className="flex flex-col space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="hidden sm:block">
              <h2 className="text-xl sm:text-2xl font-bold text-white">Interview Pipeline</h2>
              <p className="text-sm text-gray-400 mt-1">Manage candidates through your multi-stage interview process</p>
            </div>

            <Button variant="outline" size="sm" onClick={() => onNavigateToStages?.()} className="text-sm w-fit">
              <Settings className="h-4 w-4 mr-2" />
              Manage Stages
            </Button>
          </div>

        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4 w-full">
          <div className="relative flex-1">
            {/* Existing search and filters */}

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  ref={searchInputRef}
                  placeholder="Search candidates..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 w-full sm:w-48 glass-card border-white/10 text-white placeholder-gray-500"
                />
              </div>

              <div className="flex gap-2">
                <Select value={filterBy} onValueChange={(value: any) => setFilterBy(value)}>
                  <SelectTrigger className="w-full sm:w-36 glass-card border-white/10 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Candidates</SelectItem>
                    <SelectItem value="priority">High Priority</SelectItem>
                    <SelectItem value="recent">Recent</SelectItem>
                    <SelectItem value="needs_action">Needs Action</SelectItem>
                  </SelectContent>
                </Select>

                <Select value={sortBy} onValueChange={(value: any) => setSortBy(value)}>
                  <SelectTrigger className="w-full sm:w-32 glass-card border-white/10 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="date">By Date</SelectItem>
                    <SelectItem value="name">By Name</SelectItem>
                    <SelectItem value="score">By Score</SelectItem>
                    <SelectItem value="ai_confidence">AI Confidence</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Button variant="outline" size="sm" onClick={() => fetchPipelineData()} disabled={refreshing} className="w-full sm:w-auto border-white/10 bg-transparent text-gray-300 hover:bg-white/5 hover:text-white">
                <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            </div>
          </div>
        </div>

        {/* Bulk Action Toolbar */}
        {selectedCandidates.size > 0 && (
          <div className="glass-card border border-white/10 rounded-lg p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Badge variant="secondary" className="bg-blue-500/20 text-blue-200 border border-blue-500/30">
                {selectedCandidates.size} selected
              </Badge>
              <Button
                variant="ghost"
                size="sm"
                onClick={clearSelection}
                className="text-sm"
              >
                Clear selection
              </Button>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() => setShowBulkMoveModal(true)}
                className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700"
              >
                <ArrowRight className="h-4 w-4 mr-2" />
                Move Selected
              </Button>
            </div>
          </div>
        )}

        {/* Pipeline Health Summary */}
        <div className="hidden sm:grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-4" data-tutorial="pipeline-analytics-summary">
          {stageColumns.map((column, index) => (
            <Card key={column.stage._id} className="relative overflow-hidden border-0 glass-card shadow-lg group hover:bg-white/5 transition-all">
              <CardHeader className="pb-2 px-3 sm:px-4 pt-3 sm:pt-4">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-xs sm:text-sm font-medium flex items-center gap-2 text-white">
                    <div className="w-2 h-2 sm:w-3 sm:h-3 rounded-full shadow-[0_0_8px_currentColor]" style={{ backgroundColor: getStageColor(column.stage.type, index) }} />
                    <span className="truncate">{column.stage.name}</span>
                  </CardTitle>
                  <div className="flex items-center gap-1 sm:gap-2">
                    <Badge variant="outline" className="text-xs border-white/10 text-gray-300">{column.analytics.totalCandidates}</Badge>
                    {column.analytics.healthScore < 70 && (
                      <Tooltip>
                        <TooltipTrigger><AlertTriangle className="h-3 w-3 sm:h-4 sm:w-4 text-yellow-500" /></TooltipTrigger>
                        <TooltipContent><p>Stage needs attention (Health: {column.analytics.healthScore}%)</p></TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                </div>
                <div className="text-xs text-gray-400">
                  {column.stage.defaultDuration} min • {column.stage.requiredInterviewers} interviewer{column.stage.requiredInterviewers !== 1 ? 's' : ''}
                </div>
              </CardHeader>
              <CardContent className="px-3 sm:px-4 pb-3 sm:pb-4">
                <div className="space-y-1 sm:space-y-2">
                  <div className="flex items-center justify-between text-xs text-gray-400">
                    <span>Health Score</span>
                    <div className="flex items-center gap-1 sm:gap-2">
                      <Progress value={column.analytics.healthScore} className="w-8 sm:w-12 h-1 sm:h-2 bg-white/10" />
                      <span className="font-medium text-xs text-gray-300">{column.analytics.healthScore}%</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-xs text-gray-400">
                    <span>New this week</span>
                    <span className="font-medium text-gray-300">{column.analytics.newThisWeek > 0 && '+'}{column.analytics.newThisWeek}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-gray-400">
                    <span>Avg. time</span>
                    <span className="font-medium text-gray-300">{column.analytics.averageTimeInStage}d</span>
                  </div>
                  {column.analytics.overdueCandidates > 0 && (
                    <div className="flex items-center gap-1 text-xs text-red-600">
                      <AlertTriangle className="h-2 w-2 sm:h-3 sm:w-3" />
                      <span>{column.analytics.overdueCandidates} overdue</span>
                    </div>
                  )}
                  {column.analytics.scheduledInterviews > 0 && (
                    <div className="flex items-center gap-1 text-xs text-blue-400">
                      <Calendar className="h-2 w-2 sm:h-3 sm:w-3" />
                      <span>{column.analytics.scheduledInterviews} scheduled</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Carousel Pipeline Board */}
        <div data-tutorial="pipeline-board">
          <Carousel
            opts={{
              align: "start",
              dragFree: true,
            }}
            className="w-full"
          >
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 sm:mb-6 gap-4">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <CarouselPrevious className="relative left-0 top-0 translate-y-0 h-8 w-8 sm:h-10 sm:w-10" />
                  <CarouselNext className="relative right-0 top-0 translate-y-0 h-8 w-8 sm:h-10 sm:w-10" />
                </div>
                <div className="text-xs sm:text-sm text-gray-400 flex items-center gap-2">
                  <span className="font-medium text-gray-300">{stageColumns.length}</span>
                  <span>stage{stageColumns.length !== 1 ? 's' : ''}</span>
                  <span className="hidden sm:inline">•</span>
                  <span className="hidden sm:inline">Swipe or use arrows to navigate</span>
                </div>
              </div>
              <div className="hidden lg:flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 px-3 py-1.5 rounded-full">
                <span>Use dropdowns to move candidates</span>
              </div>
            </div>

            <CarouselContent className="-ml-2 md:-ml-4">
              {stageColumns.map((column, index) => (
                <CarouselItem key={column.stage._id} className="pl-2 md:pl-4 basis-[336px] sm:basis-[360px] md:basis-[400px] lg:basis-[420px] xl:basis-[450px]">
                  <div className="space-y-4 h-full">
                    {/* Stage Header */}
                    <div className="sticky top-0 z-10 pb-2">
                      <Card className="border-0 glass-card shadow-md">
                        <CardHeader className="pb-3 px-3 sm:px-4 pt-3 sm:pt-4 border-b border-white/5 bg-gradient-to-r from-card/50 to-card/30">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <div className="w-2 h-2 sm:w-3 sm:h-3 rounded-full shadow-[0_0_8px_currentColor]" style={{ backgroundColor: getStageColor(column.stage.type, index) }} />
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <CardTitle className="text-sm sm:text-lg truncate cursor-help text-white">
                                    {column.stage.name}
                                  </CardTitle>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <div>
                                    <p className="font-medium">{column.stage.name}</p>
                                    {column.stage.description && (
                                      <p className="text-sm text-muted-foreground mt-1">{column.stage.description}</p>
                                    )}
                                    <p className="text-xs text-muted-foreground mt-1">
                                      Duration: {column.stage.defaultDuration} min • Interviewers: {column.stage.requiredInterviewers}
                                    </p>
                                  </div>
                                </TooltipContent>
                              </Tooltip>
                            </div>
                            <Badge variant="secondary" className="text-xs bg-white/10 text-gray-300 border-0">{column.candidates.length}</Badge>
                          </div>
                          <div className="flex items-center gap-3 sm:gap-4 text-xs text-gray-400">
                            <span className="flex items-center gap-1">
                              <Clock className="h-2 w-2 sm:h-3 sm:w-3" />
                              {column.stage.defaultDuration} min
                            </span>
                            <span className="flex items-center gap-1">
                              <Users className="h-2 w-2 sm:h-3 sm:w-3" />
                              {column.stage.requiredInterviewers}
                            </span>
                          </div>
                        </CardHeader>
                      </Card>
                    </div>

                    {/* Candidates Area */}
                    <div className="min-h-[400px] sm:min-h-[500px] space-y-3 p-2 rounded-lg bg-white/5 border border-white/5">
                      {column.candidates.map((candidate) => {
                        const isMoving = movingCandidate.has(candidate._id)
                        const isSelected = selectedCandidates.has(candidate._id)

                        return (
                          <div key={candidate._id} className="relative group w-full max-w-full sm:w-full sm:max-w-none">
                            {/* Selection Checkbox */}
                            <div className="absolute top-2 left-2 z-10">
                              <Checkbox
                                checked={isSelected}
                                onCheckedChange={() => toggleCandidateSelection(candidate._id)}
                                className="bg-card border-white/20 data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600"
                              />
                            </div>

                            {/* Candidate Card */}
                            <EnhancedCandidateCard
                              candidate={candidate}
                              stageId={column.stage._id}
                              jobId={jobId}
                              isMoving={isMoving}
                              onClick={() => {
                                setSelectedCandidate(candidate)
                                onCandidateSelect?.(candidate._id)
                              }}
                              onMoveStage={handleQuickMoveStage}
                              stages={stageColumns.map(col => ({
                                _id: col.stage._id,
                                name: col.stage.name,
                                order: col.stage.order
                              }))}
                              currentStageOrder={stageColumns.findIndex(col => col.stage._id === candidate.currentStage.stageId)}
                              getDaysInStage={getDaysInStage}
                              getInitials={getInitials}
                              onEmailSent={fetchPipelineData}
                            />
                          </div>
                        )
                      })}

                      {/* Empty State */}
                      {column.candidates.length === 0 && (
                        <div className="flex items-center justify-center h-32 border-2 border-dashed border-white/5 rounded-lg">
                          <div className="text-center">
                            <Users className="h-6 w-6 sm:h-8 sm:w-8 mx-auto mb-2 text-gray-600" />
                            <p className="text-xs sm:text-sm text-gray-500">No candidates in this stage</p>
                            <p className="text-xs text-gray-600">Use dropdown menus to move candidates here</p>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </CarouselItem>
              ))}
            </CarouselContent>
          </Carousel>
        </div>

        {/* Enhanced Candidate Popup */}
        <EnhancedCandidatePopup
          candidate={selectedCandidate}
          stages={stageColumns.map(col => ({
            _id: col.stage._id,
            name: col.stage.name,
            type: col.stage.type,
            order: col.stage.order,
            candidateCount: col.candidates.length
          }))}
          isOpen={!!selectedCandidate}
          onClose={() => setSelectedCandidate(null)}
          onMoveToStage={async (candidateId: string, stageId: string, notes?: string) => {
            await handleMoveCandidate(candidateId, stageId)
            setSelectedCandidate(null)
          }}
          onScheduleInterview={() => {
            console.log('🔘 Create Interview button clicked in candidate modal');
            if (selectedCandidate) {
              console.log('👤 Selected candidate:', selectedCandidate.firstName, selectedCandidate.lastName);
              console.log('🎯 About to call handleScheduleInterview');
              handleScheduleInterview(selectedCandidate, {
                _id: selectedCandidate.currentStage.stageId,
                name: selectedCandidate.currentStage.stageName
              })
              console.log('✅ handleScheduleInterview called - modal should open');
              // Don't close candidate popup immediately - let user see interview modal
            } else {
              console.error('❌ No selected candidate found');
            }
          }}
          getDaysInStage={getDaysInStage}
          getInitials={getInitials}
        />

        {/* Schedule Interview Dialog */}
        <Dialog open={showScheduleDialog} onOpenChange={setShowScheduleDialog}>
          <DialogContent
            className="max-w-[90vw] sm:max-w-4xl h-[85vh] p-0 overflow-hidden multi-step-scheduler-portal"
          >
            {/* Hidden DialogTitle for accessibility */}
            <DialogHeader className="sr-only">
              <DialogTitle>
                Schedule Interview for {scheduleCandidate ? `${scheduleCandidate.firstName} ${scheduleCandidate.lastName}` : 'Candidate'}
              </DialogTitle>
            </DialogHeader>

            <div className="relative w-full h-full">
              {scheduleCandidate && scheduleStage && (
                <MultiStepInterviewScheduler
                  candidateId={scheduleCandidate._id}
                  candidateName={`${scheduleCandidate.firstName} ${scheduleCandidate.lastName}`}
                  candidateEmail={scheduleCandidate.email}
                  jobTitle={jobTitle}
                  jobId={jobId}
                  stageId={scheduleStage._id}
                  onScheduled={handleInterviewScheduled}
                  onCancel={() => setShowScheduleDialog(false)}
                />
              )}
            </div>
          </DialogContent>
        </Dialog>

        {/* Bulk Move Modal */}
        <BulkMoveModal
          isOpen={showBulkMoveModal}
          onClose={() => setShowBulkMoveModal(false)}
          onConfirm={handleBulkMoveConfirm}
          selectedCandidateCount={selectedCandidates.size}
          stages={stageColumns.map(col => ({
            _id: col.stage._id,
            name: col.stage.name,
            type: col.stage.type,
            order: col.stage.order
          }))}
        />

        {/* Floating Sticky "Move Selected" Button */}
        {selectedCandidates.size > 0 && (
          <div className="fixed bottom-8 right-8 z-50 animate-in fade-in slide-in-from-bottom-4 duration-300">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="lg"
                  onClick={() => setShowBulkMoveModal(true)}
                  className="rounded-full shadow-2xl hover:shadow-blue-500/50 bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 hover:from-blue-700 hover:via-indigo-700 hover:to-purple-700 text-white border-2 border-white/20 h-16 px-6 gap-3 group"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex items-center justify-center w-8 h-8 rounded-full bg-white/20 backdrop-blur-sm">
                      <span className="text-sm font-bold">{selectedCandidates.size}</span>
                    </div>
                    <span className="font-semibold">Move Selected</span>
                    <MoveRight className="h-5 w-5 group-hover:translate-x-1 transition-transform" />
                  </div>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left" className="bg-slate-900 text-white">
                <p>Move {selectedCandidates.size} candidate{selectedCandidates.size !== 1 ? 's' : ''} to a new stage</p>
              </TooltipContent>
            </Tooltip>
          </div>
        )}

      </div>
    </TooltipProvider>
  )
}
