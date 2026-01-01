"use client"

import React, { createContext, useContext, useState, useCallback } from "react"
import { TutorialStep } from "@/components/tutorial/TutorialWizard"

export interface TutorialConfig {
  id: string
  title: string
  description?: string
  steps: TutorialStep[]
  autoStart?: boolean
  showProgress?: boolean
}

interface TutorialContextType {
  // Current tutorial state
  activeTutorialId: string | null
  isActiveTutorialOpen: boolean
  
  // Tutorial management
  registerTutorial: (config: TutorialConfig) => void
  startTutorial: (tutorialId: string) => void
  closeTutorial: () => void
  completeTutorial: () => void
  
  // Tutorial status checks
  isTutorialCompleted: (tutorialId: string) => boolean
  isTutorialSkipped: (tutorialId: string) => boolean
  shouldShowTutorial: (tutorialId: string) => boolean
  
  // Get tutorial data
  getTutorial: (tutorialId: string) => TutorialConfig | undefined
  getActiveTutorial: () => TutorialConfig | undefined
  
  // Utility functions
  resetTutorial: (tutorialId: string) => void
  resetAllTutorials: () => void
}

const TutorialContext = createContext<TutorialContextType | null>(null)

export function TutorialProvider({ children }: { children: React.ReactNode }) {
  const [tutorials, setTutorials] = useState<Map<string, TutorialConfig>>(new Map())
  const [activeTutorialId, setActiveTutorialId] = useState<string | null>(null)
  const [isActiveTutorialOpen, setIsActiveTutorialOpen] = useState(false)

  const registerTutorial = useCallback((config: TutorialConfig) => {
    setTutorials(prev => {
      const newTutorials = new Map(prev)
      newTutorials.set(config.id, config)
      return newTutorials
    })
    
    // Auto-start tutorial if specified and not completed/skipped
    if (config.autoStart && shouldShowTutorial(config.id)) {
      setTimeout(() => startTutorial(config.id), 1000) // Small delay to ensure page is loaded
    }
  }, [])

  const startTutorial = useCallback((tutorialId: string) => {
    const tutorial = tutorials.get(tutorialId)
    if (!tutorial) {
      console.warn(`Tutorial with id "${tutorialId}" not found`)
      return
    }
    
    setActiveTutorialId(tutorialId)
    setIsActiveTutorialOpen(true)
  }, [tutorials])

  const closeTutorial = useCallback(() => {
    setIsActiveTutorialOpen(false)
    setTimeout(() => setActiveTutorialId(null), 300) // Delay to allow for animation
  }, [])

  const completeTutorial = useCallback(() => {
    if (activeTutorialId) {
      localStorage.setItem(`tutorial-completed-${activeTutorialId}`, "true")
      localStorage.removeItem(`tutorial-skipped-${activeTutorialId}`)
    }
    closeTutorial()
  }, [activeTutorialId, closeTutorial])

  const isTutorialCompleted = useCallback((tutorialId: string) => {
    return localStorage.getItem(`tutorial-completed-${tutorialId}`) === "true"
  }, [])

  const isTutorialSkipped = useCallback((tutorialId: string) => {
    return localStorage.getItem(`tutorial-skipped-${tutorialId}`) === "true"
  }, [])

  const shouldShowTutorial = useCallback((tutorialId: string) => {
    return !isTutorialCompleted(tutorialId) && !isTutorialSkipped(tutorialId)
  }, [isTutorialCompleted, isTutorialSkipped])

  const getTutorial = useCallback((tutorialId: string) => {
    return tutorials.get(tutorialId)
  }, [tutorials])

  const getActiveTutorial = useCallback(() => {
    return activeTutorialId ? tutorials.get(activeTutorialId) : undefined
  }, [activeTutorialId, tutorials])

  const resetTutorial = useCallback((tutorialId: string) => {
    localStorage.removeItem(`tutorial-completed-${tutorialId}`)
    localStorage.removeItem(`tutorial-skipped-${tutorialId}`)
  }, [])

  const resetAllTutorials = useCallback(() => {
    // Get all tutorial keys from localStorage
    const tutorialKeys = Object.keys(localStorage).filter(key => 
      key.startsWith("tutorial-completed-") || key.startsWith("tutorial-skipped-")
    )
    
    // Remove all tutorial keys
    tutorialKeys.forEach(key => localStorage.removeItem(key))
  }, [])

  const value: TutorialContextType = {
    activeTutorialId,
    isActiveTutorialOpen,
    registerTutorial,
    startTutorial,
    closeTutorial,
    completeTutorial,
    isTutorialCompleted,
    isTutorialSkipped,
    shouldShowTutorial,
    getTutorial,
    getActiveTutorial,
    resetTutorial,
    resetAllTutorials,
  }

  return (
    <TutorialContext.Provider value={value}>
      {children}
    </TutorialContext.Provider>
  )
}

export function useTutorial() {
  const context = useContext(TutorialContext)
  if (!context) {
    throw new Error("useTutorial must be used within a TutorialProvider")
  }
  return context
}
