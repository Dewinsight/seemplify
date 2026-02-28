"use client"

import React, { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/use-toast'
import { 
  Mail, 
  Users, 
  Loader2, 
  AlertCircle, 
  Send, 
  X,
  CheckCircle2,
  Settings
} from 'lucide-react'
import candidateEmailService, { CandidateEmailData } from '../../services/candidateEmailService'

const PIPELINE_DEFAULT_MESSAGE =
  "Thank you for your interest in this position. After careful consideration, we've decided to move forward with other candidates whose experience more closely aligns with our current needs."

const SHORTLIST_DEFAULT_MESSAGE =
  "Thank you for your application. While your qualifications are impressive, we've selected other candidates whose experience more closely matches our specific requirements."

interface PipelineCandidate {
  _id: string
  firstName: string
  lastName: string
  email: string
  currentStage?: {
    stageName: string
  }
  status: string
}

interface CandidateRejectionEmailControlsProps {
  candidates: PipelineCandidate[]
  jobId: string
  onEmailSent?: () => void
}

interface BulkEmailDialogProps {
  candidates: PipelineCandidate[]
  jobId: string
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  onEmailSent?: () => void
  isShortlistRejection?: boolean
}

function BulkEmailDialog({ 
  candidates, 
  jobId, 
  isOpen, 
  onOpenChange, 
  onEmailSent,
  isShortlistRejection = false
}: BulkEmailDialogProps) {
  const { toast } = useToast()
  const defaultReason = useMemo(
    () => (isShortlistRejection ? SHORTLIST_DEFAULT_MESSAGE : PIPELINE_DEFAULT_MESSAGE),
    [isShortlistRejection]
  )
  const [selectedCandidates, setSelectedCandidates] = useState<string[]>(candidates.map(c => c._id))
  const [reason, setReason] = useState(defaultReason)
  const [sending, setSending] = useState(false)

  useEffect(() => {
    if (isOpen) {
      setReason(defaultReason)
      setSelectedCandidates(candidates.map(c => c._id))
    }
  }, [isOpen, defaultReason, candidates])

  const toggleCandidate = (candidateId: string) => {
    setSelectedCandidates(prev => 
      prev.includes(candidateId) 
        ? prev.filter(id => id !== candidateId)
        : [...prev, candidateId]
    )
  }

  const toggleAll = () => {
    setSelectedCandidates(prev => 
      prev.length === candidates.length ? [] : candidates.map(c => c._id)
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
        const candidate = candidates.find(c => c._id === candidateId)!
        return {
          candidateId,
          jobId,
          stage: candidate.currentStage?.stageName || 'Application Review'
        }
      })

      const trimmedReason = reason.trim()
      const result = await candidateEmailService.sendBulkRejectionEmails(
        emailData, 
        trimmedReason.length > 0 ? trimmedReason : undefined,
        isShortlistRejection
      )

      toast({
        title: "🚫 Bulk Rejection Complete",
        description: `${result.results.sent} candidates rejected and notified. ${result.results.failed > 0 ? `${result.results.failed} failed.` : 'All emails sent successfully.'}`,
        variant: result.results.failed > 0 ? "destructive" : "default",
      })

      onOpenChange(false)
      onEmailSent?.()
      
      // Reset form
      setReason(defaultReason)
      setSelectedCandidates(candidates.map(c => c._id))

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

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl max-h-[80vh] overflow-y-auto"
        onPointerDownCapture={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5" />
              Send {isShortlistRejection ? 'Shortlist' : 'Pipeline'} Rejection Emails
            </DialogTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                window.dispatchEvent(new Event('openEmailSettings'))
                onOpenChange(false)
              }}
              className="h-8"
            >
              <Settings className="h-4 w-4 mr-1" />
              Email Settings
            </Button>
          </div>
          <DialogDescription>
            Send professional rejection emails to selected candidates. 
            {isShortlistRejection ? ' These candidates will be notified they were not selected from the shortlist.' : ' These candidates will be notified they did not advance in the hiring process.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Email Template Info */}
          <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
            <div className="flex items-start gap-2 text-sm">
              <Mail className="h-4 w-4 text-blue-600 mt-0.5" />
              <div>
                <div className="font-medium text-blue-900 dark:text-blue-200">
                  Using {isShortlistRejection ? 'Shortlist Rejection' : 'Pipeline Rejection'} Template
                </div>
                <div className="text-xs text-blue-700 dark:text-blue-300 mt-1">
                  Your custom message will be included in the email. 
                  <button
                    onClick={() => {
                      window.dispatchEvent(new Event('openEmailSettings'))
                      onOpenChange(false)
                    }}
                    className="underline ml-1 hover:text-blue-900"
                  >
                    Edit full template
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Candidate Selection */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Select Candidates ({selectedCandidates.length}/{candidates.length})</Label>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={toggleAll}
              >
                {selectedCandidates.length === candidates.length ? 'Deselect All' : 'Select All'}
              </Button>
            </div>
            
            <div className="border rounded-lg p-3 space-y-2 max-h-48 overflow-y-auto">
              {candidates.map((candidate) => (
                <div key={candidate._id} className="flex items-center space-x-2">
                  <Checkbox
                    id={candidate._id}
                    checked={selectedCandidates.includes(candidate._id)}
                    onCheckedChange={() => toggleCandidate(candidate._id)}
                  />
                  <label htmlFor={candidate._id} className="flex-1 text-sm cursor-pointer">
                    <span className="font-medium">{candidate.firstName} {candidate.lastName}</span>
                    <span className="text-gray-500 ml-2">({candidate.email})</span>
                    {candidate.currentStage?.stageName && (
                      <Badge variant="outline" className="ml-2 text-xs">
                        {candidate.currentStage.stageName}
                      </Badge>
                    )}
                  </label>
                </div>
              ))}
            </div>
          </div>

          {/* Rejection Reason */}
          <div className="space-y-2">
            <Label htmlFor="reason">Rejection Reason (Optional)</Label>
            <Textarea
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={4}
            />
            <p className="text-xs text-gray-500">
              This message will be included in the email as feedback. Customize or clear it before sending.
            </p>
          </div>

          {/* Warning */}
          <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-amber-800">This action cannot be undone</p>
              <p className="text-amber-700">
                Rejection emails will be sent immediately to {selectedCandidates.length} candidate(s). 
                Make sure you've reviewed the recipient list and message carefully.
              </p>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={sendBulkEmails} disabled={sending || selectedCandidates.length === 0}>
            {sending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Sending...
              </>
            ) : (
              <>
                <Send className="h-4 w-4 mr-2" />
                Send {selectedCandidates.length} Email{selectedCandidates.length !== 1 ? 's' : ''}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface SingleEmailDialogProps {
  candidate: PipelineCandidate
  jobId: string
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  onEmailSent?: () => void
  isShortlistRejection?: boolean
}

function SingleEmailDialog({ 
  candidate, 
  jobId, 
  isOpen, 
  onOpenChange, 
  onEmailSent,
  isShortlistRejection = false
}: SingleEmailDialogProps) {
  const { toast } = useToast()
  const defaultReason = useMemo(
    () => (isShortlistRejection ? SHORTLIST_DEFAULT_MESSAGE : PIPELINE_DEFAULT_MESSAGE),
    [isShortlistRejection]
  )
  const [reason, setReason] = useState(defaultReason)
  const [sending, setSending] = useState(false)

  useEffect(() => {
    if (isOpen) {
      setReason(defaultReason)
    }
  }, [isOpen, defaultReason])

  const sendEmail = async () => {
    try {
      setSending(true)
      
      const trimmedReason = reason.trim()
      
      console.log('🔍 FRONTEND - Sending rejection email:', {
        candidateId: candidate._id,
        candidateEmail: candidate.email,
        jobId,
        reasonText: trimmedReason,
        reasonLength: trimmedReason.length,
        isShortlistRejection,
        stage: candidate.currentStage?.stageName || 'Application Review'
      })
      
      await candidateEmailService.sendRejectionEmail(
        candidate._id,
        jobId,
        trimmedReason.length > 0 ? trimmedReason : undefined,
        candidate.currentStage?.stageName || 'Application Review',
        isShortlistRejection
      )

      toast({
        title: "✅ Candidate Rejected Successfully",
        description: `${candidate.firstName} ${candidate.lastName} has been rejected and notified via email`,
        variant: "default",
      })

      onOpenChange(false)
      onEmailSent?.()
      setReason(defaultReason)

    } catch (error: any) {
      toast({
        title: "Failed to send email",
        description: error.message,
        variant: "destructive"
      })
    } finally {
      setSending(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent
        onPointerDownCapture={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5" />
              Send Rejection Email
            </DialogTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                window.dispatchEvent(new Event('openEmailSettings'))
                onOpenChange(false)
              }}
              className="h-8"
            >
              <Settings className="h-4 w-4 mr-1" />
              Email Settings
            </Button>
          </div>
          <DialogDescription>
            Send a rejection email to {candidate.firstName} {candidate.lastName} ({candidate.email})
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Email Template Info */}
          <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
            <div className="flex items-start gap-2 text-sm">
              <Mail className="h-4 w-4 text-blue-600 mt-0.5" />
              <div>
                <div className="font-medium text-blue-900 dark:text-blue-200">
                  Using {isShortlistRejection ? 'Shortlist Rejection' : 'Pipeline Rejection'} Template
                </div>
                <div className="text-xs text-blue-700 dark:text-blue-300 mt-1">
                  Your custom message will be included in the email. 
                  <button
                    onClick={() => {
                      window.dispatchEvent(new Event('openEmailSettings'))
                      onOpenChange(false)
                    }}
                    className="underline ml-1 hover:text-blue-900"
                  >
                    Edit full template
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="p-3 bg-gray-50 rounded-lg">
            <p className="text-sm">
              <span className="font-medium">Candidate:</span> {candidate.firstName} {candidate.lastName}
            </p>
            <p className="text-sm">
              <span className="font-medium">Email:</span> {candidate.email}
            </p>
            {candidate.currentStage?.stageName && (
              <p className="text-sm">
                <span className="font-medium">Current Stage:</span> {candidate.currentStage.stageName}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="single-reason">Rejection Reason (Optional)</Label>
            <Textarea
              id="single-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={4}
            />
            <p className="text-xs text-gray-500">
              This message will be included in the email as feedback. Customize or clear it before sending.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={sendEmail} disabled={sending}>
            {sending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Sending...
              </>
            ) : (
              <>
                <Send className="h-4 w-4 mr-2" />
                Send Email
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function CandidateRejectionEmailControls({ 
  candidates, 
  jobId, 
  onEmailSent 
}: CandidateRejectionEmailControlsProps) {
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false)
  const [shortlistBulkDialogOpen, setShortlistBulkDialogOpen] = useState(false)

  const pipelineCandidates = candidates.filter(c => c.status !== 'shortlisted' && c.status !== 'rejected')
  const shortlistedCandidates = candidates.filter(c => c.status === 'shortlisted')

  if (candidates.length === 0) {
    return null
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Manual Email Controls
          </CardTitle>
          <CardDescription>
            Send rejection emails to candidates manually with personalized messages
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Pipeline Rejections */}
            {pipelineCandidates.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium flex items-center gap-2">
                  Pipeline Candidates
                  <Badge variant="secondary">{pipelineCandidates.length}</Badge>
                </h4>
                <Button 
                  variant="outline" 
                  className="w-full"
                  onClick={() => setBulkDialogOpen(true)}
                >
                  <Users className="h-4 w-4 mr-2" />
                  Send Bulk Pipeline Rejections
                </Button>
              </div>
            )}

            {/* Shortlist Rejections */}
            {shortlistedCandidates.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium flex items-center gap-2">
                  Shortlisted Candidates
                  <Badge variant="secondary">{shortlistedCandidates.length}</Badge>
                </h4>
                <Button 
                  variant="outline" 
                  className="w-full"
                  onClick={() => setShortlistBulkDialogOpen(true)}
                >
                  <Users className="h-4 w-4 mr-2" />
                  Send Bulk Shortlist Rejections
                </Button>
              </div>
            )}
          </div>

          <div className="mt-4 p-3 bg-blue-50 rounded-lg">
            <p className="text-sm text-blue-700">
              <strong>Note:</strong> These controls allow you to manually send rejection emails with custom messages. 
              Automatic rejection emails are also sent when candidates are rejected through the normal pipeline flow.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Bulk Email Dialogs */}
      <BulkEmailDialog
        candidates={pipelineCandidates}
        jobId={jobId}
        isOpen={bulkDialogOpen}
        onOpenChange={setBulkDialogOpen}
        onEmailSent={onEmailSent}
        isShortlistRejection={false}
      />

      <BulkEmailDialog
        candidates={shortlistedCandidates}
        jobId={jobId}
        isOpen={shortlistBulkDialogOpen}
        onOpenChange={setShortlistBulkDialogOpen}
        onEmailSent={onEmailSent}
        isShortlistRejection={true}
      />
    </div>
  )
}

// Individual candidate rejection button component
interface CandidateRejectionButtonProps {
  candidate: PipelineCandidate
  jobId: string
  onEmailSent?: () => void
  isShortlistRejection?: boolean
  size?: 'sm' | 'default'
  variant?: 'outline' | 'ghost'
}

export function CandidateRejectionButton({ 
  candidate, 
  jobId, 
  onEmailSent,
  isShortlistRejection = false,
  size = 'sm',
  variant = 'ghost'
}: CandidateRejectionButtonProps) {
  const [dialogOpen, setDialogOpen] = useState(false)

  return (
    <>
      <Button 
        variant={variant}
        size={size}
        onClick={() => setDialogOpen(true)}
        className="flex items-center gap-1"
      >
        <Mail className="h-3 w-3" />
        Reject
      </Button>

      <SingleEmailDialog
        candidate={candidate}
        jobId={jobId}
        isOpen={dialogOpen}
        onOpenChange={setDialogOpen}
        onEmailSent={onEmailSent}
        isShortlistRejection={isShortlistRejection}
      />
    </>
  )
}
