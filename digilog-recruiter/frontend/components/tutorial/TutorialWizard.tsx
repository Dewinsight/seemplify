"use client"

import React, { useState, useEffect, useRef, useCallback } from "react"
import { createPortal } from "react-dom"
import { X, ChevronLeft, ChevronRight, HelpCircle, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import scrollIntoView from "scroll-into-view-if-needed"

function isLargeContainer(element: HTMLElement): boolean {
  const attr = element.getAttribute('data-tutorial')
  return (
    element.id === 'jobs-display-area' ||
    attr === 'jobs-listing-container' ||
    attr === 'jobs-grid' ||
    attr === 'jobs-table' ||
    attr === 'candidates-table'
  )
}

function findEffectiveChildForLarge(element: HTMLElement): HTMLElement | null {
  // Try table rows first
  const row = element.querySelector('table tbody > tr') as HTMLElement | null
  if (row) return row
  // Try any direct child card/item (grid/list)
  const directChild = element.querySelector(':scope > *') as HTMLElement | null
  if (directChild) return directChild
  // Try common content containers
  const candidate = element.querySelector('tbody > tr, .card, [role="row"], [data-card], .grid > *') as HTMLElement | null
  return candidate
}

export interface TutorialStep {
  id: string
  title: string
  content: string
  targetSelector?: string // CSS selector for the element to highlight
  placement?: "top" | "bottom" | "left" | "right" | "center"
  delay?: number // Optional delay before showing this step
  action?: () => void // Optional action to perform when step is shown
  allowNext?: boolean // Whether the next button should be enabled
  skipable?: boolean // Whether this step can be skipped
}

export interface TutorialWizardProps {
  steps: TutorialStep[]
  isOpen: boolean
  onClose: () => void
  onComplete: () => void
  tutorialId: string
  title?: string
  description?: string
  showProgress?: boolean
}

interface HighlightOverlayProps {
  targetElement: HTMLElement | null
  placement: TutorialStep["placement"]
  onSkip: () => void
  children: React.ReactNode
}

function HighlightOverlay({ targetElement, placement = "bottom", onSkip, children }: HighlightOverlayProps) {
  const [overlayStyle, setOverlayStyle] = useState<React.CSSProperties>({})
  const [tooltipStyle, setTooltipStyle] = useState<React.CSSProperties>({})
  
  const updatePositions = useCallback(() => {
    if (!targetElement) {
      setOverlayStyle({})
      setTooltipStyle({ 
        position: "fixed", 
        top: "50%", 
        left: "50%", 
        transform: "translate(-50%, -50%)",
        zIndex: 10001,
        maxWidth: "calc(100vw - 32px)", // Prevent overflow on mobile
        maxHeight: "calc(100vh - 64px)"
      })
      return
    }

    const large = isLargeContainer(targetElement)
    const visualTarget = large ? (findEffectiveChildForLarge(targetElement) || targetElement) : targetElement

    const rect = visualTarget.getBoundingClientRect()
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop
    const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft

    // Screen dimensions
    const screenWidth = window.innerWidth
    const screenHeight = window.innerHeight
    
    // Tooltip dimensions (estimated)
    const tooltipWidth = Math.min(384, screenWidth - 32) // max-w-sm with padding
    const tooltipHeight = 200 // estimated height
    
    // Create highlight area with padding
    const padding = 8
    const highlightRect = {
      top: rect.top + scrollTop - padding,
      left: rect.left + scrollLeft - padding,
      width: rect.width + padding * 2,
      height: rect.height + padding * 2,
    }

    setOverlayStyle({
      clipPath: `polygon(0% 0%, 0% 100%, ${highlightRect.left}px 100%, ${highlightRect.left}px ${highlightRect.top}px, ${highlightRect.left + highlightRect.width}px ${highlightRect.top}px, ${highlightRect.left + highlightRect.width}px ${highlightRect.top + highlightRect.height}px, ${highlightRect.left}px ${highlightRect.top + highlightRect.height}px, ${highlightRect.left}px 100%, 100% 100%, 100% 0%)`,
    })

    // Smart positioning logic
    let tooltipTop = 0
    let tooltipLeft = 0
    let finalPlacement = placement
    const tooltipOffset = 16
    
    // Check if element is visible and calculate best position
    const elementCenterX = rect.left + rect.width / 2
    const elementCenterY = rect.top + rect.height / 2
    
    // Responsive placement adjustments
    if (screenWidth < 768) { // Mobile
      // On mobile, prefer bottom placement and center horizontally
      finalPlacement = "bottom"
      tooltipTop = rect.bottom + scrollTop + tooltipOffset
      tooltipLeft = screenWidth / 2
      
      // If bottom would overflow, try top
      if (tooltipTop + tooltipHeight > scrollTop + screenHeight) {
        finalPlacement = "top"
        tooltipTop = rect.top + scrollTop - tooltipOffset
      }
      
      // Ensure tooltip stays on screen
      tooltipTop = Math.max(16, Math.min(tooltipTop, scrollTop + screenHeight - tooltipHeight - 16))
      
    } else {
      // Desktop/tablet logic
      switch (placement) {
        case "top":
          tooltipTop = rect.top + scrollTop - tooltipOffset
          tooltipLeft = elementCenterX
          // Check if tooltip would go off-screen at top
          if (tooltipTop - tooltipHeight < scrollTop) {
            finalPlacement = "bottom"
            tooltipTop = rect.bottom + scrollTop + tooltipOffset
          }
          break
        case "bottom":
          tooltipTop = rect.bottom + scrollTop + tooltipOffset
          tooltipLeft = elementCenterX
          // Check if tooltip would go off-screen at bottom
          if (tooltipTop + tooltipHeight > scrollTop + screenHeight) {
            finalPlacement = "top"
            tooltipTop = rect.top + scrollTop - tooltipOffset
          }
          break
        case "left":
          tooltipTop = elementCenterY + scrollTop
          tooltipLeft = rect.left + scrollLeft - tooltipOffset
          // Check if tooltip would go off-screen on left
          if (tooltipLeft - tooltipWidth < 0) {
            finalPlacement = "right"
            tooltipLeft = rect.right + scrollLeft + tooltipOffset
          }
          break
        case "right":
          tooltipTop = elementCenterY + scrollTop
          tooltipLeft = rect.right + scrollLeft + tooltipOffset
          // Check if tooltip would go off-screen on right
          if (tooltipLeft + tooltipWidth > screenWidth) {
            finalPlacement = "left"
            tooltipLeft = rect.left + scrollLeft - tooltipOffset
          }
          break
        default:
          finalPlacement = "bottom"
          tooltipTop = rect.bottom + scrollTop + tooltipOffset
          tooltipLeft = elementCenterX
      }
      
      // Horizontal bounds checking
      tooltipLeft = Math.max(16, Math.min(tooltipLeft, screenWidth - tooltipWidth - 16))
      
      // Vertical bounds checking  
      tooltipTop = Math.max(16, Math.min(tooltipTop, scrollTop + screenHeight - tooltipHeight - 16))
    }

    // Transform based on final placement
    let transform = ""
    switch (finalPlacement) {
      case "left":
        transform = "translate(-100%, -50%)"
        break
      case "right":
        transform = "translate(0%, -50%)"
        break
      case "top":
        transform = "translate(-50%, -100%)"
        break
      case "bottom":
      default:
        transform = "translate(-50%, 0%)"
        break
    }

    setTooltipStyle({
      position: "absolute",
      top: tooltipTop,
      left: tooltipLeft,
      transform,
      zIndex: 10001,
      maxWidth: screenWidth < 768 ? "calc(100vw - 32px)" : "24rem", // Responsive max width
      maxHeight: "calc(100vh - 64px)",
    })
  }, [targetElement, placement])

  useEffect(() => {
    updatePositions()
    
    const handleResize = () => updatePositions()
    const handleScroll = () => updatePositions()
    
    window.addEventListener("resize", handleResize)
    window.addEventListener("scroll", handleScroll, true)
    
    return () => {
      window.removeEventListener("resize", handleResize)
      window.removeEventListener("scroll", handleScroll, true)
    }
  }, [updatePositions])

  // Scroll target into view
  useEffect(() => {
    if (!targetElement) return

    const large = isLargeContainer(targetElement)
    const scrollTarget = large ? (findEffectiveChildForLarge(targetElement) || targetElement) : targetElement

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const doScroll = () => {
      scrollIntoView(scrollTarget, {
        behavior: prefersReducedMotion ? 'auto' : 'smooth',
        block: large ? 'start' : 'center',
        inline: large ? 'nearest' : 'center',
        scrollMode: 'if-needed',
        boundary: null,
      })
    }

    // Let layout settle first for dynamic containers
    if ('requestAnimationFrame' in window) {
      requestAnimationFrame(() => setTimeout(doScroll, 50))
    } else {
      setTimeout(doScroll, 50)
    }
  }, [targetElement])

  return createPortal(
    <>
      {/* Dark overlay with cutout */}
      <div
        className="fixed inset-0 bg-black/50 transition-opacity duration-300 tutorial-overlay"
        style={overlayStyle}
        onClick={onSkip}
      />
      
      {/* Tooltip content */}
      <div style={tooltipStyle} className="max-w-sm">
        {children}
      </div>
      
      {/* Highlight ring around target element */}
      {targetElement && (() => {
        const large = isLargeContainer(targetElement)
        const visualTarget = large ? (findEffectiveChildForLarge(targetElement) || targetElement) : targetElement
        const rect = visualTarget.getBoundingClientRect()
        return (
          <div
            className="fixed pointer-events-none border-2 border-primary rounded-lg transition-all duration-300"
            style={{
              top: rect.top + window.scrollY - 4,
              left: rect.left + window.scrollX - 4,
              width: rect.width + 8,
              height: rect.height + 8,
              zIndex: 10001,
              boxShadow: "0 0 0 4px rgba(59, 130, 246, 0.3)",
            }}
          />
        )
      })()}
    </>,
    document.body
  )
}

export function TutorialWizard({
  steps,
  isOpen,
  onClose,
  onComplete,
  tutorialId,
  title = "Tutorial",
  description = "Let's get you started!",
  showProgress = true,
}: TutorialWizardProps) {
  const [currentStepIndex, setCurrentStepIndex] = useState(0)
  const [targetElement, setTargetElement] = useState<HTMLElement | null>(null)
  const stepTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const currentStep = steps[currentStepIndex]
  const isFirstStep = currentStepIndex === 0
  const isLastStep = currentStepIndex === steps.length - 1

  // Find target element when step changes
  useEffect(() => {
    if (!isOpen || !currentStep?.targetSelector) {
      setTargetElement(null)
      return
    }

    const findElement = () => {
      const element = document.querySelector(currentStep.targetSelector!) as HTMLElement
      if (element && element.offsetParent !== null) { // Check if element is visible
        setTargetElement(element)
        
        // Execute optional action
        if (currentStep.action) {
          currentStep.action()
        }
      } else {
        // Retry finding element after a short delay (max 10 retries)
        const retryCount = (findElement as any).retryCount || 0;
        if (retryCount < 10) {
          (findElement as any).retryCount = retryCount + 1;
          stepTimeoutRef.current = setTimeout(findElement, 200)
        } else {
          // If element not found after retries, set target to null and show centered tooltip
          console.warn(`Tutorial element not found: ${currentStep.targetSelector}`)
          setTargetElement(null)
        }
      }
    }

    if (currentStep.delay) {
      stepTimeoutRef.current = setTimeout(findElement, currentStep.delay)
    } else {
      findElement()
    }

    return () => {
      if (stepTimeoutRef.current) {
        clearTimeout(stepTimeoutRef.current)
      }
    }
  }, [currentStepIndex, currentStep, isOpen])

  const handleNext = () => {
    if (isLastStep) {
      handleComplete()
    } else {
      setCurrentStepIndex(prev => Math.min(prev + 1, steps.length - 1))
    }
  }

  const handlePrevious = () => {
    setCurrentStepIndex(prev => Math.max(prev - 1, 0))
  }

  const handleComplete = () => {
    // Save completion status
    localStorage.setItem(`tutorial-completed-${tutorialId}`, "true")
    onComplete()
  }

  const handleSkip = () => {
    localStorage.setItem(`tutorial-skipped-${tutorialId}`, "true")
    onClose()
  }

  if (!isOpen || !currentStep) return null

  const tooltipContent = (
    <Card className="shadow-xl border-2 border-primary/20 bg-background/95 backdrop-blur w-full">
      <CardHeader className="pb-3 px-4 sm:px-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <Sparkles className="h-4 w-4 sm:h-5 sm:w-5 text-primary flex-shrink-0" />
            <CardTitle className="text-sm sm:text-lg font-semibold truncate">{currentStep.title}</CardTitle>
          </div>
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={onClose}
            className="h-8 w-8 text-muted-foreground hover:text-foreground flex-shrink-0"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        {showProgress && (
          <div className="flex items-center gap-2 mt-2">
            <Badge variant="secondary" className="text-xs flex-shrink-0">
              {currentStepIndex + 1} of {steps.length}
            </Badge>
            <div className="flex-1 h-2 bg-secondary rounded-full overflow-hidden">
              <div 
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${((currentStepIndex + 1) / steps.length) * 100}%` }}
              />
            </div>
          </div>
        )}
      </CardHeader>
      <CardContent className="pt-0 px-4 sm:px-6">
        <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
          {currentStep.content}
        </p>
        
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 sm:gap-2">
          <div className="flex gap-2 justify-start">
            {!isFirstStep && (
              <Button 
                variant="outline" 
                size="sm" 
                onClick={handlePrevious}
                className="gap-2"
              >
                <ChevronLeft className="h-4 w-4" />
                <span className="hidden sm:inline">Previous</span>
                <span className="sm:hidden">Prev</span>
              </Button>
            )}
          </div>
          
          <div className="flex gap-2 justify-end">
            {(currentStep.skipable !== false) && (
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={handleSkip}
                className="text-muted-foreground hover:text-foreground text-xs sm:text-sm"
              >
                Skip
              </Button>
            )}
            <Button 
              size="sm" 
              onClick={handleNext}
              disabled={currentStep.allowNext === false}
              className="gap-2"
            >
              {isLastStep ? "Complete" : "Next"}
              {!isLastStep && <ChevronRight className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )

  return (
    <HighlightOverlay
      targetElement={targetElement}
      placement={currentStep.placement}
      onSkip={handleSkip}
    >
      {tooltipContent}
    </HighlightOverlay>
  )
}
