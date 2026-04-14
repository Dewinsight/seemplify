"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Checkbox } from "@/components/ui/checkbox"
import { Progress } from "@/components/ui/progress"
import { Loader2, Users, CheckCircle, XCircle, RefreshCw, User, Mail, Phone, MapPin, ChevronDown, ChevronUp, MessageSquare, AlertTriangle, ThumbsUp, Target, ExternalLink, UserPlus, Brain, Zap, Clock, Search } from "lucide-react"
import { HRLogo } from "@/components/ui/HRLogo"
import { toast } from "@/components/ui/use-toast"
import jobEmbeddingService from "@/services/jobEmbeddingService"
import { addCandidateToShortlist, bulkAddToShortlist } from "@/services/jobService"
import * as aiMatchCacheService from "@/services/aiMatchCacheService"
import {
  getEnrichmentEstimate,
  getEnrichmentResults,
  getEnrichmentStatus,
  startEnrichment,
  type EnrichmentEstimateResponse,
  type EnrichmentStatusResponse,
} from "@/services/enrichmentService"
import { useCreditError } from "@/hooks/useCreditError"
import { CreditErrorDialog } from "@/components/ui/credit-error-dialog"

interface JobEmbeddingCardProps {
  jobId: string
  onCandidateAdded?: () => void
  pipelineCandidateIds?: string[] // Array of candidate IDs already in pipeline
  shortlistCandidateIds?: string[]
}

interface MatchingCandidate {
  candidateId: string
  similarity: number
  similarityPercentage: number
  relevanceScore: number
  candidate: {
    name: string
    position: string
    experience: string
    skills: string[] | string
    location: string
    email: string
    phone: string
  }
  explanation?: {
    skillsMatch: {
      matchedSkills: string[]
      missingSkills: string[]
      bonusSkills: string[]
      matchPercentage: number
      totalRequired: number
      totalMatched: number
    }
    experienceMatch: {
      isMatch: boolean
      required: number
      candidate: number
      difference: number
      category: string
    }
    locationMatch: {
      isMatch: boolean
      type: string
      job: string
      candidate: string
    }
    industryMatch: {
      hasRelevantIndustry: boolean
      matchedIndustries: string[]
      allIndustries: string[]
      relevanceScore: number
    }
    leadershipMatch: {
      requiresLeadership: boolean
      hasLeadership: boolean
      isMatch: boolean
      gap: boolean
    }
    aiInsights: {
      hasAIAnalysis: boolean
      summary: string
      strengths: string[]
      potentialFlags: string[]
      strengthsCount: number
      flagsCount: number
    }
    careerFit: {
      totalYearsExp: number
      hasCareerProgression: boolean
      hasAchievements: boolean
      companiesWorkedAt: number
      positionsHeld: number
      avgTenureYears: number
      stabilityScore: string
      progressionIndicators: {
        multiplePositions: boolean
        multipleCompanies: boolean
        documentedGrowth: boolean
      }
    }
    dataQuality: {
      completeness: number
      hasDetailedHistory: boolean
      hasAIAnalysis: boolean
      hasCoverLetter: boolean
    }
    matchStrength: string
    overallScore: number
    reasons: string[]
    concerns: string[]
    // Legacy fields for backward compatibility
    topReasons?: string[]
    potentialConcerns?: string[]
    // LLM-enhanced insights (deployment from server env, e.g. Llama 3.3 70B)
    gptEnhanced?: {
      skillMatchPercentage: number
      experienceFit: number
      culturalAlignment: number
      growthPotential: number
      interviewFocus: string[]
      confidenceScore: number
      contextualExplanation: string
    }
  }
}

const TOP_K_OPTIONS = [10, 25, 50, 100, 250, 500, 1000, 2000, 5000]

