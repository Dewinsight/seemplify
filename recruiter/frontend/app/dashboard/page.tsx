'use client';

import React, { useEffect, useState } from "react"
import './dashboard.css'
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  AlertCircle,
  Settings,
  Maximize2,
  Minimize2,
  LayoutGrid,
  Users,
  Briefcase,
  Clock,
  FileText,
  Bot,
  ArrowRight,
  Send,
} from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import Link from "next/link"
import { useUser } from "@/context/UserContext"
import { useOrganization } from "@/context/OrganizationContext"
import { ProfileCompletionModal } from "@/components/profile-completion-modal"
import { useDashboardState } from "@/app/dashboard/hooks/useDashboardState"
import { EnhancedMetricCard } from "@/components/dashboard/EnhancedMetricCard"
import { AnalyticsTabs } from "@/components/dashboard/AnalyticsTabs"
import { DashboardSettings } from "@/components/dashboard/DashboardSettings"
import { MetricDetailModal } from "@/components/dashboard/MetricDetailModal"
import { MetroQuickActions } from "@/components/ui/metro-quick-actions"
import { Badge } from "@/components/ui/badge"
import { getIdpBaseUrl } from "@/utils/env"
import aiInterviewService, { type AIInterview } from "@/services/aiInterviewService"
import { useFeatureFlags } from "@/context/FeatureFlagsContext"

type WorkQueueSummary = {
  aiInterviews: {
    total: number;
    open: number;
    candidates: number;
    completedSessions: number;
  };
};

const emptyWorkQueueSummary: WorkQueueSummary = {
  aiInterviews: {
    total: 0,
    open: 0,
    candidates: 0,
    completedSessions: 0,
  },
};

function summarizeAIInterviews(interviews: AIInterview[]) {
  return {
    total: interviews.length,
    open: interviews.filter((interview) => !["completed", "cancelled", "expired"].includes(interview.status)).length,
    candidates: interviews.reduce((count, interview) => count + (interview.candidateCount || 0), 0),
    completedSessions: interviews.reduce((count, interview) => count + (interview.stats?.completed || 0), 0),
  };
}

