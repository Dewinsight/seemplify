'use client'

import React, { useRef, useState, useCallback, useEffect } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  ClipboardList,
  Users,
  Workflow,
  BarChart3,
  HelpCircle,
  Calendar,
  Trophy,
  TrendingUp,
  Mail,
  ChevronLeft,
  ChevronRight
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface SimpleTabNavigationProps {
  activeTab: string
  onTabChange: (tabId: string) => void
  candidateCount?: number
  isMobile?: boolean
}

const tabs = [
  {
    id: 'overview',
    label: 'Overview',
    icon: <ClipboardList className="h-4 w-4" />,
    shortLabel: 'Overview'
  },
  {
    id: 'candidates',
    label: 'Candidates',
    icon: <Users className="h-4 w-4" />,
    shortLabel: 'Candidates'
  },
  {
    id: 'hiring-pipeline',
    label: 'Hiring Pipeline',
    icon: <Workflow className="h-4 w-4" />,
    shortLabel: 'Pipeline'
  },
  {
    id: 'interviews',
    label: 'Interviews',
    icon: <Calendar className="h-4 w-4" />,
    shortLabel: 'Interviews'
  },
  {
    id: 'insights',
    label: 'Insights',
    icon: <TrendingUp className="h-4 w-4" />,
    shortLabel: 'Insights'
  },
  {
    id: 'questions',
    label: 'Questions',
    icon: <HelpCircle className="h-4 w-4" />,
    shortLabel: 'Questions'
  }
]

