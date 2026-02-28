"use client"

import React, { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/use-toast'
import {
  AlertTriangle,
  Mail,
  MessageSquare,
  Search,
  Send,
  Users,
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

type FilterOption = 'all' | 'stage'
type DialogMode = 'all' | 'manual'

export function PipelineEmailControls({
  stages,
  jobId,
  jobTitle = 'Job',
  onEmailSent,
}: PipelineEmailControlsProps) {
  const { toast } = useToast()
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false)
  const [selectedCandidates, setSelectedCandidates] = useState<string[]>([])
  const [reason, setReason] = useState('')
  const [sending, setSending] = useState(false)
  const [filterBy, setFilterBy] = useState<FilterOption>('all')
  const [selectedStageId, setSelectedStageId] = useState<string>('')
  const [dialogMode, setDialogMode] = useState<DialogMode>('manual')
  const [candidateSearch, setCandidateSearch] = useState('')

  const totalCandidates = stages.reduce((sum, stage) => sum + stage.candidates.length, 0)
  const stageStats = stages.map((stage) => ({
    ...stage,
    candidateCount: stage.candidates.length,
  }))

  const filteredCandidates = useMemo(() => {
    let scopedCandidates: PipelineCandidate[] = []

    if (filterBy === 'all') {
      scopedCandidates = stages.flatMap((stage) => stage.candidates)
    } else if (selectedStageId) {
      const stage = stages.find((item) => item._id === selectedStageId)
      scopedCandidates = stage ? stage.candidates : []
    }

    return scopedCandidates.filter((candidate) => candidate.status !== 'rejected')
  }, [filterBy, selectedStageId, stages])

  const candidateMap = useMemo(
    () => new Map(filteredCandidates.map((candidate) => [candidate._id, candidate])),
    [filteredCandidates]
  )

  const filteredCandidateIds = useMemo(
    () => filteredCandidates.map((candidate) => candidate._id),
    [filteredCandidates]
  )

  const scopeLabel = useMemo(() => {
    if (filterBy === 'stage') {
      const stage = stages.find((item) => item._id === selectedStageId)
      return stage ? `Stage: ${stage.name}` : 'Stage scope'
    }

    return `Entire pipeline (${stages.length} stages)`
  }, [filterBy, selectedStageId, stages])

  const visibleCandidates = useMemo(() => {
    const search = candidateSearch.trim().toLowerCase()
    if (!search) {
      return filteredCandidates
    }

    return filteredCandidates.filter((candidate) => {
      const candidateText = `${candidate.firstName} ${candidate.lastName} ${candidate.email} ${candidate.currentStage?.stageName || ''}`.toLowerCase()
      return candidateText.includes(search)
    })
  }, [candidateSearch, filteredCandidates])

  useEffect(() => {
    setSelectedCandidates((prev) => prev.filter((candidateId) => candidateMap.has(candidateId)))
  }, [candidateMap])

  const applyDialogMode = (mode: DialogMode) => {
    setDialogMode(mode)

    if (mode === 'all') {
      setSelectedCandidates([...filteredCandidateIds])
    }
  }

  const openBulkDialog = (mode: DialogMode) => {
    if (filteredCandidates.length === 0) {
      toast({
        title: 'No candidates in scope',
        description: 'Adjust the scope to include candidates before opening rejection center.',
        variant: 'destructive',
      })
      return
    }

    setReason('')
    setCandidateSearch('')
    setDialogMode(mode)
    setSelectedCandidates(mode === 'all' ? [...filteredCandidateIds] : [])
    setBulkDialogOpen(true)
  }

  const toggleCandidate = (candidateId: string) => {
    setSelectedCandidates((prev) =>
      prev.includes(candidateId)
        ? prev.filter((id) => id !== candidateId)
        : [...prev, candidateId]
    )
  }

  const toggleAll = () => {
    setSelectedCandidates((prev) =>
      prev.length === filteredCandidates.length ? [] : [...filteredCandidateIds]
    )
  }

  const sendBulkEmails = async () => {
    if (selectedCandidates.length === 0) {
      toast({
        title: 'No candidates selected',
        description: 'Select at least one candidate to send rejection emails.',
        variant: 'destructive',
      })
      return
    }

    try {
      setSending(true)

      const selectedCandidateRecords = selectedCandidates
        .map((candidateId) => candidateMap.get(candidateId))
        .filter((candidate): candidate is PipelineCandidate => Boolean(candidate))

      const emailData: CandidateEmailData[] = selectedCandidateRecords.map((candidate) => ({
        candidateId: candidate._id,
        jobId,
        stage: candidate.currentStage?.stageName || 'Pipeline Review',
      }))

      const result = await candidateEmailService.sendBulkRejectionEmails(
        emailData,
        reason.trim() || undefined,
        false
      )

      let description = `${result.results.sent} rejection emails sent, ${result.results.failed} failed.`
      if (result.skippedCandidates && result.skippedCandidates.length > 0) {
        description += ` ${result.skippedCandidates.length} candidate(s) skipped.`
      }

      toast({
        title: 'Pipeline rejections sent',
        description,
      })

      setBulkDialogOpen(false)
      setReason('')
      setCandidateSearch('')
      setSelectedCandidates([])
      setDialogMode('manual')
      onEmailSent?.()
    } catch (error: any) {
      toast({
        title: 'Failed to send emails',
        description: error.message,
        variant: 'destructive',
      })
    } finally {
      setSending(false)
    }
  }

  if (totalCandidates === 0) {
    return null
  }

  return (
    <>
      <Card className="border border-orange-200/70 bg-gradient-to-r from-orange-50 via-red-50 to-rose-50 shadow-sm dark:border-orange-800/40 dark:from-orange-950/50 dark:via-red-950/40 dark:to-rose-950/40">
        <CardContent className="p-4 sm:p-6">
          <div className="space-y-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                    <Mail className="h-4 w-4 text-orange-500" />
                    Pipeline Rejection Center
                  </h3>
                  <Badge variant="secondary" className="bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200">
                    {totalCandidates} total
                  </Badge>
                  <Badge variant="outline" className="border-blue-200 text-blue-700 dark:border-blue-700 dark:text-blue-300">
                    {filteredCandidates.length} in scope
                  </Badge>
                </div>
                <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                  Pick a scope, reject all candidates in that scope, or choose specific candidates before sending.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-2">
                <Label className="text-xs text-gray-600 dark:text-gray-400">Scope</Label>
                <Select
                  value={filterBy}
                  onValueChange={(value: FilterOption) => {
                    setFilterBy(value)
                    setSelectedCandidates([])
                  }}
                >
                  <SelectTrigger className="bg-white dark:bg-gray-900">
                    <SelectValue placeholder="Choose scope..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Entire Pipeline</SelectItem>
                    <SelectItem value="stage">Single Stage</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {filterBy === 'stage' ? (
                <div className="space-y-2">
                  <Label className="text-xs text-gray-600 dark:text-gray-400">Stage</Label>
                  <Select
                    value={selectedStageId}
                    onValueChange={(value) => {
                      setSelectedStageId(value)
                      setSelectedCandidates([])
                    }}
                  >
                    <SelectTrigger className="bg-white dark:bg-gray-900">
                      <SelectValue placeholder="Choose stage..." />
                    </SelectTrigger>
                    <SelectContent>
                      {stageStats.map((stage) => (
                        <SelectItem key={stage._id} value={stage._id}>
                          {stage.name} ({stage.candidateCount})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label className="text-xs text-gray-600 dark:text-gray-400">Current Scope</Label>
                  <div className="h-10 rounded-md border border-gray-200 bg-white px-3 text-sm text-gray-700 flex items-center dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200">
                    {scopeLabel}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label className="text-xs text-gray-600 dark:text-gray-400">Scope Summary</Label>
                <div className="h-10 rounded-md border border-blue-200 bg-blue-50 px-3 text-sm text-blue-700 flex items-center dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-200">
                  {filteredCandidates.length} candidate{filteredCandidates.length !== 1 ? 's' : ''} ready
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Button
                type="button"
                onClick={() => openBulkDialog('all')}
                disabled={filteredCandidates.length === 0}
                className="justify-start bg-gradient-to-r from-orange-600 to-red-600 text-white hover:from-orange-700 hover:to-red-700"
              >
                <Send className="h-4 w-4 mr-2" />
                Reject All In Scope ({filteredCandidates.length})
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => openBulkDialog('manual')}
                disabled={filteredCandidates.length === 0}
                className="justify-start border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-slate-900 dark:text-gray-200"
              >
                <Users className="h-4 w-4 mr-2" />
                Choose Candidates
              </Button>
            </div>

            <div className="rounded-lg border border-amber-200 bg-amber-50/80 p-3 text-xs text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-200">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                <p>
                  Rejection emails are sent immediately, and selected candidates are marked as rejected.
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={bulkDialogOpen} onOpenChange={setBulkDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <MessageSquare className="h-5 w-5 text-orange-500" />
              Pipeline Rejection Center
            </DialogTitle>
            <DialogDescription>
              Send rejection emails for <strong>{jobTitle}</strong>. Current scope: <strong>{scopeLabel}</strong>.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6">
            <div className="space-y-3">
              <Label className="text-sm font-medium">Quick Scope</Label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Button
                  type="button"
                  variant={dialogMode === 'all' ? 'default' : 'outline'}
                  onClick={() => applyDialogMode('all')}
                  className={dialogMode === 'all' ? 'bg-red-600 hover:bg-red-700' : ''}
                >
                  Reject All In Scope ({filteredCandidates.length})
                </Button>
                <Button
                  type="button"
                  variant={dialogMode === 'manual' ? 'default' : 'outline'}
                  onClick={() => setDialogMode('manual')}
                  className={dialogMode === 'manual' ? 'bg-gray-800 hover:bg-gray-900 dark:bg-gray-700 dark:hover:bg-gray-600' : ''}
                >
                  Manual Selection
                </Button>
              </div>
            </div>

            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-200">
              <p className="font-medium">
                {selectedCandidates.length} recipient{selectedCandidates.length !== 1 ? 's' : ''} selected
              </p>
              <p className="text-xs mt-1">
                {dialogMode === 'all'
                  ? 'Every candidate in the current scope will receive a rejection email.'
                  : 'Pick specific candidates in this scope before sending emails.'
                }
              </p>
            </div>

            <div className="space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <Label className="text-base font-medium flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  Select Recipients ({selectedCandidates.length}/{filteredCandidates.length})
                </Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={toggleAll}
                    className="text-xs"
                  >
                    {selectedCandidates.length === filteredCandidates.length ? 'Clear All' : 'Select All'}
                  </Button>
                </div>
              </div>

              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  value={candidateSearch}
                  onChange={(event) => setCandidateSearch(event.target.value)}
                  placeholder="Search by name, email, or stage..."
                  className="pl-9"
                />
              </div>

              <div className="border rounded-lg bg-gray-50 dark:bg-gray-900 max-h-72 overflow-y-auto">
                {visibleCandidates.length === 0 ? (
                  <div className="p-4 text-sm text-gray-500 dark:text-gray-400">
                    No candidates match this search.
                  </div>
                ) : (
                  visibleCandidates.map((candidate) => (
                    <div
                      key={candidate._id}
                      className="flex items-center space-x-3 p-3 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors border-b border-gray-200 dark:border-gray-700 last:border-b-0"
                    >
                      <Checkbox
                        id={candidate._id}
                        checked={selectedCandidates.includes(candidate._id)}
                        onCheckedChange={() => toggleCandidate(candidate._id)}
                      />
                      <div className="flex-1">
                        <label htmlFor={candidate._id} className="flex items-center justify-between cursor-pointer">
                          <div className="min-w-0">
                            <span className="font-medium text-gray-900 dark:text-gray-100">
                              {candidate.firstName} {candidate.lastName}
                            </span>
                            <span className="text-gray-500 text-sm ml-2">({candidate.email})</span>
                          </div>
                          <Badge variant="outline" className="text-xs ml-2">
                            {candidate.currentStage?.stageName || 'Unknown Stage'}
                          </Badge>
                        </label>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="rejection-reason" className="text-base font-medium flex items-center gap-2">
                <Mail className="h-4 w-4" />
                Custom Rejection Message
              </Label>
              <Textarea
                id="rejection-reason"
                placeholder="Optional personalized message for these candidates..."
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={4}
                className="resize-none"
              />
              <p className="text-xs text-gray-500">
                Leave empty to use the default rejection template for each candidate&apos;s stage.
              </p>
            </div>

            <div className="bg-orange-50 dark:bg-orange-950/30 p-4 rounded-lg border border-orange-200 dark:border-orange-800">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-orange-600 mt-0.5" />
                <div className="text-sm text-orange-700 dark:text-orange-300">
                  <p className="font-medium mb-1">Before sending</p>
                  <p>
                    Review recipients carefully. This action sends emails immediately and moves candidates to rejected status.
                  </p>
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
