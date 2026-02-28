"use client"

import { useEffect } from "react"
import { useTutorialForPage } from "@/hooks/useTutorial"
import { jobDetailTutorial } from "@/components/tutorial/tutorials/jobsTutorial"

interface JobSetupWizardProps {
  isOpen: boolean
  onClose: () => void
}

export function JobSetupWizard({ isOpen, onClose }: JobSetupWizardProps) {
  const tutorial = useTutorialForPage(jobDetailTutorial)

  useEffect(() => {
    if (!isOpen) return
    tutorial.startThisTutorial()
    onClose()
  }, [isOpen])

  return null
}
