"use client"

import React, { useState, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { useToast } from '@/components/ui/use-toast'
import { 
  Mail, 
  Users, 
  Send, 
  X,
  CheckCircle2,
  AlertTriangle,
  MessageSquare,
  Target,
  Zap,
  Clock,
  Filter,
  Layers,
  TrendingUp,
  BarChart3,
  FileText,
  Settings
} from 'lucide-react'
import candidateEmailService, { CandidateEmailData } from '@/services/candidateEmailService'

interface PipelineCandidate {
  _id: string
  firstName: string
  lastName: string
  email: string
  status?: string
  currentStage: {
    stageId: string
    stageName: string
  }
}

interface PipelineStage {
  _id: string
  name: string
  order: number
  candidates: PipelineCandidate[]
}

interface PipelineEmailControlsProps {
  stages: PipelineStage[]
  jobId: string
  jobTitle?: string
  onEmailSent?: () => void
}

type FilterOption = 'all' | 'stage' | string // 'all', 'stage', or specific stage ID

export function PipelineEmailControls({ 
  stages, 
  jobId, 
  jobTitle = 'Job',
  onEmailSent 
}: PipelineEmailControlsProps) {
  const { toast } = useToast()
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false)
  const [selectedCandidates, setSelectedCandidates] = useState<string[]>([])
  const [reason, setReason] = useState('')
  const [sending, setSending] = useState(false)
  const [filterBy, setFilterBy] = useState<FilterOption>('all')
  const [selectedStageId, setSelectedStageId] = useState<string>('')

  // Calculate statistics
  const totalCandidates = stages.reduce((sum, stage) => sum + stage.candidates.length, 0)
  const stageStats = stages.map(stage => ({
    ...stage,
    candidateCount: stage.candidates.length
  }))

  // Filter candidates based on selection (exclude rejected candidates)
  const filteredCandidates = useMemo(() => {
    let candidates: PipelineCandidate[] = [];
    if (filterBy === 'all') {
      candidates = stages.flatMap(stage => stage.candidates)
    } else if (filterBy === 'stage' && selectedStageId) {
      const stage = stages.find(s => s._id === selectedStageId)
      candidates = stage ? stage.candidates : []
    }
    // Filter out rejected candidates
    return candidates.filter(candidate => candidate.status !== 'rejected');
  }, [filterBy, selectedStageId, stages])

  const toggleCandidate = (candidateId: string) => {
    setSelectedCandidates(prev => 
      prev.includes(candidateId) 
        ? prev.filter(id => id !== candidateId)
        : [...prev, candidateId]
    )
  }

  const toggleAll = () => {
    setSelectedCandidates(prev => 
      prev.length === filteredCandidates.length ? [] : filteredCandidates.map(c => c._id)
    )
  }

  const sendBulkEmails = async () => {
    if (selectedCandidates.length === 0) {
      toast({
        title: "No candidates selected",
        description: "Please select at least one candidate to send rejection emails to.",
        variant: "destructive"
      })
      return
    }

    try {
      setSending(true)
      
      const emailData: CandidateEmailData[] = selectedCandidates.map(candidateId => {
        const candidate = filteredCandidates.find(c => c._id === candidateId)!
        return {
          candidateId,
          jobId,
          stage: candidate.currentStage?.stageName || 'Pipeline Review'
        }
      })

      const result = await candidateEmailService.sendBulkRejectionEmails(
        emailData, 
        reason || undefined,
        false // isShortlistRejection
      )

      toast({
        title: "Emails sent successfully",
        description: `${result.results.sent} rejection emails sent, ${result.results.failed} failed.`,
      })

      setBulkDialogOpen(false)
      onEmailSent?.()
      
      // Reset form
      setReason('')
      setSelectedCandidates([])

    } catch (error: any) {
      toast({
        title: "Failed to send emails",
        description: error.message,
        variant: "destructive"
      })
    } finally {
      setSending(false)
    }
  }

  const openBulkDialog = () => {
    if (filteredCandidates.length === 0) {
      toast({
        title: "No candidates available",
        description: "Please select a filter option to see available candidates.",
        variant: "destructive"
      })
      return
    }
    setSelectedCandidates(filteredCandidates.map(c => c._id)) // Pre-select all
    setBulkDialogOpen(true)
  }

  if (totalCandidates === 0) {
    return null
  }

  return (
    <>
      <Card className="border-0 bg-gradient-to-r from-orange-50 via-red-50 to-pink-50 dark:from-orange-950 dark:via-red-950 dark:to-pink-950 shadow-lg">
        <CardContent className="p-6">
          <div className="space-y-6">
            {/* Header Section */}
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <div className="flex items-center justify-center w-12 h-12 rounded-full bg-gradient-to-r from-orange-500 to-red-500 shadow-lg">
                  <Mail className="h-6 w-6 text-white" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                    Pipeline Email Management
                    <Badge variant="secondary" className="bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300">
                      {totalCandidates} total candidates
                    </Badge>
                  </h3>
                  <p className="text-sm text-muted-foreground dark:text-gray-400 mt-1">
                    Send targeted rejection emails to candidates in <span className="font-medium">{jobTitle}</span> pipeline
                  </p>
                </div>
              </div>
              
              <div className="hidden sm:flex items-center space-x-4 text-sm text-muted-foreground dark:text-gray-400">
                <div className="flex items-center gap-1">
                  <Layers className="h-4 w-4 text-blue-500" />
                  <span>Multi-Stage</span>
                </div>
                <div className="flex items-center gap-1">
                  <Target className="h-4 w-4 text-green-500" />
                  <span>Targeted</span>
                </div>
                <div className="flex items-center gap-1">
                  <BarChart3 className="h-4 w-4 text-purple-500" />
                  <span>Analytics Ready</span>
                </div>
              </div>
            </div>

            {/* Pipeline Statistics */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {stageStats.map((stage, index) => (
                <div 
                  key={stage._id}
                  className="glass-card bg-popover/40 dark:bg-card/30 rounded-lg p-3 border border-border/60 hover:shadow-lg transition-all duration-200"
                >
                  <div className="text-xs font-medium text-muted-foreground mb-1 truncate" title={stage.name}>
                    {stage.name}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-lg font-bold text-foreground">
                      {stage.candidateCount}
                    </span>
                    <div className={`h-2 w-2 rounded-full ${
                      stage.candidateCount > 0 ? 'bg-blue-500' : 'bg-gray-300'
                    }`} />
                  </div>
                </div>
              ))}
            </div>

            {/* Filter Controls */}
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-muted-foreground" />
                <Label className="text-sm font-medium">Filter Recipients</Label>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Filter Type */}
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground dark:text-gray-400">Scope</Label>
                  <Select value={filterBy} onValueChange={(value: FilterOption) => {
                    setFilterBy(value)
                    setSelectedCandidates([]) // Reset selection when filter changes
                  }}>
                    <SelectTrigger className="bg-background dark:bg-card/50 min-w-[200px]">
                      <SelectValue placeholder="Choose scope..." />
                    </SelectTrigger>
                    <SelectContent className="min-w-[250px]">
                      <SelectItem value="all">
                        <div className="flex items-center justify-between w-full min-w-[200px]">
                          <div className="flex items-center gap-2">
                            <Users className="h-4 w-4 text-blue-500" />
                            <span>All Pipeline Candidates</span>
                          </div>
                          <Badge variant="outline" className="text-xs flex-shrink-0">
                            {totalCandidates}
                          </Badge>
                        </div>
                      </SelectItem>
                      <SelectItem value="stage">
                        <div className="flex items-center gap-2">
                          <Layers className="h-4 w-4 text-green-500" />
                          <span>Specific Stage</span>
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Stage Selection */}
                {filterBy === 'stage' && (
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground dark:text-gray-400">Select Stage</Label>
                    <Select value={selectedStageId} onValueChange={(value) => {
                      setSelectedStageId(value)
                      setSelectedCandidates([]) // Reset selection when stage changes
                    }}>
                      <SelectTrigger className="bg-background dark:bg-card/50 min-w-[200px]">
                        <SelectValue placeholder="Choose a stage..." />
                      </SelectTrigger>
                      <SelectContent className="min-w-[280px]">
                        {stages.map((stage) => (
                          <SelectItem key={stage._id} value={stage._id}>
                            <div className="flex items-center justify-between w-full min-w-[240px]">
                              <span className="truncate flex-1">{stage.name}</span>
                              <Badge variant="outline" className="ml-3 text-xs flex-shrink-0">
                                {stage.candidates.length} candidates
                              </Badge>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* Action Button */}
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground dark:text-gray-400">Action</Label>
                  <Button 
                    onClick={openBulkDialog}
                    disabled={filteredCandidates.length === 0}
                    className="w-full bg-gradient-to-r from-orange-600 to-red-600 hover:from-orange-700 hover:to-red-700 text-white shadow-lg hover:shadow-xl transition-all duration-200"
                  >
                    <Send className="h-4 w-4 mr-2" />
                    Send Rejection Emails
                    {filteredCandidates.length > 0 && (
                      <Badge className="ml-2 bg-white/20 text-white border-white/30">
                        {filteredCandidates.length}
                      </Badge>
                    )}
                  </Button>
                </div>
              </div>

              {/* Current Selection Info */}
              {filteredCandidates.length > 0 && (
                <div className="bg-blue-50 dark:bg-blue-950/30 p-4 rounded-lg border border-blue-200 dark:border-blue-800">
                  <div className="flex items-start gap-2">
                    <TrendingUp className="h-4 w-4 text-blue-600 mt-0.5" />
                    <div className="text-sm text-blue-700 dark:text-blue-300">
                      <p className="font-medium mb-1">
                        Ready to send: {filteredCandidates.length} candidate{filteredCandidates.length !== 1 ? 's' : ''}
                      </p>
                      <p>
                        {filterBy === 'all' 
                          ? 'All pipeline candidates will receive rejection emails' 
                          : `Candidates in "${stages.find(s => s._id === selectedStageId)?.name}" stage will receive rejection emails`
                        }
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Bulk Email Dialog */}
      <Dialog open={bulkDialogOpen} onOpenChange={setBulkDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <MessageSquare className="h-5 w-5 text-orange-500" />
              Send Pipeline Rejection Emails
            </DialogTitle>
            <DialogDescription>
              Send personalized rejection emails to selected pipeline candidates for <strong>{jobTitle}</strong>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6">
            {/* Filter Summary */}
            <div className="glass-card bg-muted/30 dark:bg-card/30 rounded-lg p-4 border border-border/60">
              <div className="flex items-center gap-2 mb-2">
                <Settings className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium text-foreground">Email Scope</span>
              </div>
              <div className="text-sm text-muted-foreground">
                {filterBy === 'all' 
                  ? `All ${totalCandidates} pipeline candidates across ${stages.length} stages`
                  : `${filteredCandidates.length} candidates in "${stages.find(s => s._id === selectedStageId)?.name}" stage`
                }
              </div>
            </div>

            {/* Candidate Selection */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label className="text-base font-medium flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  Select Recipients ({selectedCandidates.length}/{filteredCandidates.length})
                </Label>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={toggleAll}
                  className="text-xs"
                >
                  {selectedCandidates.length === filteredCandidates.length ? 'Deselect All' : 'Select All'}
                </Button>
              </div>
              
              <div className="border border-border/60 rounded-lg glass-card bg-muted/30 dark:bg-card/30 max-h-64 overflow-y-auto">
                {filteredCandidates.map((candidate) => (
                  <div key={candidate._id} className="flex items-center space-x-3 p-3 hover:bg-muted/50 dark:hover:bg-card/40 transition-colors border-b border-border/60 last:border-b-0">
                    <Checkbox
                      id={candidate._id}
                      checked={selectedCandidates.includes(candidate._id)}
                      onCheckedChange={() => toggleCandidate(candidate._id)}
                    />
                    <div className="flex-1">
                      <label htmlFor={candidate._id} className="flex items-center justify-between cursor-pointer">
                        <div>
                          <span className="font-medium text-foreground">
                            {candidate.firstName} {candidate.lastName}
                          </span>
                          <span className="text-muted-foreground text-sm ml-2">({candidate.email})</span>
                        </div>
                        <Badge variant="outline" className="text-xs">
                          {candidate.currentStage?.stageName || 'Unknown Stage'}
                        </Badge>
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Rejection Message */}
            <div className="space-y-2">
              <Label htmlFor="rejection-reason" className="text-base font-medium flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Custom Rejection Message
              </Label>
              <Textarea
                id="rejection-reason"
                placeholder="Enter a personalized message for the candidates (optional). This will be included in the rejection email template..."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={4}
                className="resize-none"
              />
              <p className="text-xs text-muted-foreground">
                Leave empty to use the default rejection message template for each candidate's current stage.
              </p>
            </div>

            {/* Preview Info */}
            <div className="bg-orange-50 dark:bg-orange-950/30 p-4 rounded-lg border border-orange-200 dark:border-orange-800">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-orange-600 mt-0.5" />
                <div className="text-sm text-orange-700 dark:text-orange-300">
                  <p className="font-medium mb-1">Email Preview:</p>
                  <p>Each selected candidate will receive a personalized rejection email including:</p>
                  <ul className="list-disc list-inside mt-2 space-y-1 text-xs">
                    <li>Professional rejection notice for their current pipeline stage</li>
                    <li>Job title: {jobTitle}</li>
                    <li>Your custom message (if provided)</li>
                    <li>Encouragement for future applications</li>
                    <li>Company branding and contact information</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button 
              variant="outline" 
              onClick={() => setBulkDialogOpen(false)}
              disabled={sending}
            >
              Cancel
            </Button>
            <Button 
              onClick={sendBulkEmails}
              disabled={sending || selectedCandidates.length === 0}
              className="bg-gradient-to-r from-orange-600 to-red-600 hover:from-orange-700 hover:to-red-700 text-white"
            >
              {sending ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  Sending {selectedCandidates.length} email{selectedCandidates.length !== 1 ? 's' : ''}...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-2" />
                  Send {selectedCandidates.length} Rejection Email{selectedCandidates.length !== 1 ? 's' : ''}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
