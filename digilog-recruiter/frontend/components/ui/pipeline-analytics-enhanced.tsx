'use client'

import React, { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  FunnelChart,
  Funnel,
  LabelList,
  Area,
  AreaChart
} from 'recharts'
import {
  TrendingUp,
  TrendingDown,
  Users,
  Clock,
  Target,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Brain,
  Zap,
  Download,
  RefreshCw,
  Filter,
  BarChart3,
  PieChart as PieChartIcon,
  Activity
} from 'lucide-react'
import { toast } from 'sonner'
import pipelineService from '@/services/pipelineService'
import aiAnalysisService, { JobComparativeAnalysis } from '@/services/aiAnalysisService'


interface PipelineAnalyticsEnhancedProps {
  jobId: string
  refreshTrigger?: number
}

interface PipelineAnalytics {
  totalApplicants?: number
  stageBreakdown?: Array<{
    stageId: string
    stageName: string
    candidateCount: number
    passRate: number
    averageTimeInStage: number
    conversionRate: number
    color: string
  }>
  conversions?: Array<{
    from: string
    to: string
    rate: number
    count: number
  }>
  bottlenecks?: Array<{
    stage: string
    candidateCount: number
    averageDays: number
    severity: 'low' | 'medium' | 'high'
  }>
  timeMetrics?: {
    averageTimeToHire: number
    timeToHireTrend: number
    stageTimings: Array<{
      stage: string
      avgDays: number
      minDays: number
      maxDays: number
    }>
  }
  overallPassRate?: number
  trends?: Array<{
    date: string
    applications: number
    hired: number
    passRate: number
  }>
}

