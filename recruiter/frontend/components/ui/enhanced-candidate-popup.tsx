'use client'

import React, { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
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
  CalendarPlus,
  ExternalLink,
  User,
  Briefcase,
  GraduationCap,
  Target,
  MessageSquare,
  ArrowRight,
  ArrowLeft,
  FileText,
  Download
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

interface EnhancedCandidatePopupProps {
  candidate: {
    _id: string
    firstName: string
    lastName: string
    email: string
    phone?: string
    avatar?: string
    resumeUrl?: string
    position?: string
    experience?: string
    skills?: string
    location?: string
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
      status: 'scheduled' | 'confirmed' | 'completed' | 'cancelled' | 'no_show' | 'missed' | 'rescheduled' | 'in_progress'
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
    status: string
    priority: 'high' | 'medium' | 'low'
    tags: string[]
  } | null
  stages: Array<{
    _id: string
    name: string
    type: string
    order: number
    candidateCount: number
  }>
  isOpen: boolean
  onClose: () => void
  onMoveToStage: (candidateId: string, stageId: string, notes?: string) => Promise<void>
  onScheduleInterview: () => void
  getDaysInStage: (date: string) => number
  getInitials: (candidate: any) => string
}

const getPriorityConfig = (priority: string) => {
  switch (priority) {
    case 'high':
      return { color: 'text-red-600', bg: 'bg-red-50 dark:bg-red-950/30', icon: <AlertTriangle className="h-4 w-4" /> }
    case 'medium':
      return { color: 'text-yellow-600', bg: 'bg-yellow-50 dark:bg-yellow-950/30', icon: <Timer className="h-4 w-4" /> }
    case 'low':
      return { color: 'text-green-600', bg: 'bg-green-50 dark:bg-green-950/30', icon: <CheckCircle className="h-4 w-4" /> }
    default:
      return { color: 'text-muted-foreground', bg: 'bg-muted/30 dark:bg-card/30', icon: <Clock className="h-4 w-4" /> }
  }
}

const getStageColor = (stageType: string, order: number) => {
  const colors = ['#3B82F6', '#8B5CF6', '#10B981', '#047857', '#EF4444', '#F59E0B']
  return colors[order % colors.length] || '#6B7280'
}

export function EnhancedCandidatePopup({
  candidate,
  stages,
  isOpen,
  onClose,
  onMoveToStage,
  onScheduleInterview,
  getDaysInStage,
  getInitials
}: EnhancedCandidatePopupProps) {
  const [selectedStage, setSelectedStage] = useState('')
  const [moveNotes, setMoveNotes] = useState('')
  const [isMoving, setIsMoving] = useState(false)
  const [activeTab, setActiveTab] = useState('overview')

  if (!candidate) return null

  const priorityConfig = getPriorityConfig(candidate.priority)
  const daysInStage = getDaysInStage(candidate.currentStage.enteredAt)
  const currentStageIndex = stages.findIndex(s => s._id === candidate.currentStage.stageId)
  
  // Filter stages (exclude current stage)
  const availableStages = stages.filter(s => s._id !== candidate.currentStage.stageId)

  const handleMoveToStage = async () => {
    if (!selectedStage || !candidate) return

    setIsMoving(true)
    try {
      await onMoveToStage(candidate._id, selectedStage, moveNotes || undefined)
      toast.success('Candidate moved successfully!')
      setSelectedStage('')
      setMoveNotes('')
      onClose()
    } catch (error) {
      toast.error('Failed to move candidate')
    } finally {
      setIsMoving(false)
    }
  }

  const getStatusBadgeColor = (status: string) => {
    switch (status) {
      case 'completed': return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
      case 'scheduled': return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
      case 'confirmed': return 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300'
      case 'cancelled': return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'
      case 'missed': return 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300'
      case 'no_show': return 'bg-gray-100 text-gray-800 dark:bg-card/30 dark:text-gray-300'
      case 'rescheduled': return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300'
      case 'in_progress': return 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300'
      default: return 'bg-gray-100 text-gray-800 dark:bg-card/30 dark:text-gray-300'
    }
  }

  const openInterview = (interview: any) => {
    const id = interview?.interviewId || interview?._id || interview?.id
    if (!id) {
      toast.error('Interview ID is missing')
      return
    }
    const url = `/interviews/${id}/transcript`
    // Simply open in new tab - let browser handle popup blocking gracefully
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="w-full max-w-full h-[100vh] sm:max-w-[95vw] sm:h-[95vh] md:max-w-[90vw] md:h-[90vh] lg:max-w-6xl xl:max-w-7xl lg:max-h-[85vh] overflow-hidden p-0 gap-0 bg-gradient-to-br from-white via-slate-50/50 to-blue-50/30 dark:from-slate-900 dark:via-slate-800/50 dark:to-slate-700/30 border-0 sm:border shadow-2xl animate-in fade-in-0 zoom-in-95 duration-300 flex flex-col rounded-none sm:rounded-lg md:rounded-xl">
        
        {/* Hidden DialogTitle for accessibility */}
        <DialogHeader className="sr-only">
          <DialogTitle>
            {candidate?.firstName && candidate?.lastName 
              ? `${candidate.firstName} ${candidate.lastName} - Candidate Details`
              : 'Candidate Details'
            }
          </DialogTitle>
        </DialogHeader>
        
        {/* Modern Header Section */}
        <div className="relative overflow-hidden border-b border-slate-200/60 dark:border-slate-700/60 flex-shrink-0">
          {/* Animated Background Pattern */}
          <div className="absolute inset-0 bg-gradient-to-r from-blue-600/5 via-purple-600/5 to-indigo-600/5 animate-gradient-x" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_120%,rgba(120,119,198,0.3),rgba(255,255,255,0))] opacity-30" />
          
          <div className="relative px-3 sm:px-4 md:px-6 py-3 sm:py-4 backdrop-blur-sm">
            <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3 sm:gap-4">
              
              {/* Profile Section */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4 flex-1 min-w-0">
                <div className="relative group flex-shrink-0">
                  <Avatar className="h-12 w-12 sm:h-16 sm:w-16 lg:h-20 lg:w-20 ring-3 ring-white/80 shadow-xl transition-all duration-300 group-hover:ring-white group-hover:shadow-2xl">
                    <AvatarImage 
                      src={candidate.avatar} 
                      alt={`${candidate.firstName} ${candidate.lastName}`} 
                      className="object-cover transition-all duration-300 group-hover:scale-105"
                    />
                    <AvatarFallback className="bg-gradient-to-br from-blue-500 via-purple-500 to-indigo-600 text-white text-lg sm:text-xl font-bold">
                  {getInitials(candidate)}
                </AvatarFallback>
              </Avatar>
                  {/* Online Status Indicator */}
                  <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 sm:w-5 sm:h-5 bg-emerald-500 rounded-full border-2 border-white shadow-md flex items-center justify-center">
                    <div className="w-1.5 h-1.5 bg-card rounded-full animate-pulse" />
                  </div>
                </div>
                
                <div className="flex-1 min-w-0 space-y-2 sm:space-y-3">
                  {/* Name and Priority */}
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
                    <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold bg-gradient-to-r from-slate-900 via-slate-800 to-slate-700 dark:from-white dark:via-slate-200 dark:to-slate-300 bg-clip-text text-transparent">
                  {candidate.firstName} {candidate.lastName}
                    </h1>
                    <Badge className={cn(
                      "px-2.5 py-1 font-semibold shadow-md border-0 text-xs transition-all duration-300 w-fit",
                      priorityConfig.color,
                      priorityConfig.bg
                    )}>
                      {priorityConfig.icon}
                      <span className="ml-1">{candidate.priority}</span>
                    </Badge>
                  </div>
                  
                  {/* Professional Tags */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    {candidate.position && (
                      <Badge variant="secondary" className="bg-blue-100/80 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300 border-0 px-2 py-0.5 text-xs shadow-sm">
                        <Briefcase className="h-3 w-3 mr-1" />
                        {candidate.position}
                      </Badge>
                    )}
                    {candidate.experience && (
                      <Badge variant="secondary" className="bg-emerald-100/80 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300 border-0 px-2 py-0.5 text-xs shadow-sm">
                        <GraduationCap className="h-3 w-3 mr-1" />
                        {candidate.experience}
                      </Badge>
                    )}
                    <Badge variant="secondary" className="bg-slate-100/80 text-slate-700 dark:bg-slate-800/80 dark:text-slate-300 border-0 px-2 py-0.5 text-xs shadow-sm">
                      <Calendar className="h-3 w-3 mr-1" />
                      Applied {new Date(candidate.applicationDate).toLocaleDateString()}
                    </Badge>
                  </div>
                  
                  {/* Contact Information */}
                  <div className="flex flex-col sm:flex-row sm:flex-wrap items-start sm:items-center gap-2">
                    <div className="flex items-center gap-1.5 bg-card/80 dark:bg-slate-800/80 px-2.5 py-1.5 rounded-full backdrop-blur-sm shadow-sm border border-white/40 w-full sm:w-auto">
                      <Mail className="h-3.5 w-3.5 sm:h-3 sm:w-3 text-blue-600" />
                      <span className="font-medium text-xs text-slate-700 dark:text-slate-300 truncate">{candidate.email}</span>
                  </div>
                  {candidate.phone && (
                      <div className="flex items-center gap-1.5 bg-card/80 dark:bg-slate-800/80 px-2.5 py-1.5 rounded-full backdrop-blur-sm shadow-sm border border-white/40 w-full sm:w-auto">
                        <Phone className="h-3.5 w-3.5 sm:h-3 sm:w-3 text-emerald-600" />
                        <span className="font-medium text-xs text-slate-700 dark:text-slate-300">{candidate.phone}</span>
                    </div>
                  )}
                  {candidate.location && (
                      <div className="flex items-center gap-1.5 bg-card/80 dark:bg-slate-800/80 px-2.5 py-1.5 rounded-full backdrop-blur-sm shadow-sm border border-white/40 w-full sm:w-auto">
                        <MapPin className="h-3.5 w-3.5 sm:h-3 sm:w-3 text-purple-600" />
                        <span className="font-medium text-xs text-slate-700 dark:text-slate-300">{candidate.location}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Current Stage Card (simplified) */}
              <div className="hidden lg:block lg:min-w-[280px] xl:min-w-[320px]">
                <div className="bg-gradient-to-r from-white/95 to-blue-50/95 dark:from-slate-800/95 dark:to-slate-700/95 backdrop-blur-sm rounded-xl p-4 shadow-lg border border-white/50 dark:border-slate-600/50 transition-all duration-300">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider">Current Stage</span>
                    <div className="flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" />
                      <div className="text-xs text-slate-500 dark:text-slate-400">Active</div>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-lg font-bold text-slate-800 dark:text-slate-100">
                      {candidate.currentStage.stageName}
                    </div>
                    <div className="flex items-center text-xs text-slate-600 dark:text-slate-400">
                      <Timer className="h-3 w-3 mr-1.5 text-blue-600" />
                      <span className="font-semibold">{daysInStage} {daysInStage === 1 ? 'day' : 'days'}</span>
                      <span className="ml-1">in stage</span>
                    </div>
                  </div>
                </div>
              </div>
              
            </div>
            </div>

        {/* Main Content Area */}
        <div className="flex-1 overflow-hidden min-h-0 flex flex-col lg:flex-row">
            
            {/* Left Panel - Content */}
            <div className="flex-1 flex flex-col overflow-hidden min-h-0 p-2 sm:p-3 md:p-4">
              <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full h-full flex flex-col">
                <TabsList className="flex-shrink-0 grid w-full grid-cols-2 sm:grid-cols-4 mb-3 bg-card/60 dark:bg-slate-800/60 backdrop-blur-sm p-1 rounded-xl shadow-lg border border-white/20">
                  <TabsTrigger 
                    value="overview" 
                    className="data-[state=active]:bg-card data-[state=active]:shadow-md data-[state=active]:text-slate-900 dark:data-[state=active]:bg-slate-700 dark:data-[state=active]:text-white transition-all duration-200 rounded-lg font-semibold text-sm min-h-[44px] px-2 sm:px-4 py-2"
                  >
                    <User className="h-5 w-5 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
                    <span className="hidden sm:inline">Overview</span>
                  </TabsTrigger>
                  <TabsTrigger 
                    value="stages" 
                    className="data-[state=active]:bg-card data-[state=active]:shadow-md data-[state=active]:text-slate-900 dark:data-[state=active]:bg-slate-700 dark:data-[state=active]:text-white transition-all duration-200 rounded-lg font-semibold text-sm min-h-[44px] px-2 sm:px-4 py-2"
                  >
                    <Target className="h-5 w-5 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
                    <span className="hidden sm:inline">Pipeline</span>
                  </TabsTrigger>
                  <TabsTrigger 
                    value="interviews" 
                    className="data-[state=active]:bg-card data-[state=active]:shadow-md data-[state=active]:text-slate-900 dark:data-[state=active]:bg-slate-700 dark:data-[state=active]:text-white transition-all duration-200 rounded-lg font-semibold text-sm min-h-[44px] px-2 sm:px-4 py-2"
                  >
                    <Calendar className="h-5 w-5 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
                    <span className="hidden sm:inline">Interviews</span>
                  </TabsTrigger>
                  <TabsTrigger 
                    value="ai-insights" 
                    className="data-[state=active]:bg-card data-[state=active]:shadow-md data-[state=active]:text-slate-900 dark:data-[state=active]:bg-slate-700 dark:data-[state=active]:text-white transition-all duration-200 rounded-lg font-semibold text-sm min-h-[44px] px-2 sm:px-4 py-2"
                  >
                    <TrendingUp className="h-5 w-5 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
                    <span className="hidden sm:inline">AI Insights</span>
                  </TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="flex-1 overflow-y-scroll space-y-3 animate-in fade-in-50 duration-500 pr-1" style={{scrollbarWidth: 'thin', scrollbarColor: '#cbd5e1 transparent'}}>
                
                {/* Quick Stats Overview */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
                  <div className="bg-gradient-to-br from-white/90 to-blue-50/90 dark:from-slate-800/90 dark:to-slate-700/90 backdrop-blur-sm rounded-lg p-2 sm:p-3 shadow-md border border-white/20">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 sm:p-2 bg-blue-500/10 rounded-lg">
                        <Target className="h-4 w-4 sm:h-5 sm:w-5 text-blue-600" />
                      </div>
                      <div>
                        <div className="text-xs text-slate-600 dark:text-slate-400">Current Stage</div>
                        <div className="font-bold text-sm text-slate-800 dark:text-slate-200">{candidate.currentStage.stageName}</div>
                      </div>
                    </div>
                  </div>
                  
                  <div className="bg-gradient-to-br from-white/90 to-emerald-50/90 dark:from-slate-800/90 dark:to-slate-700/90 backdrop-blur-sm rounded-lg p-2 sm:p-3 shadow-md border border-white/20">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 sm:p-2 bg-emerald-500/10 rounded-lg">
                        <Timer className="h-4 w-4 sm:h-5 sm:w-5 text-emerald-600" />
                      </div>
                      <div>
                        <div className="text-xs text-slate-600 dark:text-slate-400">Time in Stage</div>
                        <div className="font-bold text-sm text-slate-800 dark:text-slate-200">{daysInStage} days</div>
                      </div>
                    </div>
                  </div>
                  
                  <div className="bg-gradient-to-br from-white/90 to-purple-50/90 dark:from-slate-800/90 dark:to-slate-700/90 backdrop-blur-sm rounded-lg p-2 sm:p-3 shadow-md border border-white/20">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 sm:p-2 bg-purple-500/10 rounded-lg">
                        <MessageSquare className="h-4 w-4 sm:h-5 sm:w-5 text-purple-600" />
                      </div>
                      <div>
                        <div className="text-xs text-slate-600 dark:text-slate-400">Changes</div>
                        <div className="font-bold text-sm text-slate-800 dark:text-slate-200">{candidate.stageHistory?.length || 0}</div>
                      </div>
                    </div>
                  </div>
                  
                  <div className="bg-gradient-to-br from-white/90 to-orange-50/90 dark:from-slate-800/90 dark:to-slate-700/90 backdrop-blur-sm rounded-lg p-2 sm:p-3 shadow-md border border-white/20">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 sm:p-2 bg-orange-500/10 rounded-lg">
                        <Star className="h-4 w-4 sm:h-5 sm:w-5 text-orange-600" />
                      </div>
                      <div>
                        <div className="text-xs text-slate-600 dark:text-slate-400">Priority</div>
                        <div className="font-bold text-sm text-slate-800 dark:text-slate-200 capitalize">{candidate.priority}</div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Skills & Experience */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
                  {/* Skills Card */}
                {candidate.skills && (
                    <div className="bg-gradient-to-br from-white/90 to-indigo-50/90 dark:from-slate-800/90 dark:to-slate-700/90 backdrop-blur-sm rounded-xl p-3 sm:p-4 shadow-lg border border-white/20">
                      <div className="flex items-center gap-2 mb-2 sm:mb-3">
                        <div className="p-1.5 sm:p-2 bg-indigo-500/10 rounded-lg">
                          <Target className="h-4 w-4 sm:h-5 sm:w-5 text-indigo-600" />
                        </div>
                        <h3 className="text-base font-bold text-slate-800 dark:text-slate-200">Core Skills</h3>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {candidate.skills.split(',').slice(0, 12).map((skill, index) => (
                          <Badge 
                            key={index} 
                            variant="secondary" 
                            className="bg-indigo-100/80 text-indigo-800 dark:bg-indigo-900/50 dark:text-indigo-300 border-0 px-3 py-1.5 hover:bg-indigo-200/80 dark:hover:bg-indigo-800/50 transition-all duration-200 hover:scale-105 cursor-pointer"
                          >
                            {skill.trim()}
                          </Badge>
                        ))}
                        {candidate.skills.split(',').length > 12 && (
                          <Badge variant="outline" className="text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer">
                            +{candidate.skills.split(',').length - 12} more
                          </Badge>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Professional Summary */}
                  <div className="bg-gradient-to-br from-white/90 to-emerald-50/90 dark:from-slate-800/90 dark:to-slate-700/90 backdrop-blur-sm rounded-xl p-3 sm:p-4 shadow-lg border border-white/20">
                    <div className="flex items-center gap-2 mb-2 sm:mb-3">
                      <div className="p-1.5 bg-emerald-500/10 rounded-lg">
                        <Briefcase className="h-4 w-4 text-emerald-600" />
                      </div>
                      <h3 className="text-base font-bold text-slate-800 dark:text-slate-200">Professional Profile</h3>
                    </div>
                    <div className="space-y-2">
                      {candidate.position && (
                        <div className="flex items-center justify-between p-2 bg-card/50 dark:bg-slate-800/50 rounded-lg">
                          <span className="text-xs text-slate-600 dark:text-slate-400 font-medium">Position:</span>
                          <span className="font-semibold text-sm text-slate-800 dark:text-slate-200">{candidate.position}</span>
                        </div>
                      )}
                      {candidate.experience && (
                        <div className="flex items-center justify-between p-2 bg-card/50 dark:bg-slate-800/50 rounded-lg">
                          <span className="text-xs text-slate-600 dark:text-slate-400 font-medium">Experience:</span>
                          <span className="font-semibold text-sm text-slate-800 dark:text-slate-200">{candidate.experience}</span>
                        </div>
                      )}
                      <div className="flex items-center justify-between p-2 bg-card/50 dark:bg-slate-800/50 rounded-lg">
                        <span className="text-xs text-slate-600 dark:text-slate-400 font-medium">Source:</span>
                        <Badge variant="outline" className="font-medium text-xs">{candidate.source}</Badge>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Tags Section */}
                {candidate.tags.length > 0 && (
                  <div className="bg-gradient-to-br from-white/90 to-slate-50/90 dark:from-slate-800/90 dark:to-slate-700/90 backdrop-blur-sm rounded-2xl p-4 sm:p-6 shadow-xl border border-white/20">
                    <div className="flex items-center gap-2 sm:gap-3 mb-3 sm:mb-4">
                      <div className="p-1.5 sm:p-2 bg-slate-500/10 rounded-lg">
                        <Star className="h-4 w-4 sm:h-5 sm:w-5 text-slate-600" />
                      </div>
                      <h3 className="text-base sm:text-lg font-bold text-slate-800 dark:text-slate-200">Tags & Labels</h3>
                    </div>
                      <div className="flex flex-wrap gap-1.5 sm:gap-2">
                        {candidate.tags.map((tag, index) => (
                        <Badge 
                          key={index} 
                          variant="secondary" 
                          className="bg-slate-100/80 text-slate-700 dark:bg-slate-700/80 dark:text-slate-300 border-0 px-3 py-1.5 hover:bg-slate-200/80 dark:hover:bg-slate-600/80 transition-all duration-200 hover:scale-105 cursor-pointer"
                        >
                            {tag}
                          </Badge>
                        ))}
                      </div>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="stages" className="flex-1 overflow-y-scroll space-y-3 pr-1" style={{scrollbarWidth: 'thin', scrollbarColor: '#cbd5e1 transparent'}}>
                <Card>
                  <CardHeader>
                    <CardTitle>Pipeline History</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {candidate.stageHistory.map((stage, index) => (
                        <div key={index} className="flex items-center justify-between p-3 bg-muted/30 dark:bg-card/30 rounded-lg">
                          <div className="flex items-center space-x-3">
                            <div 
                              className="w-3 h-3 rounded-full"
                              style={{ backgroundColor: getStageColor('', index) }}
                            />
                            <div>
                              <p className="font-medium">{stage.stageName}</p>
                              <p className="text-xs text-muted-foreground">
                                {new Date(stage.enteredAt).toLocaleDateString()}
                                {stage.exitedAt && ` - ${new Date(stage.exitedAt).toLocaleDateString()}`}
                              </p>
                            </div>
                          </div>
                          {stage.result && (
                            <Badge 
                              variant={stage.result === 'passed' ? 'default' : 
                                     stage.result === 'failed' ? 'destructive' : 'secondary'}
                              className="text-xs"
                            >
                              {stage.result}
                            </Badge>
                          )}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="interviews" className="flex-1 overflow-y-scroll space-y-3 pr-1" style={{scrollbarWidth: 'thin', scrollbarColor: '#cbd5e1 transparent', pointerEvents: 'auto'}}>
                {/* Interview Summary */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between">
                      <span>Interview Overview</span>
                      <div className="flex items-center space-x-3">
                        <Button
                          variant="outline"
                          size="sm"
                          className="bg-emerald-50 hover:bg-emerald-100 border-emerald-300 text-emerald-700 hover:text-emerald-800 relative z-50 min-h-[44px] sm:min-h-0"
                          style={{ pointerEvents: 'auto' }}
                          onClick={onScheduleInterview}
                        >
                          <CalendarPlus className="h-4 w-4 mr-2" />
                          Create Interview
                        </Button>
                      <div className="flex space-x-2">
                        {candidate.interviews.filter(i => ['scheduled', 'confirmed'].includes(i.status)).length > 0 && (
                          <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300">
                            {candidate.interviews.filter(i => ['scheduled', 'confirmed'].includes(i.status)).length} upcoming
                          </Badge>
                        )}
                        {candidate.interviews.filter(i => i.status === 'completed').length > 0 && (
                          <Badge className="bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300">
                            {candidate.interviews.filter(i => i.status === 'completed').length} completed
                          </Badge>
                        )}
                        </div>
                      </div>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {candidate.interviews.length > 0 ? (
                      <div className="space-y-4">
                        {/* Upcoming Interviews */}
                        {(() => {
                          const upcomingInterviews = candidate.interviews.filter(i => 
                            ['scheduled', 'confirmed'].includes(i.status)
                          ).sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());

                          if (upcomingInterviews.length > 0) {
                            return (
                      <div className="space-y-3">
                                <h4 className="text-sm font-semibold text-blue-900 dark:text-blue-100 flex items-center space-x-2">
                                  <Clock className="h-4 w-4" />
                                  <span>Upcoming Interviews</span>
                                </h4>
                                {upcomingInterviews.map((interview, index) => {
                                  const stage = stages.find(s => s._id === interview.stageId);
                                  const isNext = index === 0;
                          return (
                                    <div 
                                      key={index} 
                                      className={cn(
                                        "p-3 sm:p-4 border rounded-lg transition-all hover:shadow-md hover:bg-blue-100/50 dark:hover:bg-blue-900/30 select-none relative z-10",
                                        isNext && "bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800"
                                      )}
                                      style={{ pointerEvents: 'auto' }}
                                    >
                                      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0">
                                        <div className="flex items-center space-x-3 flex-1">
                                          <div className={cn(
                                            "w-3 h-3 rounded-full",
                                            interview.status === 'confirmed' ? "bg-green-500" : "bg-blue-500"
                                          )} />
                                          <div>
                                            <div className="flex items-center space-x-2">
                                              <p className="font-semibold">{stage?.name || 'Interview'}</p>
                                              {isNext && (
                                                <Badge variant="outline" className="text-xs bg-blue-100 text-blue-800 border-blue-300">
                                                  Next
                                                </Badge>
                                              )}
                                            </div>
                                            <p className="text-sm text-muted-foreground">
                                              {new Date(interview.scheduledAt).toLocaleDateString()} at{' '}
                                              {new Date(interview.scheduledAt).toLocaleTimeString([], { 
                                                hour: '2-digit', 
                                                minute: '2-digit' 
                                              })}
                                            </p>
                                          </div>
                                        </div>
                                        <div className="flex items-center space-x-2">
                                          <Badge className={cn("text-xs", getStatusBadgeColor(interview.status))}>
                                            {interview.status}
                                          </Badge>
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            className="h-7 px-2"
                                            onClick={(e) => { 
                                              e.stopPropagation(); 
                                              openInterview(interview) 
                                            }}
                                          >
                                            View
                                          </Button>
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            );
                          }
                          return null;
                        })()}

                        {/* Interview History */}
                        {(() => {
                          const completedInterviews = candidate.interviews.filter(i => 
                            ['completed', 'cancelled', 'no_show', 'missed', 'rescheduled'].includes(i.status)
                          ).sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime());

                          if (completedInterviews.length > 0) {
                            return (
                              <div className="space-y-3 pt-4 border-t border-gray-200 dark:border-gray-700">
                                <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center space-x-2">
                                  <CheckCircle className="h-4 w-4" />
                                  <span>Interview History</span>
                                </h4>
                                <div className="space-y-2">
                                  {completedInterviews.map((interview, index) => {
                                    const stage = stages.find(s => s._id === interview.stageId);
                                    return (
                                      <div 
                                        key={index} 
                                        className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 sm:gap-0 p-3 border rounded-lg hover:bg-muted/30 dark:hover:bg-gray-800/50 hover:shadow-md transition-all duration-200 hover:bg-green-100/50 dark:hover:bg-green-900/30 select-none relative z-10"
                                        style={{ pointerEvents: 'auto' }}
                                      >
                                        <div className="flex items-center space-x-3 flex-1">
                                          <div className={cn(
                                            "w-3 h-3 rounded-full",
                                            interview.status === 'completed' ? "bg-green-500" : 
                                            interview.status === 'cancelled' ? "bg-red-500" : 
                                            interview.status === 'missed' ? "bg-orange-500" :
                                            interview.status === 'rescheduled' ? "bg-yellow-500" :
                                            interview.status === 'no_show' ? "bg-muted/300" : "bg-gray-400"
                                          )} />
                                          <div>
                                            <p className="font-medium">{stage?.name || 'Interview'}</p>
                                            <p className="text-sm text-muted-foreground">
                                              {new Date(interview.scheduledAt).toLocaleDateString()} at{' '}
                                              {new Date(interview.scheduledAt).toLocaleTimeString([], { 
                                                hour: '2-digit', 
                                                minute: '2-digit' 
                                              })}
                                  </p>
                                </div>
                              </div>
                              <div className="flex items-center space-x-2">
                                {interview.score && (
                                  <Badge variant="outline" className="text-xs">
                                    {interview.score}/10
                                  </Badge>
                                )}
                                <Badge className={cn("text-xs", getStatusBadgeColor(interview.status))}>
                                  {interview.status}
                                </Badge>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 px-2"
                                            onClick={(e) => { 
                                              e.stopPropagation(); 
                                              openInterview(interview) 
                                            }}
                                >
                                  View
                                </Button>
                              </div>
                            </div>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          }
                          return null;
                        })()}
                        
                        {/* Always show Create Interview button at bottom of interviews list */}
                        <div className="pt-4 border-t border-gray-200">
                          <Button
                            variant="outline"
                            className="w-full bg-emerald-50 hover:bg-emerald-100 border-emerald-300 text-emerald-700 hover:text-emerald-800 relative z-50"
                            style={{ pointerEvents: 'auto' }}
                            onClick={onScheduleInterview}
                          >
                            <CalendarPlus className="h-4 w-4 mr-2" />
                            Schedule Additional Interview
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="text-center py-8">
                        <Calendar className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                        <p className="text-muted-foreground">No interviews scheduled yet</p>
                        <p className="text-sm text-muted-foreground mt-1">Schedule an interview to start the interview process</p>
                        <Button
                          variant="outline"
                          className="mt-4 bg-emerald-50 hover:bg-emerald-100 border-emerald-300 text-emerald-700 hover:text-emerald-800 relative z-50"
                          style={{ pointerEvents: 'auto' }}
                          onClick={onScheduleInterview}
                        >
                          <CalendarPlus className="h-4 w-4 mr-2" />
                          Schedule First Interview
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="ai-insights" className="flex-1 overflow-y-scroll space-y-3 pr-1" style={{scrollbarWidth: 'thin', scrollbarColor: '#cbd5e1 transparent'}}>
                {candidate.aiInsights ? (
                  <>
                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center space-x-2">
                          <TrendingUp className="h-5 w-5" />
                          <span>AI Analysis</span>
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="text-center">
                            <div className="text-3xl font-bold text-blue-600">{Math.round(candidate.aiInsights.overallScore)}%</div>
                            <div className="text-sm text-muted-foreground">Overall Score</div>
                          </div>
                          <div className="text-center">
                            <div className="text-3xl font-bold text-green-600">{Math.round(candidate.aiInsights.confidence * 100)}%</div>
                            <div className="text-sm text-muted-foreground">Confidence</div>
                          </div>
                        </div>
                        <Separator className="my-4" />
                        <div>
                          <h4 className="font-medium mb-2">Recommendation</h4>
                          <Badge variant="outline" className="capitalize">
                            {candidate.aiInsights.recommendedAction?.replace('_', ' ') || 'No recommendation'}
                          </Badge>
                        </div>
                      </CardContent>
                    </Card>

                    {/* Key Strengths */}
                    {candidate.aiInsights.keyStrengths && candidate.aiInsights.keyStrengths.length > 0 && (
                      <Card>
                        <CardHeader>
                          <CardTitle className="text-sm text-green-600">Key Strengths</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <ul className="space-y-2">
                            {candidate.aiInsights.keyStrengths.map((strength, index) => (
                              <li key={index} className="flex items-start space-x-2">
                                <CheckCircle className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
                                <span className="text-sm">{strength}</span>
                              </li>
                            ))}
                          </ul>
                        </CardContent>
                      </Card>
                    )}

                    {/* Key Concerns */}
                    {candidate.aiInsights.keyConcerns && candidate.aiInsights.keyConcerns.length > 0 && (
                      <Card>
                        <CardHeader>
                          <CardTitle className="text-sm text-red-600">Areas of Concern</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <ul className="space-y-2">
                            {candidate.aiInsights.keyConcerns.map((concern, index) => (
                              <li key={index} className="flex items-start space-x-2">
                                <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
                                <span className="text-sm">{concern}</span>
                              </li>
                            ))}
                          </ul>
                        </CardContent>
                      </Card>
                    )}
                  </>
                ) : (
                  <Card>
                    <CardContent className="text-center py-8">
                      <TrendingUp className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                      <p className="text-muted-foreground">No AI analysis available yet</p>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>
            </Tabs>
          </div>

            {/* Right Panel - Modern Actions Sidebar */}
            <div className="lg:w-72 xl:w-80 border-t lg:border-t-0 lg:border-l border-slate-200/60 dark:border-slate-700/60 bg-gradient-to-b from-slate-50/80 to-white/90 dark:from-slate-800/80 dark:to-slate-900/90 backdrop-blur-sm flex-shrink-0">
              <div className="h-full overflow-y-scroll p-2 sm:p-3 md:p-4 space-y-2 sm:space-y-3" style={{scrollbarWidth: 'thin', scrollbarColor: '#cbd5e1 transparent'}}>
                
                {/* Candidate Stats */}
                <div className="bg-gradient-to-br from-white/95 to-slate-50/95 dark:from-slate-800/95 dark:to-slate-700/95 backdrop-blur-sm rounded-xl p-3 sm:p-4 shadow-lg border border-white/50 dark:border-slate-600/50">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="p-1.5 bg-purple-500/10 rounded-lg">
                      <TrendingUp className="h-4 w-4 text-purple-600" />
                    </div>
                    <h3 className="text-lg font-bold text-slate-800 dark:text-slate-200">Candidate Stats</h3>
                  </div>
                  
                  <div className="grid grid-cols-1 gap-2">
                    <div className="bg-gradient-to-br from-white/90 to-blue-50/90 dark:from-slate-800/90 dark:to-slate-700/90 backdrop-blur-sm rounded-lg p-3 text-center shadow-md border border-white/30">
                      <div className="text-xl font-bold text-blue-600 dark:text-blue-400">
                        {Math.floor((new Date().getTime() - new Date(candidate.applicationDate).getTime()) / (1000 * 60 * 60 * 24))}
                      </div>
                      <div className="text-xs font-medium text-slate-600 dark:text-slate-400">Days Active</div>
                    </div>
                    <div className="bg-gradient-to-br from-white/90 to-emerald-50/90 dark:from-slate-800/90 dark:to-slate-700/90 backdrop-blur-sm rounded-lg p-3 text-center shadow-md border border-white/30">
                      <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400">
                        {candidate.interviews?.length || 0}
                      </div>
                      <div className="text-xs font-medium text-slate-600 dark:text-slate-400">Interviews</div>
                    </div>
                    {candidate.aiInsights && (
                      <div className="bg-gradient-to-br from-purple-50/90 to-indigo-50/90 dark:from-purple-900/30 dark:to-indigo-900/30 backdrop-blur-sm rounded-lg p-3 text-center shadow-md border border-purple-200/30">
                        <div className="text-xl font-bold text-purple-600 dark:text-purple-400">
                          {Math.round(candidate.aiInsights.overallScore || 0)}%
                        </div>
                        <div className="text-xs font-medium text-purple-700 dark:text-purple-300">AI Match Score</div>
                      </div>
                    )}
                  </div>
                </div>
                
                {/* Enhanced Move to Stage Section */}
                <div className="bg-gradient-to-br from-white/95 to-blue-50/95 dark:from-slate-800/95 dark:to-slate-700/95 backdrop-blur-sm rounded-xl p-3 sm:p-4 shadow-lg border border-white/50 dark:border-slate-600/50">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="p-1.5 bg-blue-500/10 rounded-lg">
                      <ArrowRight className="h-4 w-4 text-blue-600" />
                    </div>
                    <h3 className="text-lg font-bold text-slate-800 dark:text-slate-200">Pipeline Actions</h3>
                  </div>

                  {/* Current Stage Highlight */}
                  <div className="bg-card/80 dark:bg-slate-700/80 backdrop-blur-sm rounded-lg p-3 mb-4 border border-blue-200/50 dark:border-blue-700/50">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">Currently In</span>
                      <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" />
                    </div>
                    <div className="font-bold text-base text-slate-800 dark:text-slate-100">{candidate.currentStage.stageName}</div>
                    <div className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                      <Timer className="inline h-3 w-3 mr-1" />
                      {daysInStage} {daysInStage === 1 ? 'day' : 'days'} in stage
                    </div>
                  </div>

                  {/* Stage Selection */}
                  <div className="space-y-4">
                    <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">Move to Stage</label>
                <Select value={selectedStage} onValueChange={setSelectedStage}>
                      <SelectTrigger className="w-full min-h-[44px] bg-card/80 dark:bg-slate-800/80 backdrop-blur-sm border-slate-300/50 dark:border-slate-600/50 hover:border-blue-400 dark:hover:border-blue-500 transition-colors">
                        <SelectValue placeholder="Choose destination stage..." />
                  </SelectTrigger>
                      <SelectContent className="bg-card/95 dark:bg-slate-800/95 backdrop-blur-sm border-slate-200 dark:border-slate-700 max-h-[60vh]">
                        {availableStages.map((stage) => (
                          <SelectItem 
                            key={stage._id} 
                            value={stage._id} 
                            className="hover:bg-blue-50 dark:hover:bg-blue-950/30 cursor-pointer min-h-[44px] py-3"
                          >
                            <div className="flex items-center space-x-3 w-full">
                          <div 
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: getStageColor(stage.type, stage.order) }}
                          />
                              <span className="flex-1 font-medium">{stage.name}</span>
                              <div className="flex items-center space-x-2">
                                <Badge variant="outline" className="text-xs bg-slate-100 dark:bg-slate-700">
                            {stage.candidateCount}
                          </Badge>
                                {stage.order > currentStageIndex ? (
                                  <ArrowRight className="h-3 w-3 text-green-600" />
                                ) : (
                                  <ArrowLeft className="h-3 w-3 text-orange-600" />
                                )}
                              </div>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Textarea
                      placeholder="Add notes about this stage transition (optional)..."
                  value={moveNotes}
                  onChange={(e) => setMoveNotes(e.target.value)}
                  rows={3}
                      className="resize-none bg-card/80 dark:bg-slate-800/80 backdrop-blur-sm border-slate-300/50 dark:border-slate-600/50 focus:border-blue-400 dark:focus:border-blue-500 text-sm sm:text-base min-h-[80px]"
                />

                <Button 
                  onClick={handleMoveToStage} 
                  disabled={!selectedStage || isMoving}
                      className="w-full h-12 sm:h-auto bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-lg hover:shadow-xl transition-all duration-200"
                      size="lg"
                >
                  {isMoving ? (
                    <div className="flex items-center space-x-2">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                          <span>Moving candidate...</span>
                        </div>
                      ) : selectedStage ? (
                        <div className="flex items-center space-x-2">
                          <ArrowRight className="h-4 w-4" />
                          <span>Move to {availableStages.find(s => s._id === selectedStage)?.name}</span>
                    </div>
                  ) : (
                        <div className="flex items-center space-x-2">
                          <Target className="h-4 w-4" />
                          <span>Select Stage to Move</span>
                        </div>
                  )}
                </Button>
                  </div>
                </div>

                {/* Enhanced Quick Actions */}
                <div className="bg-gradient-to-br from-white/95 to-emerald-50/95 dark:from-slate-800/95 dark:to-slate-700/95 backdrop-blur-sm rounded-xl p-4 shadow-lg border border-white/50 dark:border-slate-600/50">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="p-1.5 bg-emerald-500/10 rounded-lg">
                      <Calendar className="h-4 w-4 text-emerald-600" />
                    </div>
                    <h3 className="text-lg font-bold text-slate-800 dark:text-slate-200">Quick Actions</h3>
                  </div>

                  {/* Smart Interview Actions */}
                  <div className="space-y-3">
                    {(() => {
                      const upcomingInterviews = candidate.interviews.filter(interview => 
                        ['scheduled', 'confirmed'].includes(interview.status)
                      );

                      if (upcomingInterviews.length > 0) {
                        const nextInterview = upcomingInterviews[0];
                        return (
                          <div className="space-y-3">
                            <Button 
                              className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 shadow-lg hover:shadow-xl transition-all duration-200" 
                              onClick={() => openInterview(nextInterview)}
                            >
                              <Calendar className="h-4 w-4 mr-2" />
                              View Scheduled Interview
                            </Button>
                            <div className="bg-card/60 dark:bg-slate-800/60 backdrop-blur-sm p-3 rounded-lg border border-emerald-200/50 dark:border-emerald-700/50">
                              <div className="flex items-center justify-between">
                                <div>
                                  <p className="text-sm font-semibold text-emerald-900 dark:text-emerald-100">
                                    Next Interview
                                  </p>
                                  <p className="text-xs text-emerald-700 dark:text-emerald-300 mt-1">
                                    {new Date(nextInterview.scheduledAt).toLocaleDateString()} at{' '}
                                    {new Date(nextInterview.scheduledAt).toLocaleTimeString([], { 
                                      hour: '2-digit', 
                                      minute: '2-digit' 
                                    })}
                                  </p>
                                </div>
                                <Badge className={cn("text-xs font-medium", {
                                  'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300': nextInterview.status === 'scheduled',
                                  'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300': nextInterview.status === 'confirmed'
                                })}>
                                  {nextInterview.status}
                                </Badge>
                              </div>
                              {upcomingInterviews.length > 1 && (
                                <p className="text-xs text-slate-600 dark:text-slate-400 text-center mt-2 pt-2 border-t border-emerald-200/30 dark:border-emerald-700/30">
                                  +{upcomingInterviews.length - 1} more interview{upcomingInterviews.length - 1 !== 1 ? 's' : ''} scheduled
                                </p>
                              )}
                            </div>
                          </div>
                        );
                      }

                      return null;
                    })()}

                    {/* Communication Actions */}
                    <div className="grid grid-cols-1 gap-2">
                      {candidate.resumeUrl && (
                        <Button 
                          variant="outline" 
                          className="w-full justify-start bg-card/80 dark:bg-slate-800/80 backdrop-blur-sm hover:bg-purple-50 dark:hover:bg-purple-950/30 transition-all duration-200" 
                          onClick={() => window.open(candidate.resumeUrl, '_blank')}
                        >
                          <FileText className="h-4 w-4 mr-2 text-purple-600" />
                    View Resume
                  </Button>
                )}

                      <Button 
                        variant="outline" 
                        className="w-full justify-start bg-card/80 dark:bg-slate-800/80 backdrop-blur-sm hover:bg-indigo-50 dark:hover:bg-indigo-950/30 transition-all duration-200" 
                        onClick={() => window.open(`/candidates/${candidate._id}?from=job-pipeline&jobId=${window.location.pathname.split('/')[2]}`, '_blank')}
                      >
                        <ExternalLink className="h-4 w-4 mr-2 text-indigo-600" />
                  View Full Profile
                </Button>
                    </div>
                </div>
                </div>
              
                </div>
                </div>
            
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
