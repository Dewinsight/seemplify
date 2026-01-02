'use client'

import React, { useState, useEffect } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { 
  ClipboardList, 
  Users, 
  Target, 
  GitBranch, 
  BarChart3, 
  HelpCircle,
  AlertTriangle,
  CheckCircle,
  Clock,
  TrendingUp
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSwipeNavigation } from '@/hooks/useSwipeNavigation'

export interface TabStatus {
  id: string
  label: string
  icon: React.ReactNode
  status: 'complete' | 'active' | 'pending' | 'warning' | 'error'
  count?: number
  progress?: number
  healthScore?: number
  lastUpdated?: Date
  shortcut?: string
}

export interface TabNotification {
  tabId: string
  type: 'info' | 'warning' | 'error' | 'success'
  message: string
  count: number
  urgent: boolean
}

interface EnhancedTabNavigationProps {
  activeTab: string
  onTabChange: (tabId: string) => void
  jobData?: any
  isMobile?: boolean
}

// Default tab configurations
const defaultTabStatuses: TabStatus[] = [
  {
    id: 'overview',
    label: 'Overview',
    icon: <ClipboardList className="h-5 w-5" />,
    status: 'complete',
    progress: 100,
    shortcut: 'Alt+1'
  },
  {
    id: 'candidates',
    label: 'Candidates',
    icon: <Users className="h-5 w-5" />,
    status: 'active',
    count: 0,
    healthScore: 85,
    shortcut: 'Alt+2'
  },
  {
    id: 'stages',
    label: 'Stages',
    icon: <Target className="h-5 w-5" />,
    status: 'pending',
    progress: 75,
    shortcut: 'Alt+3'
  },
  {
    id: 'pipeline',
    label: 'Pipeline',
    icon: <GitBranch className="h-5 w-5" />,
    status: 'active',
    healthScore: 92,
    shortcut: 'Alt+4'
  },
  {
    id: 'analytics',
    label: 'Analytics & Statistics',
    icon: <BarChart3 className="h-5 w-5" />,
    status: 'complete',
    healthScore: 85,
    shortcut: 'Alt+5'
  },
  {
    id: 'questions',
    label: 'Questions',
    icon: <HelpCircle className="h-5 w-5" />,
    status: 'pending',
    count: 12,
    shortcut: 'Alt+6'
  }
]

// Tooltip content for each tab
const tooltipContent: Record<string, { description: string; status: string }> = {
  overview: {
    description: "Job details, requirements, and basic information",
    status: "Complete - All required fields filled"
  },
  candidates: {
    description: "View and manage all job applications",
    status: "Active candidates in pipeline"
  },
  stages: {
    description: "Configure and manage interview workflow",
    status: "Interview stages configuration"
  },
  pipeline: {
    description: "Visual candidate flow through interview stages",
    status: "Candidates in active pipeline"
  },
  analytics: {
    description: "Performance metrics and hiring insights",
    status: "Analytics and conversion tracking"
  },
  questions: {
    description: "Question templates and interview guides",
    status: "Available question templates"
  }
}

interface EnhancedTabTriggerProps {
  tab: TabStatus
  isActive: boolean
  notifications: TabNotification[]
  onClick: () => void
}