export function JobEmbeddingCard({ jobId, onCandidateAdded, pipelineCandidateIds = [], shortlistCandidateIds = [] }: JobEmbeddingCardProps) {
  const router = useRouter()
  const [embeddingStatus, setEmbeddingStatus] = useState<any>(null)
  const [matchingCandidates, setMatchingCandidates] = useState<MatchingCandidate[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [loadingMatches, setLoadingMatches] = useState(false)
  const [expandedCandidates, setExpandedCandidates] = useState<Set<string>>(new Set())
  const [addingToPipeline, setAddingToPipeline] = useState<Set<string>>(new Set())
  const [selectedCandidates, setSelectedCandidates] = useState<Set<string>>(new Set())
  const [bulkAddingToShortlist, setBulkAddingToShortlist] = useState(false)
  const [optimisticShortlisted, setOptimisticShortlisted] = useState<Set<string>>(new Set())
  const [fromCache, setFromCache] = useState(false)
  const [cacheAge, setCacheAge] = useState<Date | null>(null)
  const [invalidatingCache, setInvalidatingCache] = useState(false)
  
  // Large-scale matching state
  const [topK, setTopK] = useState(10)
  const [matchMode, setMatchMode] = useState<'full-analysis' | 'vector-ranked'>('full-analysis')
  const [loadingExplanations, setLoadingExplanations] = useState<Set<string>>(new Set())
  const [lazyExplanations, setLazyExplanations] = useState<Record<string, any>>({})
  const [enrichCount, setEnrichCount] = useState(50)
  const [enrichmentEstimate, setEnrichmentEstimate] = useState<EnrichmentEstimateResponse | null>(null)
  const [enrichmentStatus, setEnrichmentStatus] = useState<EnrichmentStatusResponse | null>(null)
  const [enrichmentId, setEnrichmentId] = useState<string | null>(null)
  const [enrichmentLoadingEstimate, setEnrichmentLoadingEstimate] = useState(false)
  const [enrichmentStarting, setEnrichmentStarting] = useState(false)
  
  const { creditError, showCreditDialog, setShowCreditDialog, handleError: handleCreditError } = useCreditError()

  const isEnrichmentProcessing = enrichmentStatus?.state === 'processing'
  const selectedEnrichCount = Math.min(enrichCount, matchingCandidates.length || enrichCount)
  const enrichOptions = [50, 100, 250, matchingCandidates.length]
    .filter((n, idx, arr) => n > 0 && n <= matchingCandidates.length && arr.indexOf(n) === idx)
    .sort((a, b) => a - b)

  const formatDuration = (seconds: number | null | undefined) => {
    if (!seconds || seconds <= 0) return '0s'
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`
  }

  const toggleExplanation = async (candidateId: string) => {
    const newExpanded = new Set(expandedCandidates)
    if (newExpanded.has(candidateId)) {
      newExpanded.delete(candidateId)
    } else {
      newExpanded.add(candidateId)

      // Lazy-load explanation when missing (vector-ranked, or full-analysis rows without embedded explanation)
      const match = matchingCandidates.find(m => m.candidateId === candidateId)
      if (!match?.explanation && !lazyExplanations[candidateId]) {
        setLoadingExplanations(prev => new Set(prev).add(candidateId))
        try {
          const result = await jobEmbeddingService.getCandidateExplanation(jobId, candidateId)
          setLazyExplanations(prev => ({ ...prev, [candidateId]: result.explanation }))
        } catch (err: any) {
          console.error('Failed to load explanation:', err)
          toast({ title: "Error", description: "Could not load AI analysis", variant: "destructive" })
        } finally {
          setLoadingExplanations(prev => { const s = new Set(prev); s.delete(candidateId); return s })
        }
      }
    }
    setExpandedCandidates(newExpanded)
  }

  const getEligibleCandidateIds = () => {
    const eligible = matchingCandidates
      .map((match) => match.candidateId)
      .filter((candidateId) => {
        const isAlreadyInPipeline = pipelineCandidateIds.includes(candidateId)
        const isAlreadyInShortlist = shortlistCandidateIds.includes(candidateId) || optimisticShortlisted.has(candidateId)
        return !isAlreadyInPipeline && !isAlreadyInShortlist
      })
    return eligible
  }

  const toggleCandidateSelection = (candidateId: string) => {
    setSelectedCandidates((prev) => {
      const next = new Set(prev)
      if (next.has(candidateId)) {
        next.delete(candidateId)
      } else {
        next.add(candidateId)
      }
      return next
    })
  }

  const handleSelectAllEligible = () => {
    const eligible = getEligibleCandidateIds()
    setSelectedCandidates(new Set(eligible))
  }

  const handleClearSelection = () => {
    setSelectedCandidates(new Set())
  }

  const handleBulkAddToShortlist = async () => {
    const selected = Array.from(selectedCandidates)
    if (selected.length === 0) return

    try {
      setBulkAddingToShortlist(true)
      const result = await bulkAddToShortlist(jobId, selected)

      if (result.added?.length) {
        setOptimisticShortlisted((prev) => {
          const next = new Set(prev)
          result.added.forEach((id) => next.add(id))
          return next
        })
      }

      setSelectedCandidates(new Set())
      toast({
        title: "Candidates added to shortlist",
        description: `${result.addedCount} added, ${result.skippedCount} skipped.`,
      })

      if (onCandidateAdded) {
        onCandidateAdded()
      }
    } catch (error: any) {
      toast({
        title: "Bulk add failed",
        description: error.message || "Failed to bulk add candidates to shortlist",
        variant: "destructive",
      })
    } finally {
      setBulkAddingToShortlist(false)
    }
  }

  const navigateToCandidate = (candidateId: string) => {
    router.push(`/candidates/${candidateId}?from=job-ai-matching&jobId=${jobId}`)
  }

  const fetchEmbeddingStatus = async () => {
    try {
      const status = await jobEmbeddingService.getEmbeddingStatus(jobId)
      setEmbeddingStatus(status)
      
      // If embedding exists, fetch matching candidates
      if (status.isEmbedded) {
        await fetchMatchingCandidates()
      }
    } catch (error: any) {
      console.error('Error fetching embedding status:', error)
      toast({
        title: "Error",
        description: "Failed to fetch embedding status",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  const fetchMatchingCandidates = async (requestedTopK?: number) => {
    const k = requestedTopK ?? topK
    try {
      setLoadingMatches(true)
      setLazyExplanations({})
      setExpandedCandidates(new Set())
      setSelectedCandidates(new Set())
      setEnrichmentId(null)
      setEnrichmentStatus(null)
      setEnrichmentEstimate(null)
      setEnrichmentStarting(false)
      const response = await jobEmbeddingService.getMatchingCandidates(jobId, k)
      setMatchingCandidates(response.matches || [])
      setMatchMode(response.mode || (k > 100 ? 'vector-ranked' : 'full-analysis'))
      
      setFromCache(response.fromCache || false)
      setCacheAge(response.cacheAge || null)
      
      if (response.fromCache) {
        console.log('[AI Matches] Loaded from cache, age:', response.cacheAgeMinutes, 'minutes')
      }
    } catch (error: any) {
      console.error('Error fetching matching candidates:', error)
      const isCreditError = handleCreditError(error)
      if (!isCreditError) {
        toast({ title: "Error", description: error.message || "Failed to fetch matching candidates", variant: "destructive" })
      }
    } finally {
      setLoadingMatches(false)
    }
  }

  const handleInvalidateCache = async () => {
    try {
      setInvalidatingCache(true)
      console.log('[AI Cache] Invalidating cache for job:', jobId)
      
      const result = await aiMatchCacheService.invalidateJobCache(jobId)
      
      toast({
        title: "Cache Cleared",
        description: `${result.deletedCount} cache entries cleared. Generating fresh AI matches...`,
      })
      
      // Fetch fresh matches
      await fetchMatchingCandidates()
      
    } catch (error: any) {
      console.error('[AI Cache] Error invalidating cache:', error)
      toast({
        title: "Error",
        description: error.message || "Failed to invalidate cache",
        variant: "destructive",
      })
    } finally {
      setInvalidatingCache(false)
    }
  }

  const createEmbedding = async () => {
    try {
      setCreating(true)
      await jobEmbeddingService.createEmbedding(jobId)
      
      toast({
        title: "Success",
        description: "Job embedding created successfully",
      })
      
      // Refresh status and fetch matches
      await fetchEmbeddingStatus()
    } catch (error: any) {
      console.error('Error creating embedding:', error)
      
      // Check if it's a credit error
      const isCreditError = handleCreditError(error)
      
      if (!isCreditError) {
        // Show generic error for non-credit errors
        toast({
          title: "Error",
          description: error.message || "Failed to create embedding",
          variant: "destructive",
        })
      }
    } finally {
      setCreating(false)
    }
  }

  // Add candidate to shortlist function
  const handleAddToShortlist = async (candidateId: string, candidateName: string) => {
    if (addingToPipeline.has(candidateId)) return

    try {
      setAddingToPipeline(prev => new Set([...prev, candidateId]))
      
      await addCandidateToShortlist(jobId, candidateId)
      setOptimisticShortlisted(prev => {
        const next = new Set(prev)
        next.add(candidateId)
        return next
      })
      
      toast({
        title: "Candidate Added to Shortlist",
        description: `${candidateName} has been added to the shortlist`,
      })

      // Call the callback to refresh parent data
      if (onCandidateAdded) {
        onCandidateAdded()
      }
    } catch (error: any) {
      let errorMessage = error.message
      if (error.message.includes('already in shortlist')) {
        errorMessage = `${candidateName} is already in the shortlist for this job`
      }
      
      toast({
        title: "Failed to Add Candidate",
        description: errorMessage,
        variant: "destructive",
      })
    } finally {
      setAddingToPipeline(prev => {
        const newSet = new Set(prev)
        newSet.delete(candidateId)
        return newSet
      })
    }
  }

  // When the parent refreshes and confirms the candidate is in the shortlist, drop the optimistic entry.
  useEffect(() => {
    const serverShortlisted = new Set(shortlistCandidateIds)
    setOptimisticShortlisted(prev => {
      if (prev.size === 0) return prev
      let changed = false
      const next = new Set(prev)
      for (const id of prev) {
        if (serverShortlisted.has(id)) {
          next.delete(id)
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [shortlistCandidateIds])

  useEffect(() => {
    // Keep selection clean as candidates become ineligible.
    const eligible = new Set(getEligibleCandidateIds())
    setSelectedCandidates((prev) => {
      if (prev.size === 0) return prev
      let changed = false
      const next = new Set<string>()
      for (const id of prev) {
        if (eligible.has(id)) {
          next.add(id)
        } else {
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [matchingCandidates, pipelineCandidateIds, shortlistCandidateIds, optimisticShortlisted])

  useEffect(() => {
    fetchEmbeddingStatus()
  }, [jobId])

  useEffect(() => {
    if (matchMode !== 'vector-ranked' || matchingCandidates.length === 0) return
    if (!enrichOptions.length) return
    if (!enrichOptions.includes(enrichCount)) {
      setEnrichCount(enrichOptions[0])
    }
  }, [matchMode, matchingCandidates.length, enrichOptions, enrichCount])

  useEffect(() => {
    const loadEstimate = async () => {
      if (matchMode !== 'vector-ranked' || matchingCandidates.length === 0) {
        setEnrichmentEstimate(null)
        return
      }

      try {
        setEnrichmentLoadingEstimate(true)
        const estimate = await getEnrichmentEstimate(jobId, selectedEnrichCount)
        setEnrichmentEstimate(estimate)
      } catch (error: any) {
        console.error('Error loading enrichment estimate:', error)
        setEnrichmentEstimate(null)
      } finally {
        setEnrichmentLoadingEstimate(false)
      }
    }

    loadEstimate()
  }, [jobId, matchMode, matchingCandidates.length, selectedEnrichCount])

  useEffect(() => {
    if (!enrichmentId) return

    const poll = async () => {
      try {
        const status = await getEnrichmentStatus(enrichmentId)
        setEnrichmentStatus(status)

        if (status.state === 'completed') {
          let rankedMatches = status.rankedMatches || []
          if (!rankedMatches.length) {
            const results = await getEnrichmentResults(enrichmentId)
            rankedMatches = results.rankedMatches || []
          }

          if (rankedMatches.length > 0) {
            setMatchingCandidates(rankedMatches)
            setMatchMode('full-analysis')
            setLazyExplanations({})
            setExpandedCandidates(new Set())
          }

          setEnrichmentId(null)
          setEnrichmentStarting(false)
          setEnrichmentStatus(null)
          toast({
            title: "Enrichment complete",
            description: `Ranked ${status.enrichCount} candidates with AI enrichment.`,
          })
        } else if (status.state === 'failed') {
          setEnrichmentId(null)
          setEnrichmentStarting(false)
          toast({
            title: "Enrichment failed",
            description: status.errors?.[0]?.error || "Failed to enrich and rank candidates.",
            variant: "destructive",
          })
        }
      } catch (error) {
        console.error('Error polling enrichment status:', error)
      }
    }

    poll()
    const intervalId = setInterval(poll, 2000)
    return () => clearInterval(intervalId)
  }, [enrichmentId])

  const handleStartEnrichment = async () => {
    try {
      setEnrichmentStarting(true)
      const response = await startEnrichment(jobId, selectedEnrichCount, matchingCandidates)
      setEnrichmentId(response.enrichmentId)
      setEnrichmentStatus(null)
      toast({
        title: "Enrichment started",
        description: `Analyzing top ${selectedEnrichCount} candidates in the background.`,
      })
    } catch (error: any) {
      setEnrichmentStarting(false)
      const isCreditError = handleCreditError(error)
      if (!isCreditError) {
        toast({
          title: "Error",
          description: error.message || "Failed to start enrichment",
          variant: "destructive",
        })
      }
    }
  }

  if (loading) {
    return (
      <Card className="border-0 bg-white/60 dark:bg-slate-800/60 backdrop-blur-xl shadow-lg dark:shadow-2xl dark:border-slate-700">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-gray-900 dark:text-gray-100">
            <HRLogo size="sm" />
            AI Matching
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
    <Card className="border-0 bg-white/60 dark:bg-slate-800/60 backdrop-blur-xl shadow-lg dark:shadow-2xl dark:border-slate-700">
      <CardHeader className="bg-gradient-to-r from-purple-600 to-purple-700 text-white rounded-t-lg">
        <CardTitle className="text-xl font-semibold flex items-center gap-2">
          <HRLogo size="sm" />
          AI Matching System
          {/* Show GPT status indicator */}
          {matchingCandidates.length > 0 && matchingCandidates[0]?.explanation?.gptEnhanced && (
            <Badge className="bg-purple-400 hover:bg-purple-400 text-purple-900 text-xs">
              🧠 AI-enhanced matching
            </Badge>
          )}
        </CardTitle>
        <CardDescription className="text-purple-100">
          {matchingCandidates.length > 0 && matchingCandidates[0]?.explanation?.gptEnhanced 
            ? "Advanced LLM analysis with contextual insights and interview recommendations"
            : "Find the best candidates using AI-powered semantic matching"
          }
        </CardDescription>
      </CardHeader>
      <CardContent className="p-6 space-y-6">
        {/* Embedding Status */}
        <div className="flex items-center justify-between p-4 rounded-lg bg-gradient-to-r from-gray-50 to-gray-100 dark:from-slate-700 dark:to-slate-600">
          <div className="flex items-center gap-3">
            {embeddingStatus?.isEmbedded ? (
              <CheckCircle className="h-5 w-5 text-green-600" />
            ) : (
              <XCircle className="h-5 w-5 text-red-600" />
            )}
            <div>
              <p className="font-medium text-gray-900 dark:text-gray-100">
                {embeddingStatus?.isEmbedded ? 'AI Embedding Active' : 'AI Embedding Not Created'}
              </p>
              <p className="text-sm text-gray-600 dark:text-gray-300">
                {embeddingStatus?.isEmbedded 
                  ? `Created ${embeddingStatus.embeddingCreatedAt ? new Date(embeddingStatus.embeddingCreatedAt).toLocaleDateString() : 'recently'}`
                  : 'Create an embedding to enable AI matching'
                }
              </p>
            </div>
          </div>
          
          {!embeddingStatus?.isEmbedded && (
            <Button 
              onClick={createEmbedding} 
              disabled={creating}
              className="bg-purple-600 hover:bg-purple-700"
            >
              {creating ? (
                <>
                  <Loader2 className="animate-spin h-4 w-4 mr-2" />
                  Creating...
                </>
              ) : (
                <>
                  <Brain className="h-4 w-4 mr-2" />
                  Create Embedding
                </>
              )}
            </Button>
          )}
          
          {embeddingStatus?.isEmbedded && (
            <div className="flex items-center gap-2">
              {fromCache && cacheAge && (
                <Badge variant="secondary" className="flex items-center gap-1">
                  <Zap className="h-3 w-3" />
                  <span className="hidden sm:inline">Cached</span> {aiMatchCacheService.formatCacheAge(cacheAge)}
                </Badge>
              )}
              <Button 
                onClick={handleInvalidateCache} 
                disabled={loadingMatches || invalidatingCache}
                variant="outline"
                size="sm"
              >
                {invalidatingCache || loadingMatches ? (
                  <>
                    <Loader2 className="animate-spin h-4 w-4 mr-2" />
                    {invalidatingCache ? 'Refreshing...' : 'Loading...'}
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    {fromCache ? 'Refresh AI Matches' : 'Reload Matches'}
                  </>
                )}
              </Button>
            </div>
          )}
        </div>

        {/* Matching Candidates */}
        {embeddingStatus?.isEmbedded && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex items-center gap-2 flex-1">
                <Users className="h-5 w-5 text-purple-600" />
                <h3 className="font-semibold text-lg text-gray-900 dark:text-gray-100">Top Matching Candidates</h3>
                <Badge variant="secondary">{matchingCandidates.length} found</Badge>
                {matchMode === 'vector-ranked' && (
                  <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-200">
                    <Zap className="h-3 w-3 mr-1" />Vector Ranked
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground whitespace-nowrap">Show top:</span>
                <select
                  value={topK}
                  onChange={(e) => {
                    const val = parseInt(e.target.value)
                    setTopK(val)
                    fetchMatchingCandidates(val)
                  }}
                  disabled={loadingMatches || enrichmentStarting || isEnrichmentProcessing}
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs ring-offset-background focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  {TOP_K_OPTIONS.map(n => (
                    <option key={n} value={n}>{n.toLocaleString()} candidates</option>
                  ))}
                </select>
              </div>
            </div>
            {selectedCandidates.size > 0 && (
              <div className="rounded-lg border border-green-200 dark:border-green-800 bg-green-50/80 dark:bg-green-950/20 p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="text-xs text-green-800 dark:text-green-300">
                  {selectedCandidates.size} analysed candidate{selectedCandidates.size !== 1 ? 's' : ''} selected
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs"
                    onClick={handleSelectAllEligible}
                    disabled={bulkAddingToShortlist}
                  >
                    Select All Eligible
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 text-xs"
                    onClick={handleClearSelection}
                    disabled={bulkAddingToShortlist}
                  >
                    Clear
                  </Button>
                  <Button
                    size="sm"
                    className="h-8 text-xs bg-green-600 hover:bg-green-700"
                    onClick={handleBulkAddToShortlist}
                    disabled={bulkAddingToShortlist}
                  >
                    {bulkAddingToShortlist ? (
                      <>
                        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                        Adding...
                      </>
                    ) : (
                      <>Add Selected to Shortlist</>
                    )}
                  </Button>
                </div>
              </div>
            )}
            {matchMode === 'vector-ranked' && matchingCandidates.length > 0 && (
              <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/80 dark:bg-amber-950/30 p-3 space-y-3">
                <div className="text-xs text-amber-700 dark:text-amber-400 flex items-start gap-2">
                  <Brain className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>Large-scale mode is vector-ranked. Enrich selected candidates with GPT for higher-accuracy ranking and full match analysis.</span>
                </div>

                <div className="flex flex-col sm:flex-row sm:items-end gap-3">
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Enrich scope</label>
                    <select
                      value={selectedEnrichCount}
                      onChange={(e) => setEnrichCount(parseInt(e.target.value))}
                      disabled={enrichmentStarting || isEnrichmentProcessing}
                      className="h-8 rounded-md border border-input bg-background px-2 text-xs ring-offset-background focus:outline-none focus:ring-1 focus:ring-ring"
                    >
                      {enrichOptions.map((count) => (
                        <option key={count} value={count}>
                          Top {count.toLocaleString()}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex-1 space-y-1 text-xs text-muted-foreground">
                    {enrichmentLoadingEstimate ? (
                      <span className="inline-flex items-center gap-1">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Calculating credits and time...
                      </span>
                    ) : enrichmentEstimate ? (
                      <>
                        <div>
                          <strong>{enrichmentEstimate.batchCount}</strong> batch{enrichmentEstimate.batchCount !== 1 ? 'es' : ''} (up to{' '}
                          <strong>{enrichmentEstimate.batchSize}</strong> candidates each) ×{' '}
                          <strong>{enrichmentEstimate.costPerBatch}</strong> credit{enrichmentEstimate.costPerBatch !== 1 ? 's' : ''} per batch ={' '}
                          <strong>{enrichmentEstimate.totalCredits}</strong> credits total.
                        </div>
                        <div>
                          ~<strong>{formatDuration(enrichmentEstimate.estimatedSeconds)}</strong> estimated run time.
                          {' '}
                          {Number.isFinite(enrichmentEstimate.availableCredits) && (
                            <span>
                              Balance: <strong>{enrichmentEstimate.availableCredits}</strong>
                              {enrichmentEstimate.remainingCreditsAfter != null && (
                                <> → <strong>{enrichmentEstimate.remainingCreditsAfter}</strong> after this run</>
                              )}
                              .
                            </span>
                          )}
                        </div>
                        {!enrichmentEstimate.hasEnoughCredits && enrichmentEstimate.totalCredits > 0 && (
                          <div className="text-amber-700 dark:text-amber-400 font-medium">
                            Not enough credits for this run. Add credits or choose fewer candidates.
                          </div>
                        )}
                        {enrichmentEstimate.totalCredits === 0 && (
                          <div className="text-emerald-700 dark:text-emerald-400">
                            No per-batch credit charge for AI matching on your current plan.
                          </div>
                        )}
                      </>
                    ) : (
                      <span>Estimate unavailable.</span>
                    )}
                  </div>

                  <Button
                    size="sm"
                    onClick={handleStartEnrichment}
                    disabled={
                      enrichmentStarting ||
                      isEnrichmentProcessing ||
                      enrichOptions.length === 0 ||
                      (!!enrichmentEstimate && !enrichmentEstimate.hasEnoughCredits && enrichmentEstimate.totalCredits > 0)
                    }
                    className="h-8 px-3 text-xs whitespace-nowrap"
                  >
                    {enrichmentStarting || isEnrichmentProcessing ? (
                      <>
                        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                        Enriching...
                      </>
                    ) : (
                      <>
                        <Zap className="h-3 w-3 mr-1" />
                        Enrich & Rank
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}
            
            {loadingMatches ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="animate-spin h-6 w-6 text-primary" />
              </div>
            ) : isEnrichmentProcessing && enrichmentStatus ? (
              <div className="space-y-4 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/70 dark:bg-blue-950/20 p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                    <span className="text-sm font-medium text-blue-800 dark:text-blue-300">Background enrichment in progress</span>
                  </div>
                  <Badge variant="secondary">{enrichmentStatus.progressPercent}%</Badge>
                </div>
                <Progress value={enrichmentStatus.progressPercent} className="h-2" />
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
                  <div className="rounded bg-white dark:bg-slate-800 p-2">
                    <div className="font-semibold">{enrichmentStatus.completedCandidates}/{enrichmentStatus.enrichCount}</div>
                    <div className="text-muted-foreground">Processed</div>
                  </div>
                  <div className="rounded bg-white dark:bg-slate-800 p-2">
                    <div className="font-semibold">{enrichmentStatus.successfulCandidates}</div>
                    <div className="text-muted-foreground">Successful</div>
                  </div>
                  <div className="rounded bg-white dark:bg-slate-800 p-2">
                    <div className="font-semibold">{enrichmentStatus.failedCandidates}</div>
                    <div className="text-muted-foreground">Failed</div>
                  </div>
                  <div className="rounded bg-white dark:bg-slate-800 p-2">
                    <div className="font-semibold">{formatDuration(enrichmentStatus.elapsedSeconds)}</div>
                    <div className="text-muted-foreground">Elapsed</div>
                  </div>
                  <div className="rounded bg-white dark:bg-slate-800 p-2">
                    <div className="font-semibold">{formatDuration(enrichmentStatus.etaSeconds)}</div>
                    <div className="text-muted-foreground">ETA</div>
                  </div>
                </div>
              </div>
            ) : matchingCandidates.length > 0 ? (
              <div className="space-y-3">
                {matchingCandidates.map((match, index) => {
                  const isExpanded = expandedCandidates.has(match.candidateId)
                  const explanation = match.explanation || lazyExplanations[match.candidateId] || null
                  const isLoadingExplanation = loadingExplanations.has(match.candidateId)
                  const isAddingThisCandidate = addingToPipeline.has(match.candidateId)
                  const isAlreadyInPipeline = pipelineCandidateIds.includes(match.candidateId)
                  const isAlreadyInShortlist = shortlistCandidateIds.includes(match.candidateId) || optimisticShortlisted.has(match.candidateId)
                  const canSelect = !isAlreadyInPipeline && !isAlreadyInShortlist
                  const isSelected = selectedCandidates.has(match.candidateId)
                  
                  return (
                    <div
                      key={match.candidateId} 
                      className="rounded-lg border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800 hover:shadow-md transition-shadow cursor-pointer"
                      onClick={(e) => {
                        const target = e.target as HTMLElement | null
                        // Prevent card-level navigation when interacting with nested controls.
                        if (target?.closest('button, a, [role="button"], input, select, textarea, label')) return
                        navigateToCandidate(match.candidateId)
                      }}
                    >
                      {/* Main candidate info */}
                      <div className="p-4">
                        <div className="flex items-start justify-between">
                          <div className="flex items-start gap-3 flex-1">
                            <div
                              className="pt-1"
                              onClick={(e) => {
                                e.preventDefault()
                                e.stopPropagation()
                              }}
                            >
                              <Checkbox
                                checked={isSelected}
                                disabled={!canSelect || bulkAddingToShortlist}
                                onCheckedChange={() => toggleCandidateSelection(match.candidateId)}
                                aria-label={`Select ${match.candidate.name}`}
                              />
                            </div>
                            <Avatar className="h-10 w-10">
                              <AvatarFallback className="bg-purple-100 text-purple-700">
                                {match.candidate.name.split(' ').map(n => n[0]).join('').toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            
                            <div className="flex-1 min-w-0">
                              <div className="flex flex-wrap items-center gap-2 mb-1">
                                <h4 className="font-medium text-gray-900 dark:text-gray-100 truncate hover:text-purple-600 transition-colors">
                                  {match.candidate.name}
                                </h4>
                                <Badge 
                                  variant="outline" 
                                  className="bg-purple-50 text-purple-700 border-purple-200 text-xs"
                                >
                                  <span className="hidden sm:inline">{Math.round((match.relevanceScore ?? match.similarity ?? 0) * 100)}% Relevance</span>
                                  <span className="sm:hidden">{Math.round((match.relevanceScore ?? match.similarity ?? 0) * 100)}%</span>
                                </Badge>
                                {explanation && (
                                  <Badge 
                                    variant="secondary" 
                                    className={`text-xs ${
                                      explanation.matchStrength === 'Excellent Match' ? 'bg-green-100 text-green-800' :
                                      explanation.matchStrength === 'Strong Match' ? 'bg-blue-100 text-blue-800' :
                                      explanation.matchStrength === 'Good Match' ? 'bg-yellow-100 text-yellow-800' :
                                      'bg-gray-100 text-gray-800'
                                    }`}
                                  >
                                    <span className="hidden sm:inline">{explanation.matchStrength}</span>
                                    <span className="sm:hidden">
                                      {explanation.matchStrength === 'Excellent Match' ? 'Excellent' :
                                       explanation.matchStrength === 'Strong Match' ? 'Strong' :
                                       explanation.matchStrength === 'Good Match' ? 'Good' : 'Match'}
                                    </span>
                                  </Badge>
                                )}
                              </div>
                              
                              <p className="text-sm text-gray-600 dark:text-gray-300 mb-2 line-clamp-1">{match.candidate.position}</p>
                              
                              <div className="flex flex-wrap gap-1 mb-2 overflow-hidden">
                                {match.candidate.skills && (
                                  Array.isArray(match.candidate.skills) 
                                    ? match.candidate.skills.slice(0, 2).map((skill, skillIndex) => (
                                        <Badge key={skillIndex} variant="secondary" className="text-xs">
                                          {skill}
                                        </Badge>
                                      ))
                                    : match.candidate.skills.split(',').slice(0, 2).map((skill, skillIndex) => (
                                        <Badge key={skillIndex} variant="secondary" className="text-xs">
                                          {skill.trim()}
                                        </Badge>
                                      ))
                                )}
                                {match.candidate.skills && (
                                  (Array.isArray(match.candidate.skills) && match.candidate.skills.length > 2) ||
                                  (!Array.isArray(match.candidate.skills) && match.candidate.skills.split(',').length > 2)
                                ) && (
                                  <Badge variant="secondary" className="text-xs">
                                    +{Array.isArray(match.candidate.skills) 
                                      ? match.candidate.skills.length - 2 
                                      : match.candidate.skills.split(',').length - 2} more
                                  </Badge>
                                )}
                              </div>
                              
                              <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                                <div className="flex items-center gap-1 min-w-0 max-w-full overflow-hidden">
                                  <MapPin className="h-3 w-3 flex-shrink-0" />
                                  <span className="truncate">{match.candidate.location}</span>
                                </div>
                                <div className="flex items-center gap-1">
                                  <User className="h-3 w-3 flex-shrink-0" />
                                  <span className="whitespace-nowrap">{match.candidate.experience}</span>
                                </div>
                              </div>
                            </div>
                          </div>
                          
                          <div className="ml-4 flex flex-col items-end gap-2">
                            <Progress
                              value={(match.relevanceScore ?? match.similarity ?? 0) * 100}
                              className="w-20 h-2"
                            />
                            
                            <div className="flex flex-col sm:flex-row gap-1">
                              {!isAlreadyInPipeline && !isAlreadyInShortlist ? (
                                <Button
                                  size="sm"
                                  type="button"
                                  onClick={(e) => {
                                    e.preventDefault()
                                    e.stopPropagation()
                                    handleAddToShortlist(match.candidateId, match.candidate.name)
                                  }}
                                  disabled={isAddingThisCandidate}
                                  className="h-8 px-2 text-xs bg-green-600 hover:bg-green-700 text-white whitespace-nowrap"
                                >
                                  {isAddingThisCandidate ? (
                                    <>
                                      <Loader2 className="animate-spin h-3 w-3 mr-1" />
                                      <span className="sm:inline hidden">Adding...</span>
                                      <span className="sm:hidden">Add</span>
                                    </>
                                  ) : (
                                    <>
                                      <UserPlus className="h-3 w-3 mr-1" />
                                      <span className="sm:inline hidden">Add to Shortlist</span>
                                      <span className="sm:hidden">Add</span>
                                    </>
                                  )}
                                </Button>
                              ) : (
                                <Button
                                  size="sm"
                                  disabled
                                  className="h-8 px-2 text-xs bg-gray-400 text-gray-600 cursor-not-allowed"
                                >
                                  <CheckCircle className="h-3 w-3 mr-1" />
                                  <span className="sm:inline hidden">{isAlreadyInShortlist ? "In Shortlist" : "In Pipeline"}</span>
                                  <span className="sm:hidden">Added</span>
                                </Button>
                              )}
                              
                              <div className="flex gap-1">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  type="button"
                                  onClick={(e) => {
                                    e.preventDefault()
                                    e.stopPropagation()
                                    navigateToCandidate(match.candidateId)
                                  }}
                                  className="h-8 px-2 text-xs flex-1"
                                >
                                  <ExternalLink className="h-3 w-3 mr-1" />
                                  <span className="sm:inline hidden">View</span>
                                </Button>
                                
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    type="button"
                                    disabled={isLoadingExplanation}
                                    onClick={(e) => {
                                      e.preventDefault()
                                      e.stopPropagation()
                                      toggleExplanation(match.candidateId)
                                    }}
                                    className="h-8 px-2 text-xs flex-1"
                                  >
                                    {isLoadingExplanation ? (
                                      <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                                    ) : (
                                      <MessageSquare className="h-3 w-3 mr-1 sm:mr-0" />
                                    )}
                                    <span className="sm:inline hidden">
                                      {isLoadingExplanation ? 'Analyzing...' : 'Why?'}
                                      {isExpanded ? (
                                        <ChevronUp className="h-3 w-3 ml-1 inline" />
                                      ) : (
                                        <ChevronDown className="h-3 w-3 ml-1 inline" />
                                      )}
                                    </span>
                                    <span className="sm:hidden">
                                      {isExpanded ? (
                                        <ChevronUp className="h-3 w-3 ml-1" />
                                      ) : (
                                        <ChevronDown className="h-3 w-3 ml-1" />
                                      )}
                                    </span>
                                  </Button>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Loading explanation spinner */}
                      {isExpanded && isLoadingExplanation && (
                        <div className="border-t border-gray-200 dark:border-slate-600 bg-gray-50 dark:bg-slate-700 p-8 flex flex-col items-center gap-3">
                          <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
                          <p className="text-sm text-muted-foreground">Generating AI analysis for this candidate...</p>
                        </div>
                      )}
                      {/* Expanded explanation */}
                      {isExpanded && explanation && !isLoadingExplanation && (
                        <div className="border-t border-gray-200 dark:border-slate-600 bg-gray-50 dark:bg-slate-700 p-4 space-y-4">
                          {/* Enhanced Reasons */}
                          {explanation.reasons && explanation.reasons.length > 0 && (
                            <div>
                              <h5 className="font-medium text-green-800 dark:text-green-300 mb-2 flex items-center gap-2">
                                <ThumbsUp className="h-4 w-4" />
                                Why This Candidate Matches
                              </h5>
                              <div className="grid gap-2">
                                {explanation.reasons.map((reason, idx) => (
                                  <div key={idx} className="flex items-start gap-2 p-2 rounded bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700">
                                    <CheckCircle className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
                                    <span className="text-sm text-green-800 dark:text-green-300">{reason}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Enhanced Skills Breakdown */}
                          <div className="space-y-3">
                            <h5 className="font-medium text-blue-800 dark:text-blue-300 flex items-center gap-2">
                              <Target className="h-4 w-4" />
                              Skills Analysis ({explanation.skillsMatch.matchPercentage}% match)
                            </h5>
                            
                            {explanation.skillsMatch.matchedSkills.length > 0 && (
                              <div>
                                <p className="text-xs text-gray-600 dark:text-gray-300 mb-1">Matched Skills:</p>
                                <div className="flex flex-wrap gap-1">
                                  {explanation.skillsMatch.matchedSkills.map((skill, idx) => (
                                    <Badge key={idx} className="text-xs bg-green-100 text-green-800 border-green-200">
                                      {skill}
                                    </Badge>
                                  ))}
                                </div>
                              </div>
                            )}
                            
                            {explanation.skillsMatch.bonusSkills.length > 0 && (
                              <div>
                                <p className="text-xs text-gray-600 dark:text-gray-300 mb-1">Additional Skills:</p>
                                <div className="flex flex-wrap gap-1">
                                  {explanation.skillsMatch.bonusSkills.map((skill, idx) => (
                                    <Badge key={idx} variant="outline" className="text-xs bg-blue-50 text-blue-700 border-blue-200">
                                      {skill}
                                    </Badge>
                                  ))}
                                </div>
                              </div>
                            )}
                            
                            {explanation.skillsMatch.missingSkills.length > 0 && (
                              <div>
                                <p className="text-xs text-gray-600 dark:text-gray-300 mb-1">Missing Skills:</p>
                                <div className="flex flex-wrap gap-1">
                                  {explanation.skillsMatch.missingSkills.map((skill, idx) => (
                                    <Badge key={idx} variant="destructive" className="text-xs">
                                      {skill}
                                    </Badge>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>

                          {/* Career Insights */}
                          {explanation.careerFit && (
                            <div className="space-y-2">
                              <h5 className="font-medium text-purple-800 dark:text-purple-300 flex items-center gap-2">
                                <User className="h-4 w-4" />
                                Career Profile
                              </h5>
                              <div className="grid grid-cols-2 gap-2 text-xs">
                                <div className="bg-purple-50 dark:bg-purple-900/20 p-2 rounded border border-purple-200 dark:border-purple-700">
                                  <span className="text-purple-600 dark:text-purple-400 font-medium">{explanation.careerFit.totalYearsExp} years</span>
                                  <p className="text-gray-600 dark:text-gray-300 text-[10px] sm:text-xs">Total Experience</p>
                                </div>
                                <div className="bg-purple-50 dark:bg-purple-900/20 p-2 rounded border border-purple-200 dark:border-purple-700">
                                  <span className="text-purple-600 dark:text-purple-400 font-medium">{explanation.careerFit.companiesWorkedAt}</span>
                                  <p className="text-gray-600 dark:text-gray-300 text-[10px] sm:text-xs">Companies</p>
                                </div>
                                <div className="bg-purple-50 dark:bg-purple-900/20 p-2 rounded border border-purple-200 dark:border-purple-700">
                                  <span className="text-purple-600 dark:text-purple-400 font-medium">{explanation.careerFit.avgTenureYears}y avg</span>
                                  <p className="text-gray-600 dark:text-gray-300 text-[10px] sm:text-xs">Tenure</p>
                                </div>
                                <div className="bg-purple-50 dark:bg-purple-900/20 p-2 rounded border border-purple-200 dark:border-purple-700">
                                  <span className="text-purple-600 dark:text-purple-400 font-medium">{explanation.careerFit.stabilityScore}</span>
                                  <p className="text-gray-600 dark:text-gray-300 text-[10px] sm:text-xs">Stability</p>
                                </div>
                              </div>
                              
                              {explanation.careerFit.hasCareerProgression && (
                                <div className="flex items-center gap-2 text-xs text-green-700 dark:text-green-400">
                                  <CheckCircle className="h-3 w-3" />
                                  Documented career progression
                                </div>
                              )}
                              
                              {explanation.careerFit.hasAchievements && (
                                <div className="flex items-center gap-2 text-xs text-green-700 dark:text-green-400">
                                  <CheckCircle className="h-3 w-3" />
                                  Track record of achievements
                                </div>
                              )}
                            </div>
                          )}

                          {/* AI Insights */}
                          {explanation.aiInsights && explanation.aiInsights.hasAIAnalysis && (
                            <div className="space-y-2">
                              <h5 className="font-medium text-indigo-800 dark:text-indigo-300 flex items-center gap-2">
                                <Brain className="h-4 w-4" />
                                AI Analysis
                              </h5>
                              
                              {explanation.aiInsights.strengths.length > 0 && (
                                <div>
                                  <p className="text-xs text-gray-600 dark:text-gray-300 mb-1">AI-Identified Strengths:</p>
                                  <div className="space-y-1">
                                    {explanation.aiInsights.strengths.slice(0, 3).map((strength, idx) => (
                                      <div key={idx} className="flex items-start gap-2 text-xs">
                                        <CheckCircle className="h-3 w-3 text-green-600 mt-0.5 flex-shrink-0" />
                                        <span className="text-gray-700 dark:text-gray-300">{strength}</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}

                          {/* Industry & Leadership */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3">
                            {explanation.industryMatch && explanation.industryMatch.hasRelevantIndustry && (
                              <div className="bg-blue-50 dark:bg-blue-900/20 p-2 sm:p-3 rounded border border-blue-200 dark:border-blue-700">
                                <h6 className="font-medium text-blue-800 dark:text-blue-300 text-xs mb-1">Industry Match</h6>
                                <div className="flex flex-wrap gap-1">
                                  {explanation.industryMatch.matchedIndustries.map((industry, idx) => (
                                    <Badge key={idx} variant="outline" className="text-xs bg-blue-100 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-600">
                                      {industry}
                                    </Badge>
                                  ))}
                                </div>
                              </div>
                            )}
                            
                            {explanation.leadershipMatch && explanation.leadershipMatch.requiresLeadership && (
                              <div className={`p-2 sm:p-3 rounded border ${explanation.leadershipMatch.hasLeadership ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-700' : 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-700'}`}>
                                <h6 className={`font-medium text-xs mb-1 ${explanation.leadershipMatch.hasLeadership ? 'text-green-800 dark:text-green-300' : 'text-amber-800 dark:text-amber-300'}`}>
                                  Leadership
                                </h6>
                                <div className="flex items-center gap-1">
                                  {explanation.leadershipMatch.hasLeadership ? (
                                    <CheckCircle className="h-3 w-3 text-green-600" />
                                  ) : (
                                    <AlertTriangle className="h-3 w-3 text-amber-600" />
                                  )}
                                  <span className={`text-xs ${explanation.leadershipMatch.hasLeadership ? 'text-green-700 dark:text-green-300' : 'text-amber-700 dark:text-amber-300'}`}>
                                    {explanation.leadershipMatch.hasLeadership ? 'Experienced' : 'No experience'}
                                  </span>
                                </div>
                              </div>
                            )}
                          </div>

                          {/* Data Quality Indicator */}
                          {explanation.dataQuality && (
                            <div className="bg-gray-100 dark:bg-slate-600 p-3 rounded border border-gray-200 dark:border-slate-500">
                              <h6 className="font-medium text-gray-800 dark:text-gray-200 text-xs mb-2">Profile Completeness</h6>
                              <div className="flex items-center gap-2">
                                <div className="flex-1 bg-gray-200 dark:bg-slate-700 rounded-full h-2">
                                  <div 
                                    className="h-2 rounded-full bg-gradient-to-r from-blue-500 to-purple-500"
                                    style={{ width: `${explanation.dataQuality.completeness}%` }}
                                  ></div>
                                </div>
                                <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{explanation.dataQuality.completeness}%</span>
                              </div>
                              <div className="flex gap-3 mt-2 text-xs text-gray-600 dark:text-gray-300">
                                {explanation.dataQuality.hasDetailedHistory && (
                                  <span className="flex items-center gap-1">
                                    <CheckCircle className="h-3 w-3 text-green-600" />
                                    Work History
                                  </span>
                                )}
                                {explanation.dataQuality.hasAIAnalysis && (
                                  <span className="flex items-center gap-1">
                                    <CheckCircle className="h-3 w-3 text-green-600" />
                                    AI Analysis
                                  </span>
                                )}
                                {explanation.dataQuality.hasCoverLetter && (
                                  <span className="flex items-center gap-1">
                                    <CheckCircle className="h-3 w-3 text-green-600" />
                                    Cover Letter
                                  </span>
                                )}
                              </div>
                            </div>
                          )}

                          {/* LLM-enhanced insights */}
                          {explanation.gptEnhanced && (
                            <div className="space-y-3 bg-gradient-to-br from-purple-50 to-blue-50 dark:from-purple-900/20 dark:to-blue-900/20 p-4 rounded-lg border border-purple-200 dark:border-purple-700">
                              <h5 className="font-semibold text-purple-800 dark:text-purple-300 flex items-center gap-2 text-sm">
                                <Brain className="h-4 w-4" />
                                🧠 AI-enhanced analysis
                                <Badge variant="outline" className="bg-purple-100 text-purple-700 text-xs">
                                  {explanation.gptEnhanced.confidenceScore}/10 confidence
                                </Badge>
                              </h5>
                              
                              {/* Contextual Explanation */}
                              {explanation.gptEnhanced.contextualExplanation && (
                                <div className="bg-white/80 dark:bg-slate-800/80 p-3 rounded border border-purple-200 dark:border-purple-700">
                                  <h6 className="font-medium text-purple-800 dark:text-purple-300 text-xs mb-2">🎯 Why This Match Makes Sense</h6>
                                  <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
                                    {explanation.gptEnhanced.contextualExplanation}
                                  </p>
                                </div>
                              )}

                              {/* Enhanced Scoring Breakdown */}
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3">
                                <div className="bg-white/80 dark:bg-slate-800/80 p-2 sm:p-3 rounded border border-purple-200 dark:border-purple-700">
                                  <h6 className="font-medium text-purple-800 dark:text-purple-300 text-xs mb-1 sm:mb-2">💪 Skills Match</h6>
                                  <div className="flex items-center gap-2">
                                    <div className="flex-1 bg-purple-200 dark:bg-purple-700 rounded-full h-2">
                                      <div 
                                        className="h-2 rounded-full bg-gradient-to-r from-purple-500 to-blue-500"
                                        style={{ width: `${explanation.gptEnhanced.skillMatchPercentage}%` }}
                                      ></div>
                                    </div>
                                    <span className="text-xs font-bold text-purple-700 dark:text-purple-300 whitespace-nowrap">
                                      {explanation.gptEnhanced.skillMatchPercentage}%
                                    </span>
                                  </div>
                                </div>

                                <div className="bg-white/80 dark:bg-slate-800/80 p-2 sm:p-3 rounded border border-purple-200 dark:border-purple-700">
                                  <h6 className="font-medium text-purple-800 dark:text-purple-300 text-xs mb-1 sm:mb-2">⭐ Experience Fit</h6>
                                  <div className="flex items-center gap-2">
                                    <div className="flex-1 bg-purple-200 dark:bg-purple-700 rounded-full h-2">
                                      <div 
                                        className="h-2 rounded-full bg-gradient-to-r from-purple-500 to-blue-500"
                                        style={{ width: `${explanation.gptEnhanced.experienceFit * 10}%` }}
                                      ></div>
                                    </div>
                                    <span className="text-xs font-bold text-purple-700 dark:text-purple-300 whitespace-nowrap">
                                      {explanation.gptEnhanced.experienceFit}/10
                                    </span>
                                  </div>
                                </div>

                                <div className="bg-white/80 dark:bg-slate-800/80 p-2 sm:p-3 rounded border border-purple-200 dark:border-purple-700">
                                  <h6 className="font-medium text-purple-800 dark:text-purple-300 text-xs mb-1 sm:mb-2">🤝 Cultural Alignment</h6>
                                  <div className="flex items-center gap-2">
                                    <div className="flex-1 bg-purple-200 dark:bg-purple-700 rounded-full h-2">
                                      <div 
                                        className="h-2 rounded-full bg-gradient-to-r from-purple-500 to-blue-500"
                                        style={{ width: `${explanation.gptEnhanced.culturalAlignment * 10}%` }}
                                      ></div>
                                    </div>
                                    <span className="text-xs font-bold text-purple-700 dark:text-purple-300 whitespace-nowrap">
                                      {explanation.gptEnhanced.culturalAlignment}/10
                                    </span>
                                  </div>
                                </div>

                                <div className="bg-white/80 dark:bg-slate-800/80 p-2 sm:p-3 rounded border border-purple-200 dark:border-purple-700">
                                  <h6 className="font-medium text-purple-800 dark:text-purple-300 text-xs mb-1 sm:mb-2">🚀 Growth Potential</h6>
                                  <div className="flex items-center gap-2">
                                    <div className="flex-1 bg-purple-200 dark:bg-purple-700 rounded-full h-2">
                                      <div 
                                        className="h-2 rounded-full bg-gradient-to-r from-purple-500 to-blue-500"
                                        style={{ width: `${explanation.gptEnhanced.growthPotential * 10}%` }}
                                      ></div>
                                    </div>
                                    <span className="text-xs font-bold text-purple-700 dark:text-purple-300 whitespace-nowrap">
                                      {explanation.gptEnhanced.growthPotential}/10
                                    </span>
                                  </div>
                                </div>
                              </div>

                              {/* Interview Focus Questions */}
                              {explanation.gptEnhanced.interviewFocus && explanation.gptEnhanced.interviewFocus.length > 0 && (
                                <div className="bg-white/80 dark:bg-slate-800/80 p-3 rounded border border-purple-200 dark:border-purple-700">
                                  <h6 className="font-medium text-purple-800 dark:text-purple-300 text-xs mb-2 flex items-center gap-1">
                                    💬 AI-Suggested Interview Questions
                                  </h6>
                                  <div className="space-y-2">
                                    {explanation.gptEnhanced.interviewFocus.map((question, idx) => (
                                      <div key={idx} className="flex items-start gap-2 text-xs">
                                        <div className="w-4 h-4 rounded-full bg-purple-500 text-white flex items-center justify-center text-xs font-bold mt-0.5">
                                          {idx + 1}
                                        </div>
                                        <span className="text-gray-700 dark:text-gray-300 leading-relaxed">{question}</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}

                          {/* Enhanced Concerns */}
                          {explanation.concerns && explanation.concerns.length > 0 && (
                            <div>
                              <h5 className="font-medium text-amber-800 dark:text-amber-300 mb-2 flex items-center gap-2">
                                <AlertTriangle className="h-4 w-4" />
                                Areas to Consider
                              </h5>
                              <div className="grid gap-2">
                                {explanation.concerns.map((concern, idx) => (
                                  <div key={idx} className="flex items-start gap-2 p-2 rounded bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700">
                                    <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
                                    <span className="text-sm text-amber-800 dark:text-amber-300">{concern}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                <Users className="h-12 w-12 mx-auto mb-3 text-gray-300 dark:text-gray-600" />
                <p>No matching candidates found</p>
                <p className="text-sm">Try creating more candidate embeddings</p>
              </div>
            )}
          </div>
        )}
      </CardContent>
      
      {/* Credit Error Dialog */}
      <CreditErrorDialog
        open={showCreditDialog}
        onOpenChange={setShowCreditDialog}
        error={creditError}
      />
    </Card>
  )
} 
