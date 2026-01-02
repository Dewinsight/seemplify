"use client"

import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { MultiStepInterviewScheduler } from '@/components/ui/multi-step-interview-scheduler'
import { getJobInterviewCandidates } from '@/services/jobService'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { 
  Calendar, 
  Users, 
  Clock, 
  Video, 
  CheckCircle, 
  ArrowLeft,
  Sparkles,
  Loader2,
  AlertCircle,
  Check,
  ChevronsUpDown,
  MapPin,
  Briefcase,
  Target
} from 'lucide-react'

interface InterviewSetupTabProps {
  jobId: string
  jobTitle: string
  stages?: Array<{ _id: string; name: string; type: string; order: number }>
  loadingStages?: boolean
  onInterviewScheduled?: () => void
  onNavigateToShortlist?: () => void
}

type SchedulerMode = 'none' | 'single' | 'multi'

export function InterviewSetupTab({
  jobId,
  jobTitle,
  stages = [],
  loadingStages = false,
  onInterviewScheduled,
  onNavigateToShortlist,
}: InterviewSetupTabProps) {
  const [schedulerMode, setSchedulerMode] = useState<SchedulerMode>('none')
  
  // Selection state
  const [selectedCandidate, setSelectedCandidate] = useState<string>('')
  const [selectedStage, setSelectedStage] = useState<string>('')
  
  // Candidates data (for single interview)
  const [candidates, setCandidates] = useState<any[]>([])
  const [loadingCandidates, setLoadingCandidates] = useState(false)
  const [candidateDialogOpen, setCandidateDialogOpen] = useState(false)
  const [candidateSearchValue, setCandidateSearchValue] = useState('')
  const [activeTab, setActiveTab] = useState<'pipeline' | 'shortlist'>('pipeline')
  
  // Separate pipeline and shortlist candidates
  const pipelineCandidates = candidates.filter(c => c.source === 'pipeline')
  const shortlistCandidates = candidates.filter(c => c.source === 'shortlist')
  
  // Filtered candidates based on search
  const filteredPipelineCandidates = pipelineCandidates.filter(candidate => {
    if (!candidateSearchValue) return true
    const searchLower = candidateSearchValue.toLowerCase()
    return (
      `${candidate.firstName} ${candidate.lastName}`.toLowerCase().includes(searchLower) ||
      candidate.email?.toLowerCase().includes(searchLower)
    )
  })
  
  const filteredShortlistCandidates = shortlistCandidates.filter(candidate => {
    if (!candidateSearchValue) return true
    const searchLower = candidateSearchValue.toLowerCase()
    return (
      `${candidate.firstName} ${candidate.lastName}`.toLowerCase().includes(searchLower) ||
      candidate.email?.toLowerCase().includes(searchLower)
    )
  })
  
  // Load candidates when component mounts or jobId changes
  useEffect(() => {
    if (jobId) {
      loadCandidates()
    }
  }, [jobId])
  
  const loadCandidates = async () => {
    try {
      setLoadingCandidates(true)
      const candidatesData = await getJobInterviewCandidates(jobId)
      setCandidates(candidatesData || [])
      console.log(`📊 Loaded ${candidatesData?.length || 0} job-specific candidates for selection`)
    } catch (error) {
      console.error('Error loading candidates:', error)
      toast.error('Failed to load candidates')
      setCandidates([])
    } finally {
      setLoadingCandidates(false)
    }
  }
  
  // Find selected candidate details
  const selectedCandidateData = candidates.find(c => c._id === selectedCandidate)
  
  // Validation
  const canStartSingle = selectedCandidate && selectedStage
  const canStartMulti = selectedStage

  const handleScheduled = (result: any) => {
    console.log('Interview scheduled:', result)
    setSchedulerMode('none') // Return to selection view
    onInterviewScheduled?.() // Notify parent (switches to pipeline tab)
  }

  const handleCancel = () => {
    setSchedulerMode('none') // Return to selection view
  }

  // If a scheduler is active, show it
  if (schedulerMode === 'single' || schedulerMode === 'multi') {
    return (
      <div className="space-y-3 sm:space-y-4">
        {/* Back button */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 px-4 sm:px-0">
          <Button
            variant="outline"
            onClick={handleCancel}
            className="h-10 sm:h-9 text-xs sm:text-sm w-full sm:w-auto"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Options
          </Button>
          <div className="text-center sm:text-left">
            <h3 className="font-semibold text-base sm:text-lg">
              {schedulerMode === 'single' ? 'Single Interview' : 'Multi-Candidate Interview'}
            </h3>
            <p className="text-xs sm:text-sm text-muted-foreground">
              <span className="block sm:inline">{jobTitle}</span>
              {schedulerMode === 'single' && selectedCandidateData && (
                <span className="text-blue-600 block sm:inline"> • {selectedCandidateData.firstName} {selectedCandidateData.lastName}</span>
              )}
              {selectedStage && (
                <span className="text-green-600 block sm:inline"> • {stages.find(s => s._id === selectedStage)?.name}</span>
              )}
            </p>
          </div>
        </div>

        {/* Scheduler */}
        <div className="bg-white dark:bg-slate-900 rounded-lg border p-4 sm:p-6">
          <MultiStepInterviewScheduler
            candidateId={selectedCandidate} // Pre-filled for single interview
            candidateName={selectedCandidateData ? `${selectedCandidateData.firstName} ${selectedCandidateData.lastName}` : ''}
            candidateEmail={selectedCandidateData?.email}
            jobTitle={jobTitle}
            jobId={jobId}
            stageId={selectedStage} // Pre-filled stage
            onScheduled={handleScheduled}
            onCancel={handleCancel}
            skipTypeSelection={true} // Skip interview type selection - user already chose from cards
            forceMultiCandidate={schedulerMode === 'multi'} // Set multi mode when multi-candidate selected
            onNavigateToShortlist={onNavigateToShortlist}
          />
        </div>
      </div>
    )
  }

  // Default view: Show options for single vs multi-candidate
  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="text-center space-y-2 px-4 sm:px-0">
        <h2 className="text-xl sm:text-2xl lg:text-3xl font-bold text-foreground dark:text-gray-100">
          Schedule Interviews
        </h2>
        <p className="text-sm sm:text-base text-muted-foreground max-w-2xl mx-auto">
          Choose how you'd like to schedule interviews for <span className="font-semibold">{jobTitle}</span>
        </p>
      </div>

      {/* Options Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5 lg:gap-6 max-w-full sm:max-w-4xl lg:max-w-5xl mx-auto px-4 sm:px-0">
        
        {/* Single Interview Card */}
        <Card 
          className="transition-all duration-300 border-2 border-blue-200 bg-gradient-to-br from-blue-50 via-indigo-50 to-blue-50 dark:from-blue-950/20 dark:to-indigo-950/20 overflow-hidden relative"
        >
          {/* Decorative element - hide on mobile */}
          <div className="hidden sm:block absolute top-0 right-0 w-32 h-32 bg-blue-500/10 rounded-full -mr-16 -mt-16"></div>
          
          <CardContent className="p-4 sm:p-6 lg:p-8 relative">
            <div className="space-y-4 sm:space-y-5 lg:space-y-6">
              {/* Icon and Title */}
              <div className="flex items-start gap-3 sm:gap-4">
                <div className="p-3 sm:p-4 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl shadow-lg">
                  <Calendar className="h-6 w-6 sm:h-7 sm:w-7 lg:h-8 lg:w-8 text-white" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1 sm:mb-2">
                    <h3 className="text-lg sm:text-xl font-bold text-foreground dark:text-gray-100">Single Interview</h3>
                    <Badge variant="secondary" className="bg-blue-100 text-blue-700 text-xs">Standard</Badge>
                  </div>
                  <p className="text-xs sm:text-sm text-muted-foreground dark:text-gray-400">
                    Schedule one candidate at a time with personalized scheduling
                  </p>
                </div>
              </div>

              {/* Selection Inputs */}
              <div className="space-y-3 sm:space-y-4 bg-white/50 dark:bg-slate-800/50 p-3 sm:p-4 rounded-lg border border-blue-100">
                {/* Candidate Selection */}
                <div className="space-y-2">
                  <Label htmlFor="single-candidate-select" className="text-xs sm:text-sm font-medium">
                    Select Candidate <span className="text-red-500">*</span>
                  </Label>
                  {loadingCandidates ? (
                    <div className="flex items-center gap-2 text-xs sm:text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading candidates...
                    </div>
                  ) : candidates.length === 0 ? (
                    <div className="flex flex-col gap-2 p-4 text-xs sm:text-sm text-amber-600 bg-amber-50 dark:bg-amber-950/20 rounded-lg border border-amber-200 dark:border-amber-800">
                      <div className="flex items-center gap-2">
                        <AlertCircle className="h-4 w-4" />
                        <span className="font-medium">No candidates available for interview</span>
                      </div>
                      <p className="text-xs text-amber-600/80 dark:text-amber-400/80 ml-6">
                        Add candidates to the pipeline or shortlist first
                      </p>
                    </div>
                  ) : (
                    <>
                      <Button
                        variant="outline"
                        onClick={() => setCandidateDialogOpen(true)}
                        className="w-full justify-between h-11 sm:h-10"
                      >
                        {selectedCandidate
                          ? (() => {
                              const candidate = candidates.find(c => c._id === selectedCandidate)
                              return (
                                <div className="flex items-center gap-2 text-left">
                                  <span>{candidate?.firstName} {candidate?.lastName}</span>
                                  <Badge variant={candidate?.source === 'pipeline' ? 'default' : 'secondary'} className="text-xs">
                                    {candidate?.source === 'pipeline' ? 'Pipeline' : 'Shortlist'}
                                  </Badge>
                                </div>
                              )
                            })()
                          : "Select candidate..."}
                        <Users className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>

                      {/* Candidate Selection Dialog */}
                      <Dialog open={candidateDialogOpen} onOpenChange={setCandidateDialogOpen}>
                        <DialogContent className="max-w-[95vw] sm:max-w-2xl max-h-[90vh] overflow-y-auto">
                          <DialogHeader>
                            <DialogTitle>Select Candidate</DialogTitle>
                            <DialogDescription>
                              Choose a candidate from the job pipeline or shortlist
                            </DialogDescription>
                          </DialogHeader>

                          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'pipeline' | 'shortlist')}>
                            <TabsList className="grid w-full grid-cols-2">
                              <TabsTrigger value="pipeline">From Pipeline</TabsTrigger>
                              <TabsTrigger value="shortlist">From Shortlist</TabsTrigger>
                            </TabsList>

                            <TabsContent value="pipeline" className="space-y-4 mt-4">
                              <div className="bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 rounded-lg p-4">
                                <p className="text-sm text-emerald-800 dark:text-emerald-200">
                                  Showing pipeline candidates for this job
                                </p>
                              </div>

                              <div>
                                <Label>Search</Label>
                                <Input
                                  placeholder="Search by name or email"
                                  value={candidateSearchValue}
                                  onChange={(e) => setCandidateSearchValue(e.target.value)}
                                />
                              </div>

                              <ScrollArea className="h-[300px] border rounded-lg p-4">
                                {filteredPipelineCandidates.length === 0 ? (
                                  <p className="text-center text-muted-foreground py-8">
                                    No pipeline candidates found
                                  </p>
                                ) : (
                                  <div className="space-y-2">
                                    {filteredPipelineCandidates.map(candidate => (
                                      <label
                                        key={candidate._id}
                                        className="flex items-center space-x-3 p-3 rounded-lg hover:bg-muted cursor-pointer"
                                      >
                                        <input
                                          type="radio"
                                          name="candidate-selection"
                                          checked={selectedCandidate === candidate._id}
                                          onChange={() => setSelectedCandidate(candidate._id)}
                                          className="rounded-full"
                                        />
                                        <div className="flex-1">
                                          <div className="flex items-center gap-2">
                                            <p className="font-medium">
                                              {candidate.firstName} {candidate.lastName}
                                            </p>
                                          </div>
                                          <p className="text-sm text-muted-foreground">
                                            {candidate.email}
                                          </p>
                                          <div className="flex items-center gap-2 mt-1">
                                            {candidate.position && (
                                              <Badge variant="outline" className="text-xs">
                                                {candidate.position}
                                              </Badge>
                                            )}
                                            {candidate.location && (
                                              <span className="text-xs text-muted-foreground flex items-center gap-1">
                                                <MapPin className="h-3 w-3" />
                                                {candidate.location}
                                              </span>
                                            )}
                                          </div>
                                        </div>
                                      </label>
                                    ))}
                                  </div>
                                )}
                              </ScrollArea>

                              {/* Helpful message */}
                              <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
                                <p className="text-sm text-amber-800 dark:text-amber-200 mb-2">
                                  Don't see the candidate you want? Add them to the shortlist first.
                                </p>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => {
                                    setCandidateDialogOpen(false);
                                    setCandidateSearchValue('');
                                    if (onNavigateToShortlist) {
                                      setTimeout(() => {
                                        onNavigateToShortlist();
                                      }, 100);
                                    }
                                  }}
                                  className="text-xs"
                                >
                                  Go to Job Shortlist
                                </Button>
                              </div>

                              <div className="flex justify-end gap-2">
                                <Button variant="outline" onClick={() => setCandidateDialogOpen(false)}>
                                  Cancel
                                </Button>
                                <Button 
                                  onClick={() => {
                                    setCandidateDialogOpen(false)
                                    setCandidateSearchValue('')
                                  }}
                                  disabled={!selectedCandidate}
                                >
                                  Select Candidate
                                </Button>
                              </div>
                            </TabsContent>

                            <TabsContent value="shortlist" className="space-y-4 mt-4">
                              <div className="bg-purple-50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-800 rounded-lg p-4">
                                <p className="text-sm text-purple-800 dark:text-purple-200">
                                  Showing shortlisted candidates for this job
                                </p>
                              </div>

                              <div>
                                <Label>Search</Label>
                                <Input
                                  placeholder="Search by name or email"
                                  value={candidateSearchValue}
                                  onChange={(e) => setCandidateSearchValue(e.target.value)}
                                />
                              </div>

                              <ScrollArea className="h-[300px] border rounded-lg p-4">
                                {filteredShortlistCandidates.length === 0 ? (
                                  <p className="text-center text-muted-foreground py-8">
                                    No shortlisted candidates found
                                  </p>
                                ) : (
                                  <div className="space-y-2">
                                    {filteredShortlistCandidates.map(candidate => (
                                      <label
                                        key={candidate._id}
                                        className="flex items-center space-x-3 p-3 rounded-lg hover:bg-muted cursor-pointer"
                                      >
                                        <input
                                          type="radio"
                                          name="candidate-selection"
                                          checked={selectedCandidate === candidate._id}
                                          onChange={() => setSelectedCandidate(candidate._id)}
                                          className="rounded-full"
                                        />
                                        <div className="flex-1">
                                          <div className="flex items-center gap-2">
                                            <p className="font-medium">
                                              {candidate.firstName} {candidate.lastName}
                                            </p>
                                            {candidate.relevanceScore && (
                                              <Badge variant="secondary" className="text-xs">
                                                {Math.round(candidate.relevanceScore * 100)}% Match
                                              </Badge>
                                            )}
                                          </div>
                                          <p className="text-sm text-muted-foreground">
                                            {candidate.email}
                                          </p>
                                          <div className="flex items-center gap-2 mt-1">
                                            {candidate.position && (
                                              <Badge variant="outline" className="text-xs">
                                                {candidate.position}
                                              </Badge>
                                            )}
                                            {candidate.location && (
                                              <span className="text-xs text-muted-foreground flex items-center gap-1">
                                                <MapPin className="h-3 w-3" />
                                                {candidate.location}
                                              </span>
                                            )}
                                          </div>
                                        </div>
                                      </label>
                                    ))}
                                  </div>
                                )}
                              </ScrollArea>

                              {/* Helpful message */}
                              <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
                                <p className="text-sm text-amber-800 dark:text-amber-200 mb-2">
                                  Don't see the candidate you want? Add them to the shortlist first.
                                </p>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => {
                                    setCandidateDialogOpen(false);
                                    setCandidateSearchValue('');
                                    if (onNavigateToShortlist) {
                                      setTimeout(() => {
                                        onNavigateToShortlist();
                                      }, 100);
                                    }
                                  }}
                                  className="text-xs"
                                >
                                  Go to Job Shortlist
                                </Button>
                              </div>

                              <div className="flex justify-end gap-2">
                                <Button variant="outline" onClick={() => setCandidateDialogOpen(false)}>
                                  Cancel
                                </Button>
                                <Button 
                                  onClick={() => {
                                    setCandidateDialogOpen(false)
                                    setCandidateSearchValue('')
                                  }}
                                  disabled={!selectedCandidate}
                                >
                                  Select Candidate
                                </Button>
                              </div>
                            </TabsContent>
                          </Tabs>
                        </DialogContent>
                      </Dialog>
                    </>
                  )}
                </div>

                {/* Stage Selection */}
                <div className="space-y-2">
                  <Label htmlFor="single-stage-select" className="text-xs sm:text-sm font-medium">
                    Select Interview Stage <span className="text-red-500">*</span>
                  </Label>
                  {loadingStages ? (
                    <div className="flex items-center gap-2 text-xs sm:text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading stages...
                    </div>
                  ) : stages.length === 0 ? (
                    <div className="flex items-center gap-2 text-xs sm:text-sm text-amber-600">
                      <AlertCircle className="h-4 w-4" />
                      No stages configured
                    </div>
                  ) : (
                    <Select value={selectedStage} onValueChange={setSelectedStage}>
                      <SelectTrigger id="single-stage-select" className="h-11 sm:h-10">
                        <SelectValue placeholder="Choose an interview stage..." />
                      </SelectTrigger>
                      <SelectContent>
                        {stages.map(stage => (
                          <SelectItem key={stage._id} value={stage._id}>
                            {stage.name}
                            <span className="text-xs text-muted-foreground ml-2">({stage.type})</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </div>

              {/* Features */}
              <div className="space-y-2 sm:space-y-2.5 pl-1">
                <div className="flex items-center gap-2 text-xs sm:text-sm text-muted-foreground dark:text-gray-400">
                  <CheckCircle className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-green-600 flex-shrink-0" />
                  <span>Personalized scheduling</span>
                </div>
                <div className="flex items-center gap-2 text-xs sm:text-sm text-muted-foreground dark:text-gray-400">
                  <CheckCircle className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-green-600 flex-shrink-0" />
                  <span>AI notetaker & email templates</span>
                </div>
                <div className="flex items-center gap-2 text-xs sm:text-sm text-muted-foreground dark:text-gray-400">
                  <CheckCircle className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-green-600 flex-shrink-0" />
                  <span>Flexible timing options</span>
                </div>
              </div>

              {/* CTA */}
              <div className="pt-3 sm:pt-4">
                <Button 
                  className="w-full h-12 sm:h-11 lg:h-10 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white shadow-lg text-sm sm:text-base"
                  disabled={!canStartSingle}
                  onClick={() => setSchedulerMode('single')}
                >
                  {!canStartSingle ? (
                    <>
                      <AlertCircle className="h-4 w-4 sm:h-5 sm:w-5 mr-2" />
                      <span className="text-xs sm:text-sm">Select Candidate & Stage</span>
                    </>
                  ) : (
                    <>
                      <span>Get Started</span>
                      <ArrowLeft className="h-4 w-4 sm:h-5 sm:w-5 ml-2 rotate-180" />
                    </>
                  )}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Multi-Candidate Interview Card */}
        <Card 
          className="transition-all duration-300 border-2 border-orange-200 bg-gradient-to-br from-orange-50 via-amber-50 to-orange-50 dark:from-orange-950/20 dark:to-amber-950/20 overflow-hidden relative"
        >
          {/* Decorative element - hide on mobile */}
          <div className="hidden sm:block absolute top-0 right-0 w-32 h-32 bg-orange-500/10 rounded-full -mr-16 -mt-16"></div>
          
          {/* Badge */}
          <Badge 
            variant="secondary" 
            className="absolute top-2 right-2 sm:top-4 sm:right-4 bg-gradient-to-r from-orange-500 to-amber-500 text-white border-0 shadow-md z-10 text-xs"
          >
            <Sparkles className="h-3 w-3 mr-1" />
            Efficient
          </Badge>
          
          <CardContent className="p-4 sm:p-6 lg:p-8 relative">
            <div className="space-y-4 sm:space-y-5 lg:space-y-6">
              {/* Icon and Title */}
              <div className="flex items-start gap-3 sm:gap-4">
                <div className="p-3 sm:p-4 bg-gradient-to-br from-orange-500 to-amber-600 rounded-2xl shadow-lg">
                  <Users className="h-6 w-6 sm:h-7 sm:w-7 lg:h-8 lg:w-8 text-white" />
                </div>
                <div className="flex-1">
                  <h3 className="text-lg sm:text-xl font-bold text-foreground dark:text-gray-100 mb-1 sm:mb-2">
                    Multi-Candidate Interview
                  </h3>
                  <p className="text-xs sm:text-sm text-muted-foreground dark:text-gray-400">
                    Interview multiple candidates back-to-back in one session
                  </p>
                </div>
              </div>

              {/* Selection Input */}
              <div className="space-y-3 sm:space-y-4 bg-white/50 dark:bg-slate-800/50 p-3 sm:p-4 rounded-lg border border-orange-100">
                {/* Stage Selection */}
                <div className="space-y-2">
                  <Label htmlFor="multi-stage-select" className="text-xs sm:text-sm font-medium">
                    Select Interview Stage <span className="text-red-500">*</span>
                  </Label>
                  {loadingStages ? (
                    <div className="flex items-center gap-2 text-xs sm:text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading stages...
                    </div>
                  ) : stages.length === 0 ? (
                    <div className="flex items-center gap-2 text-xs sm:text-sm text-amber-600">
                      <AlertCircle className="h-4 w-4" />
                      No stages configured
                    </div>
                  ) : (
                    <Select value={selectedStage} onValueChange={setSelectedStage}>
                      <SelectTrigger id="multi-stage-select" className="h-11 sm:h-10">
                        <SelectValue placeholder="Choose an interview stage..." />
                      </SelectTrigger>
                      <SelectContent>
                        {stages.map(stage => (
                          <SelectItem key={stage._id} value={stage._id}>
                            {stage.name}
                            <span className="text-xs text-muted-foreground ml-2">({stage.type})</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>

                {/* Info */}
                <div className="flex items-start gap-2 text-xs text-muted-foreground bg-orange-50/50 dark:bg-orange-950/20 p-2 rounded">
                  <AlertCircle className="h-3 w-3 mt-0.5 flex-shrink-0" />
                  <span>You'll add multiple candidates in the next step</span>
                </div>
              </div>

              {/* Features */}
              <div className="space-y-2 sm:space-y-2.5 pl-1">
                <div className="flex items-center gap-2 text-xs sm:text-sm text-muted-foreground dark:text-gray-400">
                  <CheckCircle className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-green-600 flex-shrink-0" />
                  <span>Single meeting link for all</span>
                </div>
                <div className="flex items-center gap-2 text-xs sm:text-sm text-muted-foreground dark:text-gray-400">
                  <CheckCircle className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-green-600 flex-shrink-0" />
                  <span>AI notetaker with segmentation</span>
                </div>
                <div className="flex items-center gap-2 text-xs sm:text-sm text-muted-foreground dark:text-gray-400">
                  <CheckCircle className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-green-600 flex-shrink-0" />
                  <span>15-90 min slots per candidate</span>
                </div>
              </div>

              {/* CTA */}
              <div className="pt-3 sm:pt-4">
                <Button 
                  className="w-full h-12 sm:h-11 lg:h-10 bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-700 hover:to-amber-700 text-white shadow-lg text-sm sm:text-base"
                  disabled={!canStartMulti}
                  onClick={() => setSchedulerMode('multi')}
                >
                  {!canStartMulti ? (
                    <>
                      <AlertCircle className="h-4 w-4 sm:h-5 sm:w-5 mr-2" />
                      <span className="text-xs sm:text-sm">Select Stage First</span>
                    </>
                  ) : (
                    <>
                      <span>Get Started</span>
                      <ArrowLeft className="h-4 w-4 sm:h-5 sm:w-5 ml-2 rotate-180" />
                    </>
                  )}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Info Footer */}
      <div className="text-center text-xs sm:text-sm text-muted-foreground bg-muted/30 dark:bg-slate-900/50 rounded-lg p-3 sm:p-4 max-w-full sm:max-w-3xl mx-auto">
        <p>
          💡 <span className="font-medium">Tip:</span> Select the interview stage first, then choose your scheduling type. 
          Multi-candidate interviews use a shared meeting link with individual time slots - perfect for screening rounds!
        </p>
      </div>
      
      {/* No stages warning */}
      {!loadingStages && stages.length === 0 && (
        <div className="max-w-full sm:max-w-2xl mx-auto px-4 sm:px-0">
          <Card className="border-amber-200 bg-amber-50/50">
            <CardContent className="p-4 sm:p-6 text-center">
              <AlertCircle className="h-10 w-10 sm:h-12 sm:w-12 text-amber-600 mx-auto mb-3" />
              <h4 className="font-semibold text-amber-900 mb-2 text-sm sm:text-base">No Interview Stages Configured</h4>
              <p className="text-xs sm:text-sm text-amber-700 mb-4">
                You need to set up interview stages before you can schedule interviews.
              </p>
              <Button
                variant="outline"
                className="h-10 sm:h-9 bg-white border-amber-300 text-amber-700 hover:bg-amber-50 text-xs sm:text-sm"
                onClick={() => onInterviewScheduled?.()} // This will trigger navigation to stages tab
              >
                Configure Stages
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}


