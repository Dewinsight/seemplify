'use client'

import { TabStatus } from '@/hooks/useTabNotifications'

export interface JobAnalytics {
  candidateCount: number
  newCandidatesCount: number
  stageIssues: number
  missingInterviewers: number
  pipelineCandidates: number
  overdueCandidates: number
  pipelineHealth: number
  conversionRate: number
  timeToHire: number
  questionTemplates: number
  analyticsHealth: number
  completedInterviews: number
  averageTimePerStage: Record<string, number>
  topBottlenecks: string[]
  lastUpdated: Date
}

export interface TabMetrics {
  overview: {
    completionPercentage: number
    requiredFieldsFilled: number
    totalRequiredFields: number
    lastUpdated: Date
  }
  candidates: {
    total: number
    new: number
    active: number
    rejected: number
    hired: number
    averageScore: number
    topSources: string[]
    recentActivity: Array<{
      type: string
      candidateName: string
      timestamp: Date
    }>
  }
  stages: {
    configured: number
    total: number
    issues: string[]
    missingInterviewers: string[]
    averageTimePerStage: Record<string, number>
    bottlenecks: string[]
  }
  pipeline: {
    totalCandidates: number
    stageDistribution: Record<string, number>
    healthScore: number
    velocity: number
    overdueCount: number
    conversionRates: Record<string, number>
  }
  analytics: {
    healthScore: number
    trendsAvailable: boolean
    reportGenerated: Date | null
    keyInsights: string[]
    dataCompleteness: number
  }
  questions: {
    templates: number
    categories: string[]
    recentlyUsed: number
    completionRate: number
  }
}

class TabStatusService {
  private static instance: TabStatusService
  private cache: Map<string, { data: JobAnalytics; timestamp: number }> = new Map()
  private readonly CACHE_DURATION = 5 * 60 * 1000 // 5 minutes

  public static getInstance(): TabStatusService {
    if (!TabStatusService.instance) {
      TabStatusService.instance = new TabStatusService()
    }
    return TabStatusService.instance
  }

  /**
   * Fetch comprehensive job analytics for tab status calculation
   */
  async fetchJobAnalytics(jobId: string, forceRefresh = false): Promise<JobAnalytics> {
    const cacheKey = `analytics_${jobId}`
    const cached = this.cache.get(cacheKey)
    
    if (!forceRefresh && cached && Date.now() - cached.timestamp < this.CACHE_DURATION) {
      return cached.data
    }

    try {
      // In a real implementation, these would be actual API calls
      const [
        candidatesData,
        stagesData,
        pipelineData,
        analyticsData,
        questionsData
      ] = await Promise.all([
        this.fetchCandidateMetrics(jobId),
        this.fetchStageMetrics(jobId),
        this.fetchPipelineMetrics(jobId),
        this.fetchAnalyticsMetrics(jobId),
        this.fetchQuestionMetrics(jobId)
      ])

      const analytics: JobAnalytics = {
        candidateCount: candidatesData.total,
        newCandidatesCount: candidatesData.new,
        stageIssues: stagesData.issues.length,
        missingInterviewers: stagesData.missingInterviewers.length,
        pipelineCandidates: pipelineData.totalCandidates,
        overdueCandidates: pipelineData.overdueCount,
        pipelineHealth: pipelineData.healthScore,
        conversionRate: this.calculateOverallConversionRate(pipelineData.conversionRates),
        timeToHire: this.calculateAverageTimeToHire(stagesData.averageTimePerStage),
        questionTemplates: questionsData.templates,
        analyticsHealth: analyticsData.healthScore,
        completedInterviews: pipelineData.totalCandidates - candidatesData.active,
        averageTimePerStage: stagesData.averageTimePerStage,
        topBottlenecks: stagesData.bottlenecks,
        lastUpdated: new Date()
      }

      // Cache the result
      this.cache.set(cacheKey, { data: analytics, timestamp: Date.now() })
      return analytics

    } catch (error) {
      console.error('Error fetching job analytics:', error)
      // Return mock data as fallback
      return this.generateMockAnalytics(jobId)
    }
  }

