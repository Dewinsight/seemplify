"use client"

import { useState, useEffect } from "react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Button } from "@/components/ui/button"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
} from "recharts"
import {
  TrendingUp,
  TrendingDown,
  Users,
  Clock,
  AlertTriangle,
  CheckCircle,
  RefreshCw,
  Target,
} from "lucide-react"
import { toast } from "@/components/ui/use-toast"
import pipelineService, { type PipelineAnalytics } from "@/services/pipelineService"

interface PipelineAnalyticsProps {
  jobId: string
  refreshTrigger?: number
}

const STAGE_COLORS = {
  applied: '#3b82f6',
  reviewing: '#eab308',
  shortlisted: '#8b5cf6',
  interviewing: '#f97316',
  offered: '#22c55e',
  hired: '#10b981',
  rejected: '#ef4444',
}

const STAGE_LABELS = {
  applied: 'Applied',
  reviewing: 'Reviewing',
  shortlisted: 'Shortlisted',
  interviewing: 'Interviewing',
  offered: 'Offered',
  hired: 'Hired',
  rejected: 'Rejected',
}

export function PipelineAnalytics({ jobId, refreshTrigger }: PipelineAnalyticsProps) {
  const [analytics, setAnalytics] = useState<PipelineAnalytics | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchAnalytics = async () => {
    try {
      setLoading(true)
      const result = await pipelineService.getPipelineAnalytics(jobId)
      console.log('Raw analytics data:', result.analytics) // Debug log
      setAnalytics(result.analytics)
    } catch (error: any) {
      console.error('Error fetching analytics:', error)
      toast({
        title: "Analytics Error",
        description: error.message,
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchAnalytics()
  }, [jobId, refreshTrigger])

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Pipeline Analytics</h3>
          <Button variant="outline" size="sm" disabled>
            <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
            Loading...
          </Button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardHeader className="pb-2">
                <div className="h-4 bg-muted rounded w-3/4"></div>
              </CardHeader>
              <CardContent>
                <div className="h-8 bg-muted rounded w-1/2"></div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    )
  }

  if (!analytics || !analytics.statusDistribution || !analytics.conversionRates || !analytics.averageTimeInStage) {
    return (
      <div className="text-center py-8">
        <p className="text-muted-foreground">No analytics data available</p>
        <Button onClick={fetchAnalytics} className="mt-4">
          <RefreshCw className="h-4 w-4 mr-2" />
          Retry
        </Button>
      </div>
    )
  }

  // Helper function to sanitize numeric values
  const sanitizeNumber = (value: any): number => {
    if (value === null || value === undefined) return 0
    const num = Number(value)
    if (isNaN(num) || !isFinite(num)) return 0
    return Math.max(0, num) // Ensure non-negative
  }

  // Prepare data for charts with proper validation
  const statusDistributionData = Object.entries(analytics.statusDistribution)
    .map(([status, count]) => ({
      name: STAGE_LABELS[status as keyof typeof STAGE_LABELS] || status,
      value: sanitizeNumber(count),
      color: STAGE_COLORS[status as keyof typeof STAGE_COLORS] || '#6b7280',
    }))
    .filter(item => item.value > 0) // Only show stages with candidates

  const conversionData = Object.entries(analytics.conversionRates)
    .map(([transition, rate]) => {
      const [from, to] = transition.split('_to_')
      const sanitizedRate = sanitizeNumber(rate)
      return {
        name: `${STAGE_LABELS[from as keyof typeof STAGE_LABELS]} → ${STAGE_LABELS[to as keyof typeof STAGE_LABELS]}`,
        rate: Math.round(sanitizedRate * 100) / 100, // Round to 2 decimal places
      }
    })
    .filter(item => !isNaN(item.rate)) // Filter out any remaining NaN values

  const timeInStageData = Object.entries(analytics.averageTimeInStage)
    .map(([stage, days]) => ({
      name: STAGE_LABELS[stage as keyof typeof STAGE_LABELS] || stage,
      days: sanitizeNumber(days),
    }))
    .filter(item => !isNaN(item.days)) // Filter out any NaN values

  // Calculate key metrics with proper sanitization
  const totalHired = sanitizeNumber(analytics.statusDistribution.hired)
  const totalApplicants = sanitizeNumber(analytics.totalApplicants)
  const hireRate = totalApplicants > 0 ? Math.round((totalHired / totalApplicants) * 100) : 0
  
  const interviewToOfferRate = Math.round(sanitizeNumber(analytics.conversionRates['interviewing_to_offered']))
  const offerToHireRate = Math.round(sanitizeNumber(analytics.conversionRates['offered_to_hired']))

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Pipeline Analytics</h3>
        <Button variant="outline" size="sm" onClick={fetchAnalytics}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Candidates</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalApplicants}</div>
            <p className="text-xs text-muted-foreground">
              In pipeline
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Hire Rate</CardTitle>
            <Target className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{hireRate}%</div>
            <p className="text-xs text-muted-foreground">
              {totalHired} hired of {totalApplicants}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Interview Success</CardTitle>
            <CheckCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{interviewToOfferRate}%</div>
            <p className="text-xs text-muted-foreground">
              Interview to offer rate
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Offer Acceptance</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{offerToHireRate}%</div>
            <p className="text-xs text-muted-foreground">
              Offer to hire rate
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Status Distribution */}
        <Card>
          <CardHeader>
            <CardTitle>Status Distribution</CardTitle>
            <CardDescription>Current candidate distribution across stages</CardDescription>
          </CardHeader>
          <CardContent>
            {statusDistributionData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={statusDistributionData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, value }) => `${name}: ${value}`}
                    outerRadius={80}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {statusDistributionData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[300px] text-muted-foreground">
                <p>No data available</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Conversion Rates */}
        <Card>
          <CardHeader>
            <CardTitle>Conversion Rates</CardTitle>
            <CardDescription>Stage-to-stage conversion percentages</CardDescription>
          </CardHeader>
          <CardContent>
            {conversionData.length > 0 && conversionData.some(item => item.rate > 0) ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={conversionData} layout="horizontal">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    type="number" 
                    domain={[0, 'dataMax']} 
                    tickFormatter={(value) => `${Math.round(Number(value))}%`}
                  />
                  <YAxis dataKey="name" type="category" width={120} />
                                     <Tooltip formatter={(value) => [`${Math.round(Number(value))}%`, 'Conversion Rate']} />
                  <Bar dataKey="rate" fill="#3b82f6" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[300px] text-muted-foreground">
                <p>No conversion data available</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Time in Stage */}
        <Card>
          <CardHeader>
            <CardTitle>Average Time in Stage</CardTitle>
            <CardDescription>Average days spent in each stage</CardDescription>
          </CardHeader>
          <CardContent>
            {timeInStageData.length > 0 && timeInStageData.some(item => item.days > 0) ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={timeInStageData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis domain={[0, 'dataMax']} />
                  <Tooltip formatter={(value) => [`${Math.round(Number(value))} days`, 'Average Time']} />
                  <Bar dataKey="days" fill="#8b5cf6" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[300px] text-muted-foreground">
                <p>No time data available</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Pipeline Health */}
        <Card>
          <CardHeader>
            <CardTitle>Pipeline Health</CardTitle>
            <CardDescription>Bottlenecks and recommendations</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {analytics.pipelineHealth.bottlenecks.length > 0 ? (
              <div>
                <h4 className="font-medium text-sm mb-2 flex items-center">
                  <AlertTriangle className="h-4 w-4 mr-2 text-orange-500" />
                  Bottlenecks Detected
                </h4>
                <div className="space-y-2">
                  {analytics.pipelineHealth.bottlenecks.map((bottleneck, index) => (
                    <div key={index} className="flex items-center justify-between p-2 bg-orange-50 rounded">
                      <div>
                        <span className="font-medium">{STAGE_LABELS[bottleneck.stage as keyof typeof STAGE_LABELS]}</span>
                        <p className="text-xs text-muted-foreground">
                          {bottleneck.candidateCount} candidates, {bottleneck.averageDays} days avg
                        </p>
                      </div>
                      <Badge variant={bottleneck.severity === 'high' ? 'destructive' : 'secondary'}>
                        {bottleneck.severity}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex items-center text-green-600">
                <CheckCircle className="h-4 w-4 mr-2" />
                <span className="text-sm">No bottlenecks detected</span>
              </div>
            )}

            {analytics.pipelineHealth.recommendations.length > 0 && (
              <div>
                <h4 className="font-medium text-sm mb-2">Recommendations</h4>
                <ul className="space-y-1">
                  {analytics.pipelineHealth.recommendations.map((recommendation, index) => (
                    <li key={index} className="text-sm text-muted-foreground flex items-start">
                      <span className="w-2 h-2 bg-blue-500 rounded-full mt-2 mr-2 flex-shrink-0"></span>
                      {recommendation}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Stage Details */}
      <Card>
        <CardHeader>
          <CardTitle>Stage Details</CardTitle>
          <CardDescription>Detailed breakdown by pipeline stage</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {Object.entries(analytics.statusDistribution).map(([status, count]) => {
              const avgTime = analytics.averageTimeInStage[status]
              const percentage = Math.round((count / totalApplicants) * 100)
              
              return (
                <div key={status} className="flex items-center justify-between p-3 border rounded-lg">
                  <div className="flex items-center space-x-3">
                    <div 
                      className="w-4 h-4 rounded-full"
                      style={{ backgroundColor: STAGE_COLORS[status as keyof typeof STAGE_COLORS] }}
                    />
                    <div>
                      <span className="font-medium">{STAGE_LABELS[status as keyof typeof STAGE_LABELS]}</span>
                      <p className="text-sm text-muted-foreground">
                        {count} candidates ({percentage}%)
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    {avgTime && (
                      <div className="text-sm">
                        <Clock className="h-3 w-3 inline mr-1" />
                        {avgTime} days avg
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  )
} 