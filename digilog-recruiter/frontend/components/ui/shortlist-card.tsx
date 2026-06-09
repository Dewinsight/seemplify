"use client"

import { useState, useEffect, useRef, useMemo } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Checkbox } from "@/components/ui/checkbox"
import { Progress } from "@/components/ui/progress"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Loader2, User, Users, CheckCircle, XCircle, RefreshCw, UserPlus, Trash, Star, Search, AlertTriangle, Settings, MapPin, Calendar, Clock, Award, Briefcase, GraduationCap, Eye, Phone, ExternalLink, Mail, MoveRight } from "lucide-react"
import { CandidateRejectionButton } from "@/components/ui/candidate-rejection-email-controls"
import { ShortlistEmailControls } from "@/components/ui/shortlist-email-controls"
import { toast } from "@/components/ui/use-toast"
import { getShortlist, getRankedShortlist, removeCandidateFromShortlist, addCandidateToShortlist, updateShortlistCandidateStatus, clearShortlistRanking, bulkMoveShortlistToPipeline, bulkRemoveFromShortlist } from "@/services/jobService"
import pipelineService from "@/services/pipelineService"
import { getAllCandidates } from "@/services/candidateService"
import jobEmbeddingService from "@/services/jobEmbeddingService"
import interviewStageService from "@/services/interviewStageService"
import { useRouter } from "next/navigation"

interface ShortlistCardProps {
  jobId: string
  jobTitle?: string
  onCandidateMoved?: () => void
}

interface ShortlistedCandidate {
  candidate: {
    _id: string
    name?: string
    position?: string
    experience?: string
    skills?: string[] | string
    location?: string
    email?: string
    phone?: string
    isInternalCandidate?: boolean
    employeeId?: string
  }
  relevanceScore?: number
  candidateId?: string // This will be populated from candidate._id
  explanation?: any
  status?: 'shortlisted' | 'moved_to_pipeline' | 'rejected'
  movedToPipelineAt?: string
  addedAt?: string
  applicationType?: 'public' | 'internal' | 'manual'
}

