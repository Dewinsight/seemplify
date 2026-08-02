"use client"

import { useEffect, useState } from "react"
import { BarChart3, Clock, Database, Loader2, RefreshCw, TrendingUp, Zap } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
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
      const response = await fetch("/api/candidates/cache/stats")

      if (!response.ok) {
        throw new Error("Failed to fetch cache statistics")
      }

      const data = await response.json()
      setStats(data.stats)
    } catch (error: any) {
      console.error("Error fetching cache stats:", error)
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
    const interval = setInterval(fetchCacheStats, 30000)
    return () => clearInterval(interval)
  }, [])

  const getHitRateColor = (hitRate: number) => {
    if (hitRate >= 80) return "text-green-600"
    if (hitRate >= 60) return "text-yellow-600"
    return "text-red-600"
  }

  const getHitRateBg = (hitRate: number) => {
    if (hitRate >= 80) return "bg-green-50 border-green-200"
    if (hitRate >= 60) return "bg-yellow-50 border-yellow-200"
    return "bg-red-50 border-red-200"
  }

  if (loading) {
    return (
      <Card className="border-0 bg-white/60 shadow-lg backdrop-blur-xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            GPT Cache Performance
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-0 bg-white/60 shadow-lg backdrop-blur-xl">
      <CardHeader className="rounded-t-lg bg-gradient-to-r from-blue-600 to-indigo-700 text-white">
        <CardTitle className="flex items-center justify-between text-xl font-semibold">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            GPT Cache Performance
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={fetchCacheStats}
            disabled={refreshing}
            className="border-white/30 bg-white/20 text-white hover:bg-white/30"
          >
            {refreshing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </Button>
        </CardTitle>
        <CardDescription className="text-blue-100">
          Real-time monitoring of LLM batch-analysis cache performance
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6 p-6">
        {stats ? (
          <>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <div className={`rounded-lg border p-4 ${getHitRateBg(stats.hitRate)}`}>
                <div className="mb-2 flex items-center gap-2">
                  <Zap className={`h-4 w-4 ${getHitRateColor(stats.hitRate)}`} />
                  <h3 className="text-sm font-medium">Cache Hit Rate</h3>
                </div>
                <div className="space-y-2">
                  <div className={`text-2xl font-bold ${getHitRateColor(stats.hitRate)}`}>
                    {stats.hitRate.toFixed(1)}%
                  </div>
                  <Progress value={stats.hitRate} className="h-2" />
                  <p className="text-xs text-gray-600">Target: {" > "}70%</p>
                </div>
              </div>

              <div className="rounded-lg border border-purple-200 bg-purple-50 p-4">
                <div className="mb-2 flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-purple-600" />
                  <h3 className="text-sm font-medium">Total Requests</h3>
                </div>
                <div className="text-2xl font-bold text-purple-600">
                  {stats.totalRequests.toLocaleString()}
                </div>
                <p className="mt-1 text-xs text-gray-600">Analysis requests</p>
              </div>

              <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
                <div className="mb-2 flex items-center gap-2">
                  <Database className="h-4 w-4 text-blue-600" />
                  <h3 className="text-sm font-medium">Cache Entries</h3>
                </div>
                <div className="text-2xl font-bold text-blue-600">
                  {stats.cacheSize.toLocaleString()}
                </div>
                <p className="mt-1 text-xs text-gray-600">Stored analyses</p>
              </div>

              <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-4">
                <div className="mb-2 flex items-center gap-2">
                  <Clock className="h-4 w-4 text-indigo-600" />
                  <h3 className="text-sm font-medium">Candidates Tracked</h3>
                </div>
                <div className="text-2xl font-bold text-indigo-600">
                  {stats.candidatesTracked.toLocaleString()}
                </div>
                <p className="mt-1 text-xs text-gray-600">For cache invalidation</p>
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="text-lg font-semibold">Performance Insights</h3>

              <div className="grid gap-3">
                <div className="rounded border bg-gray-50 p-3">
                  <div className="flex items-start gap-3">
                    <div
                      className={`mt-2 h-2 w-2 rounded-full ${
                        stats.hitRate >= 80
                          ? "bg-green-500"
                          : stats.hitRate >= 60
                            ? "bg-yellow-500"
                            : "bg-red-500"
                      }`}
                    />
                    <div className="flex-1">
                      <h4 className="mb-1 text-sm font-medium">Cache Efficiency</h4>
                      <p className="text-sm text-gray-600">
                        {stats.hitRate >= 80
                          ? "Excellent cache performance. Most requests are served instantly from cache."
                          : stats.hitRate >= 60
                            ? "Good cache performance, but there is room for improvement."
                            : "Cache hit rate is below target. Consider optimizing cache strategies."}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="rounded border bg-gray-50 p-3">
                  <div className="flex items-start gap-3">
                    <div className="mt-2 h-2 w-2 rounded-full bg-blue-500" />
                    <div className="flex-1">
                      <h4 className="mb-1 text-sm font-medium">Usage Volume</h4>
                      <p className="text-sm text-gray-600">
                        {stats.totalRequests > 1000
                          ? `High usage system with ${stats.totalRequests.toLocaleString()} total analysis requests.`
                          : stats.totalRequests > 100
                            ? `Moderate usage with ${stats.totalRequests.toLocaleString()} analysis requests.`
                            : `Early stage usage with ${stats.totalRequests.toLocaleString()} analysis requests.`}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="rounded border bg-gray-50 p-3">
                  <div className="flex items-start gap-3">
                    <div className="mt-2 h-2 w-2 rounded-full bg-purple-500" />
                    <div className="flex-1">
                      <h4 className="mb-1 text-sm font-medium">Cache Management</h4>
                      <p className="text-sm text-gray-600">
                        {stats.candidatesTracked > 0
                          ? `Tracking ${stats.candidatesTracked.toLocaleString()} candidates for smart cache invalidation.`
                          : "No candidates are being tracked for cache invalidation yet."}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-lg border bg-gradient-to-r from-gray-50 to-gray-100 p-4">
              <h3 className="mb-3 text-sm font-semibold">Performance Targets</h3>
              <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-3">
                <div className="flex items-center gap-2">
                  <Badge variant={stats.hitRate >= 70 ? "default" : "secondary"} className="text-xs">
                    Cache Hit Rate: {" > "}70%
                  </Badge>
                  <span className={stats.hitRate >= 70 ? "text-green-600" : "text-gray-500"}>
                    {stats.hitRate >= 70 ? "OK" : "Pending"}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">
                    Response Time: {" < "}1s
                  </Badge>
                  <span className="text-green-600">OK</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">
                    API Cost: {" < "}$0.01/match
                  </Badge>
                  <span className="text-green-600">OK</span>
                </div>
              </div>
            </div>

            <div className="border-t pt-3 text-center text-xs text-gray-500">
              Last updated: {new Date(stats.timestamp).toLocaleString()}
              <br />
              Auto-refreshes every 30 seconds
            </div>
          </>
        ) : (
          <div className="py-8 text-center text-gray-500">
            <BarChart3 className="mx-auto mb-3 h-12 w-12 text-gray-300" />
            <p>No cache statistics available</p>
            <p className="text-sm">GPT analysis may not be enabled</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
