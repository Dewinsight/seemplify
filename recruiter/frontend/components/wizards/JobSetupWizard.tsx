"use client"

import { useJobWorkspace } from "@/hooks/use-job-workspace"
import { useMemo } from "react"
import { useEffect } from "react"
import { useTutorialForPage } from "@/hooks/useTutorial"
import { jobDetailTutorial } from "@/components/tutorial/tutorials/jobsTutorial"

interface JobSetupWizardProps {
  isOpen: boolean
  onClose: () => void
}

export function JobSetupWizard({ isOpen, onClose }: JobSetupWizardProps) {
  const workspace = useJobWorkspace()
  const config = useMemo(() => ({
    ...jobDetailTutorial,
    id: workspace.assessment ? 'employee-assessment-detail-tutorial' : jobDetailTutorial.id,
    title: workspace.copy(jobDetailTutorial.title),
    description: jobDetailTutorial.description ? workspace.copy(jobDetailTutorial.description) : undefined,
    steps: jobDetailTutorial.steps.map(step => ({
      ...step,
      title: step.title ? workspace.copy(step.title) : step.title,
      content: workspace.copy(step.content),
    })),
  }), [workspace])
  const tutorial = useTutorialForPage(config)

  useEffect(() => {
    if (!isOpen) return
    tutorial.startThisTutorial()
    onClose()
  }, [isOpen])

  return null
}
