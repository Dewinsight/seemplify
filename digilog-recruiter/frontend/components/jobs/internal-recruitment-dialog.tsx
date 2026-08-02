"use client"

import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Switch } from '@/components/ui/switch'
import { AlertCircle, Loader2, CreditCard, TrendingUp, Building } from 'lucide-react'
import Link from 'next/link'

interface CreditInfo {
  remainingCredits: number
  totalCredits: number
  usedCredits: number
}

interface InternalRecruitmentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: 'enable' | 'disable'
  jobId: string
  jobTitle: string
  currentLimit?: number
  currentApplicationCount?: number
  reservedCredits?: number
  creditInfo: CreditInfo | null
  onSuccess: () => void
}

export function InternalRecruitmentDialog({
  open,
  onOpenChange,
  mode,
  jobId,
  jobTitle,
  currentLimit = 0,
  currentApplicationCount = 0,
  reservedCredits = 0,
  creditInfo,
  onSuccess
}: InternalRecruitmentDialogProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  // Enable mode settings
  const [candidateLimit, setCandidateLimit] = useState(50)
  const [requireEmployeeId, setRequireEmployeeId] = useState(false)
  const [notifyHiringManager, setNotifyHiringManager] = useState(true)

  const uploadCost = 1 // Cost per application slot
  const currentCredits = creditInfo?.remainingCredits || 0

  // Reset state when dialog opens
  useEffect(() => {
    if (open && mode === 'enable') {
      setError('')
      setCandidateLimit(50)
      setRequireEmployeeId(false)
      setNotifyHiringManager(true)
    }
  }, [open, mode])

  const handleEnable = async () => {
    setError('')

    // Validation
    if (!candidateLimit || candidateLimit < 1) {
      setError('Please enter a valid candidate limit (minimum 1)')
      return
    }

    const totalCost = candidateLimit * uploadCost
    const remainingAfter = currentCredits - totalCost

    if (remainingAfter < 0) {
      setError('Insufficient credits. Please purchase more credits to continue.')
      return
    }

    try {
      setIsLoading(true)

      const response = await fetch(`/api/jobs/${jobId}/internal/enable`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          internalCandidateApplyLimit: candidateLimit,
          requireEmployeeId,
          notifyHiringManager
        })
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.message || 'Failed to enable internal recruitment')
      }

      onSuccess()
      onOpenChange(false)
    } catch (err: any) {
      console.error('Error enabling internal recruitment:', err)
      setError(err.message || 'Failed to enable internal recruitment. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  const handleDisable = async () => {
    try {
      setIsLoading(true)

      const response = await fetch(`/api/jobs/${jobId}/internal/disable`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include'
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.message || 'Failed to disable internal recruitment')
      }

      onSuccess()
      onOpenChange(false)
    } catch (err: any) {
      console.error('Error disabling internal recruitment:', err)
      setError(err.message || 'Failed to disable internal recruitment. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  // Enable mode
  if (mode === 'enable') {
    const totalCost = candidateLimit * uploadCost
    const remainingAfter = currentCredits - totalCost
    const hasInsufficientCredits = remainingAfter < 0

    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[550px]">
          <DialogHeader>
            <DialogTitle className="text-2xl flex items-center gap-2">
              <Building className="h-6 w-6 text-purple-600" />
              Enable Internal Recruitment
            </DialogTitle>
            <DialogDescription>
              Allow internal employees to apply for: <span className="font-semibold">{jobTitle}</span>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-4">
            {/* Application Limit */}
            <div className="space-y-2">
              <Label htmlFor="candidateLimit" className="text-base font-semibold">
                Internal Application Limit *
              </Label>
              <Input
                id="candidateLimit"
                type="number"
                min={1}
                value={candidateLimit}
                onChange={(e) => {
                  const value = parseInt(e.target.value) || 0
                  setCandidateLimit(value)
                  setError('')
                }}
                placeholder="e.g., 50"
                className="text-lg"
              />
              <p className="text-sm text-muted-foreground">
                Maximum number of internal candidates who can apply. Set to 0 for unlimited.
              </p>
            </div>

            {/* Settings */}
            <div className="space-y-4 rounded-lg border p-4 bg-slate-50 dark:bg-slate-900">
              <h4 className="font-semibold text-sm">Internal Application Settings</h4>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="requireEmployeeId" className="text-sm font-medium">
                    Require Employee ID
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Applicants must provide their employee ID
                  </p>
                </div>
                <Switch
                  id="requireEmployeeId"
                  checked={requireEmployeeId}
                  onCheckedChange={setRequireEmployeeId}
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="notifyHiringManager" className="text-sm font-medium">
                    Notify Hiring Manager
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Send notifications for new internal applications
                  </p>
                </div>
                <Switch
                  id="notifyHiringManager"
                  checked={notifyHiringManager}
                  onCheckedChange={setNotifyHiringManager}
                />
              </div>
            </div>

            {/* Credit Cost Breakdown */}
            {candidateLimit > 0 && (
              <div className="rounded-lg border bg-purple-50 dark:bg-purple-950/20 p-4 space-y-3">
                <div className="flex items-center gap-2 mb-2">
                  <CreditCard className="h-4 w-4 text-purple-600" />
                  <h4 className="font-semibold text-sm">Credit Reservation</h4>
                </div>

                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Current Credits:</span>
                    <span className="font-semibold">{currentCredits.toLocaleString()}</span>
                  </div>

                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Application Slots:</span>
                    <span className="font-semibold text-purple-600">
                      {candidateLimit} slots
                    </span>
                  </div>

                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total Cost:</span>
                    <span className="font-semibold text-purple-600">
                      {totalCost.toLocaleString()}
                      <span className="text-xs text-muted-foreground ml-1">
                        ({candidateLimit} × {uploadCost})
                      </span>
                    </span>
                  </div>

                  <div className="pt-2 border-t flex justify-between items-center">
                    <span className="font-semibold">Remaining After:</span>
                    <div className="flex items-center gap-1">
                      {remainingAfter >= 0 ? (
                        <TrendingUp className="h-4 w-4 text-green-600" />
                      ) : (
                        <AlertCircle className="h-4 w-4 text-red-600" />
                      )}
                      <span className={`font-bold text-lg ${remainingAfter >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {remainingAfter.toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>

                {hasInsufficientCredits && (
                  <Alert variant="destructive" className="mt-3">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      You need {Math.abs(remainingAfter).toLocaleString()} more credits.{' '}
                      <Link href="/settings/billing" className="underline font-semibold">
                        Purchase credits
                      </Link>
                    </AlertDescription>
                  </Alert>
                )}

                <div className="pt-2 border-t text-xs text-muted-foreground">
                  ✓ Credits will be reserved and consumed as internal candidates apply.
                  <br />
                  ✓ Unused credits will be refunded if you disable internal recruitment.
                </div>
              </div>
            )}

            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button
              onClick={handleEnable}
              disabled={isLoading || hasInsufficientCredits || candidateLimit < 1}
              className="bg-purple-600 hover:bg-purple-700"
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Enabling...
                </>
              ) : (
                candidateLimit > 0
                  ? `Reserve ${totalCost} Credits & Enable`
                  : 'Enable Internal Recruitment'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  // Disable mode
  const usedCredits = currentApplicationCount
  const refundAmount = reservedCredits - usedCredits

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="text-2xl">Disable Internal Recruitment?</DialogTitle>
          <DialogDescription>
            This will stop accepting internal applications and refund unused credits.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Refund Breakdown */}
          <div className="rounded-lg border bg-slate-50 dark:bg-slate-900 p-4 space-y-3">
            <div className="flex items-center gap-2 mb-2">
              <CreditCard className="h-4 w-4 text-purple-600" />
              <h4 className="font-semibold text-sm">Credit Refund Details</h4>
            </div>

            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Reserved Credits:</span>
                <span className="font-semibold">{reservedCredits.toLocaleString()}</span>
              </div>

              <div className="flex justify-between">
                <span className="text-muted-foreground">Used Credits:</span>
                <span className="font-semibold text-orange-600">
                  {usedCredits.toLocaleString()}
                  <span className="text-xs text-muted-foreground ml-1">
                    ({currentApplicationCount} applications)
                  </span>
                </span>
              </div>

              <div className="pt-2 border-t flex justify-between items-center">
                <span className="font-semibold">Refund Amount:</span>
                <div className="flex items-center gap-1">
                  <TrendingUp className="h-4 w-4 text-green-600" />
                  <span className="font-bold text-lg text-green-600">
                    {refundAmount.toLocaleString()}
                  </span>
                </div>
              </div>
            </div>

            <div className="pt-2 border-t text-xs text-muted-foreground">
              ✓ Refunded credits will be added back to your organization's credit balance immediately.
            </div>
          </div>

          {/* Warning */}
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Disabling internal recruitment will:
              <ul className="list-disc list-inside mt-2 space-y-1">
                <li>Disable the internal application link</li>
                <li>Stop accepting new internal applications</li>
                <li>Keep existing internal applicants in your pipeline</li>
              </ul>
            </AlertDescription>
          </Alert>

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            onClick={handleDisable}
            disabled={isLoading}
            variant="destructive"
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Processing...
              </>
            ) : (
              'Disable & Refund Credits'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
