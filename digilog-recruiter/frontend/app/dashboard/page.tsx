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
  GraduationCap,
  Bot,
  ArrowRight,
  Send,
} from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import Link from "next/link"
import { useUser } from "@/context/UserContext"
import { ProfileCompletionModal } from "@/components/profile-completion-modal"
import { useDashboardState } from "@/app/dashboard/hooks/useDashboardState"
import { EnhancedMetricCard } from "@/components/dashboard/EnhancedMetricCard"
import { AnalyticsTabs } from "@/components/dashboard/AnalyticsTabs"
import { DashboardSettings } from "@/components/dashboard/DashboardSettings"
import { MetricDetailModal } from "@/components/dashboard/MetricDetailModal"
import { MetroQuickActions } from "@/components/ui/metro-quick-actions"
import { DashboardProfileCard } from "@/components/ui/dashboard-profile-card"
import { ProgressiveDisclosure } from "@/components/ui/progressive-disclosure"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import aiInterviewService, { type AIInterview } from "@/services/aiInterviewService"

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
  const { viewMode, setViewMode, sections } = useDashboardState()
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
        const aiInterviews = await aiInterviewService.list();

        if (!mounted) return;

        setWorkQueues({
          aiInterviews: summarizeAIInterviews(aiInterviews || []),
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
  }, [user])

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

  if (isLoading) {
    return (
      <div className="w-full px-4 sm:px-6 lg:px-8 py-6 max-w-[1400px] mx-auto">
        <div className="space-y-8">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="space-y-3">
              <Skeleton className="h-8 w-64" />
              <Skeleton className="h-4 w-96" />
            </div>
            <div className="flex gap-2">
              <Skeleton className="h-10 w-32" />
              <Skeleton className="h-10 w-32" />
            </div>
          </div>
          
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="h-32" />
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6 pt-4 lg:pt-6 max-w-[1400px] mx-auto dashboard-container bg-background">
      <ProfileCompletionModal 
        open={showProfileModal} 
        onOpenChange={handleProfileModalClose} 
      />
      
      <div className="space-y-8">
        {/* Simplified Header */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-2">
            <h1 className="text-3xl font-bold tracking-tight">
              Welcome back, {displayName}
            </h1>
            <p className="text-muted-foreground">
              Here's your recruitment overview
            </p>
          </div>
          
          <div className="flex items-center gap-3">
            {/* Identity Hub Link */}
            <Button
              size="sm"
              asChild
              className="bg-gradient-to-r from-[#754BE5] to-[#6935CF] text-white shadow-sm hover:from-[#6935CF] hover:to-[#5a2cb5]"
            >
              <a href="/settings/organization">
                <LayoutGrid className="h-4 w-4 mr-2" />
                Organization
              </a>
            </Button>

            {/* View Mode Toggle */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setViewMode(viewMode === 'simple' ? 'detailed' : 'simple')}
            >
              {viewMode === 'simple' ? <Maximize2 className="h-4 w-4 mr-2" /> : <Minimize2 className="h-4 w-4 mr-2" />}
              {viewMode === 'simple' ? 'Detailed View' : 'Simple View'}
            </Button>
            
            {/* Settings */}
            <DashboardSettings />
          </div>
        </div>

        {/* Profile Completion Alert */}
        {!profileComplete && suggestions.length > 0 && (
          <Alert className="border-amber-300 bg-gradient-to-r from-amber-50 to-yellow-50">
            <AlertCircle className="h-4 w-4 text-amber-600" />
            <AlertDescription className="flex items-center justify-between">
              <div>
                <strong>Complete your profile</strong> to get the most out of SmartHR
                <Badge variant="secondary" className="ml-2">
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

        {/* Profile and Quick Actions */}
        {sections.quickActions?.visible && (
          <div className="grid gap-6 grid-cols-1 lg:grid-cols-12">
            <div className="lg:col-span-5 xl:col-span-4">
              <DashboardProfileCard />
            </div>
            <div className="lg:col-span-7 xl:col-span-8">
              <MetroQuickActions />
            </div>
          </div>
        )}

        {/* Key Metrics Section */}
        {sections.keyMetrics?.visible && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">Key Metrics</h2>
              <Badge variant="secondary">{viewMode} mode</Badge>
            </div>
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
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
          </div>
        )}

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Work queues</h2>
            {workQueuesLoading && <Badge variant="secondary">Loading</Badge>}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="rounded-md">
              <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
                <div>
                  <CardTitle className="text-base">AI interviews</CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">Automated interview packets and completed sessions</p>
                </div>
                <Bot className="h-5 w-5 text-muted-foreground" />
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div>
                    <div className="text-2xl font-semibold">{workQueues.aiInterviews.total}</div>
                    <div className="text-xs text-muted-foreground">Total</div>
                  </div>
                  <div>
                    <div className="text-2xl font-semibold">{workQueues.aiInterviews.open}</div>
                    <div className="text-xs text-muted-foreground">Open</div>
                  </div>
                  <div>
                    <div className="text-2xl font-semibold">{workQueues.aiInterviews.candidates}</div>
                    <div className="text-xs text-muted-foreground">Candidates</div>
                  </div>
                  <div>
                    <div className="text-2xl font-semibold">{workQueues.aiInterviews.completedSessions}</div>
                    <div className="text-xs text-muted-foreground">Complete</div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
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
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Analytics Section with Tabs */}
        {sections.analytics?.visible && (
          <AnalyticsTabs analytics={currentAnalytics} />
        )}
      </div>

      {/* Metric Detail Modal */}
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
