"use client"

import React from 'react'
import { ImprovedPipelineBoard } from '@/components/ui/improved-pipeline-board-fixed'

interface PipelineWithTabsProps {
  jobId: string
  jobTitle: string
  refreshTrigger?: number
  onCandidateSelect?: (candidateId: string) => void
  onStageUpdate?: () => void
  onNavigateToStages?: () => void
}

export function PipelineWithTabs({
  jobId,
  jobTitle,
  refreshTrigger,
  onCandidateSelect,
  onStageUpdate,
  onNavigateToStages,
}: PipelineWithTabsProps) {
  // Simplified: Just render the pipeline board directly
  // Interview setup has been moved to the Interviews tab
  return (
    <ImprovedPipelineBoard
      jobId={jobId}
      jobTitle={jobTitle}
      refreshTrigger={refreshTrigger}
      onCandidateSelect={onCandidateSelect}
      onStageUpdate={onStageUpdate}
      onNavigateToStages={onNavigateToStages}
    />
  )
}