export default function Dashboard() {
  const { state, loadAnalytics, getUserDisplayName, isProfileComplete } = useUser()
  const { user, analytics, suggestions, isLoading } = state
  const { currentOrganization } = useOrganization()
  const { viewMode, setViewMode, sections } = useDashboardState()
  const { isFeatureEnabled } = useFeatureFlags()
  const aiInterviewsEnabled = isFeatureEnabled('aiInterviews')
  const [showProfileModal, setShowProfileModal] = useState(false)
  const [workQueues, setWorkQueues] = useState<WorkQueueSummary>(emptyWorkQueueSummary)
  const [workQueuesLoading, setWorkQueuesLoading] = useState(false)
  
  // State for metric detail modal
  const [selectedMetric, setSelectedMetric] = useState<{
    id: string;
    title: string;
    currentValue: number;
    historicalData?: Array<{ date: string; value: number }>;
    breakdown?: Array<{ category: string; value: number }>;
    insights?: string[];
  } | null>(null)

  useEffect(() => {
    if (user) {
      loadAnalytics()
      
      const lastShown = localStorage.getItem('profileModalLastShown')
      const daysSinceLastShown = lastShown ? (Date.now() - parseInt(lastShown)) / (1000 * 60 * 60 * 24) : 999
      
      if (!isProfileComplete() && daysSinceLastShown > 1) {
        setTimeout(() => setShowProfileModal(true), 2000)
      }
    }
  }, [user])

  useEffect(() => {
    if (!user) return;

    let mounted = true;

    async function loadWorkQueues() {
      try {
        setWorkQueuesLoading(true);
        const aiInterviewsResult = await Promise.resolve(
          aiInterviewsEnabled ? aiInterviewService.list() : null
        );

        if (!mounted) return;

        setWorkQueues({
          aiInterviews: aiInterviewsResult
            ? summarizeAIInterviews(aiInterviewsResult)
            : emptyWorkQueueSummary.aiInterviews,
        });
      } catch (error) {
        console.error("Failed to load dashboard work queues:", error);
      } finally {
        if (mounted) setWorkQueuesLoading(false);
      }
    }

    loadWorkQueues();

    return () => {
      mounted = false;
    };
  }, [aiInterviewsEnabled, user])

  const handleProfileModalClose = (open: boolean) => {
    setShowProfileModal(open)
    if (!open) {
      localStorage.setItem('profileModalLastShown', Date.now().toString())
    }
  }

  // Handle metric card click to show details
  const handleMetricClick = (metricId: string, title: string, currentValue: number) => {
    // Use REAL timeline data based on metric type
    let timelineData: any[] = [];
    
    if (metricId === 'totalCandidates' || metricId === 'candidatesInReview') {
      // For candidate-related metrics, use candidates timeline
      timelineData = currentAnalytics.timeline?.candidates || [];
    } else if (metricId === 'activeJobs' || metricId === 'totalJobs') {
      // For job-related metrics, use jobs timeline
      timelineData = currentAnalytics.timeline?.jobs || [];
    }
    
    // Map to historical data format (REAL data only)
    const historicalData = timelineData.length > 0 
      ? timelineData.map((item: any) => ({
          date: item.date,
          value: item.count || 0
        }))
      : undefined;

    // Use REAL breakdown data from backend distributions
    // ✅ FIXED: Backend returns 'name' and 'value', not 'status' and 'count'
    let breakdown: Array<{ category: string; value: number }> | undefined;
    
    if (metricId === 'totalCandidates' || metricId === 'candidatesInReview') {
      // Real candidate status distribution
      const statusData = currentAnalytics.distributions?.candidatesByStatus || [];
      breakdown = statusData.length > 0 
        ? statusData.map((item: any) => ({
            category: item.name,  // ✅ Use 'name' from backend
            value: item.value     // ✅ Use 'value' from backend
          }))
        : undefined;
    } else if (metricId === 'activeJobs' || metricId === 'totalJobs') {
      // Real job status distribution
      const statusData = currentAnalytics.distributions?.jobsByStatus || [];
      breakdown = statusData.length > 0
        ? statusData.map((item: any) => ({
            category: item.name,  // ✅ Use 'name' from backend
            value: item.value     // ✅ Use 'value' from backend
          }))
        : undefined;
    }

    // Generate insights ONLY from real data
    const insights: string[] = [];
    
    if (historicalData && historicalData.length > 1) {
      const firstValue = historicalData[0].value;
      const lastValue = historicalData[historicalData.length - 1].value;
      
      if (firstValue > 0) {
        const change = ((lastValue - firstValue) / firstValue) * 100;
        insights.push(`This metric has ${change > 0 ? 'increased' : 'decreased'} by ${Math.abs(change).toFixed(1)}% over the tracked period.`);
      }
      
      // Add date range insight
      const firstDate = new Date(historicalData[0].date).toLocaleDateString();
      const lastDate = new Date(historicalData[historicalData.length - 1].date).toLocaleDateString();
      insights.push(`Data tracked from ${firstDate} to ${lastDate} (${historicalData.length} data points).`);
    }
    
    if (breakdown && breakdown.length > 0) {
      const topCategory = breakdown.reduce((max, item) => item.value > max.value ? item : max);
      insights.push(`${topCategory.category} represents the largest segment with ${topCategory.value} items.`);
      
      // Add total count insight
      const total = breakdown.reduce((sum, item) => sum + item.value, 0);
      insights.push(`Total of ${total} items distributed across ${breakdown.length} categories.`);
    }

    setSelectedMetric({
      id: metricId,
      title,
      currentValue,
      historicalData,
      breakdown,
      insights: insights.length > 0 ? insights : undefined
    });
  }

  const fallbackAnalytics = {
    overview: {
      totalCandidates: { value: 0, trend: { value: 0, direction: 'up' }, label: 'Total Candidates' },
      totalJobs: { value: 0, trend: { value: 0, direction: 'up' }, label: 'Total Jobs' },
      activeJobs: { value: 0, trend: { value: 0, direction: 'up' }, label: 'Active Jobs' },
      candidatesInReview: { value: 0, trend: { value: 0, direction: 'up' }, label: 'In Review' },
    },
    distributions: {
      candidatesByStatus: [],
      jobsByStatus: [],
      candidatesBySource: [],
      topSkills: []
    },
    timeline: {
      candidates: [],
      jobs: []
    },
    topPerformingJobs: [],
    recentActivity: [],
    meta: {
      generatedAt: new Date().toISOString(),
      range: 'all-time',
      dataPoints: { candidates: 0, jobs: 0 }
    }
  }

  const currentAnalytics = analytics || fallbackAnalytics
  const displayName = getUserDisplayName()
  const profileComplete = isProfileComplete()
  const organizationName = currentOrganization?.name || user?.company?.name || 'Your organization'
  const organizationRole = (currentOrganization?.userRole || user?.role || 'Member')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())

  if (isLoading) {
    return (
      <div className="recruiter-dashboard recruiter-dashboard--loading" aria-busy="true" aria-label="Loading recruitment dashboard">
        <div className="recruiter-dashboard__hero recruiter-dashboard__hero--loading">
          <div className="space-y-4">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-12 w-full max-w-xl" />
            <Skeleton className="h-5 w-full max-w-lg" />
          </div>
          <Skeleton className="h-48 w-full rounded-2xl" />
        </div>
        <div className="recruiter-metrics-strip">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-none" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="recruiter-dashboard">
      <ProfileCompletionModal 
        open={showProfileModal} 
        onOpenChange={handleProfileModalClose} 
      />

      <section className="recruiter-dashboard__hero" aria-labelledby="recruiter-dashboard-title">
        <div className="recruiter-dashboard__hero-copy">
          <p className="recruiter-dashboard__eyebrow">Recruitment workspace</p>
          <h1 id="recruiter-dashboard-title">Hiring work, clearly organized.</h1>
          <p>
            Welcome back, {displayName}. Move candidates, roles, interviews, and hiring actions forward for {organizationName}.
          </p>
        </div>

        <aside className="recruiter-context-card" aria-label="Current recruitment workspace">
          <div className="recruiter-context-card__topline">
            <div className="recruiter-context-card__identity">
              <span className="recruiter-context-card__mark" aria-hidden="true">
                {organizationName.slice(0, 2).toUpperCase()}
              </span>
              <div>
                <span className="recruiter-context-card__label">Working in</span>
                <strong>{organizationName}</strong>
                <span>{organizationRole}</span>
              </div>
            </div>
            <Button size="sm" variant="outline" asChild className="recruiter-context-card__hub-link">
              <a href={getIdpBaseUrl()} target="_blank" rel="noopener noreferrer">
                <LayoutGrid className="h-4 w-4" />
                App Hub
              </a>
            </Button>
          </div>

          <div className="recruiter-context-card__facts">
            <div>
              <span>Candidates</span>
              <strong>{currentAnalytics.overview.totalCandidates.value}</strong>
            </div>
            <div>
              <span>Active roles</span>
              <strong>{currentAnalytics.overview.activeJobs.value}</strong>
            </div>
            <div>
              <span>Profile</span>
              <strong>{user?.profileCompletion.percentage || 0}%</strong>
            </div>
          </div>

          <div className="recruiter-dashboard__actions" aria-label="Dashboard controls">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setViewMode(viewMode === 'simple' ? 'detailed' : 'simple')}
            >
              {viewMode === 'simple' ? <Maximize2 className="h-4 w-4" /> : <Minimize2 className="h-4 w-4" />}
              {viewMode === 'simple' ? 'Detailed view' : 'Simple view'}
            </Button>
            <DashboardSettings />
          </div>
        </aside>
      </section>

      <div className="recruiter-notice-stack" aria-label="Items requiring attention">
        {!profileComplete && suggestions.length > 0 && (
          <Alert className="recruiter-notice recruiter-notice--attention">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="recruiter-notice__content">
              <div>
                <strong>Complete your profile</strong>
                <span>Finish your details to improve recruiting recommendations.</span>
                <Badge variant="secondary">
                  {user?.profileCompletion.percentage}% complete
                </Badge>
              </div>
              <Button variant="outline" size="sm" asChild>
                <Link href="/settings">
                  <Settings className="mr-2 h-3.5 w-3.5" />
                  Complete Profile
                </Link>
              </Button>
            </AlertDescription>
          </Alert>
        )}

      </div>

      {sections.keyMetrics?.visible && (
        <section className="recruiter-dashboard__section recruiter-dashboard__section--metrics" aria-labelledby="recruiter-metrics-title">
          <div className="recruiter-section-heading recruiter-section-heading--compact">
            <div>
              <h2 id="recruiter-metrics-title">Pipeline at a glance</h2>
              <p>Select a metric to inspect its underlying activity.</p>
            </div>
            <Badge variant="secondary">{viewMode} mode</Badge>
          </div>
          <div className="recruiter-metrics-strip">
              <EnhancedMetricCard
                id="totalCandidates"
                title="Total Candidates"
                value={currentAnalytics.overview.totalCandidates.value}
                icon={<Users className="h-5 w-5" />}
                trend={{
                  value: currentAnalytics.overview.totalCandidates.trend.value,
                  direction: currentAnalytics.overview.totalCandidates.trend.direction as 'up' | 'down',
                  label: currentAnalytics.overview.totalCandidates.label
                }}
                description="Total candidates in your pipeline"
                variant="primary"
                onClick={() => handleMetricClick(
                  'totalCandidates',
                  'Total Candidates',
                  currentAnalytics.overview.totalCandidates.value
                )}
              />
              <EnhancedMetricCard
                id="activeJobs"
                title="Active Jobs"
                value={currentAnalytics.overview.activeJobs.value}
                icon={<Briefcase className="h-5 w-5" />}
                trend={{
                  value: currentAnalytics.overview.activeJobs.trend.value,
                  direction: currentAnalytics.overview.activeJobs.trend.direction as 'up' | 'down',
                  label: currentAnalytics.overview.activeJobs.label
                }}
                description="Currently open positions"
                variant="success"
                onClick={() => handleMetricClick(
                  'activeJobs',
                  'Active Jobs',
                  currentAnalytics.overview.activeJobs.value
                )}
              />
              <EnhancedMetricCard
                id="candidatesInReview"
                title="In Review"
                value={currentAnalytics.overview.candidatesInReview.value}
                icon={<Clock className="h-5 w-5" />}
                trend={{
                  value: currentAnalytics.overview.candidatesInReview.trend.value,
                  direction: currentAnalytics.overview.candidatesInReview.trend.direction as 'up' | 'down',
                  label: currentAnalytics.overview.candidatesInReview.label
                }}
                description="Candidates under review"
                variant="warning"
                onClick={() => handleMetricClick(
                  'candidatesInReview',
                  'In Review',
                  currentAnalytics.overview.candidatesInReview.value
                )}
              />
              <EnhancedMetricCard
                id="totalJobs"
                title="Total Jobs"
                value={currentAnalytics.overview.totalJobs.value}
                icon={<FileText className="h-5 w-5" />}
                trend={{
                  value: currentAnalytics.overview.totalJobs.trend.value,
                  direction: currentAnalytics.overview.totalJobs.trend.direction as 'up' | 'down',
                  label: currentAnalytics.overview.totalJobs.label
                }}
                description="All job postings"
                variant="default"
                onClick={() => handleMetricClick(
                  'totalJobs',
                  'Total Jobs',
                  currentAnalytics.overview.totalJobs.value
                )}
              />
          </div>
        </section>
      )}

      {sections.quickActions?.visible && (
        <section className="recruiter-dashboard__section" aria-labelledby="recruiter-workspace-title">
          <div className="recruiter-section-heading">
            <div>
              <h2 id="recruiter-workspace-title">Recruitment workspace</h2>
              <p>Open the workflow that needs to move today.</p>
            </div>
          </div>
          <MetroQuickActions />
        </section>
      )}

      {aiInterviewsEnabled && (
        <section className="recruiter-dashboard__section" aria-labelledby="recruiter-queues-title">
          <div className="recruiter-section-heading">
            <div>
              <h2 id="recruiter-queues-title">Operational queues</h2>
              <p>Follow up on the recruiting work already in motion.</p>
            </div>
            {workQueuesLoading && <Badge variant="secondary">Refreshing</Badge>}
          </div>

          <div className="recruiter-queue-grid">
            {aiInterviewsEnabled && <article className="recruiter-queue-card">
              <header className="recruiter-queue-card__header">
                <div>
                  <h3>AI interviews</h3>
                  <p>Automated interview packets and completed sessions.</p>
                </div>
                <span className="recruiter-queue-card__icon"><Bot className="h-5 w-5" /></span>
              </header>
              <div className="recruiter-queue-card__body">
                <div className="recruiter-queue-card__stats">
                  <div>
                    <strong>{workQueues.aiInterviews.total}</strong>
                    <span>Total</span>
                  </div>
                  <div>
                    <strong>{workQueues.aiInterviews.open}</strong>
                    <span>Open</span>
                  </div>
                  <div>
                    <strong>{workQueues.aiInterviews.candidates}</strong>
                    <span>Candidates</span>
                  </div>
                  <div>
                    <strong>{workQueues.aiInterviews.completedSessions}</strong>
                    <span>Complete</span>
                  </div>
                </div>
                <div className="recruiter-queue-card__actions">
                  <Button asChild size="sm" variant="outline">
                    <Link href="/ai-interviews">
                      Open AI interviews
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                  <Button asChild size="sm" variant="outline">
                    <Link href="/ai-interviews">
                      <Send className="mr-2 h-4 w-4" />
                      Create interview
                    </Link>
                  </Button>
                </div>
              </div>
            </article>}

          </div>
        </section>
      )}

      {sections.analytics?.visible && (
        <section className="recruiter-dashboard__section recruiter-dashboard__analytics" aria-label="Recruitment analytics">
          <AnalyticsTabs analytics={currentAnalytics} />
        </section>
      )}

      {selectedMetric && (
        <MetricDetailModal
          metricId={selectedMetric.id}
          metricData={selectedMetric}
          open={!!selectedMetric}
          onOpenChange={(open) => !open && setSelectedMetric(null)}
        />
      )}
    </div>
  )
}
