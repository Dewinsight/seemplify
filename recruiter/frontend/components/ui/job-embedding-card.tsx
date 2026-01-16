"use client"

import { useState, useEffect } from "react"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Progress } from "@/components/ui/progress"
import { Loader2, Users, CheckCircle, XCircle, RefreshCw, User, Mail, Phone, MapPin, ChevronDown, ChevronUp, MessageSquare, AlertTriangle, ThumbsUp, Target, ExternalLink, UserPlus, Brain, Zap, Clock } from "lucide-react"
import { HRLogo } from "@/components/ui/HRLogo"
import { toast } from "@/components/ui/use-toast"
import jobEmbeddingService from "@/services/jobEmbeddingService"
import { addCandidateToShortlist } from "@/services/jobService"
import * as aiMatchCacheService from "@/services/aiMatchCacheService"
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
    // GPT-4.1 Enhanced insights
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

export function JobEmbeddingCard({ jobId, onCandidateAdded, pipelineCandidateIds = [], shortlistCandidateIds = [] }: JobEmbeddingCardProps) {
  const [embeddingStatus, setEmbeddingStatus] = useState<any>(null)
  const [matchingCandidates, setMatchingCandidates] = useState<MatchingCandidate[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [loadingMatches, setLoadingMatches] = useState(false)
  const [expandedCandidates, setExpandedCandidates] = useState<Set<string>>(new Set())
  const [addingToPipeline, setAddingToPipeline] = useState<Set<string>>(new Set())
  const [fromCache, setFromCache] = useState(false)
  const [cacheAge, setCacheAge] = useState<Date | null>(null)
  const [invalidatingCache, setInvalidatingCache] = useState(false)

  // Credit error handling
  const { creditError, showCreditDialog, setShowCreditDialog, handleError: handleCreditError, clearError } = useCreditError()

  const toggleExplanation = (candidateId: string) => {
    const newExpanded = new Set(expandedCandidates)
    if (newExpanded.has(candidateId)) {
      newExpanded.delete(candidateId)
    } else {
      newExpanded.add(candidateId)
    }
    setExpandedCandidates(newExpanded)
  }

  const navigateToCandidate = (candidateId: string) => {
    // Get job ID from current URL path
    const pathParts = window.location.pathname.split('/')
    const jobId = pathParts[2] // Assuming URL structure /jobs/{jobId}/...

    window.location.href = `/candidates/${candidateId}?from=job-ai-matching&jobId=${jobId}`
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

  const fetchMatchingCandidates = async () => {
    try {
      setLoadingMatches(true)
      const response = await jobEmbeddingService.getMatchingCandidates(jobId, 10)
      setMatchingCandidates(response.matches || [])

      // Capture cache metadata
      setFromCache(response.fromCache || false)
      setCacheAge(response.cacheAge || null)

      if (response.fromCache) {
        console.log('[AI Matches] Loaded from cache, age:', response.cacheAgeMinutes, 'minutes')
      }
    } catch (error: any) {
      console.error('Error fetching matching candidates:', error)

      // Check if it's a credit error
      const isCreditError = handleCreditError(error)

      if (!isCreditError) {
        // Show generic error for non-credit errors
        toast({
          title: "Error",
          description: error.message || "Failed to fetch matching candidates",
          variant: "destructive",
        })
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

  useEffect(() => {
    fetchEmbeddingStatus()
  }, [jobId])

  if (loading) {
    return (
      <Card className="glass-card border-0 shadow-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-white">
            <HRLogo size="sm" />
            AI Matching
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="animate-spin h-6 w-6 text-indigo-400" />
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="glass-card border-0 shadow-lg">
      <CardHeader className="bg-gradient-to-r from-purple-100 via-indigo-100 to-blue-100 dark:from-purple-900/60 dark:via-indigo-900/60 dark:to-blue-900/60 text-purple-950 dark:text-white rounded-t-lg border-b border-border/50 dark:border-white/5">
        <CardTitle className="text-xl font-semibold flex items-center gap-2">
          <HRLogo size="sm" />
          AI Matching System
          {/* Show GPT status indicator */}
          {matchingCandidates.length > 0 && matchingCandidates[0]?.explanation?.gptEnhanced && (
            <Badge className="bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-200 border border-purple-200 dark:border-purple-500/30 hover:bg-purple-200 dark:hover:bg-purple-500/30 text-xs shadow-[0_0_10px_rgba(168,85,247,0.1)]">
              🧠 GPT-4.1 Enhanced
            </Badge>
          )}
        </CardTitle>
        <CardDescription className="text-purple-700/80 dark:text-purple-200/80">
          {matchingCandidates.length > 0 && matchingCandidates[0]?.explanation?.gptEnhanced
            ? "Advanced GPT-4.1 analysis with contextual insights and interview recommendations"
            : "Find the best candidates using AI-powered semantic matching"
          }
        </CardDescription>
      </CardHeader>
      <CardContent className="p-6 space-y-6">
        {/* Embedding Status */}
        <div className="flex items-center justify-between p-4 rounded-xl bg-card/50 dark:bg-card/30 border border-border/50 dark:border-white/5 backdrop-blur-sm">
          <div className="flex items-center gap-3">
            {embeddingStatus?.isEmbedded ? (
              <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-500" />
            ) : (
              <XCircle className="h-5 w-5 text-red-600 dark:text-red-500" />
            )}
            <div>
              <p className="font-medium text-foreground shadow-black drop-shadow-sm">
                {embeddingStatus?.isEmbedded ? 'AI Embedding Active' : 'AI Embedding Not Created'}
              </p>
              <p className="text-sm text-muted-foreground">
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
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-purple-400" />
              <h3 className="font-semibold text-lg text-white">Top Matching Candidates</h3>
              <Badge variant="secondary" className="bg-white/10 text-gray-200 border-white/10">{matchingCandidates.length} found</Badge>
            </div>

            {loadingMatches ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="animate-spin h-6 w-6 text-indigo-400" />
              </div>
            ) : matchingCandidates.length > 0 ? (
              <div className="space-y-3">
                {matchingCandidates.map((match, index) => {
                  const isExpanded = expandedCandidates.has(match.candidateId)
                  const explanation = match.explanation
                  const isAddingThisCandidate = addingToPipeline.has(match.candidateId)
                  const isAlreadyInPipeline = pipelineCandidateIds.includes(match.candidateId)
                  const isAlreadyInShortlist = shortlistCandidateIds.includes(match.candidateId)

                  return (
                    <div
                      key={match.candidateId}
                      className="rounded-xl border border-border/50 dark:border-white/5 bg-card/40 dark:bg-card/20 hover:bg-card/70 dark:hover:bg-card/40 hover:border-purple-200 dark:hover:border-white/10 transition-all duration-300 cursor-pointer shadow-sm hover:shadow-lg backdrop-blur-sm group"
                      onClick={() => navigateToCandidate(match.candidateId)}
                    >
                      {/* Main candidate info */}
                      <div className="p-4">
                        <div className="flex items-start justify-between">
                          <div className="flex items-start gap-3 flex-1">
                            <Avatar className="h-10 w-10 border border-white/10 shadow-inner">
                              <AvatarFallback className="bg-gradient-to-br from-indigo-500 to-purple-600 text-white font-semibold">
                                {match.candidate.name.split(' ').map(n => n[0]).join('').toUpperCase()}
                              </AvatarFallback>
                            </Avatar>

                            <div className="flex-1 min-w-0">
                              <div className="flex flex-wrap items-center gap-2 mb-1">
                                <h4 className="font-semibold text-lg text-foreground truncate group-hover:text-purple-600 dark:group-hover:text-purple-300 transition-colors">
                                  {match.candidate.name}
                                </h4>
                                <Badge
                                  variant="outline"
                                  className="bg-purple-100 dark:bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-500/30 text-xs shadow-[0_0_10px_rgba(168,85,247,0.1)]"
                                >
                                  <span className="hidden sm:inline">{Math.round(match.relevanceScore * 100)}% Relevance</span>
                                  <span className="sm:hidden">{Math.round(match.relevanceScore * 100)}%</span>
                                </Badge>
                                {explanation && (
                                  <Badge
                                    variant="secondary"
                                    className={`text-xs border ${explanation.matchStrength === 'Excellent Match' ? 'bg-green-100 dark:bg-green-500/20 border-green-200 dark:border-green-500/30 text-green-700 dark:text-green-200' :
                                      explanation.matchStrength === 'Strong Match' ? 'bg-blue-100 dark:bg-blue-500/20 border-blue-200 dark:border-blue-500/30 text-blue-700 dark:text-blue-200' :
                                        explanation.matchStrength === 'Good Match' ? 'bg-amber-100 dark:bg-amber-500/20 border-amber-200 dark:border-amber-500/30 text-amber-700 dark:text-amber-200' :
                                          'bg-muted/50 dark:bg-gray-500/20 border-border dark:border-gray-500/30 text-muted-foreground dark:text-gray-200'
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

                              <p className="text-sm text-muted-foreground mb-2 line-clamp-1">{match.candidate.position}</p>

                              <div className="flex flex-wrap gap-1 mb-2 overflow-hidden">
                                {match.candidate.skills && (
                                  Array.isArray(match.candidate.skills)
                                    ? match.candidate.skills.slice(0, 2).map((skill, skillIndex) => (
                                      <Badge key={skillIndex} variant="secondary" className="text-xs bg-muted dark:bg-white/5 hover:bg-muted/80 dark:hover:bg-white/10 text-muted-foreground dark:text-gray-300 border-transparent">
                                        {skill}
                                      </Badge>
                                    ))
                                    : match.candidate.skills.split(',').slice(0, 2).map((skill, skillIndex) => (
                                      <Badge key={skillIndex} variant="secondary" className="text-xs bg-muted dark:bg-white/5 hover:bg-muted/80 dark:hover:bg-white/10 text-muted-foreground dark:text-gray-300 border-transparent">
                                        {skill.trim()}
                                      </Badge>
                                    ))
                                )}
                                {match.candidate.skills && (
                                  (Array.isArray(match.candidate.skills) && match.candidate.skills.length > 2) ||
                                  (!Array.isArray(match.candidate.skills) && match.candidate.skills.split(',').length > 2)
                                ) && (
                                    <Badge variant="secondary" className="text-xs bg-muted dark:bg-white/5 hover:bg-muted/80 dark:hover:bg-white/10 text-muted-foreground dark:text-gray-400 border-transparent">
                                      +{Array.isArray(match.candidate.skills)
                                        ? match.candidate.skills.length - 2
                                        : match.candidate.skills.split(',').length - 2} more
                                    </Badge>
                                  )}
                              </div>

                              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
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
                              value={match.relevanceScore * 100}
                              className="w-20 h-2"
                            />

                            <div className="flex flex-col sm:flex-row gap-1">
                              {!isAlreadyInPipeline && !isAlreadyInShortlist ? (
                                <Button
                                  size="sm"
                                  onClick={(e) => {
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
                                  className="h-8 px-2 text-xs bg-gray-400 text-muted-foreground cursor-not-allowed"
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
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    navigateToCandidate(match.candidateId)
                                  }}
                                  className="h-8 px-2 text-xs flex-1"
                                >
                                  <ExternalLink className="h-3 w-3 mr-1" />
                                  <span className="sm:inline hidden">View</span>
                                </Button>

                                {explanation && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      toggleExplanation(match.candidateId)
                                    }}
                                    className="h-8 px-2 text-xs flex-1"
                                  >
                                    <MessageSquare className="h-3 w-3 mr-1 sm:mr-0" />
                                    <span className="sm:inline hidden">
                                      Why?
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
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Expanded explanation */}
                      {isExpanded && explanation && (
                        <div className="border-t border-border/50 dark:border-white/5 bg-muted/30 dark:bg-black/20 p-4 space-y-4">
                          {/* Enhanced Reasons */}
                          {explanation.reasons && explanation.reasons.length > 0 && (
                            <div>
                              <h5 className="font-medium text-green-700 dark:text-green-300 mb-2 flex items-center gap-2">
                                <ThumbsUp className="h-4 w-4" />
                                Why This Candidate Matches
                              </h5>
                              <div className="grid gap-2">
                                {explanation.reasons.map((reason, idx) => (
                                  <div key={idx} className="flex items-start gap-2 p-2 rounded bg-green-100 dark:bg-green-500/10 border border-green-200 dark:border-green-500/20">
                                    <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
                                    <span className="text-sm text-green-800 dark:text-green-200">{reason}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Enhanced Skills Breakdown */}
                          <div className="space-y-3">
                            <h5 className="font-medium text-blue-700 dark:text-blue-300 flex items-center gap-2">
                              <Target className="h-4 w-4" />
                              Skills Analysis ({explanation.skillsMatch.matchPercentage}% match)
                            </h5>

                            {explanation.skillsMatch.matchedSkills.length > 0 && (
                              <div>
                                <p className="text-xs text-muted-foreground mb-1">Matched Skills:</p>
                                <div className="flex flex-wrap gap-1">
                                  {explanation.skillsMatch.matchedSkills.map((skill, idx) => (
                                    <Badge key={idx} className="text-xs bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-300 border-green-200 dark:border-green-500/30">
                                      {skill}
                                    </Badge>
                                  ))}
                                </div>
                              </div>
                            )}

                            {explanation.skillsMatch.bonusSkills.length > 0 && (
                              <div>
                                <p className="text-xs text-muted-foreground mb-1">Additional Skills:</p>
                                <div className="flex flex-wrap gap-1">
                                  {explanation.skillsMatch.bonusSkills.map((skill, idx) => (
                                    <Badge key={idx} variant="outline" className="text-xs bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-500/20">
                                      {skill}
                                    </Badge>
                                  ))}
                                </div>
                              </div>
                            )}

                            {explanation.skillsMatch.missingSkills.length > 0 && (
                              <div>
                                <p className="text-xs text-muted-foreground mb-1">Missing Skills:</p>
                                <div className="flex flex-wrap gap-1">
                                  {explanation.skillsMatch.missingSkills.map((skill, idx) => (
                                    <Badge key={idx} variant="destructive" className="text-xs bg-red-100 dark:bg-red-500/10 text-red-700 dark:text-red-300 border-red-200 dark:border-red-500/20">
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
                              <h5 className="font-medium text-purple-700 dark:text-purple-300 flex items-center gap-2">
                                <User className="h-4 w-4" />
                                Career Profile
                              </h5>
                              <div className="grid grid-cols-2 gap-2 text-xs">
                                <div className="bg-purple-50 dark:bg-purple-500/10 p-2 rounded border border-purple-200 dark:border-purple-500/20">
                                  <span className="text-purple-700 dark:text-purple-300 font-medium">{explanation.careerFit.totalYearsExp} years</span>
                                  <p className="text-muted-foreground dark:text-gray-400 text-[10px] sm:text-xs">Total Experience</p>
                                </div>
                                <div className="bg-purple-50 dark:bg-purple-500/10 p-2 rounded border border-purple-200 dark:border-purple-500/20">
                                  <span className="text-purple-700 dark:text-purple-300 font-medium">{explanation.careerFit.companiesWorkedAt}</span>
                                  <p className="text-muted-foreground dark:text-gray-400 text-[10px] sm:text-xs">Companies</p>
                                </div>
                                <div className="bg-purple-50 dark:bg-purple-500/10 p-2 rounded border border-purple-200 dark:border-purple-500/20">
                                  <span className="text-purple-700 dark:text-purple-300 font-medium">{explanation.careerFit.avgTenureYears}y avg</span>
                                  <p className="text-muted-foreground dark:text-gray-400 text-[10px] sm:text-xs">Tenure</p>
                                </div>
                                <div className="bg-purple-50 dark:bg-purple-500/10 p-2 rounded border border-purple-200 dark:border-purple-500/20">
                                  <span className="text-purple-700 dark:text-purple-300 font-medium">{explanation.careerFit.stabilityScore}</span>
                                  <p className="text-muted-foreground dark:text-gray-400 text-[10px] sm:text-xs">Stability</p>
                                </div>
                              </div>

                              {explanation.careerFit.hasCareerProgression && (
                                <div className="flex items-center gap-2 text-xs text-green-600 dark:text-green-400">
                                  <CheckCircle className="h-3 w-3" />
                                  Documented career progression
                                </div>
                              )}

                              {explanation.careerFit.hasAchievements && (
                                <div className="flex items-center gap-2 text-xs text-green-600 dark:text-green-400">
                                  <CheckCircle className="h-3 w-3" />
                                  Track record of achievements
                                </div>
                              )}
                            </div>
                          )}

                          {/* AI Insights */}
                          {explanation.aiInsights && explanation.aiInsights.hasAIAnalysis && (
                            <div className="space-y-2">
                              <h5 className="font-medium text-indigo-700 dark:text-indigo-300 flex items-center gap-2">
                                <Brain className="h-4 w-4" />
                                AI Analysis
                              </h5>

                              {explanation.aiInsights.strengths.length > 0 && (
                                <div>
                                  <p className="text-xs text-muted-foreground mb-1">AI-Identified Strengths:</p>
                                  <div className="space-y-1">
                                    {explanation.aiInsights.strengths.slice(0, 3).map((strength, idx) => (
                                      <div key={idx} className="flex items-start gap-2 text-xs">
                                        <CheckCircle className="h-3 w-3 text-green-600 dark:text-green-500 mt-0.5 flex-shrink-0" />
                                        <span className="text-foreground dark:text-gray-300">{strength}</span>
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
                              <div className="bg-blue-50 dark:bg-blue-500/10 p-2 sm:p-3 rounded border border-blue-200 dark:border-blue-500/20">
                                <h6 className="font-medium text-blue-700 dark:text-blue-300 text-xs mb-1">Industry Match</h6>
                                <div className="flex flex-wrap gap-1">
                                  {explanation.industryMatch.matchedIndustries.map((industry, idx) => (
                                    <Badge key={idx} variant="outline" className="text-xs bg-blue-100 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-500/20">
                                      {industry}
                                    </Badge>
                                  ))}
                                </div>
                              </div>
                            )}

                            {explanation.leadershipMatch && explanation.leadershipMatch.requiresLeadership && (
                              <div className={`p-2 sm:p-3 rounded border ${explanation.leadershipMatch.hasLeadership ? 'bg-green-100 dark:bg-green-500/10 border-green-200 dark:border-green-500/20' : 'bg-amber-100 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/20'}`}>
                                <h6 className={`font-medium text-xs mb-1 ${explanation.leadershipMatch.hasLeadership ? 'text-green-700 dark:text-green-300' : 'text-amber-700 dark:text-amber-300'}`}>
                                  Leadership
                                </h6>
                                <div className="flex items-center gap-1">
                                  {explanation.leadershipMatch.hasLeadership ? (
                                    <CheckCircle className="h-3 w-3 text-green-600 dark:text-green-500" />
                                  ) : (
                                    <AlertTriangle className="h-3 w-3 text-amber-600 dark:text-amber-500" />
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
                            <div className="bg-card dark:bg-white/5 p-3 rounded border border-border/50 dark:border-white/10">
                              <h6 className="font-medium text-foreground dark:text-gray-200 text-xs mb-2">Profile Completeness</h6>
                              <div className="flex items-center gap-2">
                                <div className="flex-1 bg-muted dark:bg-white/10 rounded-full h-2">
                                  <div
                                    className="h-2 rounded-full bg-gradient-to-r from-blue-500 to-purple-500"
                                    style={{ width: `${explanation.dataQuality.completeness}%` }}
                                  ></div>
                                </div>
                                <span className="text-xs font-medium text-muted-foreground dark:text-gray-300">{explanation.dataQuality.completeness}%</span>
                              </div>
                              <div className="flex gap-3 mt-2 text-xs text-muted-foreground dark:text-gray-400">
                                {explanation.dataQuality.hasDetailedHistory && (
                                  <span className="flex items-center gap-1">
                                    <CheckCircle className="h-3 w-3 text-green-600 dark:text-green-500" />
                                    Work History
                                  </span>
                                )}
                                {explanation.dataQuality.hasAIAnalysis && (
                                  <span className="flex items-center gap-1">
                                    <CheckCircle className="h-3 w-3 text-green-600 dark:text-green-500" />
                                    AI Analysis
                                  </span>
                                )}
                                {explanation.dataQuality.hasCoverLetter && (
                                  <span className="flex items-center gap-1">
                                    <CheckCircle className="h-3 w-3 text-green-600 dark:text-green-500" />
                                    Cover Letter
                                  </span>
                                )}
                              </div>
                            </div>
                          )}

                          {/* GPT-4.1 Enhanced Insights */}
                          {explanation.gptEnhanced && (
                            <div className="space-y-3 bg-gradient-to-br from-purple-50 to-blue-50 dark:from-purple-500/10 dark:to-blue-500/10 p-4 rounded-lg border border-purple-200 dark:border-purple-500/20">
                              <h5 className="font-semibold text-purple-700 dark:text-purple-300 flex items-center gap-2 text-sm">
                                <Brain className="h-4 w-4" />
                                🧠 GPT-4.1 Enhanced Analysis
                                <Badge variant="outline" className="bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-500/30 text-xs shadow-[0_0_10px_rgba(168,85,247,0.1)]">
                                  {explanation.gptEnhanced.confidenceScore}/10 confidence
                                </Badge>
                              </h5>

                              {/* Contextual Explanation */}
                              {explanation.gptEnhanced.contextualExplanation && (
                                <div className="bg-white dark:bg-black/20 p-3 rounded border border-purple-200 dark:border-purple-500/20 shadow-sm">
                                  <h6 className="font-medium text-purple-700 dark:text-purple-300 text-xs mb-2">🎯 Why This Match Makes Sense</h6>
                                  <p className="text-sm text-foreground dark:text-gray-300 leading-relaxed">
                                    {explanation.gptEnhanced.contextualExplanation}
                                  </p>
                                </div>
                              )}

                              {/* Enhanced Scoring Breakdown */}
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3">
                                <div className="bg-white dark:bg-black/20 p-2 sm:p-3 rounded border border-purple-200 dark:border-purple-500/20 shadow-sm">
                                  <h6 className="font-medium text-purple-700 dark:text-purple-300 text-xs mb-1 sm:mb-2">💪 Skills Match</h6>
                                  <div className="flex items-center gap-2">
                                    <div className="flex-1 bg-purple-100 dark:bg-purple-500/20 rounded-full h-2">
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

                                <div className="bg-white dark:bg-black/20 p-2 sm:p-3 rounded border border-purple-200 dark:border-purple-500/20 shadow-sm">
                                  <h6 className="font-medium text-purple-700 dark:text-purple-300 text-xs mb-1 sm:mb-2">⭐ Experience Fit</h6>
                                  <div className="flex items-center gap-2">
                                    <div className="flex-1 bg-purple-100 dark:bg-purple-500/20 rounded-full h-2">
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

                                <div className="bg-white dark:bg-black/20 p-2 sm:p-3 rounded border border-purple-200 dark:border-purple-500/20 shadow-sm">
                                  <h6 className="font-medium text-purple-700 dark:text-purple-300 text-xs mb-1 sm:mb-2">🤝 Cultural Alignment</h6>
                                  <div className="flex items-center gap-2">
                                    <div className="flex-1 bg-purple-100 dark:bg-purple-500/20 rounded-full h-2">
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

                                <div className="bg-white dark:bg-black/20 p-2 sm:p-3 rounded border border-purple-200 dark:border-purple-500/20 shadow-sm">
                                  <h6 className="font-medium text-purple-700 dark:text-purple-300 text-xs mb-1 sm:mb-2">🚀 Growth Potential</h6>
                                  <div className="flex items-center gap-2">
                                    <div className="flex-1 bg-purple-100 dark:bg-purple-500/20 rounded-full h-2">
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
                                <div className="bg-white dark:bg-black/20 p-3 rounded border border-purple-200 dark:border-purple-500/20 shadow-sm">
                                  <h6 className="font-medium text-purple-700 dark:text-purple-300 text-xs mb-2 flex items-center gap-1">
                                    💬 AI-Suggested Interview Questions
                                  </h6>
                                  <div className="space-y-2">
                                    {explanation.gptEnhanced.interviewFocus.map((question, idx) => (
                                      <div key={idx} className="flex items-start gap-2 text-xs">
                                        <div className="w-4 h-4 rounded-full bg-purple-500 text-white flex items-center justify-center text-xs font-bold mt-0.5 shadow-lg shadow-purple-900/50">
                                          {idx + 1}
                                        </div>
                                        <span className="text-foreground dark:text-gray-300 leading-relaxed">{question}</span>
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
                              <h5 className="font-medium text-amber-700 dark:text-amber-300 mb-2 flex items-center gap-2">
                                <AlertTriangle className="h-4 w-4" />
                                Areas to Consider
                              </h5>
                              <div className="grid gap-2">
                                {explanation.concerns.map((concern, idx) => (
                                  <div key={idx} className="flex items-start gap-2 p-2 rounded bg-amber-100 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20">
                                    <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-500 mt-0.5 flex-shrink-0" />
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
              <div className="text-center py-8 text-muted-foreground dark:text-gray-400">
                <Users className="h-12 w-12 mx-auto mb-3 text-gray-300 dark:text-muted-foreground" />
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