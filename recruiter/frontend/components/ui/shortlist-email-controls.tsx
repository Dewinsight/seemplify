"use client"

import React, { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
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
  Clock
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
  onEmailSent?: () => void
}

export function ShortlistEmailControls({ 
  candidates, 
  jobId, 
  jobTitle = 'Job',
  onEmailSent 
}: ShortlistEmailControlsProps) {
  const { toast } = useToast()
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false)
  const [selectedCandidates, setSelectedCandidates] = useState<string[]>([])
  const [reason, setReason] = useState('')
  const [sending, setSending] = useState(false)

  // Filter out rejected candidates
  const availableCandidates = candidates.filter(c => c.status !== 'rejected')

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
      
      const emailData: CandidateEmailData[] = selectedCandidates.map(candidateId => {
        const candidate = availableCandidates.find(c => c._id === candidateId)!
        return {
          candidateId,
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

  const openBulkDialog = () => {
    setSelectedCandidates(availableCandidates.map(c => c._id)) // Pre-select all
    setBulkDialogOpen(true)
  }

  return (
    <>
      <Card className="border-0 bg-gradient-to-r from-red-50 via-orange-50 to-yellow-50 dark:from-red-950 dark:via-orange-950 dark:to-yellow-950 shadow-lg">
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="flex items-center justify-center w-12 h-12 rounded-full bg-gradient-to-r from-red-500 to-orange-500 shadow-lg">
                <Mail className="h-6 w-6 text-white" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                  Shortlist Email Management
                  <Badge variant="secondary" className="bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300">
                    {availableCandidates.length} candidates
                  </Badge>
                </h3>
                <p className="text-sm text-muted-foreground dark:text-muted-foreground/70 mt-1">
                  Send personalized rejection emails to shortlisted candidates for <span className="font-medium">{jobTitle}</span>
                </p>
              </div>
            </div>
            
            <div className="flex items-center space-x-3">
              <div className="hidden sm:flex items-center space-x-4 text-sm text-muted-foreground dark:text-muted-foreground/70">
                <div className="flex items-center gap-1">
                  <Target className="h-4 w-4 text-blue-500" />
                  <span>Targeted</span>
                </div>
                <div className="flex items-center gap-1">
                  <Zap className="h-4 w-4 text-yellow-500" />
                  <span>Personalized</span>
                </div>
                <div className="flex items-center gap-1">
                  <Clock className="h-4 w-4 text-green-500" />
                  <span>Instant</span>
                </div>
              </div>
              
              <Separator orientation="vertical" className="h-8 hidden sm:block" />
              
              <Button 
                onClick={openBulkDialog}
                className="bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-700 hover:to-orange-700 text-white shadow-lg hover:shadow-xl transition-all duration-200 transform hover:scale-105"
                size="lg"
              >
                <Users className="h-4 w-4 mr-2" />
                Send Bulk Rejections
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Bulk Email Dialog */}
      <Dialog open={bulkDialogOpen} onOpenChange={setBulkDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <MessageSquare className="h-5 w-5 text-red-500" />
              Send Shortlist Rejection Emails
            </DialogTitle>
            <DialogDescription>
              Send personalized rejection emails to selected shortlisted candidates for <strong>{jobTitle}</strong>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6">
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
                          <span className="text-muted-foreground text-sm ml-2">({candidate.email})</span>
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
              <p className="text-xs text-muted-foreground">
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
