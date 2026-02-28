'use client'

import { useState, useEffect, useCallback } from 'react'

export interface TabNotification {
  id: string
  tabId: string
  type: 'info' | 'warning' | 'error' | 'success'
  message: string
  count: number
  urgent: boolean
  timestamp: Date
  read: boolean
}

export interface TabStatus {
  id: string
  candidateCount?: number
  stageIssues?: number
  pipelineCandidates?: number
  pipelineHealth?: number
  questionTemplates?: number
  analyticsHealth?: number
  completionStatus?: 'complete' | 'active' | 'pending' | 'warning' | 'error'
  lastUpdated?: Date
}

interface UseTabNotificationsProps {
  jobId: string
  jobData?: any
  refreshTrigger?: number
}

export const useTabNotifications = ({ 
  jobId, 
  jobData,
  refreshTrigger 
}: UseTabNotificationsProps) => {
  const [notifications, setNotifications] = useState<TabNotification[]>([])
  const [tabStatus, setTabStatus] = useState<TabStatus>({
    id: jobId,
    candidateCount: 0,
    stageIssues: 0,
    pipelineCandidates: 0,
    pipelineHealth: 85,
    questionTemplates: 12,
    analyticsHealth: 85
  })

  // Generate notifications based on job data and status
  const generateNotifications = useCallback((data: any): TabNotification[] => {
    const newNotifications: TabNotification[] = []

    // Candidates notifications
    if (data?.newCandidatesCount > 0) {
      newNotifications.push({
        id: `candidates-new-${Date.now()}`,
        tabId: 'candidates',
        type: 'info',
        message: `${data.newCandidatesCount} new applications received`,
        count: data.newCandidatesCount,
        urgent: false,
        timestamp: new Date(),
        read: false
      })
    }

    if (data?.candidateCount > 50) {
      newNotifications.push({
        id: `candidates-high-${Date.now()}`,
        tabId: 'candidates',
        type: 'warning',
        message: 'High volume of candidates - consider reviewing pipeline',
        count: data.candidateCount,
        urgent: false,
        timestamp: new Date(),
        read: false
      })
    }

    // Stages notifications
    if (data?.stageIssues > 0) {
      newNotifications.push({
        id: `stages-issues-${Date.now()}`,
        tabId: 'stages',
        type: data.stageIssues > 2 ? 'error' : 'warning',
        message: `${data.stageIssues} stage configuration issues need attention`,
        count: data.stageIssues,
        urgent: data.stageIssues > 2,
        timestamp: new Date(),
        read: false
      })
    }

    if (data?.missingInterviewers > 0) {
      newNotifications.push({
        id: `stages-interviewers-${Date.now()}`,
        tabId: 'stages',
        type: 'warning',
        message: `${data.missingInterviewers} stages missing assigned interviewers`,
        count: data.missingInterviewers,
        urgent: true,
        timestamp: new Date(),
        read: false
      })
    }

    // Pipeline notifications
    if (data?.overdueCandidates > 0) {
      newNotifications.push({
        id: `pipeline-overdue-${Date.now()}`,
        tabId: 'pipeline',
        type: 'error',
        message: `${data.overdueCandidates} candidates are overdue in pipeline`,
        count: data.overdueCandidates,
        urgent: true,
        timestamp: new Date(),
        read: false
      })
    }

    if (data?.pipelineHealth < 70) {
      newNotifications.push({
        id: `pipeline-health-${Date.now()}`,
        tabId: 'pipeline',
        type: 'warning',
        message: 'Pipeline health score is below optimal threshold',
        count: Math.round(data.pipelineHealth || 0),
        urgent: data.pipelineHealth < 50,
        timestamp: new Date(),
        read: false
      })
    }

    // Analytics notifications
    if (data?.conversionRate < 20) {
      newNotifications.push({
        id: `analytics-conversion-${Date.now()}`,
        tabId: 'analytics',
        type: 'warning',
        message: 'Conversion rate is below industry average',
        count: Math.round(data.conversionRate || 0),
        urgent: false,
        timestamp: new Date(),
        read: false
      })
    }

    if (data?.timeToHire > 30) {
      newNotifications.push({
        id: `analytics-timeline-${Date.now()}`,
        tabId: 'analytics',
        type: 'info',
        message: 'Average time to hire exceeds target',
        count: Math.round(data.timeToHire || 0),
        urgent: false,
        timestamp: new Date(),
        read: false
      })
    }

    // Questions notifications
    if (data?.questionTemplates === 0) {
      newNotifications.push({
        id: `questions-empty-${Date.now()}`,
        tabId: 'questions',
        type: 'warning',
        message: 'No interview question templates configured',
        count: 0,
        urgent: true,
        timestamp: new Date(),
        read: false
      })
    }

    return newNotifications
  }, [])

  // Update tab status based on job data
  const updateTabStatus = useCallback((data: any) => {
    setTabStatus({
      id: jobId,
      candidateCount: data?.candidateCount || 0,
      stageIssues: data?.stageIssues || 0,
      pipelineCandidates: data?.pipelineCandidates || 0,
      pipelineHealth: data?.pipelineHealth || 85,
      questionTemplates: data?.questionTemplates || 12,
      analyticsHealth: data?.analyticsHealth || 85,
      completionStatus: determineCompletionStatus(data),
      lastUpdated: new Date()
    })
  }, [jobId])

  // Determine overall completion status
  const determineCompletionStatus = (data: any): 'complete' | 'active' | 'pending' | 'warning' | 'error' => {
    if (data?.stageIssues > 2) return 'error'
    if (data?.stageIssues > 0 || data?.overdueCandidates > 0) return 'warning'
    if (data?.candidateCount > 0 && data?.pipelineCandidates > 0) return 'active'
    if (data?.candidateCount === 0) return 'pending'
    return 'complete'
  }

  // Mock data generation for demo purposes
  const generateMockData = useCallback(() => {
    return {
      candidateCount: Math.floor(Math.random() * 50) + 5,
      newCandidatesCount: Math.floor(Math.random() * 5),
      stageIssues: Math.floor(Math.random() * 3),
      missingInterviewers: Math.floor(Math.random() * 2),
      pipelineCandidates: Math.floor(Math.random() * 20) + 5,
      overdueCandidates: Math.floor(Math.random() * 3),
      pipelineHealth: Math.floor(Math.random() * 40) + 60,
      conversionRate: Math.floor(Math.random() * 30) + 15,
      timeToHire: Math.floor(Math.random() * 20) + 15,
      questionTemplates: Math.floor(Math.random() * 15) + 5,
      analyticsHealth: Math.floor(Math.random() * 30) + 70
    }
  }, [])

  // Load notifications and status
  useEffect(() => {
    const data = jobData || generateMockData()
    updateTabStatus(data)
    const newNotifications = generateNotifications(data)
    setNotifications(prev => {
      // Remove old notifications for the same issues and add new ones
      const filtered = prev.filter(n => 
        !newNotifications.some(nn => nn.tabId === n.tabId && nn.type === n.type)
      )
      return [...filtered, ...newNotifications]
    })
  }, [jobData, generateNotifications, updateTabStatus, generateMockData, refreshTrigger])

  // Mark notification as read
  const markAsRead = useCallback((notificationId: string) => {
    setNotifications(prev => 
      prev.map(n => n.id === notificationId ? { ...n, read: true } : n)
    )
  }, [])

  // Mark all notifications for a tab as read
  const markTabAsRead = useCallback((tabId: string) => {
    setNotifications(prev => 
      prev.map(n => n.tabId === tabId ? { ...n, read: true } : n)
    )
  }, [])

  // Clear old notifications
  const clearOldNotifications = useCallback(() => {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
    setNotifications(prev => 
      prev.filter(n => n.timestamp > oneDayAgo || !n.read)
    )
  }, [])

  // Auto-clear old notifications
  useEffect(() => {
    const interval = setInterval(clearOldNotifications, 60 * 60 * 1000) // Every hour
    return () => clearInterval(interval)
  }, [clearOldNotifications])

  // Get notifications for a specific tab
  const getTabNotifications = useCallback((tabId: string) => {
    return notifications.filter(n => n.tabId === tabId)
  }, [notifications])

  // Get unread count for a tab
  const getUnreadCount = useCallback((tabId: string) => {
    return notifications.filter(n => n.tabId === tabId && !n.read).length
  }, [notifications])

  // Get urgent notifications
  const getUrgentNotifications = useCallback(() => {
    return notifications.filter(n => n.urgent && !n.read)
  }, [notifications])

  return {
    notifications,
    tabStatus,
    markAsRead,
    markTabAsRead,
    getTabNotifications,
    getUnreadCount,
    getUrgentNotifications,
    clearOldNotifications
  }
}
