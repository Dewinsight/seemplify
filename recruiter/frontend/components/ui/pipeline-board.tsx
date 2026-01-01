"use client"

import { useState, useEffect, useCallback } from "react"
import { createPortal } from "react-dom"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/hooks/use-toast"
import pipelineService, { type PipelineApplicant, type UpdateStatusRequest, type AddToPipelineRequest } from "@/services/pipelineService"
import { getAllCandidates } from "@/services/candidateService"
import interviewService, { type Interview } from "@/services/interviewService"
import { InterviewFeedbackSimple } from "@/components/ui/interview-feedback-simple"
import {
  Plus,
  MoreVertical, 
  Clock, 
  Star,
  Phone,
  Mail,
  MapPin,
  Eye,
  Filter,
  FileText,
  Calendar,
  User,
  GripVertical,
  Check,
  ChevronsUpDown,
  X,
  Trash2,
  Video,
  CheckCircle,
  XCircle,
  AlertCircle,
  Mic,
  FileVideo,
  MessageSquare
} from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { MultiStepInterviewScheduler } from './multi-step-interview-scheduler'

const PIPELINE_STAGES = [
  { id: 'applied', title: 'Applied', color: 'bg-blue-100 border-blue-200' },
  { id: 'reviewing', title: 'Reviewing', color: 'bg-yellow-100 border-yellow-200' },
  { id: 'shortlisted', title: 'Shortlisted', color: 'bg-purple-100 border-purple-200' },
  { id: 'interviewing', title: 'Interviewing', color: 'bg-orange-100 border-orange-200' },
  { id: 'offered', title: 'Offered', color: 'bg-green-100 border-green-200' },
  { id: 'hired', title: 'Hired', color: 'bg-emerald-100 border-emerald-200' },
  { id: 'rejected', title: 'Rejected', color: 'bg-red-100 border-red-200' },
]

interface PipelineBoardProps {
  jobId: string
  applicants: PipelineApplicant[]
  onApplicantsChange: (applicants: PipelineApplicant[]) => void
  onAnalyticsUpdate?: () => void
  onJobDataRefresh?: () => void
  job?: { title: string }
}

