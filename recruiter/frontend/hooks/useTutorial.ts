"use client"

import { useEffect } from "react"
import { useTutorial as useBaseTutorial, TutorialConfig } from "@/context/TutorialContext"

// Enhanced hook with additional utilities
export function useTutorial() {
  return useBaseTutorial()
}

// Hook for registering and managing a tutorial on a specific page
export function useTutorialForPage(config: TutorialConfig) {
  const tutorial = useTutorial()

  useEffect(() => {
    // Register the tutorial when component mounts
    tutorial.registerTutorial(config)

    return () => {
      // Optionally clean up when component unmounts
      // tutorial.closeTutorial()
    }
  }, [config.id]) // Only re-register if the tutorial ID changes

  return {
    ...tutorial,
    startThisTutorial: () => tutorial.startTutorial(config.id),
    isThisTutorialCompleted: tutorial.isTutorialCompleted(config.id),
    isThisTutorialSkipped: tutorial.isTutorialSkipped(config.id),
    shouldShowThisTutorial: tutorial.shouldShowTutorial(config.id),
    resetThisTutorial: () => tutorial.resetTutorial(config.id),
  }
}

// Hook for tutorial button/trigger components
export function useTutorialTrigger(tutorialId: string) {
  const tutorial = useTutorial()

  return {
    startTutorial: () => tutorial.startTutorial(tutorialId),
    isCompleted: tutorial.isTutorialCompleted(tutorialId),
    isSkipped: tutorial.isTutorialSkipped(tutorialId),
    shouldShow: tutorial.shouldShowTutorial(tutorialId),
    reset: () => tutorial.resetTutorial(tutorialId),
  }
}