export function ShortlistCard({ jobId, jobTitle, onCandidateMoved }: ShortlistCardProps) {
  const router = useRouter()
  const lastLoadedJobIdRef = useRef<string | null>(null)
  const [shortlistedCandidates, setShortlistedCandidates] = useState<ShortlistedCandidate[]>([])
  const [pipelineCandidateIds, setPipelineCandidateIds] = useState<Set<string>>(new Set()) // Track candidates in pipeline
  const [loading, setLoading] = useState(true)
  const [ranking, setRanking] = useState(false)
  const [clearingRanking, setClearingRanking] = useState(false)
  const [isRanked, setIsRanked] = useState(false) // Track if we're currently showing ranked results
  const [movingToPipeline, setMovingToPipeline] = useState<Set<string>>(new Set())
  const [removingFromShortlist, setRemovingFromShortlist] = useState<Set<string>>(new Set())
  
  // Bulk selection state
  const [selectedCandidates, setSelectedCandidates] = useState<Set<string>>(new Set())
  const [bulkOperating, setBulkOperating] = useState(false)
  
  // Add candidates dialog state
  const [showAddCandidateDialog, setShowAddCandidateDialog] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [allCandidates, setAllCandidates] = useState<any[]>([])
  const [loadingCandidates, setLoadingCandidates] = useState(false)
  const [addingCandidates, setAddingCandidates] = useState<Set<string>>(new Set())
  const [allCandidatesLoaded, setAllCandidatesLoaded] = useState(false)
  
  // Error dialog state for stage requirement
  const [showStageErrorDialog, setShowStageErrorDialog] = useState(false)
  const [staffFilter, setStaffFilter] = useState<'all' | 'staff' | 'non_staff'>('all')

  // Helper function to get candidate ID consistently
  const getCandidateId = (match: ShortlistedCandidate): string => {
    return match.candidate?._id || match.candidateId || ''
  }

  // Helper function to get candidate name consistently
  const getCandidateName = (match: ShortlistedCandidate): string => {
    return match.candidate?.name || 'Unnamed Candidate'
  }

  // Helper function to get candidate position consistently
  const getCandidatePosition = (match: ShortlistedCandidate): string => {
    return match.candidate?.position || 'Position not specified'
  }

  const filteredShortlistedCandidates = useMemo(() => {
    return shortlistedCandidates.filter((match) => {
      const isStaff = Boolean(match.candidate?.isInternalCandidate)
      if (staffFilter === 'staff') return isStaff
      if (staffFilter === 'non_staff') return !isStaff
      return true
    })
  }, [shortlistedCandidates, staffFilter])

  const fetchShortlistedCandidates = async (options?: { showLoading?: boolean }) => {
    const shouldShowLoading = options?.showLoading ?? lastLoadedJobIdRef.current !== jobId

    try {
      if (shouldShowLoading) {
        setLoading(true)
      }
      
      // Fetch pipeline data to get candidates already in pipeline
      try {
        const pipelineData = await pipelineService.getDetailedPipeline(jobId)
        const pipelineIds = new Set<string>()
        
        if (pipelineData?.pipeline?.stages) {
          pipelineData.pipeline.stages.forEach((stage: any) => {
            stage.candidates?.forEach((applicant: any) => {
              if (applicant.candidate?._id) {
                pipelineIds.add(applicant.candidate._id)
              }
            })
          })
        }
        
        setPipelineCandidateIds(pipelineIds)
        console.log(`📊 Found ${pipelineIds.size} candidates in pipeline`)
      } catch (pipelineError) {
        console.error('Error fetching pipeline data:', pipelineError)
        // Don't fail the whole operation if pipeline fetch fails
      }
      
      const response = await getShortlist(jobId)
      // The new endpoint returns { shortlist: [...] }
      // We'll map this to add a default relevanceScore and ensure candidateId is present
      const candidates = response.shortlist.map(item => ({
        ...item,
        candidateId: item.candidate._id,
        relevanceScore: item.relevanceScore || 0,
        // Ensure consistent access to candidate ID
        candidate: {
          ...item.candidate,
          _id: item.candidate._id // Ensure this exists
        }
      }))
      setShortlistedCandidates(candidates || [])
      
      // Use hasRankings from backend response (backend automatically sorts if rankings exist)
      setIsRanked((response as any).hasRankings || false)
      lastLoadedJobIdRef.current = jobId
    } catch (error: any) {
      console.error('Error fetching shortlisted candidates:', error)
      toast({
        title: "Error",
        description: "Failed to fetch shortlisted candidates",
        variant: "destructive",
      })
    } finally {
      if (shouldShowLoading) {
        setLoading(false)
      }
    }
  }

  // Function to refresh current view (preserves ranking state)
  const refreshCurrentView = async (options?: { showLoading?: boolean }) => {
    if (isRanked) {
      // If we're showing ranked results, refresh with ranking
      const response = await getRankedShortlist(jobId)
      const normalizedMatches = (response.matches || []).map(match => ({
        ...match,
        candidate: {
          ...match.candidate,
          _id: match.candidateId
        },
        candidateId: match.candidateId
      }))
      setShortlistedCandidates(normalizedMatches)
    } else {
      // Fetch data (will be auto-sorted if rankings exist in DB)
      await fetchShortlistedCandidates(options)
      // fetchShortlistedCandidates will now automatically set isRanked based on hasRankings
    }
  }

  const handleRankShortlist = async () => {
    try {
      setRanking(true)
      const response = await getRankedShortlist(jobId)
      
      // Normalize the ranked data structure to match unranked structure
      const normalizedMatches = (response.matches || []).map(match => ({
        ...match,
        candidate: {
          ...match.candidate,
          _id: match.candidateId // Ensure candidate._id exists for consistent access
        },
        candidateId: match.candidateId // Keep candidateId for fallback
      }))
      
      setShortlistedCandidates(normalizedMatches)
      setIsRanked(true) // Mark as ranked
      toast({
        title: "Success",
        description: "Shortlist has been ranked and saved.",
      })
    } catch (error: any) {
      console.error('Error ranking shortlist:', error)
      toast({
        title: "Error",
        description: "Failed to rank shortlist.",
        variant: "destructive",
      })
    } finally {
      setRanking(false)
    }
  }

  const handleMoveToPipeline = async (candidateId: string, candidateName: string) => {
    if (movingToPipeline.has(candidateId)) return

    console.log('handleMoveToPipeline called for:', candidateName, candidateId);

    try {
      setMovingToPipeline(prev => new Set([...prev, candidateId]))
      
      // Add to pipeline with proper metadata
      await pipelineService.addCandidateToPipeline(jobId, { 
        candidateId, 
        notes: 'Moved from shortlist',
        initialStatus: 'shortlisted'
      });
      
      // Update shortlist status instead of removing
      await updateShortlistCandidateStatus(jobId, candidateId, 'moved_to_pipeline');
      
      toast({
        title: "Candidate Moved",
        description: `${candidateName} has been moved to the pipeline.`,
      });
      
      if (onCandidateMoved) {
        onCandidateMoved();
      }
      
      // Refresh current view (preserves ranking)
      await refreshCurrentView();
    } catch (error: any) {
      console.error('Error moving candidate to pipeline:', error);
      console.log('Full error object:', {
        message: error.message,
        originalMessage: error.originalMessage,
        statusCode: error.statusCode,
        fullError: error.fullError
      });
      
      // Get all possible error messages
      const errorMessage = error.originalMessage || error.message || error.msg || error.fullError?.msg || '';
      const statusCode = error.statusCode || error.status || 0;
      
      console.log('Error message:', errorMessage);
      console.log('Status code:', statusCode);
      
      // More comprehensive error detection
      let isStageError = false;
      
      // Check for specific error messages
      if (errorMessage && errorMessage.length > 0) {
        const lowerMessage = errorMessage.toLowerCase();
        isStageError = 
          lowerMessage.includes('no active pipeline stages') || 
          lowerMessage.includes('create pipeline stages') ||
          lowerMessage.includes('pipeline stages') ||
          lowerMessage.includes('pipeline stage') ||
          lowerMessage.includes('no stages') ||
          (lowerMessage.includes('stage') && lowerMessage.includes('first')) ||
          (lowerMessage.includes('stage') && lowerMessage.includes('exist')) ||
          (lowerMessage.includes('cannot') && lowerMessage.includes('pipeline'));
      }
      
      // Fallback: If it's a 500 error and mentions pipeline, likely a stage issue
      if (!isStageError && statusCode === 500 && errorMessage.toLowerCase().includes('pipeline')) {
        console.log('Detected as stage error due to 500 status + pipeline mention');
        isStageError = true;
      }
      
      // Final fallback: Check if stages actually exist
      if (!isStageError && (statusCode === 500 || statusCode === 400)) {
        try {
          console.log('Checking if stages exist for job:', jobId);
          const stages = await interviewStageService.getStagesForJob(jobId);
          console.log('Stages found:', stages?.length || 0);
          
          if (!stages || stages.length === 0) {
            console.log('No stages found - treating as stage error');
            isStageError = true;
          }
        } catch (stageCheckError) {
          console.error('Error checking stages:', stageCheckError);
          // If we can't check stages, continue with original error
        }
      }
      
      console.log('Final - Is stage error?', isStageError);
      
      if (isStageError) {
        // Show special dialog for stage requirement
        setShowStageErrorDialog(true)
      } else {
        // Show generic error message
        toast({
          title: "Failed to Move Candidate",
          description: errorMessage || "An error occurred while moving the candidate to the pipeline.",
          variant: "destructive",
        })
      }
    } finally {
      setMovingToPipeline(prev => {
        const newSet = new Set(prev)
        newSet.delete(candidateId)
        return newSet
      })
    }
  }

  const handleReturnToShortlist = async (candidateId: string, candidateName: string) => {
    if (movingToPipeline.has(candidateId)) return

    try {
      setMovingToPipeline(prev => new Set([...prev, candidateId]))
      
      console.log(`🔄 Returning candidate ${candidateId} to shortlist...`)
      
      // Update shortlist status back to shortlisted
      const result = await updateShortlistCandidateStatus(jobId, candidateId, 'shortlisted');
      
      console.log(`✅ Successfully returned candidate to shortlist:`, result)
      
      toast({
        title: "✅ Candidate Returned Successfully",
        description: `${candidateName} has been returned to the active shortlist.`,
      });
      
      if (onCandidateMoved) {
        onCandidateMoved();
      }
      
      // Refresh current view (preserves ranking)
      await refreshCurrentView();
    } catch (error: any) {
      console.error(`❌ Error returning candidate to shortlist:`, error)
      toast({
        title: "Failed to Return Candidate",
        description: error.message || "An error occurred while returning the candidate to shortlist.",
        variant: "destructive",
      })
    } finally {
      setMovingToPipeline(prev => {
        const newSet = new Set(prev)
        newSet.delete(candidateId)
        return newSet
      })
    }
  }

  const handleRemoveFromShortlist = async (candidateId: string, candidateName: string) => {
    if (removingFromShortlist.has(candidateId)) return

    try {
      setRemovingFromShortlist(prev => new Set([...prev, candidateId]))
      await removeCandidateFromShortlist(jobId, candidateId)
      toast({
        title: "Candidate Removed",
        description: `${candidateName} has been removed from the shortlist.`,
      })
      // Refresh current view (preserves ranking)
      await refreshCurrentView()
    } catch (error: any) {
      toast({
        title: "Failed to Remove Candidate",
        description: error.message,
        variant: "destructive",
      })
    } finally {
      setRemovingFromShortlist(prev => {
        const newSet = new Set(prev)
        newSet.delete(candidateId)
        return newSet
      })
    }
  }


  // Lazy load all candidates only when needed
  const loadAllCandidates = async () => {
    if (allCandidatesLoaded) return // Don't reload if already loaded
    
    try {
      setLoadingCandidates(true)
      
      const allCandidatesResponse = await getAllCandidates()
      setAllCandidates(allCandidatesResponse || [])
      setAllCandidatesLoaded(true)
    } catch (error) {
      console.error('Error loading all candidates:', error)
      toast({
        title: "Error",
        description: "Failed to load all candidates",
        variant: "destructive",
      })
    } finally {
      setLoadingCandidates(false)
    }
  }
  
  // Watch for tab changes and lazy load all candidates when needed
  
  // Reset state when dialog closes
  useEffect(() => {
    if (!showAddCandidateDialog) {
      setSearchQuery('')
      setAllCandidatesLoaded(false)
    }
  }, [showAddCandidateDialog])

  // Handle adding candidate to shortlist from the dialog
  const handleAddCandidateToShortlist = async (candidateId: string, candidateName: string) => {
    if (addingCandidates.has(candidateId)) return

    try {
      setAddingCandidates(prev => new Set([...prev, candidateId]))
      
      await addCandidateToShortlist(jobId, candidateId)
      
      toast({
        title: "Candidate Added to Shortlist",
        description: `${candidateName} has been added to the shortlist.`,
      })
      
      // Refresh current view (preserves ranking)
      await refreshCurrentView()
      if (onCandidateMoved) {
        onCandidateMoved()
      }
    } catch (error: any) {
      toast({
        title: "Failed to Add Candidate",
        description: error.message || "An error occurred while adding the candidate.",
        variant: "destructive",
      })
    } finally {
      setAddingCandidates(prev => {
        const newSet = new Set(prev)
        newSet.delete(candidateId)
        return newSet
      })
    }
  }

  // Handle clearing ranking
  const handleClearRanking = async () => {
    try {
      setClearingRanking(true)
      await clearShortlistRanking(jobId)
      setIsRanked(false)
      await fetchShortlistedCandidates() // Fetch unranked data
      toast({
        title: "Success",
        description: "Ranking has been cleared.",
      })
    } catch (error: any) {
      console.error('Error clearing ranking:', error)
      toast({
        title: "Error",
        description: "Failed to clear ranking.",
        variant: "destructive",
      })
    } finally {
      setClearingRanking(false)
    }
  }

  // Open add candidates dialog
  const openAddCandidatesDialog = () => {
    setShowAddCandidateDialog(true)
    // Load all candidates directly
    loadAllCandidates()
  }

  // Bulk selection handlers
  const toggleCandidateSelection = (candidateId: string) => {
    console.log('🔘 Toggling selection for candidate:', candidateId)
    setSelectedCandidates(prev => {
      const newSet = new Set(prev)
      if (newSet.has(candidateId)) {
        newSet.delete(candidateId)
        console.log('✅ Deselected candidate:', candidateId)
      } else {
        newSet.add(candidateId)
        console.log('✅ Selected candidate:', candidateId)
      }
      console.log('📊 Total selected:', newSet.size)
      return newSet
    })
  }

  const clearSelection = () => {
    setSelectedCandidates(new Set())
  }

  const selectAllCandidates = () => {
    const selectableIds = filteredShortlistedCandidates
      .filter(match => 
        match.status !== 'rejected' && 
        match.status !== 'moved_to_pipeline' &&
        !pipelineCandidateIds.has(getCandidateId(match))
      )
      .map(match => getCandidateId(match))
    setSelectedCandidates(new Set(selectableIds))
  }

  // Bulk operation handlers
  const handleBulkMoveToPipeline = async () => {
    if (selectedCandidates.size === 0) return

    try {
      setBulkOperating(true)
      const candidateIds = Array.from(selectedCandidates)
      
      console.log('🚀 Starting bulk move to pipeline for:', candidateIds)
      
      const result = await bulkMoveShortlistToPipeline(jobId, candidateIds)
      
      console.log('✅ Bulk move to pipeline result:', result)
      
      if (result.moved > 0) {
        toast({
          title: "Candidates Moved",
          description: `Successfully moved ${result.moved} candidate(s) to the pipeline.`,
        })
      }
      
      if (result.failed > 0) {
        toast({
          title: "Some Moves Failed",
          description: `${result.failed} candidate(s) could not be moved. ${result.failures[0]?.reason || ''}`,
          variant: "destructive",
        })
      }
      
      if (result.moved === 0 && result.failed === 0) {
        toast({
          title: "No Candidates Moved",
          description: "No candidates were moved. They may already be in the pipeline.",
          variant: "destructive",
        })
      }
      
      clearSelection()
      await refreshCurrentView()
      if (onCandidateMoved) {
        onCandidateMoved()
      }
    } catch (error: any) {
      console.error('❌ Error during bulk move to pipeline:', error)
      toast({
        title: "Bulk Move Failed",
        description: error.message || "An error occurred while moving candidates.",
        variant: "destructive",
      })
    } finally {
      setBulkOperating(false)
    }
  }

  const handleBulkRemoveFromShortlist = async () => {
    if (selectedCandidates.size === 0) return

    const confirmed = window.confirm(`Are you sure you want to remove ${selectedCandidates.size} candidate(s) from the shortlist?`)
    if (!confirmed) return

    try {
      setBulkOperating(true)
      const candidateIds = Array.from(selectedCandidates)
      
      console.log('🗑️ Starting bulk removal for:', candidateIds)
      
      const result = await bulkRemoveFromShortlist(jobId, candidateIds)
      
      console.log('✅ Bulk removal result:', result)
      
      if (result.removed > 0) {
        toast({
          title: "Candidates Removed",
          description: `Successfully removed ${result.removed} candidate(s) from the shortlist.`,
        })
      }
      
      if (result.failed > 0) {
        toast({
          title: "Some Removals Failed",
          description: `${result.failed} candidate(s) could not be removed. ${result.failures[0]?.reason || ''}`,
          variant: "destructive",
        })
      }
      
      if (result.removed === 0 && result.failed === 0) {
        toast({
          title: "No Candidates Removed",
          description: "No candidates were found in the shortlist to remove.",
          variant: "destructive",
        })
      }
      
      clearSelection()
      await refreshCurrentView()
    } catch (error: any) {
      console.error('❌ Error during bulk removal:', error)
      toast({
        title: "Bulk Removal Failed",
        description: error.message || "An error occurred while removing candidates.",
        variant: "destructive",
      })
    } finally {
      setBulkOperating(false)
    }
  }

  useEffect(() => {
    fetchShortlistedCandidates()
  }, [jobId])

  useEffect(() => {
    // Keep selection aligned with currently visible (filtered) candidates.
    setSelectedCandidates(prev => {
      const visibleIds = new Set(filteredShortlistedCandidates.map(getCandidateId))
      const next = new Set(Array.from(prev).filter(id => visibleIds.has(id)))
      return next
    })
  }, [filteredShortlistedCandidates])

  if (loading) {
    return (
      <Card className="border-0 bg-white/60 dark:bg-slate-800/60 backdrop-blur-xl shadow-lg dark:shadow-2xl dark:border-slate-700">
        <CardHeader>
          <CardTitle className="text-gray-900 dark:text-gray-100">Shortlisted Candidates</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="animate-spin h-6 w-6 text-primary" />
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <>
      {/* Bulk Action Bar - Portal to body level for true fixed positioning */}
      {selectedCandidates.size > 0 && (
        <div className="fixed top-2 sm:top-4 left-1/2 -translate-x-1/2 w-[calc(100%-1rem)] sm:w-full max-w-6xl z-[9999] px-2 sm:px-4">
          <div className="bg-gradient-to-r from-[#754BE5] to-[#6935CF] text-white p-3 sm:p-4 rounded-lg shadow-2xl backdrop-blur-md border border-purple-400/30">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
              {/* Selection count */}
              <div className="flex items-center justify-center sm:justify-start gap-2">
                <CheckCircle className="h-4 w-4 sm:h-5 sm:w-5 flex-shrink-0" />
                <span className="font-semibold text-sm sm:text-lg">
                  {selectedCandidates.size} candidate{selectedCandidates.size !== 1 ? 's' : ''} selected
                </span>
              </div>

              {/* Action buttons - responsive grid on mobile */}
              <div className="grid grid-cols-3 sm:flex gap-2">
                <Button
                  size="sm"
                  type="button"
                  onClick={handleBulkMoveToPipeline}
                  disabled={bulkOperating}
                  className="bg-white text-blue-600 hover:bg-blue-50 font-semibold text-xs sm:text-sm px-2 sm:px-4"
                >
                  {bulkOperating ? (
                    <Loader2 className="animate-spin h-4 w-4" />
                  ) : (
                    <>
                      <MoveRight className="h-4 w-4 sm:mr-2" />
                      <span className="hidden sm:inline">Move to Pipeline</span>
                      <span className="sm:hidden">Move</span>
                    </>
                  )}
                </Button>
                <Button
                  size="sm"
                  type="button"
                  onClick={handleBulkRemoveFromShortlist}
                  disabled={bulkOperating}
                  variant="outline"
                  className="bg-white text-red-600 hover:bg-red-50 border-red-200 font-semibold text-xs sm:text-sm px-2 sm:px-4"
                >
                  {bulkOperating ? (
                    <Loader2 className="animate-spin h-4 w-4" />
                  ) : (
                    <>
                      <Trash className="h-4 w-4 sm:mr-2" />
                      <span className="hidden sm:inline">Remove</span>
                    </>
                  )}
                </Button>
                <Button
                  size="sm"
                  type="button"
                  onClick={clearSelection}
                  variant="outline"
                  className="bg-white/20 hover:bg-white/30 border-white/40 text-white text-xs sm:text-sm px-2 sm:px-4"
                >
                  <XCircle className="h-4 w-4 sm:mr-2" />
                  <span className="hidden sm:inline">Clear</span>
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

    <Card className="border-0 bg-white/60 dark:bg-slate-800/60 backdrop-blur-xl shadow-lg dark:shadow-2xl dark:border-slate-700">
      <CardHeader className="bg-gradient-to-r from-[#754BE5] to-[#6935CF] text-white rounded-t-lg p-4 sm:p-6">
        <div className="flex flex-col gap-4">
          {/* Title row */}
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
            <CardTitle className="text-lg sm:text-xl font-semibold flex items-center gap-2 flex-wrap">
              <Users className="h-5 w-5 flex-shrink-0" />
              <span>Shortlisted Candidates</span>
              {selectedCandidates.size > 0 && (
                <Badge variant="secondary" className="bg-white text-blue-600">
                  {selectedCandidates.size} selected
                </Badge>
              )}
            </CardTitle>

            {/* Primary actions - always visible */}
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={openAddCandidatesDialog}
                className="bg-white text-blue-600 hover:bg-blue-50 text-sm"
                size="sm"
              >
                <UserPlus className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">Add Candidates</span>
              </Button>
              <Button
                onClick={handleRankShortlist}
                disabled={ranking}
                className="bg-white text-blue-600 hover:bg-blue-50 text-sm"
                size="sm"
              >
                {ranking ? (
                  <>
                    <Loader2 className="animate-spin h-4 w-4 sm:mr-2" />
                    <span className="hidden sm:inline">Ranking...</span>
                  </>
                ) : (
                  <>
                    <Star className="h-4 w-4 sm:mr-2" />
                    <span className="hidden sm:inline">{isRanked ? 'Re-rank' : 'Rank Shortlist'}</span>
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Secondary actions row - responsive wrapping */}
          <div className="flex flex-wrap gap-2 items-center">
            {/* Select All / Deselect All button */}
            {filteredShortlistedCandidates.some(match =>
              match.status !== 'rejected' &&
              match.status !== 'moved_to_pipeline' &&
              !pipelineCandidateIds.has(getCandidateId(match))
            ) && (
              <Button
                onClick={selectedCandidates.size > 0 ? clearSelection : selectAllCandidates}
                variant="outline"
                className="bg-white/90 text-blue-600 hover:bg-white border-white/50 text-sm"
                size="sm"
              >
                {selectedCandidates.size > 0 ? (
                  <>
                    <XCircle className="h-4 w-4 sm:mr-2" />
                    <span className="hidden xs:inline">Deselect All</span>
                  </>
                ) : (
                  <>
                    <CheckCircle className="h-4 w-4 sm:mr-2" />
                    <span className="hidden xs:inline">Select All</span>
                  </>
                )}
              </Button>
            )}

            {isRanked && (
              <Button
                onClick={handleClearRanking}
                disabled={clearingRanking}
                variant="outline"
                className="bg-white/90 text-gray-600 hover:bg-white border-white/50 text-sm"
                size="sm"
              >
                {clearingRanking ? (
                  <>
                    <Loader2 className="animate-spin h-4 w-4 sm:mr-2" />
                    <span className="hidden sm:inline">Clearing...</span>
                  </>
                ) : (
                  <>
                    <XCircle className="h-4 w-4 sm:mr-2" />
                    <span className="hidden sm:inline">Clear Ranking</span>
                  </>
                )}
              </Button>
            )}

            <Select
              value={staffFilter}
              onValueChange={(value) => setStaffFilter(value as 'all' | 'staff' | 'non_staff')}
            >
              <SelectTrigger className="w-full sm:w-[190px] bg-white/90 text-blue-700 border-white/50 h-9">
                <SelectValue placeholder="Filter by staff" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Candidates</SelectItem>
                <SelectItem value="staff">Staff Only</SelectItem>
                <SelectItem value="non_staff">Non-Staff Only</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <CardDescription className="text-blue-100 text-sm mt-3">
          {isRanked
            ? 'Candidates are ranked by AI relevance score. Rankings are saved automatically.'
            : 'These candidates have been shortlisted for the role. Rank them to see the best matches.'
          }
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 sm:space-y-6 p-3 sm:p-6">
        {/* Selection hint - shows when no candidates selected */}
        {filteredShortlistedCandidates.length > 0 &&
         selectedCandidates.size === 0 &&
         filteredShortlistedCandidates.some(match =>
           match.status !== 'rejected' &&
           match.status !== 'moved_to_pipeline' &&
           !pipelineCandidateIds.has(getCandidateId(match))
         ) && (
          <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-2 sm:p-3 mb-3 sm:mb-4">
            <div className="flex items-start sm:items-center gap-2 text-xs sm:text-sm text-blue-700 dark:text-blue-300">
              <CheckCircle className="h-3 w-3 sm:h-4 sm:w-4 mt-0.5 sm:mt-0 flex-shrink-0" />
              <span className="font-medium">Tip:</span>
              <span className="hidden sm:inline">Click on candidate cards or use checkboxes to select multiple candidates for bulk actions</span>
              <span className="sm:hidden">Tap cards to select for bulk actions</span>
            </div>
          </div>
        )}

        {/* Email Controls - At the top */}
        {filteredShortlistedCandidates.length > 0 && (
          <ShortlistEmailControls
            candidates={filteredShortlistedCandidates
              .filter(match => {
                const candidateId = getCandidateId(match)
                // Exclude: moved_to_pipeline status, rejected status, OR already in pipeline
                return match.status !== 'moved_to_pipeline' 
                  && match.status !== 'rejected'
                  && !pipelineCandidateIds.has(candidateId)
              })
              .map(match => ({
                _id: getCandidateId(match),
                firstName: getCandidateName(match).split(' ')[0] || 'Unknown',
                lastName: getCandidateName(match).split(' ').slice(1).join(' ') || '',
                email: match.candidate?.email || '',
                status: 'shortlisted'
              }))
            }
            jobId={jobId}
            jobTitle={jobTitle || "Current Position"}
            preselectedCandidateIds={Array.from(selectedCandidates)}
            onEmailSent={() => {
              clearSelection()
              refreshCurrentView()
              onCandidateMoved?.()
            }}
          />
        )}

        {filteredShortlistedCandidates.length > 0 ? (
          filteredShortlistedCandidates
            // Sort: rejected candidates always at the bottom
            .sort((a, b) => {
              const aRejected = a.status === 'rejected'
              const bRejected = b.status === 'rejected'
              
              // If one is rejected and the other isn't, rejected goes to bottom
              if (aRejected && !bRejected) return 1
              if (!aRejected && bRejected) return -1
              
              // Otherwise preserve original order (maintains ranking if present)
              return 0
            })
            .map((match, index) => {
            console.log(`📋 Rendering candidate ${getCandidateId(match)} with status: ${match.status}`)
            const candidateId = getCandidateId(match)
            const isSelected = selectedCandidates.has(candidateId)
            return (
            <div 
              key={candidateId || `candidate-${index}`} 
              className={`group relative overflow-hidden rounded-2xl border transition-all duration-300 cursor-pointer ${
                isSelected
                  ? 'border-blue-500 dark:border-blue-400 bg-gradient-to-br from-[#F1ECFF] via-[#E9E2FB]/50 to-[#F1ECFF] dark:from-[#1E0059]/50 dark:via-[#2E1568]/50 dark:to-[#1E0059]/30 shadow-lg shadow-blue-500/30 ring-2 ring-blue-500/50'
                  : match.status === 'rejected' 
                  ? 'border-red-300 dark:border-red-700 bg-gradient-to-br from-red-50/80 via-gray-50/50 to-red-50/30 dark:from-red-950/50 dark:via-slate-700/50 dark:to-red-950/30 hover:shadow-lg hover:shadow-red-500/20 opacity-75' 
                  : 'border-gray-200 dark:border-slate-600 bg-gradient-to-br from-white via-gray-50/50 to-[#F1ECFF]/30 dark:from-slate-800 dark:via-slate-700/50 dark:to-slate-600/30 hover:shadow-xl hover:shadow-blue-500/10 hover:border-blue-300 dark:hover:border-blue-500 hover:scale-[1.01]'
              }`}
              onClick={(e) => {
                // Allow clicking on card to select/deselect, but not if clicking buttons or other interactive elements
                const target = e.target as HTMLElement
                if (
                  match.status !== 'rejected' && 
                  !pipelineCandidateIds.has(candidateId) &&
                  !target.closest('button') && 
                  !target.closest('a') &&
                  !target.closest('[role="checkbox"]')
                ) {
                  toggleCandidateSelection(candidateId)
                }
              }}
            >
              {/* Gradient overlay for depth */}
              <div className={`absolute inset-0 bg-gradient-to-r from-transparent via-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 ${
                match.status === 'rejected' 
                  ? 'to-red-500/10' 
                  : 'to-[#F1ECFF]0/5'
              }`} />
              
              {/* Rejected overlay indicator */}
              {match.status === 'rejected' && (
                <div className="absolute top-4 left-4 z-10">
                  <div className="bg-red-500/20 backdrop-blur-sm rounded-full p-2 border border-red-300 dark:border-red-600">
                    <XCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
                  </div>
                </div>
              )}
              
              {/* Selection Checkbox - Enhanced with hover */}
              {match.status !== 'rejected' && !pipelineCandidateIds.has(getCandidateId(match)) && (
                <div className="absolute top-4 left-4 z-10 transition-all duration-200 opacity-70 group-hover:opacity-100 group-hover:scale-110 group-hover:animate-pulse">
                  <div className="relative">
                    {/* Glow effect on hover */}
                    <div className="absolute inset-0 bg-blue-400 rounded opacity-0 group-hover:opacity-20 blur-md transition-opacity"></div>
                    <Checkbox
                      checked={selectedCandidates.has(getCandidateId(match))}
                      onCheckedChange={() => toggleCandidateSelection(getCandidateId(match))}
                      className="h-5 w-5 border-2 border-gray-400 data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600 bg-white shadow-lg hover:border-blue-500 hover:shadow-xl transition-all cursor-pointer relative z-10"
                    />
                    {/* Hover tooltip */}
                    <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 whitespace-nowrap bg-gray-900 text-white text-xs px-2 py-1 rounded shadow-lg opacity-0 group-hover:opacity-100 transition-opacity delay-300 pointer-events-none z-20">
                      {selectedCandidates.has(getCandidateId(match)) ? 'Deselect' : 'Select'}
                    </div>
                  </div>
                </div>
              )}
              
              <div className="relative p-4 sm:p-6">
                {/* Header Section */}
                <div className="flex flex-col sm:flex-row sm:items-start gap-3 sm:gap-4 mb-4">
                  {/* Avatar and basic info row on mobile */}
                  <div className="flex items-start gap-3 sm:gap-4">
                    {/* Enhanced Avatar */}
                    <div className="relative flex-shrink-0">
                      <Avatar className="h-12 w-12 sm:h-16 sm:w-16 ring-2 sm:ring-4 ring-white/80 shadow-lg group-hover:ring-blue-200 transition-all duration-300">
                        <AvatarFallback className="bg-gradient-to-br from-[#754BE5] to-[#6935CF] text-white text-sm sm:text-lg font-bold shadow-inner">
                          {getCandidateName(match) !== 'Unnamed Candidate' ? getCandidateName(match).split(' ').map((n: string) => n[0]).join('').toUpperCase() : 'N/A'}
                        </AvatarFallback>
                      </Avatar>
                      {/* Online indicator */}
                      <div className="absolute -bottom-1 -right-1 h-4 w-4 sm:h-5 sm:w-5 bg-green-400 border-2 sm:border-3 border-white dark:border-slate-800 rounded-full shadow-sm" />
                    </div>

                    {/* Candidate Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className={`text-base sm:text-lg font-bold transition-colors truncate ${
                          match.status === 'rejected'
                            ? 'text-gray-600 dark:text-gray-400 line-through'
                            : 'text-gray-900 dark:text-gray-100 group-hover:text-blue-700 dark:group-hover:text-blue-300'
                        }`}>
                          {getCandidateName(match)}
                        </h3>
                        {match.candidate?.isInternalCandidate && (
                          <Badge className="bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200 text-xs px-2 py-0.5 font-medium shrink-0">
                            Staff
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mb-2">
                        <Briefcase className="h-3 w-3 sm:h-4 sm:w-4 text-gray-500 flex-shrink-0" />
                        <p className="text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 truncate">{getCandidatePosition(match)}</p>
                      </div>
                    </div>
                  </div>

                  {/* Status Badge - stacks below on mobile */}
                  <div className="flex justify-start sm:justify-end sm:ml-auto pl-[60px] sm:pl-0">
                    <Badge
                      variant={match.status === 'moved_to_pipeline' ? 'default' : match.status === 'rejected' ? 'destructive' : 'secondary'}
                      className={`text-xs px-2 sm:px-3 py-1 font-medium shadow-sm whitespace-nowrap ${
                        match.status === 'moved_to_pipeline'
                          ? 'bg-green-100 text-green-800 border-green-200 dark:bg-green-900 dark:text-green-200'
                          : match.status === 'rejected'
                          ? 'bg-red-100 text-red-800 border-red-200 animate-pulse font-bold'
                          : 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900 dark:text-blue-200'
                      }`}
                    >
                      {match.status === 'moved_to_pipeline' ? (
                        <><CheckCircle className="h-3 w-3 mr-1" />In Pipeline</>
                      ) : match.status === 'rejected' ? (
                        <><XCircle className="h-3 w-3 mr-1" />REJECTED</>
                      ) : (
                        <><Clock className="h-3 w-3 mr-1" />Active</>
                      )}
                    </Badge>
                  </div>
                </div>

                {/* Candidate Details Section */}
                <div className="space-y-2 sm:space-y-3 mb-4">
                  {/* Contact Information - responsive grid on mobile */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {match.candidate?.email && (
                      <div className="flex items-center gap-2 text-xs sm:text-sm text-gray-600 dark:text-gray-400 min-w-0">
                        <Mail className="h-3 w-3 sm:h-4 sm:w-4 text-blue-500 flex-shrink-0" />
                        <span className="font-medium truncate">{match.candidate.email}</span>
                      </div>
                    )}

                    {match.candidate?.phone && (
                      <div className="flex items-center gap-2 text-xs sm:text-sm text-gray-600 dark:text-gray-400">
                        <Phone className="h-3 w-3 sm:h-4 sm:w-4 text-green-500 flex-shrink-0" />
                        <span>{match.candidate.phone}</span>
                      </div>
                    )}

                    {match.candidate?.location && (
                      <div className="flex items-center gap-2 text-xs sm:text-sm text-gray-600 dark:text-gray-400">
                        <MapPin className="h-3 w-3 sm:h-4 sm:w-4 text-red-500 flex-shrink-0" />
                        <span className="truncate">{match.candidate.location}</span>
                      </div>
                    )}

                    {/* Experience */}
                    {match.candidate?.experience && (
                      <div className="flex items-center gap-2 text-xs sm:text-sm text-gray-600 dark:text-gray-400">
                        <GraduationCap className="h-3 w-3 sm:h-4 sm:w-4 text-orange-500 flex-shrink-0" />
                        <span className="truncate"><strong>Exp:</strong> {match.candidate.experience}</span>
                      </div>
                    )}
                  </div>

                  {/* Skills Section */}
                  {match.candidate?.skills && (
                    <div className="space-y-1 sm:space-y-2">
                      <div className="flex items-center gap-2">
                        <Award className="h-3 w-3 sm:h-4 sm:w-4 text-purple-500" />
                        <span className="text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300">Skills</span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {(typeof match.candidate.skills === 'string'
                          ? match.candidate.skills.split(',')
                          : match.candidate.skills
                        ).slice(0, 3).map((skill: string, skillIndex: number) => (
                          <Badge
                            key={skillIndex}
                            variant="outline"
                            className="text-[10px] sm:text-xs px-1.5 sm:px-2 py-0.5 bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-900/20 dark:text-purple-300 dark:border-purple-700"
                          >
                            {skill.trim()}
                          </Badge>
                        ))}
                        {(typeof match.candidate.skills === 'string'
                          ? match.candidate.skills.split(',')
                          : match.candidate.skills
                        ).length > 3 && (
                          <Badge variant="outline" className="text-[10px] sm:text-xs px-1.5 sm:px-2 py-0.5 text-gray-500">
                            +{(typeof match.candidate.skills === 'string'
                              ? match.candidate.skills.split(',')
                              : match.candidate.skills
                            ).length - 3} more
                          </Badge>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* AI Match Score Section */}
                <div className="bg-gradient-to-r from-[#F1ECFF] to-[#E9E2FB] dark:from-[#1E0059]/20 dark:to-purple-950/20 rounded-lg sm:rounded-xl p-3 sm:p-4 mb-4 border border-blue-100 dark:border-blue-800/30">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      <Award className="h-3 w-3 sm:h-4 sm:w-4 text-blue-500" />
                      <span className="text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300">AI Match Score</span>
                    </div>
                    {match.relevanceScore && match.relevanceScore > 0 && (
                      <Badge
                        variant="outline"
                        className={`text-[10px] sm:text-xs px-2 py-0.5 sm:py-1 font-bold ${
                          match.relevanceScore >= 0.8
                            ? 'bg-green-100 text-green-800 border-green-300'
                            : match.relevanceScore >= 0.6
                            ? 'bg-yellow-100 text-yellow-800 border-yellow-300'
                            : 'bg-gray-100 text-gray-800 border-gray-300'
                        }`}
                      >
                        {Math.round(match.relevanceScore * 100)}% Match
                      </Badge>
                    )}
                  </div>

                  {match.relevanceScore && match.relevanceScore > 0 ? (
                    <Progress
                      value={match.relevanceScore * 100}
                      className="h-2 sm:h-3 bg-gray-200 dark:bg-gray-700"
                    />
                  ) : (
                    <div className="flex items-center gap-2 text-[10px] sm:text-xs text-gray-500 italic">
                      <AlertTriangle className="h-3 w-3 flex-shrink-0" />
                      <span>Not ranked yet - tap "Rank" button above</span>
                    </div>
                  )}
                </div>

                {/* Action Buttons Section */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-3 sm:pt-4 border-t border-gray-200 dark:border-slate-600">
                  {/* View Profile Button */}
                  <Button
                    size="sm"
                    variant="outline"
                    type="button"
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      router.push(`/candidates/${getCandidateId(match)}?from=job-shortlist&jobId=${jobId}`)
                    }}
                    className="h-8 sm:h-9 px-3 bg-white hover:bg-gray-50 border-gray-300 text-gray-700 hover:text-gray-900 text-xs sm:text-sm w-full sm:w-auto"
                  >
                    <Eye className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
                    View Profile
                  </Button>

                  {/* Show individual action buttons only when NOT in bulk selection mode */}
                  {selectedCandidates.size === 0 ? (
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {/* Main Action Button */}
                      {match.status === 'moved_to_pipeline' ? (
                        <Button
                          size="sm"
                          variant="outline"
                          type="button"
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            handleReturnToShortlist(getCandidateId(match), getCandidateName(match))
                          }}
                          disabled={movingToPipeline.has(getCandidateId(match))}
                          className="h-8 sm:h-9 px-2 sm:px-4 bg-orange-50 hover:bg-orange-100 border-orange-300 text-orange-700 hover:text-orange-900 text-xs sm:text-sm"
                        >
                          {movingToPipeline.has(getCandidateId(match)) ? (
                            <Loader2 className="animate-spin h-3 w-3 sm:h-4 sm:w-4" />
                          ) : (
                            <>
                              <RefreshCw className="h-3 w-3 sm:h-4 sm:w-4 sm:mr-2" />
                              <span className="hidden sm:inline">Return to Shortlist</span>
                              <span className="sm:hidden ml-1">Return</span>
                            </>
                          )}
                        </Button>
                      ) : match.status !== 'rejected' ? (
                        <Button
                          size="sm"
                          type="button"
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            handleMoveToPipeline(getCandidateId(match), getCandidateName(match))
                          }}
                          disabled={movingToPipeline.has(getCandidateId(match))}
                          className="h-8 sm:h-9 px-2 sm:px-4 bg-gradient-to-r from-green-600 to-[#6935CF] hover:from-green-700 hover:to-[#5A2CB5] text-white shadow-lg hover:shadow-xl transition-all duration-200 text-xs sm:text-sm"
                        >
                          {movingToPipeline.has(getCandidateId(match)) ? (
                            <Loader2 className="animate-spin h-3 w-3 sm:h-4 sm:w-4" />
                          ) : (
                            <>
                              <UserPlus className="h-3 w-3 sm:h-4 sm:w-4 sm:mr-2" />
                              <span className="hidden sm:inline">Move to Pipeline</span>
                              <span className="sm:hidden ml-1">Pipeline</span>
                            </>
                          )}
                        </Button>
                      ) : null}

                      {/* Secondary Actions */}
                      {match.status !== 'rejected' && !pipelineCandidateIds.has(getCandidateId(match)) && (
                        <>
                          <CandidateRejectionButton
                            candidate={{
                              _id: getCandidateId(match),
                              firstName: getCandidateName(match).split(' ')[0] || 'Unknown',
                              lastName: getCandidateName(match).split(' ').slice(1).join(' ') || '',
                              email: match.candidate?.email || '',
                              status: 'shortlisted'
                            }}
                            jobId={jobId}
                            onEmailSent={() => {
                              refreshCurrentView()
                              onCandidateMoved?.()
                            }}
                            isShortlistRejection={true}
                            size="sm"
                            variant="outline"
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            type="button"
                            onClick={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              handleRemoveFromShortlist(getCandidateId(match), getCandidateName(match))
                            }}
                            disabled={removingFromShortlist.has(getCandidateId(match))}
                            className="h-8 sm:h-9 px-2 sm:px-3 bg-white hover:bg-red-50 border-red-200 text-red-600 hover:text-red-700 hover:border-red-300"
                          >
                            {removingFromShortlist.has(getCandidateId(match)) ? (
                              <Loader2 className="animate-spin h-3 w-3 sm:h-4 sm:w-4" />
                            ) : (
                              <Trash className="h-3 w-3 sm:h-4 sm:w-4" />
                            )}
                          </Button>
                        </>
                      )}

                      {/* Show message if candidate is in pipeline */}
                      {pipelineCandidateIds.has(getCandidateId(match)) && match.status !== 'rejected' && (
                        <div className="text-[10px] sm:text-xs text-gray-500 dark:text-gray-400 italic text-right">
                          In pipeline
                        </div>
                      )}
                    </div>
                  ) : (
                    /* Show selection indicator when in bulk mode */
                    <div className="flex items-center justify-end gap-2">
                      {isSelected ? (
                        <Badge className="bg-blue-100 text-blue-800 border-blue-300 text-xs">
                          <CheckCircle className="h-3 w-3 mr-1" />
                          Selected
                        </Badge>
                      ) : (
                        <span className="text-[10px] sm:text-xs text-gray-500 italic">
                          Tap to select
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
            )
          })
        ) : (
          <div className="text-center py-12 text-gray-500 dark:text-gray-400">
            <Users className="h-16 w-16 mx-auto mb-4 text-gray-300 dark:text-gray-600" />
            {shortlistedCandidates.length > 0 ? (
              <>
                <p className="text-base">No candidates match this staff filter.</p>
                <p className="text-sm text-gray-400 mt-2">Try switching the filter back to "All Candidates".</p>
              </>
            ) : (
              <>
                <p className="text-base">No candidates have been shortlisted yet.</p>
                <p className="text-sm text-gray-400 mt-2">Use "Add Candidates" to start building your shortlist.</p>
              </>
            )}
          </div>
        )}
      </CardContent>
      
      {/* Add Candidates Dialog */}
      <Dialog open={showAddCandidateDialog} onOpenChange={setShowAddCandidateDialog}>
        <DialogContent className="w-[95vw] max-w-4xl max-h-[85vh] sm:max-h-[90vh] overflow-y-auto bg-white dark:bg-slate-800 border-0 dark:border-slate-700 p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle className="text-lg sm:text-2xl font-bold flex items-center gap-2 sm:gap-3 text-gray-900 dark:text-gray-100">
              <div className="h-8 w-8 sm:h-10 sm:w-10 rounded-full bg-gradient-to-r from-[#754BE5] to-[#6935CF] flex items-center justify-center flex-shrink-0">
                <UserPlus className="h-4 w-4 sm:h-5 sm:w-5 text-white" />
              </div>
              <span className="truncate">Add Candidates to Shortlist</span>
            </DialogTitle>
          </DialogHeader>

          {/* Search Bar */}
          <div className="relative mt-2">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search candidates..."
              className="pl-9 text-sm sm:text-base h-9 sm:h-10"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {/* All Candidates */}
          <div className="space-y-3 sm:space-y-4 mt-3">
              {loadingCandidates ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="animate-spin h-6 w-6 text-primary" />
                </div>
              ) : (
                <div className="space-y-2 sm:space-y-3 max-h-[50vh] sm:max-h-96 overflow-y-auto">
                  {allCandidates
                    .filter(candidate =>
                      !searchQuery ||
                      `${candidate.firstName} ${candidate.lastName}`.toLowerCase().includes(searchQuery.toLowerCase()) ||
                      (candidate.position || '').toLowerCase().includes(searchQuery.toLowerCase())
                    )
                    .map((candidate) => {
                      const candidateId = candidate._id
                      const candidateName = `${candidate.firstName || ''} ${candidate.lastName || ''}`.trim() || 'Unnamed Candidate'
                      const isAdding = addingCandidates.has(candidateId)
                      const isAlreadyInShortlist = shortlistedCandidates.some(item =>
                        item.candidate._id === candidateId || item.candidateId === candidateId
                      )

                      return (
                        <div key={candidateId} className="border rounded-lg p-3 sm:p-4 flex items-center justify-between gap-2 sm:gap-3">
                          <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
                            <Avatar className="h-9 w-9 sm:h-10 sm:w-10 flex-shrink-0">
                              <AvatarFallback className="text-xs sm:text-sm">
                                {candidateName.split(' ').map((n: string) => n[0]).join('').toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0 flex-1">
                              <h4 className="font-medium text-sm sm:text-base truncate">{candidateName}</h4>
                              <p className="text-xs sm:text-sm text-gray-600 truncate">{candidate.position || 'Position not specified'}</p>
                              {candidate.location && (
                                <p className="text-[10px] sm:text-xs text-gray-500 truncate">{candidate.location}</p>
                              )}
                            </div>
                          </div>
                          <Button
                            size="sm"
                            onClick={() => handleAddCandidateToShortlist(candidateId, candidateName)}
                            disabled={isAdding || isAlreadyInShortlist}
                            className="h-8 px-2 sm:px-3 text-xs sm:text-sm flex-shrink-0"
                          >
                            {isAdding ? (
                              <Loader2 className="animate-spin h-3 w-3 sm:h-4 sm:w-4" />
                            ) : isAlreadyInShortlist ? (
                              <>
                                <CheckCircle className="h-3 w-3 sm:h-4 sm:w-4 sm:mr-1" />
                                <span className="hidden sm:inline">In Shortlist</span>
                              </>
                            ) : (
                              <>
                                <UserPlus className="h-3 w-3 sm:h-4 sm:w-4 sm:mr-1" />
                                <span className="hidden xs:inline">Add</span>
                              </>
                            )}
                          </Button>
                        </div>
                      )
                    })}
                </div>
              )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Stage Requirement Error Dialog */}
      <Dialog open={showStageErrorDialog} onOpenChange={setShowStageErrorDialog}>
        <DialogContent className="sm:max-w-md bg-white dark:bg-slate-800">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-full bg-red-100 dark:bg-red-900/20 flex items-center justify-center">
                <AlertTriangle className="h-6 w-6 text-red-600 dark:text-red-400" />
              </div>
              <div>
                <DialogTitle className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  Pipeline Stages Required
                </DialogTitle>
                <DialogDescription className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                  You need to set up pipeline stages first
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-gray-700 dark:text-gray-300">
              Before you can add candidates to the pipeline, you need to create at least one pipeline stage. 
              Pipeline stages define the interview process for this job.
            </p>
          </div>
          <DialogFooter className="flex gap-2 sm:gap-2">
            <Button
              variant="outline"
              onClick={() => setShowStageErrorDialog(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                setShowStageErrorDialog(false)
                console.log('Navigating to stage configuration for job:', jobId)

                // Use hash-based navigation that the job page expects
                window.location.hash = '#configuration'

                // Also try the global function if available
                // @ts-ignore
                if (window.navigateToJobStagesTab) {
                  console.log('Using global navigation function')
                  // @ts-ignore
                  window.navigateToJobStagesTab()
                }

                // Dispatch custom event as backup
                window.dispatchEvent(new CustomEvent('navigateToStages'))

                console.log('Navigation triggered')
              }}
              className="bg-blue-600 hover:bg-blue-700"
            >
              <Settings className="h-4 w-4 mr-2" />
              Create Pipeline Stages
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </Card>
    </>
  )
}
