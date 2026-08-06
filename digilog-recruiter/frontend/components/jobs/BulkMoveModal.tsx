"use client"

import { useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'

export interface InterviewStage {
  _id: string
  name: string
  type: string
  order: number
}

interface BulkMoveModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: (targetStageId: string) => Promise<void>
  selectedCandidateCount: number
  stages: InterviewStage[]
}

export function BulkMoveModal({
  isOpen,
  onClose,
  onConfirm,
  selectedCandidateCount,
  stages = []
}: BulkMoveModalProps) {
  const [selectedStageId, setSelectedStageId] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  
  const handleConfirm = async () => {
    if (!selectedStageId) return
    
    setIsSubmitting(true)
    try {
      await onConfirm(selectedStageId)
      setSelectedStageId('')
      onClose()
    } catch (error) {
      console.error('Bulk move failed:', error)
    } finally {
      setIsSubmitting(false)
    }
  }
  
  const handleClose = () => {
    if (!isSubmitting) {
      setSelectedStageId('')
      onClose()
    }
  }
  
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            Move {selectedCandidateCount} Candidate{selectedCandidateCount !== 1 ? 's' : ''}
          </DialogTitle>
          <DialogDescription>
            Select the target stage for the selected candidates
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          {/* Stage selector */}
          <div>
            <Label htmlFor="target-stage">Target Stage</Label>
            <Select value={selectedStageId} onValueChange={setSelectedStageId} disabled={isSubmitting}>
              <SelectTrigger id="target-stage" className="mt-2">
                <SelectValue placeholder="Select stage" />
              </SelectTrigger>
              <SelectContent>
                {stages.map(stage => (
                  <SelectItem key={stage._id} value={stage._id}>
                    {stage.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        
        <DialogFooter>
          <Button 
            variant="outline" 
            onClick={handleClose} 
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!selectedStageId || isSubmitting}
          >
            {isSubmitting 
              ? 'Moving...' 
              : `Move ${selectedCandidateCount} Candidate${selectedCandidateCount !== 1 ? 's' : ''}`
            }
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

