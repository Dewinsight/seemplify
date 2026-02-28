"use client"

import React, { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/use-toast'
import { 
  AlertTriangle,
  ListChecks,
  Mail, 
  MessageSquare,
  Users, 
  Send, 
} from 'lucide-react'
import candidateEmailService, { CandidateEmailData } from '@/services/candidateEmailService'

interface ShortlistCandidate {
  _id: string
  firstName: string
  lastName: string
  email: string
  status: string
}

interface ShortlistEmailControlsProps {
  candidates: ShortlistCandidate[]
  jobId: string
  jobTitle?: string
  preselectedCandidateIds?: string[]
  onEmailSent?: () => void
}

type DialogMode = 'selected' | 'all' | 'manual'

export function ShortlistEmailControls({ 
  candidates, 
  jobId, 
  jobTitle = 'Job',
  preselectedCandidateIds = [],
  onEmailSent 
}: ShortlistEmailControlsProps) {
  const { toast } = useToast()
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false)
  const [selectedCandidates, setSelectedCandidates] = useState<string[]>([])
  const [reason, setReason] = useState('')
  const [sending, setSending] = useState(false)
  const [dialogMode, setDialogMode] = useState<DialogMode>('manual')

  const availableCandidates = useMemo(
    () => candidates.filter((candidate) => candidate.status !== 'rejected'),
    [candidates]
  )

  const candidateMap = useMemo(
    () => new Map(availableCandidates.map((candidate) => [candidate._id, candidate])),
    [availableCandidates]
  )

  const eligibleCandidateIds = useMemo(
    () => availableCandidates.map((candidate) => candidate._id),
    [availableCandidates]
  )

  const shortlistSelectedEligibleIds = useMemo(
    () => preselectedCandidateIds.filter((candidateId) => candidateMap.has(candidateId)),
    [candidateMap, preselectedCandidateIds]
  )

  useEffect(() => {
    setSelectedCandidates((prev) => prev.filter((candidateId) => candidateMap.has(candidateId)))
  }, [candidateMap])

  const applyDialogMode = (mode: DialogMode) => {
    setDialogMode(mode)

    if (mode === 'selected') {
      setSelectedCandidates([...shortlistSelectedEligibleIds])
      return
    }

    if (mode === 'all') {
      setSelectedCandidates([...eligibleCandidateIds])
      return
    }
  }

  const openBulkDialog = (mode: DialogMode) => {
    if (availableCandidates.length === 0) {
      return
    }

    setReason('')

    if (mode === 'manual') {
      setDialogMode('manual')
      setSelectedCandidates([...shortlistSelectedEligibleIds])
    } else {
      applyDialogMode(mode)
    }

    setBulkDialogOpen(true)
  }

  const toggleCandidate = (candidateId: string) => {
    setSelectedCandidates(prev => 
      prev.includes(candidateId) 
        ? prev.filter(id => id !== candidateId)
        : [...prev, candidateId]
    )
  }

  const toggleAll = () => {
    setSelectedCandidates(prev => 
      prev.length === availableCandidates.length ? [] : availableCandidates.map(c => c._id)
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
      
      const selectedCandidateRecords = selectedCandidates
        .map((candidateId) => candidateMap.get(candidateId))
        .filter((candidate): candidate is ShortlistCandidate => Boolean(candidate))

      const emailData: CandidateEmailData[] = selectedCandidateRecords.map(candidate => {
        return {
          candidateId: candidate._id,
          jobId,
          stage: 'Shortlist Review'
        }
      })

      const result = await candidateEmailService.sendBulkRejectionEmails(
        emailData, 
        reason || undefined,
        true // isShortlistRejection
      )

      let description = `${result.results.sent} rejection emails sent, ${result.results.failed} failed.`
      
      // If some candidates were skipped (already in pipeline)
      if (result.skippedCandidates && result.skippedCandidates.length > 0) {
        description += ` ${result.skippedCandidates.length} candidate(s) skipped (already in pipeline).`
      }

      toast({
        title: "Emails sent successfully",
        description,
      })

      setBulkDialogOpen(false)
      onEmailSent?.()
      
      // Reset form
      setReason('')
      setSelectedCandidates([])
      setDialogMode('manual')

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

  if (availableCandidates.length === 0) {
    return null
  }

  return (
    <>
      <Card className="border border-orange-200/70 bg-gradient-to-r from-orange-50 via-red-50 to-rose-50 shadow-sm dark:border-orange-800/40 dark:from-orange-950/50 dark:via-red-950/40 dark:to-rose-950/40">
        <CardContent className="p-4 sm:p-5">
          <div className="space-y-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                    <Mail className="h-4 w-4 text-red-500" />
                    Shortlist Rejection Center
                  </h3>
                  <Badge variant="secondary" className="bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200">
                    {availableCandidates.length} eligible
                  </Badge>
                  <Badge variant="outline" className="border-blue-200 text-blue-700 dark:border-blue-700 dark:text-blue-300">
                    {shortlistSelectedEligibleIds.length} selected on shortlist
                  </Badge>
                </div>
                <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                  Reject selected candidates, reject every eligible candidate, or choose a custom set before sending emails.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => openBulkDialog('selected')}
                disabled={shortlistSelectedEligibleIds.length === 0}
                className="justify-start border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 hover:text-blue-800 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-200"
              >
                <ListChecks className="h-4 w-4 mr-2" />
                Reject Selected ({shortlistSelectedEligibleIds.length})
              </Button>
              <Button
                type="button"
                onClick={() => openBulkDialog('all')}
                className="justify-start bg-gradient-to-r from-red-600 to-orange-600 text-white hover:from-red-700 hover:to-orange-700"
              >
                <Mail className="h-4 w-4 text-white" />
                <span className="ml-2">Reject All Eligible ({availableCandidates.length})</span>
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => openBulkDialog('manual')}
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
                  Rejection emails are sent immediately and shortlisted candidates are updated to rejected after delivery.
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Bulk Email Dialog */}
      <Dialog open={bulkDialogOpen} onOpenChange={setBulkDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <MessageSquare className="h-5 w-5 text-red-500" />
              Shortlist Rejection Center
            </DialogTitle>
            <DialogDescription>
              Select who to reject from <strong>{jobTitle}</strong> and send personalized shortlist rejection emails.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6">
            <div className="space-y-3">
              <Label className="text-sm font-medium">Quick Scope</Label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <Button
                  type="button"
                  variant={dialogMode === 'selected' ? 'default' : 'outline'}
                  onClick={() => applyDialogMode('selected')}
                  disabled={shortlistSelectedEligibleIds.length === 0}
                  className={dialogMode === 'selected' ? 'bg-blue-600 hover:bg-blue-700' : ''}
                >
                  Selected ({shortlistSelectedEligibleIds.length})
                </Button>
                <Button
                  type="button"
                  variant={dialogMode === 'all' ? 'default' : 'outline'}
                  onClick={() => applyDialogMode('all')}
                  className={dialogMode === 'all' ? 'bg-red-600 hover:bg-red-700' : ''}
                >
                  All Eligible ({availableCandidates.length})
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
                  ? 'Every eligible shortlisted candidate will receive a rejection email.'
                  : dialogMode === 'selected'
                    ? 'Only candidates currently selected in the shortlist view will receive emails.'
                    : 'Pick exactly which shortlisted candidates should receive rejection emails.'
                }
              </p>
            </div>

            {/* Candidate Selection */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label className="text-base font-medium flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  Select Candidates ({selectedCandidates.length}/{availableCandidates.length})
                </Label>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={toggleAll}
                  className="text-xs"
                >
                  {selectedCandidates.length === availableCandidates.length ? 'Deselect All' : 'Select All'}
                </Button>
              </div>
              
              <div className="border rounded-lg bg-gray-50 dark:bg-gray-900 max-h-48 overflow-y-auto">
                {availableCandidates.map((candidate) => (
                  <div key={candidate._id} className="flex items-center space-x-3 p-3 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                    <Checkbox
                      id={candidate._id}
                      checked={selectedCandidates.includes(candidate._id)}
                      onCheckedChange={() => toggleCandidate(candidate._id)}
                    />
                    <div className="flex-1">
                      <label htmlFor={candidate._id} className="flex items-center justify-between cursor-pointer">
                        <div>
                          <span className="font-medium text-gray-900 dark:text-gray-100">
                            {candidate.firstName} {candidate.lastName}
                          </span>
                          <span className="text-gray-500 text-sm ml-2">({candidate.email})</span>
                        </div>
                        <Badge variant="outline" className="text-xs">
                          Shortlisted
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
                <MessageSquare className="h-4 w-4" />
                Rejection Message
              </Label>
              <Textarea
                id="rejection-reason"
                placeholder="Enter a personalized message for the candidates (optional). This will be included in the rejection email template..."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={4}
                className="resize-none"
              />
              <p className="text-xs text-gray-500">
                Leave empty to use the default rejection message template.
              </p>
            </div>

            {/* Preview Info */}
            <div className="bg-blue-50 dark:bg-blue-950 p-4 rounded-lg border border-blue-200 dark:border-blue-800">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-blue-600 mt-0.5" />
                <div className="text-sm text-blue-700 dark:text-blue-300">
                  <p className="font-medium mb-1">Email Preview:</p>
                  <p>Each candidate will receive a personalized rejection email including:</p>
                  <ul className="list-disc list-inside mt-2 space-y-1 text-xs">
                    <li>Professional rejection notice</li>
                    <li>Job title: {jobTitle}</li>
                    <li>Your custom message (if provided)</li>
                    <li>Encouragement for future applications</li>
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
              className="bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-700 hover:to-orange-700 text-white"
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
