'use client'

import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { AlertCircle, Loader2, CreditCard, TrendingUp, TrendingDown } from 'lucide-react'
import Link from 'next/link'
import type { JobData as ServiceJobData } from '@/services/jobService'

interface CreditInfo {
  remainingCredits: number
  totalCredits: number
  usedCredits: number
  creditCosts: {
    uploadCandidate: number
    [key: string]: number
  }
}

type DialogJobData = ServiceJobData & {
  reservedCredits?: number
  publicApplicationCount?: number
}

interface PublicJobDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: 'enable' | 'disable' | 'increase'
  jobData: DialogJobData | null
  creditInfo: CreditInfo | null
  onConfirm: (isPublic: boolean, candidateApplyLimit?: number) => Promise<void>
  isLoading: boolean
}

export function PublicJobDialog({
  open,
  onOpenChange,
  mode,
  jobData,
  creditInfo,
  onConfirm,
  isLoading
}: PublicJobDialogProps) {
  const [candidateLimit, setCandidateLimit] = useState<number>(50)
  const [error, setError] = useState<string>('')

  // Debug logging
  useEffect(() => {
    if (open) {
      console.log('💳 PublicJobDialog opened with creditInfo:', creditInfo)
    }
  }, [open, creditInfo])

  // Calculate values for enable mode
  const uploadCost = creditInfo?.creditCosts?.uploadCandidate || 3
  const totalCost = candidateLimit * uploadCost
  const currentCredits = creditInfo?.remainingCredits || 0
  const remainingAfter = currentCredits - totalCost
  const hasInsufficientCredits = remainingAfter < 0

  // Calculate values for disable mode
  const reservedCredits = jobData?.reservedCredits || 0
  const publicApplicationCount = jobData?.publicApplicationCount || 0
  const usedCredits = publicApplicationCount * uploadCost
  const refundAmount = reservedCredits - usedCredits

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setError('')
      if (mode === 'enable') {
        setCandidateLimit(jobData?.candidateApplyLimit || 50)
      } else if (mode === 'increase') {
        // For increase mode, start with current limit + 10 as a suggestion
        const currentLimit = jobData?.candidateApplyLimit || 0
        setCandidateLimit(currentLimit + 10)
      }
    }
  }, [open, mode, jobData])

  const handleConfirm = async () => {
    setError('') // Clear any previous errors

    if (mode === 'enable') {
      // Validation for enable mode
      if (!candidateLimit || candidateLimit < 1) {
        setError('Please enter a valid candidate limit (minimum 1)')
        return
      }

      if (hasInsufficientCredits) {
        setError('Insufficient credits. Please purchase more credits to continue.')
        return
      }

      try {
        await onConfirm(true, candidateLimit)
      } catch (err: any) {
        console.error('Dialog error:', err)
        // Extract user-friendly error message
        let errorMsg = 'Failed to make job public. Please try again.'
        if (err.message) {
          if (err.message.includes('INSUFFICIENT_CREDITS')) {
            errorMsg = 'Insufficient credits available. Please purchase more credits.'
          } else if (err.message.includes('INVALID_APPLY_LIMIT')) {
            errorMsg = 'Invalid candidate limit. Please enter a number greater than 0.'
          } else if (err.message.includes('validation')) {
            errorMsg = 'System error occurred. Please contact support if this persists.'
          } else {
            errorMsg = err.message
          }
        }
        setError(errorMsg)
      }
    } else if (mode === 'increase') {
      // Validation for increase mode
      const currentLimit = jobData?.candidateApplyLimit || 0
      if (!candidateLimit || candidateLimit <= currentLimit) {
        setError(`New limit must be greater than current limit (${currentLimit})`)
        return
      }

      const additionalSlots = candidateLimit - currentLimit
      const additionalCost = additionalSlots * uploadCost
      const remainingAfterIncrease = currentCredits - additionalCost

      if (remainingAfterIncrease < 0) {
        setError('Insufficient credits. Please purchase more credits to continue.')
        return
      }

      try {
        await onConfirm(true, candidateLimit)
      } catch (err: any) {
        console.error('Dialog error:', err)
        let errorMsg = 'Failed to increase slots. Please try again.'
        if (err.message) {
          if (err.message.includes('INSUFFICIENT_CREDITS')) {
            errorMsg = 'Insufficient credits available. Please purchase more credits.'
          } else if (err.message.includes('INVALID_APPLY_LIMIT')) {
            errorMsg = 'Invalid candidate limit. Please enter a valid number.'
          } else {
            errorMsg = err.message
          }
        }
        setError(errorMsg)
      }
    } else {
      // Disable mode
      try {
        await onConfirm(false)
      } catch (err: any) {
        console.error('Dialog error:', err)
        setError(err.message || 'Failed to make job private. Please try again.')
      }
    }
  }

  if (mode === 'enable') {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="text-2xl">Make Job Public</DialogTitle>
            <DialogDescription>
              Set a limit for public applications. Credits will be reserved upfront to cover AI-powered CV parsing and matching.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-4">
            {/* Candidate Limit Input */}
            <div className="space-y-2">
              <Label htmlFor="candidateLimit" className="text-base font-semibold">
                Maximum Applications *
              </Label>
              <Input
                id="candidateLimit"
                type="number"
                min="1"
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
                Each application includes AI CV parsing, scoring, and intelligent matching
              </p>
            </div>

            {/* Credit Breakdown */}
            <div className="rounded-lg border bg-slate-50 dark:bg-slate-900 p-4 space-y-3">
              <div className="flex items-center gap-2 mb-2">
                <CreditCard className="h-4 w-4 text-blue-600" />
                <h4 className="font-semibold text-sm">Credit Breakdown</h4>
              </div>

              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Current Credits:</span>
                  <span className="font-semibold">{currentCredits.toLocaleString()}</span>
                </div>
                
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Required Credits:</span>
                  <span className="font-semibold text-blue-600">
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
                      <TrendingDown className="h-4 w-4 text-green-600" />
                    ) : (
                      <TrendingDown className="h-4 w-4 text-red-600" />
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
                💡 Credits are reserved upfront. Unused credits will be automatically refunded if you unpublish or delete this job.
              </div>
            </div>

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
              onClick={handleConfirm}
              disabled={isLoading || hasInsufficientCredits}
              className="bg-green-600 hover:bg-green-700"
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Processing...
                </>
              ) : (
                'Reserve Credits & Make Public'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  // Disable mode
  if (mode === 'disable') {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="text-2xl">Make Job Private?</DialogTitle>
            <DialogDescription>
              This will disable public applications and refund any unused credits.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Refund Breakdown */}
            <div className="rounded-lg border bg-slate-50 dark:bg-slate-900 p-4 space-y-3">
              <div className="flex items-center gap-2 mb-2">
                <CreditCard className="h-4 w-4 text-blue-600" />
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
                      ({publicApplicationCount} applications)
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
                Making this job private will:
                <ul className="list-disc list-inside mt-2 space-y-1">
                  <li>Disable the public application link</li>
                  <li>Stop accepting new public applications</li>
                  <li>Keep existing applicants in your pipeline</li>
                </ul>
              </AlertDescription>
            </Alert>
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
              onClick={handleConfirm}
              disabled={isLoading}
              variant="destructive"
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Processing...
                </>
              ) : (
                'Make Private & Refund Credits'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  // Increase slots mode
  const currentLimit = jobData?.candidateApplyLimit || 0
  const additionalSlots = candidateLimit - currentLimit
  const additionalCost = additionalSlots * uploadCost
  const remainingAfterIncrease = currentCredits - additionalCost
  const hasInsufficientCreditsForIncrease = remainingAfterIncrease < 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="text-2xl">Increase Application Slots</DialogTitle>
          <DialogDescription>
            Add more slots to allow additional candidates to apply to this public job.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Current Status */}
          <div className="rounded-lg border bg-slate-50 dark:bg-slate-900 p-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Current Limit:</span>
              <span className="font-semibold">{currentLimit} applications</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Applications Received:</span>
              <span className="font-semibold">{publicApplicationCount} / {currentLimit}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Remaining Slots:</span>
              <span className="font-semibold text-orange-600">{currentLimit - publicApplicationCount}</span>
            </div>
          </div>

          {/* New Limit Input */}
          <div className="space-y-2">
            <Label htmlFor="newCandidateLimit" className="text-base font-semibold">
              New Application Limit *
            </Label>
            <Input
              id="newCandidateLimit"
              type="number"
              min={currentLimit + 1}
              value={candidateLimit}
              onChange={(e) => {
                const value = parseInt(e.target.value) || currentLimit
                setCandidateLimit(value)
                setError('')
              }}
              placeholder={`Minimum: ${currentLimit + 1}`}
              className="text-lg"
            />
            <p className="text-sm text-muted-foreground">
              Must be greater than current limit ({currentLimit})
            </p>
          </div>

          {/* Cost Breakdown */}
          <div className="rounded-lg border bg-slate-50 dark:bg-slate-900 p-4 space-y-3">
            <div className="flex items-center gap-2 mb-2">
              <CreditCard className="h-4 w-4 text-blue-600" />
              <h4 className="font-semibold text-sm">Credit Cost</h4>
            </div>

            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Current Credits:</span>
                <span className="font-semibold">{currentCredits.toLocaleString()}</span>
              </div>

              <div className="flex justify-between">
                <span className="text-muted-foreground">Additional Slots:</span>
                <span className="font-semibold text-blue-600">
                  +{additionalSlots} slots
                </span>
              </div>

              <div className="flex justify-between">
                <span className="text-muted-foreground">Additional Cost:</span>
                <span className="font-semibold text-blue-600">
                  {additionalCost.toLocaleString()}
                  <span className="text-xs text-muted-foreground ml-1">
                    ({additionalSlots} × {uploadCost})
                  </span>
                </span>
              </div>

              <div className="pt-2 border-t flex justify-between items-center">
                <span className="font-semibold">Remaining After:</span>
                <div className="flex items-center gap-1">
                  {remainingAfterIncrease >= 0 ? (
                    <TrendingDown className="h-4 w-4 text-green-600" />
                  ) : (
                    <TrendingDown className="h-4 w-4 text-red-600" />
                  )}
                  <span className={`font-bold text-lg ${remainingAfterIncrease >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {remainingAfterIncrease.toLocaleString()}
                  </span>
                </div>
              </div>
            </div>

            {hasInsufficientCreditsForIncrease && (
              <Alert variant="destructive" className="mt-3">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  You need {Math.abs(remainingAfterIncrease).toLocaleString()} more credits.{' '}
                  <Link href="/settings/billing" className="underline font-semibold">
                    Purchase credits
                  </Link>
                </AlertDescription>
              </Alert>
            )}
          </div>

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
            onClick={handleConfirm}
            disabled={isLoading || hasInsufficientCreditsForIncrease || candidateLimit <= currentLimit}
            className="bg-blue-600 hover:bg-blue-700"
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Processing...
              </>
            ) : (
              `Reserve ${additionalCost} Credits & Increase Slots`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

