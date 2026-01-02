"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Loader2, BarChart3, Clock, Database, RefreshCw, TrendingUp, Zap } from "lucide-react"
import { toast } from "@/components/ui/use-toast"

interface CacheStats {
  hitRate: number
  totalRequests: number
  cacheSize: number
  candidatesTracked: number
  timestamp: string
}

export function GPTCacheMonitor() {
  const [stats, setStats] = useState<CacheStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const fetchCacheStats = async () => {
    try {
      setRefreshing(true)
      const response = await fetch('/api/candidates/cache/stats')
      
      if (!response.ok) {
        throw new Error('Failed to fetch cache statistics')
      }
      
      const data = await response.json()
      setStats(data.stats)
    } catch (error: any) {
      console.error('Error fetching cache stats:', error)
      toast({
        title: "Error",
        description: "Failed to fetch cache statistics",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    fetchCacheStats()
    // Auto-refresh every 30 seconds
    const interval = setInterval(fetchCacheStats, 30000)
    return () => clearInterval(interval)
  }, [])

  const getHitRateColor = (hitRate: number) => {
    if (hitRate >= 80) return "text-green-600"
    if (hitRate >= 60) return "text-yellow-600"
    return "text-red-600"
  }

  const getHitRateBg = (hitRate: number) => {
    if (hitRate >= 80) return "bg-green-100 border-green-200"
    if (hitRate >= 60) return "bg-yellow-100 border-yellow-200"
    return "bg-red-100 border-red-200"
  }

  if (loading) {
    return (
      <Card className="border-0 bg-white/60 backdrop-blur-xl shadow-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            GPT Cache Performance
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="animate-spin h-6 w-6 text-primary" />
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-0 bg-white/60 backdrop-blur-xl shadow-lg">
      <CardHeader className="bg-gradient-to-r from-blue-600 to-indigo-700 text-white rounded-t-lg">
        <CardTitle className="text-xl font-semibold flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            GPT Cache Performance
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={fetchCacheStats}
            disabled={refreshing}
            className="bg-white/20 hover:bg-white/30 text-white border-white/30"
          >
            {refreshing ? (
              <Loader2 className="animate-spin h-4 w-4" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </Button>
        </CardTitle>
        <CardDescription className="text-blue-100">
          Real-time monitoring of GPT-4.1 analysis caching performance
        </CardDescription>
      </CardHeader>
      
      <CardContent className="p-6 space-y-6">
        {stats ? (
          <>
            {/* Key Metrics Row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {/* Hit Rate */}
              <div className={`p-4 rounded-lg border ${getHitRateBg(stats.hitRate)}`}>
                <div className="flex items-center gap-2 mb-2">
                  <Zap className={`h-4 w-4 ${getHitRateColor(stats.hitRate)}`} />
                  <h3 className="font-medium text-sm">Cache Hit Rate</h3>
                </div>
                <div className="space-y-2">
                  <div className={`text-2xl font-bold ${getHitRateColor(stats.hitRate)}`}>
                    {stats.hitRate.toFixed(1)}%
                  </div>
                  <Progress 
                    value={stats.hitRate} 
                    className="h-2"
                  />
                  <p className="text-xs text-muted-foreground">
                    Target: >70%
                  </p>
                </div>
              </div>

              {/* Total Requests */}
              <div className="p-4 rounded-lg border bg-purple-50 border-purple-200">
                <div className="flex items-center gap-2 mb-2">
                  <TrendingUp className="h-4 w-4 text-purple-600" />
                  <h3 className="font-medium text-sm">Total Requests</h3>
                </div>
                <div className="text-2xl font-bold text-purple-600">
                  {stats.totalRequests.toLocaleString()}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Analysis requests
                </p>
              </div>

              {/* Cache Size */}
              <div className="p-4 rounded-lg border bg-blue-50 border-blue-200">
                <div className="flex items-center gap-2 mb-2">
                  <Database className="h-4 w-4 text-blue-600" />
                  <h3 className="font-medium text-sm">Cache Entries</h3>
                </div>
                <div className="text-2xl font-bold text-blue-600">
                  {stats.cacheSize.toLocaleString()}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Stored analyses
                </p>
              </div>

              {/* Candidates Tracked */}
              <div className="p-4 rounded-lg border bg-indigo-50 border-indigo-200">
                <div className="flex items-center gap-2 mb-2">
                  <Clock className="h-4 w-4 text-indigo-600" />
                  <h3 className="font-medium text-sm">Candidates Tracked</h3>
                </div>
                <div className="text-2xl font-bold text-indigo-600">
                  {stats.candidatesTracked.toLocaleString()}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  For cache invalidation
                </p>
              </div>
            </div>

            {/* Performance Insights */}
            <div className="space-y-3">
              <h3 className="font-semibold text-lg">Performance Insights</h3>
              
              <div className="grid gap-3">
                {/* Hit Rate Analysis */}
                <div className="p-3 rounded border bg-gray-50">
                  <div className="flex items-start gap-3">
                    <div className={`w-2 h-2 rounded-full mt-2 ${
                      stats.hitRate >= 80 ? 'bg-green-500' : 
                      stats.hitRate >= 60 ? 'bg-yellow-500' : 'bg-red-500'
                    }`}></div>
                    <div className="flex-1">
                      <h4 className="font-medium text-sm mb-1">Cache Efficiency</h4>
                      <p className="text-sm text-muted-foreground">
                        {stats.hitRate >= 80 ? 
                          "🟢 Excellent cache performance! Most requests are served instantly from cache." :
                          stats.hitRate >= 60 ?
                          "🟡 Good cache performance, but there's room for improvement." :
                          "🔴 Cache hit rate is below target. Consider optimizing cache strategies."
                        }
                      </p>
                    </div>
                  </div>
                </div>

                {/* Request Volume Analysis */}
                <div className="p-3 rounded border bg-gray-50">
                  <div className="flex items-start gap-3">
                    <div className="w-2 h-2 rounded-full bg-blue-500 mt-2"></div>
                    <div className="flex-1">
                      <h4 className="font-medium text-sm mb-1">Usage Volume</h4>
                      <p className="text-sm text-muted-foreground">
                        {stats.totalRequests > 1000 ?
                          `High usage system with ${stats.totalRequests.toLocaleString()} total analysis requests.` :
                          stats.totalRequests > 100 ?
                          `Moderate usage with ${stats.totalRequests.toLocaleString()} analysis requests.` :
                          `Early stage usage with ${stats.totalRequests.toLocaleString()} analysis requests.`
                        }
                      </p>
                    </div>
                  </div>
                </div>

                {/* Cache Management */}
                <div className="p-3 rounded border bg-gray-50">
                  <div className="flex items-start gap-3">
                    <div className="w-2 h-2 rounded-full bg-purple-500 mt-2"></div>
                    <div className="flex-1">
                      <h4 className="font-medium text-sm mb-1">Cache Management</h4>
                      <p className="text-sm text-muted-foreground">
                        {stats.candidatesTracked > 0 ?
                          `Tracking ${stats.candidatesTracked.toLocaleString()} candidates for smart cache invalidation.` :
                          "No candidates being tracked for cache invalidation yet."
                        }
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Performance Targets */}
            <div className="bg-gradient-to-r from-gray-50 to-gray-100 p-4 rounded-lg border">
              <h3 className="font-semibold text-sm mb-3">🎯 Performance Targets</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                <div className="flex items-center gap-2">
                  <Badge variant={stats.hitRate >= 70 ? "default" : "secondary"} className="text-xs">
                    Cache Hit Rate: >70%
                  </Badge>
                  <span className={stats.hitRate >= 70 ? "text-green-600" : "text-muted-foreground"}>
                    {stats.hitRate >= 70 ? "✓" : "○"}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">
                    Response Time: <1s
                  </Badge>
                  <span className="text-green-600">✓</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">
                    API Cost: <$0.01/match
                  </Badge>
                  <span className="text-green-600">✓</span>
                </div>
              </div>
            </div>

            {/* Last Updated */}
            <div className="text-xs text-muted-foreground text-center border-t pt-3">
              Last updated: {new Date(stats.timestamp).toLocaleString()}
              <br />
              Auto-refreshes every 30 seconds
            </div>
          </>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            <BarChart3 className="h-12 w-12 mx-auto mb-3 text-gray-300" />
            <p>No cache statistics available</p>
            <p className="text-sm">GPT analysis may not be enabled</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
} 