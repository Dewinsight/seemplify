"use client"

import React, { useState, useEffect } from 'react'
import { PipelineEmailControls } from '@/components/ui/pipeline-email-controls'
import pipelineService from '@/services/pipelineService'
import { toast } from '@/components/ui/use-toast'
import { Card, CardContent } from '@/components/ui/card'
import { Loader2 } from 'lucide-react'

interface PipelineStage {
  _id: string
  name: string
  order: number
  candidates: any[]
}

interface PipelineEmailManagementTabProps {
  jobId: string
  jobTitle?: string
  onEmailSent?: () => void
}

export function PipelineEmailManagementTab({ 
  jobId, 
  jobTitle = 'Job',
  onEmailSent 
}: PipelineEmailManagementTabProps) {
  const [stages, setStages] = useState<PipelineStage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchPipelineData = async () => {
    if (!jobId) return

    try {
      setLoading(true)
      setError(null)

      const pipelineData = await pipelineService.getDetailedPipeline(jobId)
      
      if (pipelineData?.pipeline?.stages) {
        setStages(pipelineData.pipeline.stages.map((stage: any) => ({
          _id: stage.stage._id,
          name: stage.stage.name,
          order: stage.stage.order,
          candidates: (stage.candidates || []).map((applicant: any) => ({
            _id: applicant.candidate._id,
            firstName: applicant.candidate.firstName,
            lastName: applicant.candidate.lastName,
            email: applicant.candidate.email,
            status: applicant.status,
            currentStage: {
              stageId: stage.stage._id,
              stageName: stage.stage.name
            }
          }))
        })))
      } else {
        setStages([])
      }
    } catch (error: any) {
      console.error('Error fetching pipeline data:', error)
      setError('Failed to load pipeline data')
      toast({
        title: "Error",
        description: "Failed to load pipeline data for email management",
        variant: "destructive"
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchPipelineData()
  }, [jobId])

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>Loading pipeline data...</span>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <div className="text-center">
            <p className="text-muted-foreground mb-2">Failed to load pipeline data</p>
            <button 
              onClick={fetchPipelineData}
              className="text-blue-600 hover:text-blue-800 underline"
            >
              Try again
            </button>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (!stages.length) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <div className="text-center">
            <p className="text-muted-foreground mb-2">No pipeline stages found</p>
            <p className="text-sm text-muted-foreground">
              Configure pipeline stages first to manage candidate emails
            </p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <PipelineEmailControls
        stages={stages}
        jobId={jobId}
        jobTitle={jobTitle}
        onEmailSent={() => {
          onEmailSent?.()
          fetchPipelineData() // Refresh data after email sent
        }}
      />
    </div>
  )
}