  /**
   * Calculate detailed tab metrics from job analytics
   */
  calculateTabMetrics(analytics: JobAnalytics): TabMetrics {
    return {
      overview: {
        completionPercentage: this.calculateOverviewCompletion(analytics),
        requiredFieldsFilled: 8, // Mock data
        totalRequiredFields: 10,
        lastUpdated: analytics.lastUpdated
      },
      candidates: {
        total: analytics.candidateCount,
        new: analytics.newCandidatesCount,
        active: Math.floor(analytics.candidateCount * 0.6),
        rejected: Math.floor(analytics.candidateCount * 0.25),
        hired: Math.floor(analytics.candidateCount * 0.15),
        averageScore: 75 + Math.random() * 20,
        topSources: ['LinkedIn', 'Company Website', 'Referrals'],
        recentActivity: [] // Would be populated from real data
      },
      stages: {
        configured: Math.max(1, 5 - analytics.stageIssues),
        total: 5,
        issues: this.generateStageIssues(analytics.stageIssues),
        missingInterviewers: this.generateMissingInterviewers(analytics.missingInterviewers),
        averageTimePerStage: analytics.averageTimePerStage,
        bottlenecks: analytics.topBottlenecks
      },
      pipeline: {
        totalCandidates: analytics.pipelineCandidates,
        stageDistribution: this.generateStageDistribution(analytics.pipelineCandidates),
        healthScore: analytics.pipelineHealth,
        velocity: Math.max(1, Math.floor(analytics.pipelineCandidates / analytics.timeToHire)),
        overdueCount: analytics.overdueCandidates,
        conversionRates: this.generateConversionRates(analytics.conversionRate)
      },
      analytics: {
        healthScore: analytics.analyticsHealth,
        trendsAvailable: analytics.candidateCount > 10,
        reportGenerated: analytics.candidateCount > 5 ? analytics.lastUpdated : null,
        keyInsights: this.generateInsights(analytics),
        dataCompleteness: Math.min(100, (analytics.candidateCount / 20) * 100)
      },
      questions: {
        templates: analytics.questionTemplates,
        categories: ['Technical', 'Behavioral', 'Cultural', 'Role-specific'],
        recentlyUsed: Math.floor(analytics.questionTemplates * 0.6),
        completionRate: Math.min(100, analytics.questionTemplates * 8.33)
      }
    }
  }

  /**
   * Get tab status based on metrics
   */
  getTabStatus(tabId: string, metrics: TabMetrics): 'complete' | 'active' | 'pending' | 'warning' | 'error' {
    switch (tabId) {
      case 'overview':
        if (metrics.overview.completionPercentage >= 100) return 'complete'
        if (metrics.overview.completionPercentage >= 80) return 'active'
        if (metrics.overview.completionPercentage >= 50) return 'warning'
        return 'pending'

      case 'candidates':
        if (metrics.candidates.total === 0) return 'pending'
        if (metrics.candidates.total > 50) return 'warning'
        if (metrics.candidates.new > 0) return 'active'
        return 'complete'

      case 'stages':
        if (metrics.stages.issues.length > 2) return 'error'
        if (metrics.stages.issues.length > 0) return 'warning'
        if (metrics.stages.configured < metrics.stages.total) return 'active'
        return 'complete'

      case 'pipeline':
        if (metrics.pipeline.overdueCount > 3) return 'error'
        if (metrics.pipeline.healthScore < 60) return 'warning'
        if (metrics.pipeline.totalCandidates > 0) return 'active'
        return 'pending'

      case 'analytics':
        if (metrics.analytics.dataCompleteness < 30) return 'pending'
        if (metrics.analytics.healthScore < 60) return 'warning'
        if (metrics.analytics.trendsAvailable) return 'complete'
        return 'active'

      case 'questions':
        if (metrics.questions.templates === 0) return 'error'
        if (metrics.questions.templates < 5) return 'warning'
        if (metrics.questions.completionRate >= 100) return 'complete'
        return 'active'

      default:
        return 'pending'
    }
  }

  // Private helper methods

  private async fetchCandidateMetrics(jobId: string) {
    // Mock API call
    await this.delay(100)
    const total = Math.floor(Math.random() * 30) + 5
    return {
      total,
      new: Math.floor(Math.random() * 5),
      active: Math.floor(total * 0.6),
      rejected: Math.floor(total * 0.25),
      hired: Math.floor(total * 0.15)
    }
  }

  private async fetchStageMetrics(jobId: string) {
    await this.delay(150)
    const issueCount = Math.floor(Math.random() * 3)
    return {
      configured: 5 - issueCount,
      total: 5,
      issues: Array(issueCount).fill(0).map((_, i) => `Issue ${i + 1}`),
      missingInterviewers: Array(Math.floor(Math.random() * 2)).fill(0).map((_, i) => `Stage ${i + 1}`),
      averageTimePerStage: {
        'phone-screen': 2 + Math.random() * 3,
        'technical': 5 + Math.random() * 5,
        'behavioral': 3 + Math.random() * 4,
        'final': 4 + Math.random() * 6
      },
      bottlenecks: ['Technical Interview', 'Final Review'].slice(0, Math.floor(Math.random() * 2) + 1)
    }
  }

  private async fetchPipelineMetrics(jobId: string) {
    await this.delay(200)
    const totalCandidates = Math.floor(Math.random() * 20) + 5
    return {
      totalCandidates,
      healthScore: Math.floor(Math.random() * 40) + 60,
      overdueCount: Math.floor(Math.random() * 4),
      conversionRates: {
        'phone-to-technical': 60 + Math.random() * 30,
        'technical-to-behavioral': 40 + Math.random() * 40,
        'behavioral-to-final': 70 + Math.random() * 25,
        'final-to-offer': 80 + Math.random() * 15
      }
    }
  }