export function PipelineAnalyticsEnhanced({ 
  jobId, 
  refreshTrigger 
}: PipelineAnalyticsEnhancedProps) {
  const [analytics, setAnalytics] = useState<PipelineAnalytics | null>(null)
  const [aiAnalytics, setAiAnalytics] = useState<JobComparativeAnalysis | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [selectedStage, setSelectedStage] = useState<string>('all')
  const [timeframe, setTimeframe] = useState<'7d' | '30d' | '90d'>('30d')
  const [viewMode, setViewMode] = useState<'overview' | 'funnel' | 'stages' | 'time' | 'ai'>('overview')

  useEffect(() => {
    fetchAnalytics()
  }, [jobId, refreshTrigger, timeframe])

  const fetchAnalytics = async () => {
    try {
      setLoading(true)
      const [pipelineData, aiData] = await Promise.all([
        pipelineService.getPipelineAnalytics(jobId),
        aiAnalysisService.getJobComparativeAnalysis(jobId).catch(() => null) // AI data is optional
      ])
      
      setAnalytics(pipelineData)
      setAiAnalytics(aiData)
    } catch (error: any) {
      toast.error('Failed to load analytics')
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  const handleRefresh = async () => {
    setRefreshing(true)
    await fetchAnalytics()
    setRefreshing(false)
    toast.success('Analytics refreshed')
  }

  const handleExport = async () => {
    try {
      const blob = await aiAnalysisService.exportAnalysisData(jobId, 'csv')
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.style.display = 'none'
      a.href = url
      a.download = `pipeline-analytics-${jobId}.csv`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      toast.success('Analytics exported successfully')
    } catch (error: any) {
      toast.error('Failed to export analytics')
    }
  }

  if (loading || !analytics) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading pipeline analytics...</p>
        </div>
      </div>
    )
  }

  // Prepare funnel data with safety checks
  const funnelData = (analytics.stageBreakdown || []).map((stage) => ({
    name: stage.stageName,
    value: stage.candidateCount,
    fill: stage.color || '#3b82f6',
    passRate: stage.passRate
  }))

  // Prepare conversion data with safety checks
  const conversionData = (analytics.conversions || []).map((conv) => ({
    name: `${conv.from} → ${conv.to}`,
    rate: conv.rate,
    count: conv.count
  }))

  // Prepare time data with safety checks
  const timeData = analytics.timeMetrics?.stageTimings || []

  // Color scheme for charts
  const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#84cc16']

  return (
    <div className="space-y-6">
      {/* Header with Controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">Pipeline Analytics</h2>
          <p className="text-muted-foreground">
            Comprehensive insights into your hiring funnel performance
          </p>
        </div>
        
        <div className="flex items-center gap-2">
          <Select value={timeframe} onValueChange={(value: any) => setTimeframe(value)}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
              <SelectItem value="90d">Last 90 days</SelectItem>
            </SelectContent>
          </Select>
          
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing}>
            <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
        </div>
      </div>

      {/* Key Metrics Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Users className="h-4 w-4" />
              Total Pipeline
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{analytics.totalApplicants || 0}</div>
            <p className="text-xs text-muted-foreground">Active candidates</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Target className="h-4 w-4" />
              Pass Rate
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{analytics.overallPassRate || 0}%</div>
            <Progress value={analytics.overallPassRate || 0} className="mt-2" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Avg. Time to Hire
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {analytics.timeMetrics?.averageTimeToHire || 0} days
            </div>
            <p className="text-xs text-muted-foreground flex items-center">
              {(analytics.timeMetrics?.timeToHireTrend || 0) > 0 ? (
                <span className="text-red-500 flex items-center">
                  <TrendingUp className="h-3 w-3 mr-1" />
                  {analytics.timeMetrics?.timeToHireTrend || 0}% slower
                </span>
              ) : (
                <span className="text-green-500 flex items-center">
                  <TrendingDown className="h-3 w-3 mr-1" />
                  {Math.abs(analytics.timeMetrics?.timeToHireTrend || 0)}% faster
                </span>
              )}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              Bottlenecks
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {(analytics.bottlenecks || []).filter(b => b.severity === 'high').length}
            </div>
            <p className="text-xs text-muted-foreground">
              High-impact issues
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Brain className="h-4 w-4" />
              AI Insights
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {aiAnalytics?.analyzedCandidates || 0}
            </div>
            <p className="text-xs text-muted-foreground">
              Analyzed candidates
            </p>
          </CardContent>
        </Card>
      </div>

      {/* View Mode Selector */}
      <div className="flex items-center gap-2 border-b">
        <Button
          variant={viewMode === 'overview' ? 'default' : 'ghost'}
          size="sm"
          onClick={() => setViewMode('overview')}
        >
          <Activity className="h-4 w-4 mr-2" />
          Overview
        </Button>
        <Button
          variant={viewMode === 'funnel' ? 'default' : 'ghost'}
          size="sm"
          onClick={() => setViewMode('funnel')}
        >
          <BarChart3 className="h-4 w-4 mr-2" />
          Funnel
        </Button>
        <Button
          variant={viewMode === 'stages' ? 'default' : 'ghost'}
          size="sm"
          onClick={() => setViewMode('stages')}
        >
          <PieChartIcon className="h-4 w-4 mr-2" />
          Stages
        </Button>
        <Button
          variant={viewMode === 'time' ? 'default' : 'ghost'}
          size="sm"
          onClick={() => setViewMode('time')}
        >
          <Clock className="h-4 w-4 mr-2" />
          Time
        </Button>
        {aiAnalytics && (
          <Button
            variant={viewMode === 'ai' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setViewMode('ai')}
          >
            <Brain className="h-4 w-4 mr-2" />
            AI Insights
          </Button>
        )}
      </div>

      {/* Content based on view mode */}
      {viewMode === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Pipeline Funnel */}
          <Card>
            <CardHeader>
              <CardTitle>Pipeline Funnel</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <FunnelChart>
                  <Tooltip 
                    formatter={(value, name) => [
                      `${value} candidates`, 
                      name
                    ]}
                  />
                  <Funnel
                    dataKey="value"
                    data={funnelData}
                    isAnimationActive
                  >
                    <LabelList position="center" fill="#fff" />
                  </Funnel>
                </FunnelChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Stage Performance */}
          <Card>
            <CardHeader>
              <CardTitle>Stage Performance</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {(analytics.stageBreakdown || []).map((stage, index) => (
                  <div key={stage.stageId} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{stage.stageName}</span>
                      <div className="text-sm text-muted-foreground">
                        {stage.candidateCount} candidates
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Progress 
                        value={stage.passRate} 
                        className="flex-1"
                        style={{ 
                          '--progress-background': stage.color || colors[index % colors.length] 
                        } as any}
                      />
                      <span className="text-sm font-medium w-12">
                        {stage.passRate}%
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Avg. {stage.averageTimeInStage} days in stage
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {viewMode === 'funnel' && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Detailed Pipeline Funnel</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={400}>
                <FunnelChart>
                  <Tooltip 
                    formatter={(value: any, name: any) => [
                      `${value} candidates`, 
                      name
                    ]}
                  />
                  <Funnel
                    dataKey="value"
                    data={funnelData}
                    isAnimationActive
                  >
                    <LabelList position="center" fill="#fff" />
                  </Funnel>
                </FunnelChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Conversion Rates */}
            <Card>
              <CardHeader>
                <CardTitle>Stage Conversion Rates</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={conversionData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis 
                      dataKey="name" 
                      tick={{ fontSize: 12 }}
                      angle={-45}
                      textAnchor="end"
                      height={80}
                    />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="rate" fill="#3b82f6" name="Conversion Rate %" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Bottlenecks */}
            <Card>
              <CardHeader>
                <CardTitle>Pipeline Bottlenecks</CardTitle>
              </CardHeader>
              <CardContent>
                {(analytics.bottlenecks || []).length > 0 ? (
                  <div className="space-y-3">
                    {(analytics.bottlenecks || []).map((bottleneck, index) => (
                      <div 
                        key={index} 
                        className={`flex items-start gap-3 p-3 rounded-lg ${
                          bottleneck.severity === 'high' ? 'bg-red-50' :
                          bottleneck.severity === 'medium' ? 'bg-orange-50' :
                          'bg-yellow-50'
                        }`}
                      >
                        <AlertTriangle className={`h-5 w-5 mt-0.5 ${
                          bottleneck.severity === 'high' ? 'text-red-500' :
                          bottleneck.severity === 'medium' ? 'text-orange-500' :
                          'text-yellow-500'
                        }`} />
                        <div className="flex-1">
                          <p className="font-medium text-sm">{bottleneck.stage}</p>
                          <p className="text-xs text-muted-foreground">
                            {bottleneck.candidateCount} candidates stuck for avg {bottleneck.averageDays} days
                          </p>
                        </div>
                        <Badge 
                          variant={
                            bottleneck.severity === 'high' ? 'destructive' : 
                            bottleneck.severity === 'medium' ? 'secondary' : 
                            'outline'
                          }
                        >
                          {bottleneck.severity}
                        </Badge>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-green-600 justify-center py-8">
                    <CheckCircle className="h-5 w-5" />
                    <span>No bottlenecks detected</span>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {viewMode === 'stages' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
          {(analytics.stageBreakdown || []).map((stage, index) => (
            <Card key={stage.stageId}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{stage.stageName}</CardTitle>
                  <div 
                    className="w-4 h-4 rounded-full"
                    style={{ backgroundColor: stage.color || colors[index % colors.length] }}
                  />
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="text-center">
                      <div className="text-2xl font-bold">{stage.candidateCount}</div>
                      <p className="text-xs text-muted-foreground">Candidates</p>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold">{stage.passRate}%</div>
                      <p className="text-xs text-muted-foreground">Pass Rate</p>
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span>Conversion Rate</span>
                      <span className="font-medium">{stage.conversionRate}%</span>
                    </div>
                    <Progress value={stage.conversionRate} />
                  </div>
                  
                  <div className="text-sm text-muted-foreground">
                    <div className="flex items-center justify-between">
                      <span>Avg. Time in Stage</span>
                      <span>{stage.averageTimeInStage} days</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {viewMode === 'time' && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Time Spent in Each Stage</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={timeData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="stage" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="avgDays" fill="#3b82f6" name="Average Days" />
                  <Bar dataKey="minDays" fill="#10b981" name="Min Days" />
                  <Bar dataKey="maxDays" fill="#ef4444" name="Max Days" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Pipeline Trends</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <AreaChart data={analytics.trends || []}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis />
                    <Tooltip />
                    <Area 
                      type="monotone" 
                      dataKey="applications" 
                      stackId="1"
                      stroke="#3b82f6" 
                      fill="#3b82f6" 
                      fillOpacity={0.6}
                      name="Applications"
                    />
                    <Area 
                      type="monotone" 
                      dataKey="hired" 
                      stackId="1"
                      stroke="#10b981" 
                      fill="#10b981" 
                      fillOpacity={0.8}
                      name="Hired"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Performance Metrics</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Average Time to Hire</span>
                    <span className="font-medium">
                      {analytics.timeMetrics?.averageTimeToHire || 0} days
                    </span>
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Fastest Hire</span>
                    <span className="font-medium">
                      {timeData.length > 0 ? Math.min(...timeData.map(d => d.minDays)) : 0} days
                    </span>
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Longest Process</span>
                    <span className="font-medium">
                      {timeData.length > 0 ? Math.max(...timeData.map(d => d.maxDays)) : 0} days
                    </span>
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Process Efficiency</span>
                    <span className="font-medium">
                      {(analytics.timeMetrics?.timeToHireTrend || 0) < 0 ? 'Improving' : 'Declining'}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {viewMode === 'ai' && aiAnalytics && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Brain className="h-5 w-5" />
                  AI Analysis Summary
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="text-center">
                      <div className="text-2xl font-bold">{aiAnalytics.analyzedCandidates}</div>
                      <p className="text-xs text-muted-foreground">Analyzed</p>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold">{Math.round(aiAnalytics.averageScore)}</div>
                      <p className="text-xs text-muted-foreground">Avg Score</p>
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span>Analysis Coverage</span>
                      <span className="font-medium">
                        {Math.round((aiAnalytics.analyzedCandidates / aiAnalytics.totalCandidates) * 100)}%
                      </span>
                    </div>
                    <Progress 
                      value={(aiAnalytics.analyzedCandidates / aiAnalytics.totalCandidates) * 100} 
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Top Performers</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {aiAnalytics.topPerformers.slice(0, 5).map((performer, index) => (
                    <div key={performer.candidateId} className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-medium">
                          {index + 1}
                        </div>
                        <div>
                          <p className="font-medium text-sm">{performer.candidateName}</p>
                          <p className="text-xs text-muted-foreground">
                            {performer.percentile}th percentile
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-medium">{performer.overallScore}</div>
                        <div className="text-xs text-muted-foreground">score</div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Skills Distribution</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {aiAnalytics.skillDistribution.slice(0, 8).map((skill, index) => (
                    <div key={skill.skill} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium">{skill.skill}</span>
                        <span className="text-muted-foreground">
                          {skill.candidateCount} candidates
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Progress 
                          value={skill.averageRelevance} 
                          className="flex-1"
                        />
                        <span className="text-xs w-12">
                          {Math.round(skill.averageRelevance)}%
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Common Concerns</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {aiAnalytics.concernsBreakdown.map((concern, index) => (
                    <div key={concern.type} className="flex items-center justify-between p-3 bg-muted/20 rounded-lg">
                      <div className="flex items-center gap-3">
                        <AlertTriangle className={`h-4 w-4 ${
                          concern.averageSeverity === 'high' ? 'text-red-500' :
                          concern.averageSeverity === 'medium' ? 'text-orange-500' :
                          'text-yellow-500'
                        }`} />
                        <div>
                          <p className="font-medium text-sm capitalize">
                            {concern.type.replace('_', ' ')}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {concern.resolution}% resolved
                          </p>
                        </div>
                      </div>
                      <Badge variant="outline">
                        {concern.count}
                      </Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="h-5 w-5" />
                AI-Driven Recommendations
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {aiAnalytics.recommendations.map((rec, index) => (
                  <div key={index} className="flex items-start gap-3 p-4 bg-blue-50 rounded-lg">
                    <Zap className="h-5 w-5 text-blue-500 mt-0.5" />
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="font-medium text-sm">{rec.title}</p>
                        <Badge 
                          variant={
                            rec.priority === 'high' ? 'destructive' :
                            rec.priority === 'medium' ? 'secondary' :
                            'outline'
                          }
                        >
                          {rec.priority}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mb-2">
                        {rec.description}
                      </p>
                      <p className="text-xs font-medium text-blue-600">
                        Impact: {rec.impact}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}

export default PipelineAnalyticsEnhanced 