export function PipelineBoard({ 
  jobId, 
  applicants, 
  onApplicantsChange,
  onAnalyticsUpdate,
  onJobDataRefresh,
  job
}: PipelineBoardProps) {
  const [selectedApplicant, setSelectedApplicant] = useState<PipelineApplicant | null>(null)
  const [showStatusDialog, setShowStatusDialog] = useState(false)
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [showNotesDialog, setShowNotesDialog] = useState(false)
  const [showPreviewDialog, setShowPreviewDialog] = useState(false)
  const [selectedInterviewIdForPreview, setSelectedInterviewIdForPreview] = useState<string | null>(null)
  const [updating, setUpdating] = useState<string | null>(null)
  const [newStatus, setNewStatus] = useState('')
  const [notes, setNotes] = useState('')
  const [availableCandidates, setAvailableCandidates] = useState<any[]>([])
  const [selectedCandidateId, setSelectedCandidateId] = useState('')
  const [addNotes, setAddNotes] = useState('')
  const [addScore, setAddScore] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [showScheduler, setShowScheduler] = useState<string | null>(null)
  const [loadingCandidates, setLoadingCandidates] = useState(false)
  const [candidateSearchOpen, setCandidateSearchOpen] = useState(false)
  const [candidateSearchValue, setCandidateSearchValue] = useState("")
  const [candidateInterviews, setCandidateInterviews] = useState<Record<string, Interview[]>>({})
  const [loadingInterviews, setLoadingInterviews] = useState<Record<string, boolean>>({})

  // Load available candidates when dialog opens
  const loadAvailableCandidates = useCallback(async () => {
    setLoadingCandidates(true)
    try {
      console.log('🔍 Loading available candidates...')
      const candidates = await getAllCandidates()
      console.log('📋 All candidates fetched:', candidates?.length || 0, candidates)
      
      // Ensure we have a valid array
      if (!Array.isArray(candidates)) {
        console.error('❌ Invalid response format - expected array, got:', typeof candidates)
        throw new Error('Invalid response format from server')
      }
      
      // Filter out candidates already in pipeline
      const candidateIds = applicants.map(app => app?.candidate?._id).filter(Boolean)
      console.log('🚫 Candidates already in pipeline:', candidateIds)
      
      const available = candidates.filter((candidate: any) => 
        candidate && candidate._id && !candidateIds.includes(candidate._id)
      )
      console.log('✅ Available candidates for selection:', available?.length || 0, available)
      
      setAvailableCandidates(available)
      
      if (available.length === 0) {
        console.warn('⚠️ No candidates available for selection')
        if (candidates.length === 0) {
          toast({
            title: "No Candidates Found",
            description: "No candidates exist in the system. Please create some candidates first.",
            variant: "default",
          })
        } else {
          toast({
            title: "No Available Candidates",
            description: "All candidates are already in this pipeline.",
            variant: "default",
          })
        }
      }
    } catch (error) {
      console.error('❌ Error loading candidates:', error)
      setAvailableCandidates([])
      toast({
        title: "Error Loading Candidates",
        description: `Failed to load available candidates: ${error instanceof Error ? error.message : 'Unknown error'}`,
        variant: "destructive",
      })
    } finally {
      setLoadingCandidates(false)
    }
  }, [applicants])

  useEffect(() => {
    if (showAddDialog) {
      loadAvailableCandidates()
    }
  }, [showAddDialog, loadAvailableCandidates])

  // When opening candidate preview, select the latest interview for preview
  useEffect(() => {
    if (!showPreviewDialog || !selectedApplicant) return
    const candidateId = selectedApplicant.candidate._id
    const list = (candidateInterviews[candidateId] || []).slice().sort((a, b) => {
      const ad = new Date((a as any).scheduledAt || (a as any).createdAt || 0).getTime()
      const bd = new Date((b as any).scheduledAt || (b as any).createdAt || 0).getTime()
      return bd - ad
    })
    setSelectedInterviewIdForPreview(list.length > 0 ? list[0]._id : null)
  }, [showPreviewDialog, selectedApplicant, candidateInterviews])

  // Load interviews for all candidates on mount and when applicants change
  useEffect(() => {
    const loadAllInterviews = async () => {
      const interviewPromises = applicants.map(async (applicant) => {
        if (!loadingInterviews[applicant.candidate._id]) {
          setLoadingInterviews(prev => ({ ...prev, [applicant.candidate._id]: true }))
          try {
            const interviews = await interviewService.getCandidateInterviews(applicant.candidate._id)
            setCandidateInterviews(prev => ({ ...prev, [applicant.candidate._id]: interviews }))
          } catch (error) {
            console.error(`Error loading interviews for candidate ${applicant.candidate._id}:`, error)
          } finally {
            setLoadingInterviews(prev => ({ ...prev, [applicant.candidate._id]: false }))
          }
        }
      })
      
      await Promise.all(interviewPromises)
    }

    loadAllInterviews()
  }, [applicants])

  // Helper function to get interview status badge color
  const getInterviewStatusColor = (status: string) => {
    switch (status) {
      case 'scheduled':
      case 'confirmed':
        return 'bg-blue-100 text-blue-800 border-blue-200'
      case 'in_progress':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200'
      case 'completed':
        return 'bg-green-100 text-green-800 border-green-200'
      case 'cancelled':
      case 'rescheduled':
        return 'bg-red-100 text-red-800 border-red-200'
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200'
    }
  }

  // Helper function to get interview status icon
  const getInterviewStatusIcon = (status: string, hasTranscript: boolean, hasRecording: boolean) => {
    switch (status) {
      case 'completed':
        if (hasTranscript || hasRecording) {
          return <CheckCircle className="h-4 w-4 text-green-600" title="Interview completed with transcript/recording" />
        }
        return <CheckCircle className="h-4 w-4 text-green-600" title="Interview completed" />
      case 'in_progress':
        return <AlertCircle className="h-4 w-4 text-yellow-600" title="Interview in progress" />
      case 'cancelled':
        return <XCircle className="h-4 w-4 text-red-600" title="Interview cancelled" />
      default:
        return <Clock className="h-4 w-4 text-blue-600" title="Interview scheduled" />
    }
  }

  // Helper function to format interview date/time
  const formatInterviewDateTime = (dateString: string) => {
    const date = new Date(dateString)
    const today = new Date()
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)
    
    const isToday = date.toDateString() === today.toDateString()
    const isTomorrow = date.toDateString() === tomorrow.toDateString()
    
    if (isToday) {
      return `Today at ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`
    } else if (isTomorrow) {
      return `Tomorrow at ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`
    } else {
      return date.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      })
    }
  }

  // Handle status update with notes
  const handleStatusUpdate = async () => {
    if (!selectedApplicant || !newStatus) return

    try {
      setUpdating(selectedApplicant._id)
      
      const updateData: UpdateStatusRequest = {
        newStatus,
        notes: notes.trim() || undefined,
      }

      const result = await pipelineService.updateApplicantStatus(
        jobId,
        selectedApplicant.candidate._id,
        updateData
      )

      // Update the applicants list
      const updatedApplicants = applicants.map(app =>
        app._id === selectedApplicant._id ? result.applicant : app
      )
      onApplicantsChange(updatedApplicants)

      // Force re-render

      toast({
        title: "Status Updated",
                    description: `${selectedApplicant?.candidate?.firstName || 'Candidate'} ${selectedApplicant?.candidate?.lastName || ''} moved to ${newStatus}`,
      })

      setShowStatusDialog(false)
      setSelectedApplicant(null)
      setNewStatus('')
      setNotes('')
      onAnalyticsUpdate?.()
    } catch (error: any) {
      // Parse error message for better user feedback
      let errorMessage = error.message
      if (error.message.includes('Invalid status transition')) {
        errorMessage = `Cannot move candidate to ${newStatus}. This transition is not allowed by business rules.`
      }
      
      toast({
        title: "Status Update Failed",
        description: errorMessage,
        variant: "destructive",
      })
    } finally {
      setUpdating(null)
    }
  }

  // Handle adding candidate to pipeline
  const handleAddCandidate = async () => {
    if (!selectedCandidateId) return

    try {
      const addData: AddToPipelineRequest = {
        candidateId: selectedCandidateId,
        initialStatus: 'applied',
        notes: addNotes.trim() || undefined,
        score: addScore ? parseInt(addScore) : undefined,
      }

      const result = await pipelineService.addCandidateToPipeline(jobId, addData)
      
      // Add to applicants list
      const updatedApplicants = [...applicants, result.applicant]
      onApplicantsChange(updatedApplicants)

      toast({
        title: "Candidate Added",
        description: "Candidate has been added to the pipeline",
      })

      setShowAddDialog(false)
      setSelectedCandidateId('')
      setAddNotes('')
      setAddScore('')
      onAnalyticsUpdate?.()
    } catch (error: any) {
      toast({
        title: "Add Failed",
        description: error.message,
        variant: "destructive",
      })
    }
  }

  // Handle removing candidate
  const handleRemoveCandidate = async (applicant: PipelineApplicant) => {
    try {
      await pipelineService.removeCandidateFromPipeline(
        jobId,
        applicant.candidate._id,
        'Removed by user'
      )

      const updatedApplicants = applicants.filter(app => app._id !== applicant._id)
      onApplicantsChange(updatedApplicants)

      toast({
        title: "Candidate Removed",
                  description: `${applicant?.candidate?.firstName || 'Candidate'} ${applicant?.candidate?.lastName || ''} removed from pipeline`,
      })

      onAnalyticsUpdate?.()
    } catch (error: any) {
      toast({
        title: "Remove Failed",
        description: error.message,
        variant: "destructive",
      })
    }
  }

  const getInitials = (firstName: string, lastName: string) => {
    const first = firstName?.charAt(0) || '?'
    const last = lastName?.charAt(0) || '?'
    return `${first}${last}`.toUpperCase()
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString()
  }

  const getTimeInStage = (applicant: PipelineApplicant) => {
    const lastStatusChange = applicant.statusHistory[applicant.statusHistory.length - 1]
    if (!lastStatusChange) return 'Unknown'
    
    const daysDiff = Math.floor(
      (Date.now() - new Date(lastStatusChange.changedAt).getTime()) / (1000 * 60 * 60 * 24)
    )
    
    return daysDiff === 0 ? 'Today' : `${daysDiff} days`
  }

  // Filter applicants based on status filter and ensure valid data
  const filteredApplicants = (statusFilter && statusFilter !== 'all'
    ? applicants.filter(app => app?.status === statusFilter)
    : applicants)
    .filter(app => app && app.candidate && app.candidate.firstName !== undefined)

  return (
    <div className="space-y-4">
      {/* Header with Controls */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div className="flex items-center gap-4">
          <h3 className="text-lg font-semibold">Pipeline ({filteredApplicants.length} candidates)</h3>
        </div>

        <div className="flex items-center gap-2">
          {/* Status Filter */}
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40">
              <Filter className="h-4 w-4 mr-2" />
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {PIPELINE_STAGES.map((stage) => (
                <SelectItem key={stage.id} value={stage.id}>
                  {stage.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

        <Button onClick={() => setShowAddDialog(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Add Candidate
        </Button>
        </div>
      </div>

      {/* List View */}
      <div className="space-y-3">
        {filteredApplicants.length === 0 ? (
          <Card className="p-8 text-center">
            <div className="flex flex-col items-center gap-4">
              <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center">
                <User className="h-8 w-8 text-gray-400" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900">No candidates found</h3>
                <p className="text-gray-500">
                  {statusFilter && statusFilter !== 'all' 
                    ? `No candidates with status "${PIPELINE_STAGES.find(s => s.id === statusFilter)?.title}"`
                    : "Add some candidates to get started"
                  }
                </p>
              </div>
              <Button onClick={() => setShowAddDialog(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Add First Candidate
              </Button>
            </div>
          </Card>
        ) : (
          <div className="grid gap-3">
            {filteredApplicants.map((applicant) => {
              const stageInfo = PIPELINE_STAGES.find(s => s.id === applicant.status)
              return (
                <Card key={`${applicant._id}-${applicant.status}`} className="group hover:shadow-md transition-shadow">
                  <div className="p-4">
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-center">
                    {/* Candidate Info */}
                    <div className="flex items-center gap-3">
                      <Avatar className="h-14 w-14 ring-2 ring-gray-100 shadow-sm">
                        <AvatarFallback className="bg-gradient-to-br from-blue-500 to-purple-600 text-white font-semibold text-lg">
                                      {getInitials(applicant?.candidate?.firstName || '', applicant?.candidate?.lastName || '')}
                                    </AvatarFallback>
                                  </Avatar>
                      <div className="min-w-0 flex-1">
                        <div className="text-center">
                          <p className="font-bold text-lg text-gray-900 truncate">
                            {applicant?.candidate?.firstName || 'N/A'}
                          </p>
                          <p className="text-sm text-gray-600 truncate">
                            {applicant?.candidate?.lastName || 'N/A'}
                          </p>
                        </div>
                        <div className="text-center mt-1">
                          <p className="text-sm font-medium text-gray-800 truncate">
                            {applicant.candidate.position || 'No position specified'}
                          </p>
                          {applicant.candidate.location && (
                            <p className="text-xs text-gray-500 flex items-center justify-center gap-1 mt-1">
                              <MapPin className="h-3 w-3" />
                              {applicant.candidate.location}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Contact Info */}
                    <div className="space-y-2">
                      {applicant.candidate.phone && (
                        <div className="flex items-center gap-2 text-sm bg-green-50 text-green-700 px-2 py-1 rounded">
                          <Phone className="h-3 w-3" />
                          <span className="truncate">{applicant.candidate.phone}</span>
                        </div>
                      )}
                    </div>

                    {/* Status & Score */}
                    <div className="flex flex-col items-center gap-2">
                      <Badge 
                        variant="outline" 
                        className={`${stageInfo?.color} border-current font-medium ${updating === applicant._id ? 'opacity-50 animate-pulse' : ''}`}
                      >
                        {updating === applicant._id ? '⏳ Updating...' : stageInfo?.title}
                      </Badge>
                      {applicant.score && applicant.score >= 80 && (
                        <div className="flex items-center gap-1 text-green-600">
                          <Star className="h-4 w-4 fill-current" />
                          <span className="text-sm font-medium">{applicant.score}%</span>
                        </div>
                      )}
                      <div className="text-xs text-gray-500 text-center">
                        <Clock className="h-3 w-3 inline mr-1" />
                        {getTimeInStage(applicant)}
                                  </div>
                                </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 justify-end">
                      {/* Preview Button */}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 hover:bg-blue-100"
                        onClick={() => {
                          setSelectedApplicant(applicant)
                          setShowPreviewDialog(true)
                        }}
                      >
                        <Eye className="h-4 w-4 text-blue-600" />
                      </Button>
                      
                      {/* Remove Button */}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-100"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`Are you sure you want to remove ${applicant?.candidate?.firstName || 'this candidate'} from the pipeline?`)) {
                            handleRemoveCandidate(applicant);
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4 text-red-600" />
                      </Button>
                      
                      {/* NEW: Interview scheduling button */}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowScheduler(applicant.candidate._id);
                        }}
                      >
                        <Calendar className="h-4 w-4" />
                      </Button>
                      
                      {/* Quick Status Update */}
                      <Select 
                        value={applicant.status} 
                        onValueChange={async (newStatus) => {
                          console.log(`🔄 Updating candidate ${applicant?.candidate?.firstName || 'N/A'} ${applicant?.candidate?.lastName || 'N/A'} from ${applicant.status} to ${newStatus}`)
                          
                          const updateData = { newStatus }
                          setUpdating(applicant._id)
                          
                          try {
                            const result = await pipelineService.updateApplicantStatus(jobId, applicant.candidate._id, updateData)
                            console.log('✅ Status update successful, server response:', result)
                            
                            // Update with the complete applicant object from server response
                            const updatedApplicants = applicants.map(app =>
                              app._id === applicant._id ? result.applicant : app
                            )
                            console.log('📝 Updating local state with:', updatedApplicants.find(app => app._id === applicant._id))
                            onApplicantsChange(updatedApplicants)
                            
                            
                            toast({
                              title: "Status Updated",
                              description: `${applicant?.candidate?.firstName || 'Candidate'} ${applicant?.candidate?.lastName || ''} moved to ${newStatus}`,
                            })
                            onAnalyticsUpdate?.()
                          } catch (error: any) {
                            console.error('❌ Status update failed:', error)
                            // Parse error message for better user feedback
                            let errorMessage = error.message
                            if (error.message.includes('Invalid status transition')) {
                              errorMessage = `Cannot move candidate to ${newStatus}. This transition is not allowed by business rules.`
                            }
                            
                            toast({
                              title: "Status Update Failed",
                              description: errorMessage,
                              variant: "destructive",
                            })
                          } finally {
                            setUpdating(null)
                          }
                        }}
                        disabled={updating === applicant._id}
                      >
                        <SelectTrigger className="w-32">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PIPELINE_STAGES.map((stage) => (
                            <SelectItem key={stage.id} value={stage.id}>
                              {stage.title}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      
                      {/* More Actions */}
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                            <MoreVertical className="h-4 w-4" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => {
                              setShowScheduler(applicant.candidate._id)
                            }}
                          >
                            <Calendar className="h-4 w-4 mr-2" />
                            Schedule Interview
                          </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onClick={() => {
                                        setSelectedApplicant(applicant)
                                        setNewStatus(applicant.status)
                                        setShowStatusDialog(true)
                                      }}
                                    >
                            <FileText className="h-4 w-4 mr-2" />
                            Update with Notes
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onClick={() => {
                                        setSelectedApplicant(applicant)
                                        setShowNotesDialog(true)
                                      }}
                                    >
                            <FileText className="h-4 w-4 mr-2" />
                                      View History
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onClick={() => {
                                        if (confirm(`Are you sure you want to remove ${applicant?.candidate?.firstName || 'this candidate'} from the pipeline?`)) {
                                          handleRemoveCandidate(applicant);
                                        }
                                      }}
                                      className="text-red-600 focus:text-red-600"
                                    >
                                      <Trash2 className="h-4 w-4 mr-2" />
                                      Remove from Pipeline
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </div>
                                </div>
                    
                    {/* Interview Details Section */}
                    {candidateInterviews[applicant.candidate._id] && candidateInterviews[applicant.candidate._id].length > 0 && (
                      <div className="mt-4 pt-4 border-t border-gray-100">
                        <div className="flex items-center gap-2 mb-3">
                          <Calendar className="h-4 w-4 text-gray-500" />
                          <span className="text-sm font-medium text-gray-700">Interviews ({candidateInterviews[applicant.candidate._id].length})</span>
                        </div>
                        <div className="space-y-2">
                          {candidateInterviews[applicant.candidate._id].slice(0, 2).map((interview) => (
                            <div key={interview._id} className="flex items-center justify-between bg-gray-50 rounded-lg p-3">
                              <div className="flex items-center gap-3">
                                <div className="flex-shrink-0">
                                  {interview.type === 'video' ? (
                                    <Video className="h-4 w-4 text-blue-600" />
                                  ) : interview.type === 'phone' ? (
                                    <Phone className="h-4 w-4 text-green-600" />
                                  ) : (
                                    <User className="h-4 w-4 text-purple-600" />
                                  )}
                                </div>
                                <div>
                                  <p className="text-sm font-medium text-gray-900">{interview.title}</p>
                                  <p className="text-xs text-gray-500">{formatInterviewDateTime(interview.scheduledAt)}</p>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                {getInterviewStatusIcon(interview.status, !!interview.transcript?.content, !!interview.recordingUrl)}
                                <Badge 
                                  variant="outline" 
                                  className={`text-xs ${getInterviewStatusColor(interview.status)}`}
                                >
                                  {interview.status}
                                </Badge>
                                {interview.notetakerEnabled && (
                                  <div className="flex items-center gap-1">
                                    {interview.transcript?.content || interview.recordingUrl ? (
                                      <FileVideo className="h-3 w-3 text-green-600" title="Recording available" />
                                    ) : interview.notetakerStatus === 'completed' ? (
                                      <Mic className="h-3 w-3 text-blue-600" title="Transcript processing" />
                                    ) : (
                                      <Mic className="h-3 w-3 text-gray-400" title="AI notetaker enabled" />
                                    )}
                                  </div>
                                )}
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 w-6 p-0"
                                  onClick={() => window.open(`/interviews/${interview._id}/transcript`, '_blank')}
                                >
                                  <Eye className="h-3 w-3" />
                                </Button>
                              </div>
                            </div>
                          ))}
                          {candidateInterviews[applicant.candidate._id].length > 2 && (
                            <p className="text-xs text-gray-500 text-center mt-2">
                              +{candidateInterviews[applicant.candidate._id].length - 2} more interview{candidateInterviews[applicant.candidate._id].length - 2 > 1 ? 's' : ''}
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                    
                    {/* Loading interviews indicator */}
                    {loadingInterviews[applicant.candidate._id] && (
                      <div className="mt-4 pt-4 border-t border-gray-100">
                        <div className="flex items-center gap-2">
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-600"></div>
                          <span className="text-sm text-gray-500">Loading interviews...</span>
                        </div>
                      </div>
                    )}
                  </div>
                </Card>
              )
            })}
                  </div>
                )}
        </div>

      {/* Status Update Dialog */}
      <Dialog open={showStatusDialog} onOpenChange={setShowStatusDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update Status</DialogTitle>
            <DialogDescription>
              Update the status for {selectedApplicant?.candidate.firstName} {selectedApplicant?.candidate.lastName}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="status">New Status</Label>
              <Select value={newStatus} onValueChange={setNewStatus}>
                <SelectTrigger>
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  {PIPELINE_STAGES.map((stage) => (
                    <SelectItem key={stage.id} value={stage.id}>
                      {stage.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="notes">Notes (Optional)</Label>
              <Textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add any notes about this status change..."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowStatusDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleStatusUpdate} disabled={!newStatus || updating !== null}>
              {updating ? 'Updating...' : 'Update Status'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Candidate Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Candidate to Pipeline</DialogTitle>
            <DialogDescription>
              Select a candidate to add to this job's pipeline
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="candidate">Candidate</Label>
              <Popover open={candidateSearchOpen} onOpenChange={setCandidateSearchOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={candidateSearchOpen}
                    className="w-full justify-between"
                    disabled={loadingCandidates || availableCandidates.length === 0}
                  >
                    {selectedCandidateId
                      ? (() => {
                          const candidate = availableCandidates.find(
                            (candidate) => candidate._id === selectedCandidateId
                          )
                          return candidate 
                            ? `${candidate.firstName || 'N/A'} ${candidate.lastName || 'N/A'} - ${candidate.position || 'No position'}`
                            : "Select candidate..."
                        })()
                      : loadingCandidates 
                        ? "Loading candidates..." 
                        : availableCandidates.length === 0 
                          ? "No candidates available" 
                          : "Select candidate..."}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-full p-0" align="start">
                  <Command>
                    <CommandInput 
                      placeholder="Search candidates..." 
                      value={candidateSearchValue}
                      onValueChange={setCandidateSearchValue}
                    />
                    <CommandEmpty>
                      {loadingCandidates ? "Loading candidates..." : "No candidates found."}
                    </CommandEmpty>
                    <CommandGroup className="max-h-64 overflow-auto">
                      {availableCandidates
                        .filter((candidate) => {
                          if (!candidateSearchValue) return true
                          const searchLower = candidateSearchValue.toLowerCase()
                          const fullName = `${candidate.firstName || ''} ${candidate.lastName || ''}`.toLowerCase()
                          const position = (candidate.position || '').toLowerCase()
                          const email = (candidate.email || '').toLowerCase()
                          
                          return (
                            fullName.includes(searchLower) ||
                            position.includes(searchLower) ||
                            email.includes(searchLower)
                          )
                        })
                        .map((candidate) => (
                          <CommandItem
                            key={candidate._id}
                            value={candidate._id}
                            onSelect={(currentValue) => {
                              setSelectedCandidateId(currentValue === selectedCandidateId ? "" : currentValue)
                              setCandidateSearchOpen(false)
                              setCandidateSearchValue("")
                            }}
                          >
                            <Check
                              className={`mr-2 h-4 w-4 ${
                                selectedCandidateId === candidate._id ? "opacity-100" : "opacity-0"
                              }`}
                            />
                            <div className="flex flex-col">
                              <span className="font-medium">
                                {candidate.firstName || 'N/A'} {candidate.lastName || 'N/A'}
                              </span>
                              <span className="text-sm text-gray-500">
                                {candidate.position || 'No position'} • {candidate.email || 'No email'}
                              </span>
                            </div>
                          </CommandItem>
                        ))}
                    </CommandGroup>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
            <div>
              <Label htmlFor="addNotes">Notes (Optional)</Label>
              <Textarea
                id="addNotes"
                value={addNotes}
                onChange={(e) => setAddNotes(e.target.value)}
                placeholder="Add any notes about adding this candidate..."
                rows={3}
              />
            </div>
            <div>
              <Label htmlFor="addScore">Score (Optional)</Label>
              <Input
                id="addScore"
                type="number"
                min="0"
                max="100"
                value={addScore}
                onChange={(e) => setAddScore(e.target.value)}
                placeholder="Enter score (0-100)"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleAddCandidate} 
              disabled={!selectedCandidateId || loadingCandidates || availableCandidates.length === 0}
            >
              {loadingCandidates ? 'Loading...' : 'Add to Pipeline'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Notes/History Dialog */}
      <Dialog open={showNotesDialog} onOpenChange={setShowNotesDialog}>
        <DialogContent className="max-w-[95vw] sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
            <DialogTitle>
              Status History - {selectedApplicant?.candidate.firstName} {selectedApplicant?.candidate.lastName}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 max-h-96 overflow-y-auto">
            {selectedApplicant?.statusHistory.map((history, index) => (
              <div key={index} className="border-l-2 border-muted pl-4 pb-4">
                <div className="flex items-center justify-between">
                  <Badge variant="outline">{history.status}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {formatDate(history.changedAt)}
                  </span>
                </div>
                {history.notes && (
                  <p className="text-sm text-muted-foreground mt-1">{history.notes}</p>
                )}
                {history.previousStatus && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Changed from: {history.previousStatus}
                  </p>
                )}
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button onClick={() => setShowNotesDialog(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Candidate Preview Dialog */}
      <Dialog open={showPreviewDialog} onOpenChange={setShowPreviewDialog}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader className="pb-6">
            <DialogTitle className="text-2xl font-bold text-gray-800">Candidate Profile</DialogTitle>
            <DialogDescription className="text-gray-600">
              Complete overview of candidate information and pipeline status
            </DialogDescription>
          </DialogHeader>
          {selectedApplicant && (
            <div className="space-y-8">
              {/* Header Section with Avatar and Basic Info */}
              <div className="bg-gradient-to-r from-blue-50 to-purple-50 rounded-2xl p-6">
                <div className="flex flex-col md:flex-row items-center md:items-start gap-6">
                  <div className="flex-shrink-0">
                    <Avatar className="h-32 w-32 ring-4 ring-white shadow-2xl">
                      <AvatarFallback className="bg-gradient-to-br from-blue-500 to-purple-600 text-white font-bold text-4xl">
                        {getInitials(selectedApplicant?.candidate?.firstName || '', selectedApplicant?.candidate?.lastName || '')}
                      </AvatarFallback>
                    </Avatar>
                  </div>
                  <div className="flex-1 text-center md:text-left">
                    <h2 className="text-3xl font-bold text-gray-800 mb-2">
                      {selectedApplicant?.candidate?.firstName || 'N/A'} {selectedApplicant?.candidate?.lastName || 'N/A'}
                    </h2>
                    <p className="text-xl text-blue-600 font-semibold mb-3">{selectedApplicant.candidate.position}</p>
                    {selectedApplicant.candidate.location && (
                      <div className="flex items-center justify-center md:justify-start gap-2 text-gray-600 mb-4">
                        <MapPin className="h-5 w-5" />
                        <span className="text-lg">{selectedApplicant.candidate.location}</span>
                      </div>
                    )}
                    <div className="flex flex-wrap gap-3 justify-center md:justify-start">
                      <Badge variant="outline" className="text-sm px-3 py-1 bg-white">
                        {PIPELINE_STAGES.find(s => s.id === selectedApplicant.status)?.title}
                      </Badge>
                      {selectedApplicant.score && (
                        <Badge variant="outline" className="text-sm px-3 py-1 bg-white">
                          {selectedApplicant.score}% Match
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              </div>
              
              {/* Main Content Grid */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Contact Information Card */}
                <Card className="p-6 shadow-lg border-0 bg-gradient-to-br from-white to-gray-50">
                  <CardHeader className="pb-4">
                    <CardTitle className="flex items-center gap-2 text-lg font-semibold text-gray-800">
                      <Mail className="h-5 w-5 text-blue-500" />
                      Contact Information
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {selectedApplicant.candidate.email && (
                      <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-lg border border-blue-100">
                        <Mail className="h-5 w-5 text-blue-600 flex-shrink-0" />
                        <div>
                          <p className="text-sm font-medium text-blue-800">Email</p>
                          <a 
                            href={`mailto:${selectedApplicant.candidate.email}`} 
                            className="text-blue-600 hover:text-blue-800 hover:underline transition-colors"
                          >
                            {selectedApplicant.candidate.email}
                          </a>
                        </div>
                      </div>
                    )}
                    {selectedApplicant.candidate.phone && (
                      <div className="flex items-center gap-3 p-3 bg-green-50 rounded-lg border border-green-100">
                        <Phone className="h-5 w-5 text-green-600 flex-shrink-0" />
                        <div>
                          <p className="text-sm font-medium text-green-800">Phone</p>
                          <a 
                            href={`tel:${selectedApplicant.candidate.phone}`}
                            className="text-green-600 hover:text-green-800 hover:underline transition-colors"
                          >
                            {selectedApplicant.candidate.phone}
                          </a>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
                
                {/* Pipeline Status Card */}
                <Card className="p-6 shadow-lg border-0 bg-gradient-to-br from-white to-gray-50">
                  <CardHeader className="pb-4">
                    <CardTitle className="flex items-center gap-2 text-lg font-semibold text-gray-800">
                      <User className="h-5 w-5 text-purple-500" />
                      Pipeline Status
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="p-3 bg-purple-50 rounded-lg border border-purple-100">
                      <p className="text-sm font-medium text-purple-800 mb-1">Current Status</p>
                      <Badge variant="outline" className="text-sm font-semibold">
                        {PIPELINE_STAGES.find(s => s.id === selectedApplicant.status)?.title}
                      </Badge>
                    </div>
                    {selectedApplicant.score && (
                      <div className="p-3 bg-yellow-50 rounded-lg border border-yellow-100">
                        <p className="text-sm font-medium text-yellow-800 mb-2">Match Score</p>
                        <div className="flex items-center gap-3">
                          <div className="flex-1 bg-gray-200 rounded-full h-3">
                            <div 
                              className="bg-gradient-to-r from-yellow-400 to-yellow-600 h-3 rounded-full transition-all duration-300"
                              style={{ width: `${selectedApplicant.score}%` }}
                            ></div>
                          </div>
                          <span className="font-bold text-yellow-700 text-lg">{selectedApplicant.score}%</span>
                          {selectedApplicant.score >= 80 && (
                            <Star className="h-5 w-5 text-yellow-500 fill-current" />
                          )}
                        </div>
                      </div>
                    )}
                    <div className="p-3 bg-gray-50 rounded-lg border border-gray-100">
                      <p className="text-sm font-medium text-gray-800 mb-1">Time in Current Stage</p>
                      <div className="flex items-center gap-2 text-gray-600">
                        <Clock className="h-4 w-4" />
                        <span>{getTimeInStage(selectedApplicant)}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
              
              {/* Interview History Card */}
              {candidateInterviews[selectedApplicant.candidate._id] && candidateInterviews[selectedApplicant.candidate._id].length > 0 && (
                <Card className="p-6 shadow-lg border-0 bg-gradient-to-br from-white to-gray-50">
                  <CardHeader className="pb-4">
                    <CardTitle className="flex items-center gap-2 text-lg font-semibold text-gray-800">
                      <Calendar className="h-5 w-5 text-orange-500" />
                      Interview History
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {candidateInterviews[selectedApplicant.candidate._id].map((interview) => (
                        <div key={interview._id} className="p-4 bg-orange-50 rounded-lg border border-orange-100">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-3 mb-2">
                                {interview.type === 'video' ? (
                                  <Video className="h-5 w-5 text-blue-600" />
                                ) : interview.type === 'phone' ? (
                                  <Phone className="h-5 w-5 text-green-600" />
                                ) : (
                                  <User className="h-5 w-5 text-purple-600" />
                                )}
                                <h4 className="font-semibold text-gray-900">{interview.title}</h4>
                              </div>
                              <div className="space-y-1">
                                <p className="text-sm text-gray-600">
                                  <Clock className="h-3 w-3 inline mr-1" />
                                  {formatInterviewDateTime(interview.scheduledAt)}
                                </p>
                                <p className="text-sm text-gray-600">
                                  Duration: {interview.duration} minutes
                                </p>
                                {interview.location && (
                                  <p className="text-sm text-gray-600">
                                    <MapPin className="h-3 w-3 inline mr-1" />
                                    {interview.location}
                                  </p>
                                )}
                              </div>
                            </div>
                            <div className="flex flex-col items-end gap-2">
                              <div className="flex items-center gap-2">
                                {getInterviewStatusIcon(interview.status, !!interview.transcript?.content, !!interview.recordingUrl)}
                                <Badge 
                                  variant="outline" 
                                  className={`${getInterviewStatusColor(interview.status)}`}
                                >
                                  {interview.status}
                                </Badge>
                              </div>
                              {interview.notetakerEnabled && (
                                <div className="flex items-center gap-2">
                                  {interview.transcript?.content || interview.recordingUrl ? (
                                    <Badge variant="outline" className="text-xs bg-green-50 text-green-700 border-green-200">
                                      <FileVideo className="h-3 w-3 mr-1" />
                                      Recording Available
                                    </Badge>
                                  ) : interview.notetakerStatus === 'completed' ? (
                                    <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700 border-blue-200">
                                      <Mic className="h-3 w-3 mr-1" />
                                      Processing
                                    </Badge>
                                  ) : (
                                    <Badge variant="outline" className="text-xs bg-gray-50 text-gray-700 border-gray-200">
                                      <Mic className="h-3 w-3 mr-1" />
                                      AI Notetaker
                                    </Badge>
                                  )}
                                </div>
                              )}
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => window.open(`/interviews/${interview._id}/transcript`, '_blank')}
                              >
                                <Eye className="h-3 w-3 mr-1" />
                                View Details
                              </Button>
                            </div>
                          </div>
                          {interview.conferencing?.details?.url && (
                            <div className="mt-3 pt-3 border-t border-orange-100">
                              <a 
                                href={interview.conferencing.details.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-sm text-blue-600 hover:text-blue-800 hover:underline"
                              >
                                <Video className="h-3 w-3 inline mr-1" />
                                Join Meeting
                              </a>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Interview Feedback Inline */}
              {candidateInterviews[selectedApplicant.candidate._id] && candidateInterviews[selectedApplicant.candidate._id].length > 0 && (
                <Card className="p-6 shadow-lg border-0 bg-gradient-to-br from-white to-gray-50">
                  <CardHeader className="pb-4">
                    <CardTitle className="flex items-center justify-between gap-2 text-lg font-semibold text-gray-800">
                      <span className="flex items-center gap-2">
                        <MessageSquare className="h-5 w-5 text-blue-600" />
                        Interview Feedback
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">Select interview</span>
                        <select
                          className="border rounded-md px-2 py-1 text-sm"
                          value={selectedInterviewIdForPreview || ''}
                          onChange={(e) => setSelectedInterviewIdForPreview(e.target.value)}
                        >
                          {(candidateInterviews[selectedApplicant.candidate._id] || []).map((it) => (
                            <option key={it._id} value={it._id}>
                              {formatInterviewDateTime((it as any).scheduledAt)} • {(it as any).title || (it as any).type}
                            </option>
                          ))}
                        </select>
                      </div>
                    </CardTitle>
                    <CardDescription>View and add feedback right from the pipeline.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {selectedInterviewIdForPreview ? (
                      <InterviewFeedbackSimple interviewId={selectedInterviewIdForPreview} />
                    ) : (
                      <div className="text-sm text-muted-foreground">No interview selected.</div>
                    )}
                  </CardContent>
                </Card>
              )}
              
              {/* Notes Section */}
              {selectedApplicant.notes && (
                <Card className="p-6 shadow-lg border-0 bg-gradient-to-br from-white to-gray-50">
                  <CardHeader className="pb-4">
                    <CardTitle className="flex items-center gap-2 text-lg font-semibold text-gray-800">
                      <FileText className="h-5 w-5 text-indigo-500" />
                      Notes
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="p-4 bg-indigo-50 rounded-lg border border-indigo-100">
                      <p className="text-gray-700 leading-relaxed">{selectedApplicant.notes}</p>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Recent Activity Timeline */}
              {selectedApplicant.statusHistory && selectedApplicant.statusHistory.length > 0 && (
                <Card className="p-6 shadow-lg border-0 bg-gradient-to-br from-white to-gray-50">
                  <CardHeader className="pb-4">
                    <CardTitle className="flex items-center gap-2 text-lg font-semibold text-gray-800">
                      <Calendar className="h-5 w-5 text-teal-500" />
                      Recent Activity
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4 max-h-48 overflow-y-auto">
                      {selectedApplicant.statusHistory.slice(-3).reverse().map((history, index) => (
                        <div key={index} className="flex gap-4 p-3 bg-teal-50 rounded-lg border border-teal-100">
                          <div className="flex-shrink-0 w-2 h-2 bg-teal-500 rounded-full mt-2"></div>
                          <div className="flex-1">
                            <div className="flex items-center justify-between mb-1">
                              <Badge variant="outline" className="text-xs">
                                {history.status}
                              </Badge>
                              <span className="text-xs text-gray-500">
                                {formatDate(history.changedAt)}
                              </span>
                            </div>
                            {history.notes && (
                              <p className="text-sm text-gray-600">{history.notes}</p>
                            )}
                            {history.previousStatus && (
                              <p className="text-xs text-gray-500 mt-1">
                                From: {history.previousStatus}
                              </p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
          <DialogFooter className="pt-6 border-t">
            <Button variant="outline" onClick={() => setShowPreviewDialog(false)} className="px-6">
              Close
            </Button>
            <Button 
              onClick={() => {
                if (selectedApplicant) {
                  // Get job ID from current URL or props
                  const pathParts = window.location.pathname.split('/')
                  const jobId = pathParts[2] // Assuming URL structure /jobs/{jobId}/...
                  
                  window.open(`/candidates/${selectedApplicant.candidate._id}?from=job-pipeline&jobId=${jobId}`, '_blank')
                }
              }}
              className="px-6 bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white"
            >
              View Full Profile
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Interview Scheduler Dialog using Portal */}
      {showScheduler && typeof window !== 'undefined' && createPortal(
        <div className="multi-step-scheduler-portal">
        <div 
          className="fixed inset-0 bg-black/60 flex items-center justify-center p-4"
          style={{ 
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
              zIndex: 9998
          }}
        >
          <div 
              className="multi-step-scheduler-content bg-background rounded-lg max-w-[90vw] sm:max-w-4xl w-full h-[85vh] shadow-2xl overflow-hidden"
            style={{ 
              position: 'relative',
                zIndex: 9999
            }}
          >
            <MultiStepInterviewScheduler
              candidateId={showScheduler}
              candidateName={(() => {
                const applicant = applicants.find(app => app?.candidate?._id === showScheduler);
                return applicant ? `${applicant?.candidate?.firstName || 'N/A'} ${applicant?.candidate?.lastName || 'N/A'}` : 'Candidate';
              })()}
              candidateEmail={(() => {
                const applicant = applicants.find(app => app?.candidate?._id === showScheduler);
                return applicant?.candidate?.email;
              })()}
              jobTitle={job?.title || 'Position'}
              jobId={jobId}
              onScheduled={async (interview) => {
                console.log('Interview scheduled:', interview);
                setShowScheduler(null);
                
                // Check if notetaker was enabled
                const notetakerMessage = interview?.notetakerEnabled 
                  ? " with AI notetaker" 
                  : "";
                
                toast({
                  title: "Interview Scheduled",
                  description: `Interview has been scheduled${notetakerMessage} and candidate status updated to interviewing`,
                });
                
                // Refresh job data immediately to get updated pipeline status
                if (onJobDataRefresh) {
                  await onJobDataRefresh();
                }
                
                // Also trigger analytics update
                onAnalyticsUpdate?.();
              }}
              onCancel={() => setShowScheduler(null)}
            />
          </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
} 