  private async fetchAnalyticsMetrics(jobId: string) {
    await this.delay(120)
    return {
      healthScore: Math.floor(Math.random() * 30) + 70,
      trendsAvailable: Math.random() > 0.3,
      reportGenerated: Math.random() > 0.5 ? new Date() : null
    }
  }

  private async fetchQuestionMetrics(jobId: string) {
    await this.delay(80)
    return {
      templates: Math.floor(Math.random() * 15) + 5,
      categories: 4,
      recentlyUsed: Math.floor(Math.random() * 10) + 2
    }
  }

  private generateMockAnalytics(jobId: string): JobAnalytics {
    const candidateCount = Math.floor(Math.random() * 30) + 10
    return {
      candidateCount,
      newCandidatesCount: Math.floor(Math.random() * 5) + 1,
      stageIssues: Math.floor(Math.random() * 3),
      missingInterviewers: Math.floor(Math.random() * 2),
      pipelineCandidates: Math.floor(candidateCount * 0.8),
      overdueCandidates: Math.floor(Math.random() * 3),
      pipelineHealth: Math.floor(Math.random() * 40) + 60,
      conversionRate: Math.floor(Math.random() * 30) + 50,
      timeToHire: Math.floor(Math.random() * 15) + 20,
      questionTemplates: Math.floor(Math.random() * 10) + 8,
      analyticsHealth: Math.floor(Math.random() * 25) + 75,
      completedInterviews: Math.floor(candidateCount * 0.3),
      averageTimePerStage: {
        'phone-screen': 2 + Math.random() * 2,
        'technical': 5 + Math.random() * 3,
        'behavioral': 3 + Math.random() * 2,
        'final': 4 + Math.random() * 4
      },
      topBottlenecks: ['Technical Interview', 'Final Review'],
      lastUpdated: new Date()
    }
  }

  private calculateOverviewCompletion(analytics: JobAnalytics): number {
    let score = 0
    if (analytics.candidateCount > 0) score += 20
    if (analytics.questionTemplates > 0) score += 20
    if (analytics.stageIssues === 0) score += 20
    if (analytics.pipelineCandidates > 0) score += 20
    if (analytics.pipelineHealth > 80) score += 20
    return score
  }

  private calculateOverallConversionRate(rates: Record<string, number>): number {
    const values = Object.values(rates)
    return values.reduce((sum, rate) => sum + rate, 0) / values.length
  }

  private calculateAverageTimeToHire(stageTime: Record<string, number>): number {
    return Object.values(stageTime).reduce((sum, time) => sum + time, 0)
  }

  private generateStageIssues(count: number): string[] {
    const possibleIssues = [
      'Missing interviewer assignments',
      'Undefined evaluation criteria',
      'No question templates configured',
      'Stage duration not set',
      'Missing approval workflow'
    ]
    return possibleIssues.slice(0, count)
  }

  private generateMissingInterviewers(count: number): string[] {
    const stages = ['Phone Screen', 'Technical Review', 'Behavioral Interview', 'Final Interview']
    return stages.slice(0, count)
  }

  private generateStageDistribution(total: number): Record<string, number> {
    const remaining = total
    const phoneScreen = Math.floor(remaining * 0.4)
    const technical = Math.floor(remaining * 0.3)
    const behavioral = Math.floor(remaining * 0.2)
    const final = remaining - phoneScreen - technical - behavioral

    return {
      'phone-screen': phoneScreen,
      'technical': technical,
      'behavioral': behavioral,
      'final': Math.max(0, final)
    }
  }

  private generateConversionRates(overall: number): Record<string, number> {
    const variation = 15
    return {
      'phone-to-technical': Math.max(30, overall + (Math.random() - 0.5) * variation),
      'technical-to-behavioral': Math.max(25, overall + (Math.random() - 0.5) * variation),
      'behavioral-to-final': Math.max(40, overall + (Math.random() - 0.5) * variation),
      'final-to-offer': Math.max(60, overall + (Math.random() - 0.5) * variation)
    }
  }

  private generateInsights(analytics: JobAnalytics): string[] {
    const insights: string[] = []
    
    if (analytics.overdueCandidates > 0) {
      insights.push(`${analytics.overdueCandidates} candidates are overdue - review pipeline flow`)
    }
    
    if (analytics.conversionRate < 50) {
      insights.push('Conversion rate below average - consider optimizing interview process')
    }
    
    if (analytics.timeToHire > 30) {
      insights.push('Time to hire exceeds target - identify bottlenecks')
    }
    
    if (analytics.pipelineHealth < 70) {
      insights.push('Pipeline health needs attention - review stage efficiency')
    }

    if (insights.length === 0) {
      insights.push('Pipeline performing well - maintain current processes')
    }

    return insights
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /**
   * Clear cache for a specific job
   */
  clearCache(jobId: string): void {
    const cacheKey = `analytics_${jobId}`
    this.cache.delete(cacheKey)
  }

  /**
   * Clear all cache
   */
  clearAllCache(): void {
    this.cache.clear()
  }
}

export const tabStatusService = TabStatusService.getInstance()
