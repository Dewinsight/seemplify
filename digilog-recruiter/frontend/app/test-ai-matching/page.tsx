"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Input } from "@/components/ui/input"
import { useToast } from "@/hooks/use-toast"
import { Bot, Users, Briefcase, Sparkles, TrendingUp, UserPlus, ArrowRight, Check, Zap, RefreshCw, AlertTriangle, ListPlus } from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import assistantService from "@/services/assistantService"
import pipelineService from "@/services/pipelineService"
import interviewStageService from "@/services/interviewStageService"
import creditsService from "@/services/creditsService"
import { useCreditError } from "@/hooks/useCreditError"
import { CreditErrorDialog } from "@/components/ui/credit-error-dialog"
import { AddToCandidateListDialog } from "@/components/candidate-lists/AddToCandidateListDialog"

export default function TestAIMatchingPage() {
  const { toast } = useToast()
  const { creditError, showCreditDialog, setShowCreditDialog, handleError } = useCreditError()
  const [jobs, setJobs] = useState<any[]>([])
  const [selectedJob, setSelectedJob] = useState<any>(null)
  const [matchingResults, setMatchingResults] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [loadingJobs, setLoadingJobs] = useState(false)
  
  // Pipeline addition states
  const [pipelineStages, setPipelineStages] = useState<any[]>([])
  const [selectedStageId, setSelectedStageId] = useState<string>('')
  const [addingToPipeline, setAddingToPipeline] = useState<Set<string>>(new Set())
  const [candidatesInPipeline, setCandidatesInPipeline] = useState<Set<string>>(new Set())
  const [bulkSelecting, setBulkSelecting] = useState(false)
  const [selectedForBulkAdd, setSelectedForBulkAdd] = useState<Set<string>>(new Set())
  const [showRefreshDialog, setShowRefreshDialog] = useState(false)
  const [aiMatchingCost, setAiMatchingCost] = useState<number>(11) // Fallback until API returns plan costs
  const [matchLimit, setMatchLimit] = useState(25)
  const [listTopN, setListTopN] = useState(25)
  const [showListDialog, setShowListDialog] = useState(false)
  const [listEntries, setListEntries] = useState<any[]>([])

  const getCandidateId = (candidate: any) => candidate?.candidateId || candidate?.id || candidate?._id

  // Fetch credit costs on mount
  useEffect(() => {
    const fetchCreditCosts = async () => {
      try {
        const creditStatus = await creditsService.getCreditStatus()
        if (creditStatus.success && creditStatus.credits.creditCosts) {
          setAiMatchingCost(creditStatus.credits.creditCosts.aiMatching || 11)
        }
      } catch (error) {
        console.error('Failed to fetch credit costs:', error)
        // Keep default value
      }
    }
    fetchCreditCosts()
  }, [])

  // Load available jobs
  const loadJobs = async () => {
    setLoadingJobs(true)
    try {
      const jobsData = await assistantService.getJobs()
      const openJobs = jobsData.filter((job: any) => job.status === 'Open')
      setJobs(openJobs)
      
      if (openJobs.length === 0) {
        toast({
          title: "No Open Jobs",
          description: "Please create some open job positions first",
          variant: "default"
        })
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to load jobs",
        variant: "destructive"
      })
    } finally {
      setLoadingJobs(false)
    }
  }

  // Run AI matching for a job
  const runAIMatching = async (job: any, forceRefresh: boolean = false) => {
    setLoading(true)
    setSelectedJob(job)
    setMatchingResults(null)
    setBulkSelecting(false)
    setSelectedForBulkAdd(new Set())

    try {
      // Load pipeline stages for this job
      const stages = await interviewStageService.getStagesForJob(job._id)
      setPipelineStages(stages)
      if (stages.length > 0) {
        setSelectedStageId(stages[0]._id)
      }

      // Get matching results
      const results = await assistantService.getMatchingReport(job._id, forceRefresh, matchLimit)
      setMatchingResults(results)
      setListTopN(Math.min(matchLimit, results.topCandidates?.length || matchLimit))
      
      // Check which candidates are already in pipeline
      const pipelineData = await pipelineService.getDetailedPipeline(job._id)
      const inPipeline = new Set<string>(
        (pipelineData.pipeline?.stages || [])
          .flatMap((stage: any) => stage.candidates || [])
          .map((applicant: any) => String(applicant.candidate?._id || applicant.candidate || ""))
          .filter(Boolean)
      )
      setCandidatesInPipeline(inPipeline)
      
      const cacheMessage = results.fromCache 
        ? ` (from cache, ${results.cacheAgeMinutes || 0} minutes old)` 
        : forceRefresh 
          ? ' (fresh insights generated)' 
          : ''
      
      toast({
        title: "AI Matching Complete",
        description: `Found ${results.totalMatches} candidates using AI embeddings${cacheMessage}`,
      })
    } catch (error: any) {
      const isCreditError = handleError(error)
      if (!isCreditError) {
        toast({
          title: "Matching Error",
          description: error.message || "Failed to run AI matching",
          variant: "destructive"
        })
      }
    } finally {
      setLoading(false)
    }
  }

  // Handle refresh with warning
  const handleRefreshClick = () => {
    setShowRefreshDialog(true)
  }

  const handleConfirmRefresh = () => {
    setShowRefreshDialog(false)
    if (selectedJob) {
      runAIMatching(selectedJob, true)
    }
  }

  // Add single candidate to pipeline
  const handleAddToPipeline = async (candidateId: string, candidateName: string, matchScore: number) => {
    if (!selectedStageId) {
      toast({
        title: "Select a Stage",
        description: "Please select a pipeline stage first",
        variant: "destructive"
      })
      return
    }

    try {
      setAddingToPipeline(prev => new Set([...prev, candidateId]))

      await pipelineService.addCandidateToPipeline(selectedJob._id, {
        candidateId,
        initialStatus: 'applied',
        notes: `Added from AI matching - ${matchScore}% match`,
        score: matchScore,
        tags: ['ai_matched']
      })

      // Move to selected stage
      await pipelineService.advanceCandidateToStage(selectedJob._id, candidateId, selectedStageId, 'Initial stage assignment from AI matching')

      setCandidatesInPipeline(prev => new Set([...prev, candidateId]))
      
      toast({
        title: "Candidate Added",
        description: `${candidateName} added to pipeline`,
      })
    } catch (error: any) {
      toast({
        title: "Failed to Add",
        description: error.message || "Failed to add candidate to pipeline",
        variant: "destructive"
      })
    } finally {
      setAddingToPipeline(prev => {
        const next = new Set(prev)
        next.delete(candidateId)
        return next
      })
    }
  }

  // Handle bulk add to pipeline
  const handleBulkAddToPipeline = async () => {
    if (!selectedStageId) {
      toast({
        title: "Select a Stage",
        description: "Please select a pipeline stage first",
        variant: "destructive"
      })
      return
    }

    if (selectedForBulkAdd.size === 0) {
      toast({
        title: "No Candidates Selected",
        description: "Please select candidates to add",
        variant: "destructive"
      })
      return
    }

    const candidatesToAdd = Array.from(selectedForBulkAdd)
    let successCount = 0

    for (const candidateId of candidatesToAdd) {
      const candidate = matchingResults.topCandidates.find((c: any) => getCandidateId(c) === candidateId)
      if (candidate) {
        try {
          await handleAddToPipeline(candidateId, candidate.name, candidate.similarityPercentage)
          successCount++
        } catch (error) {
          console.error(`Failed to add ${candidate.name}:`, error)
        }
      }
    }

    if (successCount > 0) {
      toast({
        title: "Bulk Add Complete",
        description: `Added ${successCount} candidates to pipeline`,
      })
      setSelectedForBulkAdd(new Set())
      setBulkSelecting(false)
    }
  }

  const openListFromMatches = (mode: "top" | "selected") => {
    const selectedIds = selectedForBulkAdd
    const rankedCandidates = mode === "selected"
      ? (matchingResults?.topCandidates || []).filter((candidate: any) => selectedIds.has(getCandidateId(candidate)))
      : (matchingResults?.topCandidates || []).slice(0, Math.max(1, listTopN))

    const entries = rankedCandidates
      .map((candidate: any, index: number) => ({
        candidateId: getCandidateId(candidate),
        rank: candidate.rank || index + 1,
        score: candidate.similarityPercentage ?? candidate.relevanceScore ?? candidate.similarity,
        source: "ai_matching",
        notes: selectedJob?.title ? `${candidate.similarityPercentage || candidate.relevanceScore || 0}% match for ${selectedJob.title}` : undefined,
      }))
      .filter((entry: any) => entry.candidateId)

    if (!entries.length) {
      toast({
        title: "No candidates available",
        description: mode === "selected" ? "Select candidates first." : "Run matching with a larger result limit.",
        variant: "destructive",
      })
      return
    }

    setListEntries(entries)
    setShowListDialog(true)
  }

  return (
    <div className="container mx-auto py-8 max-w-7xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2 bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
          AI Matching Test with Embeddings
        </h1>
        <p className="text-gray-600">
          Test the AI-powered candidate matching using Azure OpenAI embeddings and Weaviate vector search
        </p>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700" htmlFor="match-limit">
              Candidates to rank
            </label>
            <Input
              id="match-limit"
              type="number"
              min={1}
              max={5000}
              value={matchLimit}
              onChange={(event) => setMatchLimit(Math.min(Math.max(Number(event.target.value) || 1, 1), 5000))}
              className="w-32"
            />
          </div>
          <p className="text-sm text-gray-500 pb-2">Max 5,000</p>
        </div>
      </div>

      {/* Load Jobs Button */}
      {jobs.length === 0 && (
        <Card className="mb-8">
          <CardContent className="pt-6">
            <div className="text-center">
              <Briefcase className="h-12 w-12 mx-auto mb-4 text-gray-400" />
              <h3 className="text-lg font-semibold mb-2">Load Available Jobs</h3>
              <p className="text-gray-600 mb-4">Click below to load open job positions for AI matching</p>
              <Button onClick={loadJobs} disabled={loadingJobs}>
                {loadingJobs ? "Loading..." : "Load Open Jobs"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Jobs Grid */}
      {jobs.length > 0 && (
        <div className="mb-8">
          <h2 className="text-xl font-semibold mb-4">Select a Job for AI Matching</h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {jobs.map((job) => (
              <Card 
                key={job._id} 
                className={`cursor-pointer transition-all ${
                  selectedJob?._id === job._id ? 'ring-2 ring-blue-500' : 'hover:shadow-lg'
                }`}
                onClick={() => !loading && runAIMatching(job)}
              >
                <CardHeader>
                  <CardTitle className="text-lg">{job.title}</CardTitle>
                  <CardDescription>{job.department}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-600">Location:</span>
                      <span className="text-sm font-medium">{job.location || 'Remote'}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-600">Type:</span>
                      <Badge variant="outline">{job.jobType || 'Full-time'}</Badge>
                    </div>
                    {job.isEmbedded && (
                      <Badge className="w-full justify-center" variant="secondary">
                        <Bot className="h-3 w-3 mr-1" />
                        AI Embeddings Ready
                      </Badge>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <Card className="mb-8">
          <CardContent className="pt-6">
            <div className="text-center">
              <div className="animate-pulse">
                <Bot className="h-16 w-16 mx-auto mb-4 text-blue-500" />
              </div>
              <h3 className="text-lg font-semibold mb-2">Running AI Matching</h3>
              <p className="text-gray-600">
                Analyzing candidates using Azure OpenAI embeddings...
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Matching Results */}
      {matchingResults && (
        <div className="space-y-6">
          {/* Summary Card */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Sparkles className="h-5 w-5 text-purple-500" />
                    AI Matching Results for {selectedJob?.title}
                  </CardTitle>
                  <CardDescription>
                    Using AI embeddings to find the best candidates
                    {matchingResults.fromCache && matchingResults.cacheAgeMinutes !== undefined && (
                      <span className="ml-2 text-xs text-gray-500">
                        (Cached {matchingResults.cacheAgeMinutes} minutes ago - No credits charged)
                      </span>
                    )}
                  </CardDescription>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRefreshClick}
                  disabled={loading}
                  className="flex items-center gap-2"
                >
                  <RefreshCw className="h-4 w-4" />
                  Refresh Insights
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-3">
                <div className="text-center">
                  <p className="text-3xl font-bold text-blue-600">{matchingResults.totalMatches}</p>
                  <p className="text-sm text-gray-600">Total Matches</p>
                </div>
                <div className="text-center">
                  <p className="text-3xl font-bold text-green-600">
                    {matchingResults.topCandidates.filter((c: any) => c.similarityPercentage >= 80).length}
                  </p>
                  <p className="text-sm text-gray-600">High Quality (80%+)</p>
                </div>
                <div className="text-center">
                  <Badge variant="secondary" className="mt-2">
                    {matchingResults.usingAIMatching ? 'AI Embeddings' : 'Basic Matching'}
                  </Badge>
                  <p className="text-sm text-gray-600 mt-1">Matching Method</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Top Candidates */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5 text-blue-500" />
                  Top Matching Candidates
                </CardTitle>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Input
                    type="number"
                    min={1}
                    max={matchingResults.topCandidates.length || 1}
                    value={listTopN}
                    onChange={(event) => setListTopN(Math.min(Math.max(Number(event.target.value) || 1, 1), matchingResults.topCandidates.length || 1))}
                    className="h-9 w-24"
                    aria-label="Top candidates to save"
                  />
                  <Button size="sm" variant="outline" onClick={() => openListFromMatches("top")}>
                    <ListPlus className="h-4 w-4 mr-2" />
                    List top
                  </Button>
                  {bulkSelecting && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => openListFromMatches("selected")}
                      disabled={selectedForBulkAdd.size === 0}
                    >
                      <ListPlus className="h-4 w-4 mr-2" />
                      List selected
                    </Button>
                  )}
                
                {/* Pipeline Controls */}
                {pipelineStages.length > 0 && (
                  <div className="flex items-center gap-3">
                    <Select value={selectedStageId} onValueChange={setSelectedStageId}>
                      <SelectTrigger className="w-[200px]">
                        <SelectValue placeholder="Select Pipeline Stage" />
                      </SelectTrigger>
                      <SelectContent>
                        {pipelineStages.map((stage: any) => (
                          <SelectItem key={stage._id} value={stage._id}>
                            {stage.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    
                    {bulkSelecting ? (
                      <>
                        <Button
                          size="sm"
                          variant="default"
                          onClick={handleBulkAddToPipeline}
                          disabled={selectedForBulkAdd.size === 0}
                        >
                          <UserPlus className="h-4 w-4 mr-1" />
                          Add {selectedForBulkAdd.size} Selected
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setBulkSelecting(false)
                            setSelectedForBulkAdd(new Set())
                          }}
                        >
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setBulkSelecting(true)}
                      >
                        Bulk Select
                      </Button>
                    )}
                  </div>
                )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {matchingResults.topCandidates.slice(0, 10).map((candidate: any, index: number) => {
                  const candidateId = getCandidateId(candidate)
                  const isInPipeline = candidatesInPipeline.has(candidateId)
                  const isAddingThis = addingToPipeline.has(candidateId)
                  const isSelectedForBulk = selectedForBulkAdd.has(candidateId)
                  
                  return (
                    <div 
                      key={candidateId || candidate.id}
                      className={`border rounded-lg p-4 transition-all ${
                        isSelectedForBulk ? 'border-blue-500 bg-blue-50' : 'hover:bg-gray-50'
                      } ${isInPipeline ? 'opacity-60' : ''}`}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-start gap-3 flex-1">
                          {bulkSelecting && !isInPipeline && (
                            <input
                              type="checkbox"
                              checked={isSelectedForBulk}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedForBulkAdd(prev => new Set([...prev, candidateId]))
                                } else {
                                  setSelectedForBulkAdd(prev => {
                                    const next = new Set(prev)
                                    next.delete(candidateId)
                                    return next
                                  })
                                }
                              }}
                              className="mt-1"
                            />
                          )}
                          <div className="flex-1">
                            <h4 className="font-semibold text-lg">
                              #{index + 1} {candidate.name}
                              {isInPipeline && (
                                <Badge variant="secondary" className="ml-2">
                                  <Check className="h-3 w-3 mr-1" />
                                  In Pipeline
                                </Badge>
                              )}
                            </h4>
                            <p className="text-sm text-gray-600">{candidate.position}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <Badge className="mb-1" variant={
                            candidate.similarityPercentage >= 90 ? "default" :
                            candidate.similarityPercentage >= 80 ? "secondary" :
                            candidate.similarityPercentage >= 70 ? "outline" : "outline"
                          }>
                            {candidate.similarityPercentage}% Match
                          </Badge>
                          <p className="text-xs text-gray-500">Similarity Score</p>
                        </div>
                      </div>
                      
                      {/* Similarity Progress Bar */}
                      <Progress value={candidate.similarityPercentage} className="h-2 mb-3" />
                      
                      {/* Details */}
                      <div className="grid gap-2 md:grid-cols-2 text-sm">
                        <div>
                          <span className="font-medium">Experience:</span> {candidate.experience}
                        </div>
                        <div>
                          <span className="font-medium">Status:</span>{' '}
                          <Badge variant="outline" className="text-xs">
                            {candidate.status}
                          </Badge>
                        </div>
                      </div>
                      
                      {/* Skills */}
                      <div className="mt-2">
                        <span className="text-sm font-medium">Skills:</span>
                        <p className="text-sm text-gray-600 mt-1">{candidate.skills}</p>
                      </div>
                      
                      {/* AI Explanation */}
                      {candidate.explanation && (
                        <div className="mt-3 p-3 bg-blue-50 rounded-md">
                          <p className="text-sm font-medium text-blue-900 mb-1">
                            <Bot className="h-3 w-3 inline mr-1" />
                            AI Matching Explanation:
                          </p>
                          <p className="text-sm text-blue-800">{candidate.explanation}</p>
                        </div>
                      )}
                      
                      {/* AI Analysis Summary */}
                      {candidate.aiAnalysis?.summary && (
                        <div className="mt-2 text-sm text-gray-600">
                          <span className="font-medium">AI Summary:</span> {candidate.aiAnalysis.summary}
                        </div>
                      )}
                      
                      {/* Add to Pipeline Button */}
                      {!isInPipeline && !bulkSelecting && pipelineStages.length > 0 && (
                        <div className="mt-4 flex justify-end">
                          <Button
                            size="sm"
                            onClick={() => handleAddToPipeline(
                              candidateId,
                              candidate.name,
                              candidate.similarityPercentage
                            )}
                            disabled={isAddingThis || !selectedStageId}
                            className="bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 text-white"
                          >
                            {isAddingThis ? (
                              <>
                                <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white mr-2" />
                                Adding...
                              </>
                            ) : (
                              <>
                                <UserPlus className="h-4 w-4 mr-2" />
                                Add to Pipeline
                                <ArrowRight className="h-4 w-4 ml-1" />
                              </>
                            )}
                          </Button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>

          {/* AI Insights */}
          {matchingResults.insights && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-green-500" />
                  AI Insights & Recommendations
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="prose max-w-none">
                  <div className="whitespace-pre-wrap text-sm text-gray-700">
                    {matchingResults.insights}
                  </div>
                </div>
                
                {matchingResults.recommendations && (
                  <div className="mt-4 pt-4 border-t">
                    <h4 className="font-medium mb-2">Quick Recommendations:</h4>
                    <ul className="space-y-1">
                      {matchingResults.recommendations.map((rec: string, index: number) => (
                        <li key={index} className="text-sm text-gray-600 flex items-start">
                          <span className="text-blue-500 mr-2">•</span>
                          {rec}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Refresh Warning Dialog */}
      <AlertDialog open={showRefreshDialog} onOpenChange={setShowRefreshDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-yellow-500" />
              Refresh AI Insights?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will generate fresh AI insights and deduct <strong>{aiMatchingCost} credits</strong> from your account.
              <br /><br />
              Current results are cached and free to view. Are you sure you want to refresh?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmRefresh}
              className="bg-yellow-500 hover:bg-yellow-600"
            >
              Refresh (Deduct Credits)
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AddToCandidateListDialog
        open={showListDialog}
        onOpenChange={setShowListDialog}
        entries={listEntries}
        source="ai_matching"
        sourceRef={{ jobId: selectedJob?._id, jobTitle: selectedJob?.title }}
        defaultName={`${selectedJob?.title || "AI matching"} - top ${listEntries.length || listTopN}`}
        defaultDescription={selectedJob?.title ? `AI matching results for ${selectedJob.title}` : "AI matching results"}
        countLabel={`${listEntries.length} ranked candidate${listEntries.length === 1 ? "" : "s"} will be saved.`}
        onCompleted={() => {
          setListEntries([])
          setSelectedForBulkAdd(new Set())
        }}
      />

      {/* Credit Error Dialog */}
      <CreditErrorDialog 
        open={showCreditDialog} 
        onOpenChange={setShowCreditDialog} 
        error={creditError} 
      />
    </div>
  )
}
