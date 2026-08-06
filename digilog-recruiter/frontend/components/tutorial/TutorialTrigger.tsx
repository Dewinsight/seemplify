"use client"

import React from "react"
import { HelpCircle, PlayCircle, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { useTutorialTrigger } from "@/hooks/useTutorial"

interface TutorialTriggerProps {
  tutorialId: string
  variant?: "default" | "outline" | "ghost" | "secondary"
  size?: "default" | "sm" | "lg" | "icon"
  showStatus?: boolean
  children?: React.ReactNode
  className?: string
}

/**
 * A button component that triggers a specific tutorial
 * Can show completion status and provides easy tutorial management
 */
export function TutorialTrigger({
  tutorialId,
  variant = "outline",
  size = "sm",
  showStatus = true,
  children,
  className,
}: TutorialTriggerProps) {
  const { startTutorial, isCompleted, isSkipped, shouldShow, reset } = useTutorialTrigger(tutorialId)

  const getStatusInfo = () => {
    if (isCompleted) return { status: "completed", color: "success", text: "Completed" }
    if (isSkipped) return { status: "skipped", color: "secondary", text: "Skipped" }
    return { status: "pending", color: "default", text: "Start" }
  }

  const statusInfo = getStatusInfo()

  return (
    <TooltipProvider>
      <div className="flex items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={variant}
              size={size}
              onClick={startTutorial}
              className={className}
            >
              <HelpCircle className="h-4 w-4" />
              {children || "Tutorial"}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{shouldShow ? "Start tutorial" : "Restart tutorial"}</p>
          </TooltipContent>
        </Tooltip>
        
        {showStatus && (
          <>
            <Badge 
              variant={statusInfo.color as any}
              className="text-xs"
            >
              {statusInfo.text}
            </Badge>
            
            {!shouldShow && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={reset}
                    className="h-6 w-6"
                  >
                    <RefreshCw className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Reset tutorial</p>
                </TooltipContent>
              </Tooltip>
            )}
          </>
        )}
      </div>
    </TooltipProvider>
  )
}

/**
 * A simple icon button for starting tutorials in compact spaces
 */
export function TutorialIcon({ 
  tutorialId, 
  className 
}: { 
  tutorialId: string
  className?: string 
}) {
  const { startTutorial, shouldShow } = useTutorialTrigger(tutorialId)

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            onClick={startTutorial}
            className={className}
          >
            <HelpCircle className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{shouldShow ? "Start tutorial" : "Restart tutorial"}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
