'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Progress } from '@/components/ui/progress'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  ArrowLeft,
  Download,
  FileText,
  Search,
  Star,
  MessageSquare,
  User,
  Calendar,
  Filter,
  Loader2,
  FileJson,
  FileSpreadsheet,
  Printer
} from 'lucide-react'
import leaderboardService, { type JobFeedbackData, type FeedbackComment } from '@/services/leaderboardService'
import feedbackExportService from '@/services/feedbackExportService'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

export default function FullFeedbackPage() {
  const params = useParams()
  const router = useRouter()
  const jobId = params.jobId as string

  const [feedbackData, setFeedbackData] = useState<JobFeedbackData | null>(null)
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedStage, setSelectedStage] = useState('all')
  const [sortBy, setSortBy] = useState('date_desc')
  const [downloading, setDownloading] = useState(false)

  useEffect(() => {
    fetchFeedbackData()
  }, [jobId])

  const fetchFeedbackData = async () => {
    try {
      setLoading(true)
      const data = await leaderboardService.getAllJobFeedback(jobId)
      setFeedbackData(data)
    } catch (error) {
      console.error('Error fetching feedback:', error)
      toast.error('Failed to load feedback data')
    } finally {
      setLoading(false)
    }
  }

  const handleDownloadPDF = async () => {
    if (!feedbackData) return
    try {
      setDownloading(true)
      await feedbackExportService.generatePDF(feedbackData)
      toast.success('PDF downloaded successfully')
    } catch (error) {
      console.error('Error generating PDF:', error)
      toast.error('Failed to generate PDF')
    } finally {
      setDownloading(false)
    }
  }

  const handleDownloadCSV = async () => {
    if (!feedbackData) return
    try {
      setDownloading(true)
      await feedbackExportService.exportCSV(feedbackData)
      toast.success('CSV exported successfully')
    } catch (error) {
      console.error('Error exporting CSV:', error)
      toast.error('Failed to export CSV')
    } finally {
      setDownloading(false)
    }
  }

  const handleDownloadJSON = async () => {
    if (!feedbackData) return
    try {
      setDownloading(true)
      await feedbackExportService.exportJSON(feedbackData)
      toast.success('JSON exported successfully')
    } catch (error) {
      console.error('Error exporting JSON:', error)
      toast.error('Failed to export JSON')
    } finally {
      setDownloading(false)
    }
  }

  const handlePrint = () => {
    feedbackExportService.printFeedback()
  }

  // Filter and sort feedback
  const getFilteredFeedback = (): FeedbackComment[] => {
    if (!feedbackData) return []

    let filtered = [...feedbackData.feedback]

    // Filter by stage
    if (selectedStage !== 'all') {
      filtered = filtered.filter(f => {
        const stageId = f.interviewId?.stageId?._id || f.interviewId?.stageId as any
        return stageId === selectedStage
      })
    }

    // Filter by search term
    if (searchTerm) {
      const term = searchTerm.toLowerCase()
      filtered = filtered.filter(f => {
        const candidate = f.interviewId?.candidateId
        const candidateName = candidate ? `${candidate.firstName} ${candidate.lastName}`.toLowerCase() : ''
        const content = f.content.toLowerCase()
        const assessor = f.authorId?.profile?.firstName 
          ? `${f.authorId.profile.firstName} ${f.authorId.profile.lastName || ''}`.toLowerCase()
          : ''
        
        return candidateName.includes(term) || content.includes(term) || assessor.includes(term)
      })
    }

    // Sort
    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'date_desc':
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        case 'date_asc':
          return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        case 'rating_desc':
          return (b.rating?.overall || 0) - (a.rating?.overall || 0)
        case 'rating_asc':
          return (a.rating?.overall || 0) - (b.rating?.overall || 0)
        default:
          return 0
      }
    })

    return filtered
  }

  // Group by stage and candidate
  const groupByStage = (feedback: FeedbackComment[]) => {
    const stages = new Map<string, {
      stageName: string
      stageOrder: number
      candidates: Map<string, {
        candidate: any
        feedback: FeedbackComment[]
      }>
    }>()

    feedback.forEach(f => {
      const stageId = f.interviewId?.stageId?._id || 'unknown'
      const stageName = f.interviewId?.stageId?.name || f.interviewId?.stageName || 'Unknown Stage'
      const stageOrder = f.interviewId?.stageId?.order ?? f.interviewId?.stageOrder ?? 999
      const candidateId = f.interviewId?.candidateId?._id || 'unknown'
      const candidate = f.interviewId?.candidateId

      if (!stages.has(stageId)) {
        stages.set(stageId, {
          stageName,
          stageOrder,
          candidates: new Map()
        })
      }

      const stage = stages.get(stageId)!
      if (!stage.candidates.has(candidateId)) {
        stage.candidates.set(candidateId, {
          candidate,
          feedback: []
        })
      }

      stage.candidates.get(candidateId)!.feedback.push(f)
    })

    // Convert to array and sort
    return Array.from(stages.values())
      .sort((a, b) => a.stageOrder - b.stageOrder)
      .map(stage => ({
        ...stage,
        candidates: Array.from(stage.candidates.values())
      }))
  }

  if (loading) {
    return (
      <div className="min-h-screen p-8 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-blue-600" />
          <p className="text-gray-500">Loading feedback...</p>
        </div>
      </div>
    )
  }

  if (!feedbackData || feedbackData.totalFeedback === 0) {
    return (
      <div className="min-h-screen p-8">
        <div className="max-w-4xl mx-auto">
          <Button variant="ghost" asChild className="mb-6">
            <Link href={`/jobs/${jobId}`}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Job Detail
            </Link>
          </Button>

          <Card>
            <CardContent className="p-12 text-center">
              <MessageSquare className="h-16 w-16 mx-auto mb-4 text-gray-300" />
              <h3 className="text-lg font-semibold text-gray-900 mb-2">No Feedback Yet</h3>
              <p className="text-gray-500">
                No feedback has been submitted for this job position yet.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  const filteredFeedback = getFilteredFeedback()
  const groupedByStage = groupByStage(filteredFeedback)

  return (
    <div className="min-h-screen p-4 sm:p-8 bg-gray-50">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <Button variant="ghost" asChild className="mb-4">
            <Link href={`/jobs/${jobId}`}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Job Detail
            </Link>
          </Button>

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Full Feedback Review</h1>
              <p className="text-gray-600 mt-1">{feedbackData.jobTitle}</p>
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button disabled={downloading}>
                  {downloading ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4 mr-2" />
                  )}
                  Download
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleDownloadPDF}>
                  <FileText className="h-4 w-4 mr-2" />
                  Download PDF
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleDownloadCSV}>
                  <FileSpreadsheet className="h-4 w-4 mr-2" />
                  Export CSV
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleDownloadJSON}>
                  <FileJson className="h-4 w-4 mr-2" />
                  Export JSON
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handlePrint}>
                  <Printer className="h-4 w-4 mr-2" />
                  Print View
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Filters */}
        <Card className="mb-6">
          <CardContent className="p-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Search feedback..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>

              {/* Stage Filter */}
              <Select value={selectedStage} onValueChange={setSelectedStage}>
                <SelectTrigger>
                  <SelectValue placeholder="All Stages" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Stages</SelectItem>
                  {feedbackData.stages.map((stage) => (
                    <SelectItem key={stage._id} value={stage._id}>
                      Round {stage.order}: {stage.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Sort */}
              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger>
                  <SelectValue placeholder="Sort by" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="date_desc">Date (Newest First)</SelectItem>
                  <SelectItem value="date_asc">Date (Oldest First)</SelectItem>
                  <SelectItem value="rating_desc">Rating (Highest)</SelectItem>
                  <SelectItem value="rating_asc">Rating (Lowest)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="mt-3 text-sm text-gray-600">
              Showing {filteredFeedback.length} of {feedbackData.totalFeedback} feedback items
            </div>
          </CardContent>
        </Card>

        {/* Feedback by Stage */}
        {groupedByStage.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center">
              <Search className="h-12 w-12 mx-auto mb-3 text-gray-300" />
              <p className="text-gray-500">No feedback matches your filters</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-8">
            {groupedByStage.map((stage) => (
              <div key={stage.stageName} className="space-y-4">
                {/* Stage Header */}
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
                    <span className="text-sm font-bold text-blue-700">R{stage.stageOrder}</span>
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-gray-900">{stage.stageName}</h2>
                    <p className="text-sm text-gray-600">
                      {stage.candidates.length} candidate{stage.candidates.length !== 1 ? 's' : ''} • 
                      {' '}{stage.candidates.reduce((sum, c) => sum + c.feedback.length, 0)} feedback item{stage.candidates.reduce((sum, c) => sum + c.feedback.length, 0) !== 1 ? 's' : ''}
                    </p>
                  </div>
                </div>

                {/* Candidates */}
                {stage.candidates.map((candidateData) => {
                  const { candidate, feedback } = candidateData
                  if (!candidate) return null

                  // Calculate average rating
                  const ratings = feedback.filter(f => f.rating?.overall).map(f => f.rating!.overall!)
                  const avgRating = ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0

                  return (
                    <Card key={candidate._id} className="overflow-hidden">
                      {/* Candidate Header */}
                      <CardHeader className="bg-gradient-to-r from-[#F1ECFF] to-[#E9E2FB] border-b">
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-3">
                            <Avatar className="h-12 w-12">
                              <AvatarImage src={candidate.avatar} />
                              <AvatarFallback>
                                {candidate.firstName[0]}{candidate.lastName[0]}
                              </AvatarFallback>
                            </Avatar>
                            <div>
                              <Link 
                                href={`/candidates/${candidate._id}`}
                                className="text-lg font-semibold text-gray-900 hover:text-blue-600"
                              >
                                {candidate.firstName} {candidate.lastName}
                              </Link>
                              <p className="text-sm text-gray-600">{candidate.email}</p>
                              {candidate.position && (
                                <p className="text-sm text-gray-500">{candidate.position}</p>
                              )}
                            </div>
                          </div>

                          {avgRating > 0 && (
                            <div className="text-right">
                              <div className="flex items-center gap-1">
                                {[...Array(5)].map((_, i) => (
                                  <Star
                                    key={i}
                                    className={cn(
                                      "h-4 w-4",
                                      i < Math.round(avgRating) 
                                        ? "fill-yellow-400 text-yellow-400" 
                                        : "fill-gray-200 text-gray-200"
                                    )}
                                  />
                                ))}
                              </div>
                              <p className="text-sm text-gray-600 mt-1">{avgRating.toFixed(1)}/5.0</p>
                            </div>
                          )}
                        </div>
                      </CardHeader>

                      <CardContent className="p-6 space-y-6">
                        {/* Feedback Items */}
                        {feedback.map((fb, index) => (
                          <div key={fb._id} className={cn(
                            "pb-6",
                            index !== feedback.length - 1 && "border-b border-gray-200"
                          )}>
                            {/* Assessor & Date */}
                            <div className="flex items-center gap-2 mb-3">
                              <User className="h-4 w-4 text-gray-400" />
                              <span className="text-sm font-medium text-gray-700">
                                {fb.authorId?.profile?.firstName 
                                  ? `${fb.authorId.profile.firstName} ${fb.authorId.profile.lastName || ''}`
                                  : 'Anonymous'}
                              </span>
                              <span className="text-gray-400">•</span>
                              <Calendar className="h-4 w-4 text-gray-400" />
                              <span className="text-sm text-gray-600">
                                {new Date(fb.createdAt).toLocaleString()}
                              </span>
                            </div>

                            {/* Question */}
                            {fb.questionId && (
                              <div className="mb-3 p-3 bg-blue-50 rounded-lg">
                                <p className="text-sm font-medium text-blue-900">
                                  Q: {fb.questionId.question}
                                </p>
                              </div>
                            )}

                            {/* Feedback Content */}
                            <p className="text-gray-800 mb-3">{fb.content}</p>

                            {/* Ratings */}
                            {fb.rating && (
                              <div className="space-y-2">
                                {fb.rating.overall && (
                                  <div>
                                    <div className="flex justify-between text-sm mb-1">
                                      <span className="text-gray-600">Overall</span>
                                      <span className="font-medium">{fb.rating.overall}/5</span>
                                    </div>
                                    <Progress value={(fb.rating.overall / 5) * 100} className="h-2" />
                                  </div>
                                )}
                                {fb.rating.technical && (
                                  <div>
                                    <div className="flex justify-between text-sm mb-1">
                                      <span className="text-gray-600">Technical</span>
                                      <span className="font-medium">{fb.rating.technical}/5</span>
                                    </div>
                                    <Progress value={(fb.rating.technical / 5) * 100} className="h-2" />
                                  </div>
                                )}
                                {fb.rating.communication && (
                                  <div>
                                    <div className="flex justify-between text-sm mb-1">
                                      <span className="text-gray-600">Communication</span>
                                      <span className="font-medium">{fb.rating.communication}/5</span>
                                    </div>
                                    <Progress value={(fb.rating.communication / 5) * 100} className="h-2" />
                                  </div>
                                )}
                                {fb.rating.cultural && (
                                  <div>
                                    <div className="flex justify-between text-sm mb-1">
                                      <span className="text-gray-600">Cultural Fit</span>
                                      <span className="font-medium">{fb.rating.cultural}/5</span>
                                    </div>
                                    <Progress value={(fb.rating.cultural / 5) * 100} className="h-2" />
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