export const SimpleTabNavigation: React.FC<SimpleTabNavigationProps> = ({
  activeTab,
  onTabChange,
  candidateCount,
  isMobile = false
}) => {
  const carouselRef = useRef<HTMLDivElement>(null)
  const [touchStart, setTouchStart] = useState<number | null>(null)
  const [touchEnd, setTouchEnd] = useState<number | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  // Minimum swipe distance (in px)
  const minSwipeDistance = 50

  const currentIndex = tabs.findIndex(t => t.id === activeTab)

  const goToNextTab = useCallback(() => {
    const nextIndex = Math.min(currentIndex + 1, tabs.length - 1)
    if (nextIndex !== currentIndex) {
      onTabChange(tabs[nextIndex].id)
    }
  }, [currentIndex, onTabChange])

  const goToPrevTab = useCallback(() => {
    const prevIndex = Math.max(currentIndex - 1, 0)
    if (prevIndex !== currentIndex) {
      onTabChange(tabs[prevIndex].id)
    }
  }, [currentIndex, onTabChange])

  const onTouchStart = (e: React.TouchEvent) => {
    setTouchEnd(null)
    setTouchStart(e.targetTouches[0].clientX)
    setIsDragging(true)
  }

  const onTouchMove = (e: React.TouchEvent) => {
    if (!isDragging) return
    setTouchEnd(e.targetTouches[0].clientX)
  }

  const onTouchEnd = () => {
    if (!touchStart || !touchEnd) {
      setIsDragging(false)
      return
    }

    const distance = touchStart - touchEnd
    const isLeftSwipe = distance > minSwipeDistance
    const isRightSwipe = distance < -minSwipeDistance

    if (isLeftSwipe) {
      goToNextTab()
    } else if (isRightSwipe) {
      goToPrevTab()
    }

    setIsDragging(false)
    setTouchStart(null)
    setTouchEnd(null)
  }

  // Scroll active tab into view
  useEffect(() => {
    if (carouselRef.current) {
      const activeButton = carouselRef.current.querySelector(`[data-tab-id="${activeTab}"]`)
      if (activeButton) {
        activeButton.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
      }
    }
  }, [activeTab])

  if (isMobile) {
    return (
      <Card className="glass-card border-0 shadow-lg mb-4 overflow-hidden">
        {/* Swipeable Carousel Area */}
        <div
          className="relative"
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          {/* Navigation Arrows - subtle hints */}
          {currentIndex > 0 && (
            <button
              onClick={goToPrevTab}
              className="absolute left-1 top-1/2 -translate-y-1/2 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-black/40 border border-white/10 shadow-md backdrop-blur-sm opacity-60 hover:opacity-100 transition-opacity"
              aria-label="Previous tab"
            >
              <ChevronLeft className="h-4 w-4 text-white" />
            </button>
          )}
          {currentIndex < tabs.length - 1 && (
            <button
              onClick={goToNextTab}
              className="absolute right-1 top-1/2 -translate-y-1/2 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-black/40 border border-white/10 shadow-md backdrop-blur-sm opacity-60 hover:opacity-100 transition-opacity"
              aria-label="Next tab"
            >
              <ChevronRight className="h-4 w-4 text-white" />
            </button>
          )}

          {/* Main Tab Display */}
          <div className="px-4 py-4">
            <div
              ref={carouselRef}
              className="flex overflow-x-auto snap-x snap-mandatory scrollbar-hide gap-2 pb-2"
              style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
            >
              {tabs.map((tab, index) => {
                const isActive = activeTab === tab.id
                return (
                  <button
                    key={tab.id}
                    data-tab-id={tab.id}
                    onClick={() => onTabChange(tab.id)}
                    className={cn(
                      "flex-shrink-0 snap-center",
                      "min-w-[80px] h-16 flex flex-col items-center justify-center gap-1 px-4 py-2",
                      "rounded-xl transition-all duration-300 ease-out",
                      "rounded-xl transition-all duration-300 ease-out",
                      "border",
                      isActive
                        ? "bg-blue-600/20 text-blue-700 dark:text-blue-100 shadow-lg shadow-blue-500/10 border-blue-500/50 backdrop-blur-md"
                        : "bg-transparent text-gray-400 hover:bg-white/5 border-transparent hover:border-white/10"
                    )}
                  >
                    <div className={cn(
                      "transition-colors duration-200",
                      isActive ? "text-blue-400" : "text-gray-400"
                    )}>
                      {React.cloneElement(tab.icon as React.ReactElement<any>, {
                        className: "h-5 w-5"
                      })}
                    </div>
                    <span className={cn(
                      "text-xs font-medium leading-tight text-center",
                      isActive ? "text-blue-700 dark:text-blue-100" : "text-gray-400"
                    )}>
                      {tab.shortLabel}
                    </span>
                    {tab.id === 'candidates' && candidateCount !== undefined && candidateCount > 0 && (
                      <Badge
                        variant="secondary"
                        className={cn(
                          "text-[10px] px-1.5 py-0 min-w-[18px] h-4",
                          isActive
                            ? "bg-blue-500/20 text-blue-200 border-blue-500/30"
                            : "bg-white/10 text-gray-300 border-white/10"
                        )}
                      >
                        {candidateCount}
                      </Badge>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Progress Dots - now clickable and shows active state properly */}
          <div className="flex justify-center pb-3 gap-1.5">
            {tabs.map((tab, index) => (
              <button
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                className={cn(
                  "h-2 rounded-full transition-all duration-300 ease-out",
                  activeTab === tab.id
                    ? "bg-blue-600 w-6"
                    : "bg-gray-300 dark:bg-gray-600 w-2 hover:bg-gray-400 dark:hover:bg-muted/300"
                )}
                aria-label={`Go to ${tab.label} tab`}
              />
            ))}
          </div>

          {/* Swipe Hint - shows briefly on mount */}
          <div className="absolute bottom-10 left-1/2 -translate-x-1/2 text-[10px] text-muted-foreground/70 dark:text-muted-foreground pointer-events-none opacity-50">
            ← swipe to navigate →
          </div>
        </div>
      </Card>
    )
  }

  return (
    <Card className="glass-card border-0 shadow-lg mb-6">
      <CardContent className="p-4 sm:p-6">
        {/* Desktop Tab Grid */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 lg:gap-4">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={cn(
                "relative p-3 sm:p-4 rounded-lg",
                "border bg-transparent shadow-none",
                "simple-tab-transition simple-tab-hover simple-tab-focus",
                "focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:ring-offset-2 focus:ring-offset-transparent",
                activeTab === tab.id
                  ? "border-blue-500/50 bg-blue-600/10 text-blue-700 dark:text-blue-100 shadow-[0_0_15px_rgba(59,130,246,0.15)]"
                  : "border-transparent hover:border-white/10 hover:bg-white/5 text-gray-400"
              )}
            >
              {/* Tab Content */}
              <div className="flex flex-col items-center space-y-2 text-center">
                {/* Icon */}
                <div className={cn(
                  "transition-colors duration-200",
                  activeTab === tab.id ? "text-blue-400" : "text-gray-400"
                )}>
                  {tab.icon}
                </div>

                {/* Label */}
                <div className={cn(
                  "text-sm font-medium leading-tight",
                  activeTab === tab.id ? "text-blue-700 dark:text-blue-100" : "text-gray-400"
                )}>
                  <span className="hidden sm:inline">{tab.label}</span>
                  <span className="sm:hidden">{tab.shortLabel}</span>
                </div>

                {/* Candidate Count Badge */}
                {tab.id === 'candidates' && candidateCount !== undefined && candidateCount > 0 && (
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-xs px-2 py-0.5",
                      activeTab === tab.id
                        ? "border-blue-500/30 bg-blue-500/20 text-blue-200"
                        : "border-white/10 bg-white/5 text-gray-400"
                    )}
                  >
                    {candidateCount}
                  </Badge>
                )}
              </div>

              {/* Active Indicator */}
              {activeTab === tab.id && (
                <div className="absolute bottom-0 left-1/2 transform -translate-x-1/2 translate-y-1/2 w-2 h-2 bg-blue-600 rounded-full simple-tab-active-indicator" />
              )}
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