const EnhancedTabTrigger: React.FC<EnhancedTabTriggerProps> = ({
  tab,
  isActive,
  notifications,
  onClick
}) => {
  const hasNotifications = notifications.length > 0
  const urgentCount = notifications.filter(n => n.urgent).length
  
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'complete': return 'text-green-600'
      case 'active': return 'text-blue-600'
      case 'warning': return 'text-yellow-600'
      case 'error': return 'text-red-600'
      default: return 'text-muted-foreground'
    }
  }
  
  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'complete': return <CheckCircle className="h-3 w-3" />
      case 'active': return <Clock className="h-3 w-3" />
      case 'warning': return <AlertTriangle className="h-3 w-3" />
      case 'error': return <AlertTriangle className="h-3 w-3" />
      default: return <Clock className="h-3 w-3" />
    }
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            className={cn(
              "relative group p-4 rounded-xl transition-all duration-200 w-full",
              "border-2 bg-white/80 backdrop-blur-sm shadow-sm",
              "hover:shadow-md hover:-translate-y-0.5 focus-ring",
              "focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2",
              isActive
                ? "border-blue-500 bg-gradient-to-br from-blue-500 to-blue-600 text-white shadow-lg scale-105"
                : "border-transparent hover:border-blue-200 hover:bg-blue-50 text-slate-700"
            )}
            onClick={onClick}
            role="tab"
            aria-selected={isActive}
            aria-controls={`panel-${tab.id}`}
            id={`tab-${tab.id}`}
            tabIndex={isActive ? 0 : -1}
            aria-label={`${tab.label} tab${hasNotifications ? `, ${urgentCount > 0 ? urgentCount + ' urgent' : notifications.length} notifications` : ''}${tab.status ? `, status: ${tab.status}` : ''}${tab.count !== undefined ? `, ${tab.count} items` : ''}${tab.healthScore !== undefined ? `, ${tab.healthScore}% health score` : ''}`}
          >
            {/* Notification Indicator */}
            {hasNotifications && (
              <div className="absolute -top-2 -right-2 flex items-center justify-center z-10">
                {urgentCount > 0 ? (
                  <Badge variant="destructive" className="animate-pulse text-xs px-1.5 py-0.5">
                    {urgentCount}
                  </Badge>
                ) : (
                  <div className="w-3 h-3 bg-blue-500 rounded-full animate-pulse" />
                )}
              </div>
            )}

            {/* Tab Content */}
            <div className="flex flex-col items-center space-y-3">
              {/* Icon */}
              <div className={cn(
                "transition-all duration-200",
                isActive ? "text-white scale-110" : "text-slate-600 group-hover:text-blue-600"
              )}>
                {tab.icon}
              </div>
              
              {/* Label */}
              <div className={cn(
                "text-sm font-medium text-center leading-tight",
                isActive ? "text-white" : "text-slate-700 group-hover:text-blue-700"
              )}>
                {tab.label}
              </div>
              
              {/* Status Indicators */}
              <div className="flex flex-col items-center space-y-1">
                {/* Status Badge */}
                <div className="flex items-center space-x-1">
                  {tab.status === 'complete' && (
                    <Badge 
                      variant={isActive ? "secondary" : "default"} 
                      className={cn(
                        "text-xs px-2 py-0.5 flex items-center space-x-1",
                        isActive ? "bg-white/20 text-white" : "bg-green-100 text-green-700"
                      )}
                    >
                      <CheckCircle className="h-3 w-3" />
                      <span>Complete</span>
                    </Badge>
                  )}
                  
                  {tab.count !== undefined && (
                    <Badge 
                      variant={isActive ? "secondary" : "outline"} 
                      className={cn(
                        "text-xs px-2 py-0.5",
                        isActive ? "bg-white/20 text-white border-white/30" : "border-slate-300"
                      )}
                    >
                      {tab.count}
                    </Badge>
                  )}
                </div>

                {/* Health Score */}
                {tab.healthScore && (
                  <div className="flex items-center space-x-1 text-xs">
                    <div className={cn(
                      "w-2 h-2 rounded-full",
                      tab.healthScore >= 80 ? "bg-green-400" : 
                      tab.healthScore >= 60 ? "bg-yellow-400" : "bg-red-400",
                      isActive && "bg-white"
                    )} />
                    <span className={cn(
                      isActive ? "text-white" : "text-slate-600"
                    )}>
                      {tab.healthScore}%
                    </span>
                  </div>
                )}

                {/* Status Icon for non-complete states */}
                {tab.status !== 'complete' && (
                  <div className={cn(
                    "flex items-center space-x-1 text-xs",
                    isActive ? "text-white" : getStatusColor(tab.status)
                  )}>
                    {getStatusIcon(tab.status)}
                    <span className="capitalize">{tab.status}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Progress Bar */}
            {tab.progress !== undefined && (
              <div className={cn(
                "absolute bottom-0 left-0 right-0 h-1 rounded-b-xl overflow-hidden",
                isActive ? "bg-white/20" : "bg-black/10"
              )}>
                <div
                  className={cn(
                    "h-full transition-all duration-300",
                    isActive ? "bg-white/60" : "bg-blue-500"
                  )}
                  style={{ width: `${tab.progress}%` }}
                />
              </div>
            )}
          </button>
        </TooltipTrigger>
        
        <TooltipContent side="bottom" className="max-w-xs">
          <div className="space-y-2">
            <div className="font-medium">{tab.label}</div>
            <div className="text-sm text-muted-foreground">
              {tooltipContent[tab.id]?.description}
            </div>
            <div className="text-sm text-muted-foreground">
              Status: {tooltipContent[tab.id]?.status}
            </div>
            {tab.shortcut && (
              <div className="text-xs">
                <kbd className="px-1.5 py-0.5 bg-muted rounded font-mono">
                  {tab.shortcut}
                </kbd>
              </div>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

const MobileTabNavigation: React.FC<{
  tabs: TabStatus[]
  activeTab: string
  onTabChange: (tabId: string) => void
  notifications: TabNotification[]
}> = ({ tabs, activeTab, onTabChange, notifications }) => {
  const activeTabData = tabs.find(tab => tab.id === activeTab)
  const activeNotifications = notifications.filter(n => n.tabId === activeTab)
  
  // Setup swipe navigation
  const tabIds = tabs.map(tab => tab.id)
  const swipeHandlers = {
    onSwipeLeft: () => {
      const currentIndex = tabIds.findIndex(id => id === activeTab)
      const nextIndex = Math.min(currentIndex + 1, tabIds.length - 1)
      if (nextIndex !== currentIndex) {
        onTabChange(tabIds[nextIndex])
      }
    },
    onSwipeRight: () => {
      const currentIndex = tabIds.findIndex(id => id === activeTab)
      const prevIndex = Math.max(currentIndex - 1, 0)
      if (prevIndex !== currentIndex) {
        onTabChange(tabIds[prevIndex])
      }
    }
  }
  
  const { elementRef, isSwipeInProgress } = useSwipeNavigation({
    ...swipeHandlers,
    threshold: 50,
    enabled: true
  })
  
  return (
    <div className="lg:hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b bg-white/50 backdrop-blur-sm rounded-t-xl">
        <div className="flex flex-col">
          <h2 className="font-semibold text-slate-900">Job Management</h2>
          <div className="flex items-center space-x-1 text-xs text-slate-500 mt-1">
            <span>Swipe to navigate</span>
            <div className="flex items-center space-x-1 swipe-hint">
              <div className="w-1 h-1 bg-slate-400 rounded-full"></div>
              <div className="w-1 h-1 bg-slate-400 rounded-full"></div>
              <div className="w-1 h-1 bg-slate-400 rounded-full"></div>
            </div>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          {activeTabData && (
            <Badge variant="outline" className="flex items-center space-x-1">
              {activeTabData.icon}
              <span className="hidden sm:inline">{activeTabData.label}</span>
            </Badge>
          )}
          {activeNotifications.length > 0 && (
            <Badge variant="destructive" className="notification-pulse">
              {activeNotifications.length}
            </Badge>
          )}
        </div>
      </div>
      
      {/* Swipeable Navigation Area */}
      <div 
        ref={elementRef as React.RefObject<HTMLDivElement>}
        className={cn(
          "relative overflow-hidden bg-white/80 backdrop-blur-sm",
          isSwipeInProgress && "bg-blue-50/50"
        )}
      >
        {/* Current Tab Display with Touch-Friendly UI */}
        <div className="p-4 space-y-4">
          {/* Large Tab Indicator */}
          <div className="flex items-center justify-center space-x-2 py-4 bg-gradient-to-r from-blue-50 to-purple-50 rounded-xl">
            <div className="text-2xl">{activeTabData?.icon}</div>
            <div className="flex flex-col">
              <div className="font-medium text-slate-900">{activeTabData?.label}</div>
              {activeTabData?.status && (
                <div className="flex items-center space-x-1 text-sm">
                  {activeTabData.status === 'complete' && (
                    <>
                      <CheckCircle className="h-3 w-3 text-green-600" />
                      <span className="text-green-600">Complete</span>
                    </>
                  )}
                  {activeTabData.status === 'active' && (
                    <>
                      <Clock className="h-3 w-3 text-blue-600" />
                      <span className="text-blue-600">Active</span>
                    </>
                  )}
                  {activeTabData.status === 'warning' && (
                    <>
                      <AlertTriangle className="h-3 w-3 text-yellow-600" />
                      <span className="text-yellow-600">Needs Attention</span>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
          
          {/* Tab Stats */}
          {(activeTabData?.count !== undefined || activeTabData?.healthScore !== undefined) && (
            <div className="grid grid-cols-2 gap-4">
              {activeTabData.count !== undefined && (
                <div className="bg-white/60 rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-slate-900">{activeTabData.count}</div>
                  <div className="text-xs text-slate-600">Items</div>
                </div>
              )}
              {activeTabData.healthScore !== undefined && (
                <div className="bg-white/60 rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-slate-900">{activeTabData.healthScore}%</div>
                  <div className="text-xs text-slate-600">Health Score</div>
                </div>
              )}
            </div>
          )}
        </div>
        
        {/* Tab Progress Indicators */}
        <div className="flex items-center justify-center space-x-2 pb-4">
          {tabs.map((tab, index) => (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={cn(
                "w-2 h-2 rounded-full transition-all duration-200",
                activeTab === tab.id 
                  ? "bg-blue-600 w-6" 
                  : "bg-slate-300 hover:bg-slate-400"
              )}
              aria-label={`Go to ${tab.label} tab`}
            />
          ))}
        </div>
      </div>
      
      {/* Alternative Dropdown (Collapsed by default) */}
      <details className="bg-white/60 backdrop-blur-sm">
        <summary className="p-3 cursor-pointer text-sm text-slate-600 hover:text-slate-900 border-t">
          View All Tabs
        </summary>
        <div className="px-4 pb-4">
          <div className="grid grid-cols-2 gap-2">
            {tabs.map((tab) => {
              const tabNotifications = notifications.filter(n => n.tabId === tab.id)
              const isActive = activeTab === tab.id
              
              return (
                <Button
                  key={tab.id}
                  variant={isActive ? "default" : "outline"}
                  size="sm"
                  className={cn(
                    "relative h-12 justify-start",
                    isActive && "bg-blue-600 text-white shadow-lg"
                  )}
                  onClick={() => onTabChange(tab.id)}
                >
                  <div className="flex items-center space-x-2">
                    {tab.icon}
                    <span className="text-xs">{tab.label}</span>
                  </div>
                  {tabNotifications.length > 0 && (
                    <Badge variant="destructive" className="absolute -top-1 -right-1 text-xs px-1">
                      {tabNotifications.length}
                    </Badge>
                  )}
                </Button>
              )
            })}
          </div>
        </div>
      </details>
    </div>
  )
}

export const EnhancedTabNavigation: React.FC<EnhancedTabNavigationProps> = ({
  activeTab,
  onTabChange,
  jobData,
  isMobile = false
}) => {
  const [tabStatuses, setTabStatuses] = useState<TabStatus[]>(defaultTabStatuses)
  const [notifications, setNotifications] = useState<TabNotification[]>([])

  // Update tab statuses based on job data
  useEffect(() => {
    if (jobData) {
      setTabStatuses(prev => prev.map(tab => {
        switch (tab.id) {
          case 'candidates':
            return {
              ...tab,
              count: jobData.candidateCount || 0,
              status: (jobData.candidateCount || 0) > 0 ? 'active' : 'pending'
            }
          case 'stages':
            return {
              ...tab,
              count: jobData.stageIssues || 0,
              status: (jobData.stageIssues || 0) > 0 ? 'warning' : 'complete'
            }
          case 'pipeline':
            return {
              ...tab,
              count: jobData.pipelineCandidates || 0,
              healthScore: jobData.pipelineHealth || 85
            }
          case 'questions':
            return {
              ...tab,
              count: jobData.questionTemplates || 12
            }
          default:
            return tab
        }
      }))
    }
  }, [jobData])

  // Simulate notifications (in real app, this would come from a service)
  useEffect(() => {
    const mockNotifications: TabNotification[] = []
    
    if ((jobData?.candidateCount || 0) > 0) {
      mockNotifications.push({
        tabId: 'candidates',
        type: 'info',
        message: 'New applications received',
        count: 3,
        urgent: false
      })
    }
    
    if ((jobData?.stageIssues || 0) > 0) {
      mockNotifications.push({
        tabId: 'stages',
        type: 'warning',
        message: 'Missing interviewers',
        count: jobData.stageIssues,
        urgent: true
      })
    }
    
    setNotifications(mockNotifications)
  }, [jobData])

  // Enhanced keyboard navigation with accessibility
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Alt + Number shortcuts
      if (event.altKey && event.key >= '1' && event.key <= '6') {
        event.preventDefault()
        const tabIndex = parseInt(event.key) - 1
        if (tabStatuses[tabIndex]) {
          onTabChange(tabStatuses[tabIndex].id)
          // Announce tab change to screen readers
          const announcement = `Switched to ${tabStatuses[tabIndex].label} tab`
          announceToScreenReader(announcement)
        }
        return
      }

      // Only handle tab navigation when focused on tab navigation
      const activeElement = document.activeElement
      const isTabNavigation = activeElement?.closest('[role="tablist"]')
      
      if (!isTabNavigation) return

      switch (event.key) {
        case 'ArrowLeft':
        case 'ArrowUp':
          event.preventDefault()
          navigateToPrevTab()
          break
        case 'ArrowRight':
        case 'ArrowDown':
          event.preventDefault()
          navigateToNextTab()
          break
        case 'Home':
          event.preventDefault()
          onTabChange(tabStatuses[0].id)
          break
        case 'End':
          event.preventDefault()
          onTabChange(tabStatuses[tabStatuses.length - 1].id)
          break
      }
    }

    const navigateToPrevTab = () => {
      const currentIndex = tabStatuses.findIndex(tab => tab.id === activeTab)
      const prevIndex = currentIndex > 0 ? currentIndex - 1 : tabStatuses.length - 1
      onTabChange(tabStatuses[prevIndex].id)
    }

    const navigateToNextTab = () => {
      const currentIndex = tabStatuses.findIndex(tab => tab.id === activeTab)
      const nextIndex = currentIndex < tabStatuses.length - 1 ? currentIndex + 1 : 0
      onTabChange(tabStatuses[nextIndex].id)
    }

    const announceToScreenReader = (message: string) => {
      const announcement = document.createElement('div')
      announcement.setAttribute('aria-live', 'polite')
      announcement.setAttribute('aria-atomic', 'true')
      announcement.className = 'sr-only'
      announcement.textContent = message
      document.body.appendChild(announcement)
      
      setTimeout(() => {
        document.body.removeChild(announcement)
      }, 1000)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [tabStatuses, onTabChange, activeTab])

  if (isMobile) {
    return (
      <Card className="border-0 bg-white/60 backdrop-blur-xl shadow-lg mb-6">
        <MobileTabNavigation
          tabs={tabStatuses}
          activeTab={activeTab}
          onTabChange={onTabChange}
          notifications={notifications}
        />
      </Card>
    )
  }

  return (
    <Card className="border-0 bg-white/60 backdrop-blur-xl shadow-lg mb-6">
      <CardContent className="p-6">
        {/* Screen Reader Instructions */}
        <div className="sr-only">
          <p>Job management navigation. Use arrow keys to navigate between tabs, or press Alt plus a number key to jump directly to a tab.</p>
        </div>
        
        {/* Enhanced Tab Grid with ARIA */}
        <div 
          role="tablist" 
          aria-label="Job management sections"
          className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4"
        >
          {tabStatuses.map((tab, index) => (
            <EnhancedTabTrigger
              key={tab.id}
              tab={tab}
              isActive={activeTab === tab.id}
              notifications={notifications.filter(n => n.tabId === tab.id)}
              onClick={() => onTabChange(tab.id)}
            />
          ))}
        </div>
        
        {/* Live Region for Announcements */}
        <div aria-live="polite" aria-atomic="true" className="sr-only" id="tab-announcements"></div>
        
        {/* Progress Indicator with Accessibility */}
        <div className="mt-6 space-y-2" role="status" aria-label="Overall job setup progress">
          <div className="flex items-center justify-between text-sm text-slate-600">
            <span>Overall Progress</span>
            <span aria-label={`${Math.round(tabStatuses.reduce((acc, tab) => acc + (tab.progress || 0), 0) / tabStatuses.length)} percent complete`}>
              {Math.round(tabStatuses.reduce((acc, tab) => acc + (tab.progress || 0), 0) / tabStatuses.length)}%
            </span>
          </div>
          <div className="w-full bg-slate-200 rounded-full h-2" role="progressbar" 
               aria-valuenow={Math.round(tabStatuses.reduce((acc, tab) => acc + (tab.progress || 0), 0) / tabStatuses.length)} 
               aria-valuemin={0} 
               aria-valuemax={100}
               aria-label="Job setup completion progress">
            <div
              className="bg-gradient-to-r from-blue-500 to-green-500 h-2 rounded-full transition-all duration-500 progress-animated"
              style={{ 
                width: `${Math.round(tabStatuses.reduce((acc, tab) => acc + (tab.progress || 0), 0) / tabStatuses.length)}%` 
              }}
            />
          </div>
        </div>

        {/* Keyboard Shortcuts Help */}
        <details className="mt-4">
          <summary className="text-xs text-slate-500 cursor-pointer hover:text-slate-700">
            Keyboard Shortcuts
          </summary>
          <div className="mt-2 text-xs text-slate-600 space-y-1">
            <div><kbd className="px-1 py-0.5 bg-slate-100 rounded text-xs">Alt + 1-6</kbd> Jump to specific tab</div>
            <div><kbd className="px-1 py-0.5 bg-slate-100 rounded text-xs">← →</kbd> Navigate between tabs</div>
            <div><kbd className="px-1 py-0.5 bg-slate-100 rounded text-xs">Home/End</kbd> First/Last tab</div>
            <div><kbd className="px-1 py-0.5 bg-slate-100 rounded text-xs">Tab</kbd> Navigate through interface</div>
          </div>
        </details>
      </CardContent>
    </Card>
  )
}
