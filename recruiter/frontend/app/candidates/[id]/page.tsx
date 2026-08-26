"use client"

import { useState, useEffect, useCallback } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import {
  ArrowLeft,
  Calendar,
  Download,
  Edit,
  FileText,
  Mail,
  Phone,
  Share2,
  Star,
  StarHalf,
  User,
  CheckCircle,
  XCircle,
  HelpCircle,
  Play,
  Pause,
  Volume2,
  FileSpreadsheet,
  Lock,
  Trash,
  Sparkles,
  BarChart3,
  Brain,
  Users,
  ExternalLink,
  MapPin,
  Plus,
  Building,
  GraduationCap,
  Briefcase,
  Clock,
  AlertCircle,
  Loader2,
  Video,
  Award,
  Globe,
  Trophy,
  Code,
  BookOpen,
  Heart,
  Link as LinkIcon,
  Github,
  Linkedin,
} from "lucide-react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import useMobile from "@/hooks/use-mobile"
import { OwnerChip } from "@/components/owner-chip"
import { SourceChip } from "@/components/source-chip"
import { Checkbox } from "@/components/ui/checkbox"
import { CardFooter } from "@/components/ui/card"
import { getCandidateById, getAccessibleResumeUrl, type CandidateData } from "@/services/candidateService"
import { getOnboardingRecords, type CandidateOnboarding } from "@/services/onboardingService"
import { embeddingService } from "@/services/embeddingService"
import interviewService, { Interview } from "@/services/interviewService"
import { toast } from "sonner"
import { CandidateEmbeddingCard } from "@/components/ui/candidate-embedding-card"
import { useFeatureFlags } from "@/context/FeatureFlagsContext"
// Removed: import { InterviewComments } from "@/components/ui/interview-comments"
// Tour functionality removed

// Add type for accessible URLs
interface AccessibleResumeUrls {
  accessibleUrl: string
  downloadUrl: string
  previewUrl: string
  originalUrl: string
}

// Render star rating
function StarRating({ rating }: { rating: number }) {
  const fullStars = Math.floor(rating)
  const hasHalfStar = rating % 1 !== 0

  return (
    <div className="flex items-center">
      {Array.from({ length: fullStars }).map((_, i) => (
        <Star key={`star-${i}`} className="h-4 w-4 fill-yellow-400 text-yellow-400" />
      ))}
      {hasHalfStar && <StarHalf className="h-4 w-4 fill-yellow-400 text-yellow-400" />}
      {Array.from({ length: 5 - fullStars - (hasHalfStar ? 1 : 0) }).map((_, i) => (
        <Star key={`empty-star-${i}`} className="h-4 w-4 text-muted-foreground" />
      ))}
    </div>
  )
}

// Audio waveform player component
function WaveformPlayer({ audioUrl, sentiment, duration = "00:00" }: { audioUrl: string; sentiment: { time: string; score: number }[]; duration?: string }) {
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [volume, setVolume] = useState(80)

  // Toggle play/pause
  const togglePlayPause = () => {
    setIsPlaying(!isPlaying)
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={togglePlayPause}>
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </Button>
          <span className="text-sm font-medium">
            {Math.floor(currentTime / 60)}:{(currentTime % 60).toString().padStart(2, "0")} /{" "}
            {duration}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Volume2 className="h-4 w-4 text-muted-foreground" />
          <input
            type="range"
            min="0"
            max="100"
            value={volume}
            onChange={(e) => setVolume(Number.parseInt(e.target.value))}
            className="h-2 w-20"
          />
        </div>
      </div>

      <div className="relative h-24 rounded-md bg-muted p-2">
        {/* Waveform visualization */}
        <div className="flex h-16 items-end justify-between gap-0.5">
          {Array.from({ length: 100 }).map((_, i) => {
            // Generate random heights for the waveform bars
            const height = Math.random() * 100
            return (
              <div
                key={i}
                className={`w-1 ${i === Math.floor((currentTime / 45) * 100) ? "bg-primary" : "bg-primary/50"}`}
                style={{ height: `${height}%` }}
              ></div>
            )
          })}
        </div>

        {/* Sentiment heat strip */}
        <div className="mt-2 flex h-4 w-full rounded-full">
          {sentiment.map((item, index) => {
            // Calculate color based on sentiment score (0-1)
            // Red for negative, yellow for neutral, green for positive
            const color =
              item.score < 0.4
                ? `bg-red-${Math.floor(item.score * 10)}00`
                : item.score < 0.7
                  ? `bg-yellow-${Math.floor(item.score * 10)}00`
                  : `bg-green-${Math.floor(item.score * 10)}00`

            return (
              <div
                key={index}
                className={`flex-1 ${
                  item.score < 0.4 ? "bg-red-500" : item.score < 0.7 ? "bg-yellow-500" : "bg-green-500"
                } opacity-${Math.floor(item.score * 10)}`}
                style={{ opacity: item.score }}
                title={`Sentiment: ${Math.floor(item.score * 100)}% at ${item.time}`}
              ></div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function CandidateDetailInnerPage() {
  const { isLoading: featuresLoading, isFeatureEnabled } = useFeatureFlags()
  const peopleTransitionsEnabled = isFeatureEnabled('peopleTransitions')
  const [activeTab, setActiveTab] = useState("overview")
  const [candidate, setCandidate] = useState<CandidateData | null>(null)
  const [loading, setLoading] = useState(true)
  const [accessibleUrls, setAccessibleUrls] = useState<AccessibleResumeUrls | null>(null)
  const [loadingUrls, setLoadingUrls] = useState(false)
  const router = useRouter()
  const searchParams = useSearchParams()
  const isMobile = useMobile()
  
  // Embedding status states
  const [embeddingStatus, setEmbeddingStatus] = useState<any>(null)
  const [checkingEmbedding, setCheckingEmbedding] = useState(false)
  const [creatingEmbedding, setCreatingEmbedding] = useState(false)
  const [interviews, setInterviews] = useState<Interview[]>([])
  const [loadingInterviews, setLoadingInterviews] = useState(false)
  const [onboardingRecords, setOnboardingRecords] = useState<CandidateOnboarding[]>([])
  const [loadingOnboarding, setLoadingOnboarding] = useState(false)
  
  // Smart navigation logic
  const getBackNavigationPath = useCallback(() => {
    const fromParam = searchParams.get('from')
    const jobId = searchParams.get('jobId')
    const tab = searchParams.get('tab')
    
    if (fromParam === 'job' && jobId) {
      // Return to specific job detail page
      if (tab) {
        return `/jobs/${jobId}?tab=${tab}`
      }
      return `/jobs/${jobId}`
    } else if (fromParam === 'job-ai-matching' && jobId) {
      // Return to job detail page with AI matching section
      return `/jobs/${jobId}?tab=ai-matching`
    } else if (fromParam === 'job-pipeline' && jobId) {
      // Return to job detail page with pipeline section
      return `/jobs/${jobId}?tab=hiring-pipeline`
    } else if (fromParam === 'job-shortlist' && jobId) {
      // Return to job detail page with shortlist section
      return `/jobs/${jobId}?tab=shortlist`
    }
    
    // Default: return to candidate list
    return '/candidates'
  }, [searchParams])
  
  const handleBackNavigation = useCallback(() => {
    const backPath = getBackNavigationPath()
    
    // Check if we can use browser back history for better UX
    if (typeof window !== 'undefined' && window.history.length > 1) {
      // Try to use browser back if we have history
      const referrer = document.referrer
      if (referrer && (referrer.includes('/jobs/') || referrer.includes('/candidates'))) {
        router.back()
        return
      }
    }
    
    // Fallback to programmatic navigation
    router.push(backPath)
  }, [router, getBackNavigationPath])

  useEffect(() => {
    const id = window.location.pathname.split('/').pop()
    if (id) {
      fetchCandidate(id)
    }
  }, [])

  const fetchCandidate = async (id: string) => {
    try {
      setLoading(true)
      const data = await getCandidateById(id)
      setCandidate(data)
      
      // Check if resume is a PDF and fetch accessible URLs
      if (data.resumeUrl && data.resumeUrl.includes('.pdf')) {
        await fetchAccessibleUrls(id)
      }
      
      // Check embedding status
      await checkEmbeddingStatus(id)
      
      // Load candidate interviews
      await loadCandidateInterviews(id)

    } catch (error) {
      console.error("Error fetching candidate:", error)
      toast.error("Failed to fetch candidate details")
    } finally {
      setLoading(false)
    }
  }

  const loadCandidateInterviews = async (candidateId: string) => {
    try {
      setLoadingInterviews(true)
      const interviewData = await interviewService.getCandidateInterviews(candidateId)
      setInterviews(interviewData)
    } catch (error) {
      console.error("Error loading candidate interviews:", error)
    } finally {
      setLoadingInterviews(false)
    }
  }

  const loadCandidateOnboarding = async (candidateId: string) => {
    try {
      setLoadingOnboarding(true)
      const result = await getOnboardingRecords({ candidateId })
      setOnboardingRecords(result.data || [])
    } catch (error) {
      console.warn("Error loading candidate onboarding:", error)
    } finally {
      setLoadingOnboarding(false)
    }
  }

  useEffect(() => {
    if (featuresLoading) return
    if (!peopleTransitionsEnabled) {
      setOnboardingRecords([])
      setActiveTab((tab) => tab === 'onboarding' ? 'overview' : tab)
      return
    }
    if (candidate?._id) {
      loadCandidateOnboarding(candidate._id)
    }
  }, [candidate?._id, featuresLoading, peopleTransitionsEnabled])

  const checkEmbeddingStatus = async (candidateId: string) => {
    try {
      setCheckingEmbedding(true)
      console.log('Checking embedding status for candidate:', candidateId)
      const status = await embeddingService.checkEmbeddingStatus(candidateId)
      console.log('Embedding status response:', status)
      setEmbeddingStatus(status)
    } catch (error) {
      console.error("Error checking embedding status:", error)
      // Set embeddingStatus to null so we show the fallback UI
      setEmbeddingStatus(null)
    } finally {
      setCheckingEmbedding(false)
    }
  }

  const handleCreateEmbedding = async () => {
    if (!candidate) return
    
    try {
      setCreatingEmbedding(true)
      await embeddingService.createEmbedding(candidate._id)
      toast.success("Embedding created successfully!")
      
      // Refresh embedding status
      await checkEmbeddingStatus(candidate._id)
    } catch (error: any) {
      console.error("Error creating embedding:", error)
      toast.error(error.message || "Failed to create embedding")
    } finally {
      setCreatingEmbedding(false)
    }
  }

  const fetchAccessibleUrls = async (candidateId: string) => {
    try {
      setLoadingUrls(true)
      const data = await getAccessibleResumeUrl(candidateId)
      setAccessibleUrls({
        accessibleUrl: data.accessibleUrl,
        downloadUrl: data.downloadUrl,
        previewUrl: data.previewUrl,
        originalUrl: data.originalUrl
      })
    } catch (error) {
      console.warn("Error fetching accessible URLs:", error)
    } finally {
      setLoadingUrls(false)
    }
  }

  // Helper function to get the best available URL for viewing/downloading
  const getResumeUrls = useCallback(() => {
    if (!candidate?.resumeUrl) return null
    
    const isPdf = candidate.resumeUrl.includes('.pdf')
    
    if (isPdf && accessibleUrls) {
      return {
        viewUrl: accessibleUrls.accessibleUrl,
        downloadUrl: accessibleUrls.downloadUrl,
        previewUrl: accessibleUrls.previewUrl,
        isPdf: true,
        hasAccessibleUrls: true
      }
    }
    
    return {
      viewUrl: candidate.resumeUrl,
      downloadUrl: candidate.resumeUrl,
      previewUrl: null,
      isPdf,
      hasAccessibleUrls: false
    }
  }, [candidate, accessibleUrls])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-lg text-muted-foreground">Loading candidate details...</div>
      </div>
    )
  }

  if (!candidate) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-lg text-muted-foreground">Candidate not found</div>
      </div>
    )
  }

  // Calculate match score
  const calculateMatchScore = (candidate: CandidateData): number => {
    let score = 60
    if (candidate.email && candidate.email !== "N/A") score += 5
    if (candidate.phone && candidate.phone !== "N/A") score += 5
    if (candidate.position && candidate.position !== "N/A") score += 10
    if (candidate.experience && candidate.experience !== "N/A") score += 10
    if (candidate.education && candidate.education !== "N/A") score += 5
    if (candidate.skills && candidate.skills.trim().length > 0) score += 5
    return Math.min(score, 100)
  }

  const matchScore = calculateMatchScore(candidate)

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100 text-foreground dark:from-slate-950 dark:via-slate-950 dark:to-slate-900">
      {/* Stunning Hero Header */}
      <div className="relative overflow-hidden bg-gradient-to-r from-blue-600 via-blue-700 to-gray-800 text-white">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGRlZnM+CjxwYXR0ZXJuIGlkPSJncmlkIiB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHBhdHRlcm5Vbml0cz0idXNlclNwYWNlT25Vc2UiPgo8cGF0aCBkPSJNIDYwIDAgTCAwIDAgMCA2MCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSJyZ2JhKDI1NSwyNTUsMjU1LDAuMSkiIHN0cm9rZS13aWR0aD0iMSIvPgo8L3BhdHRlcm4+CjwvZGVmcz4KPHJlY3Qgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIgZmlsbD0idXJsKCNncmlkKSIvPgo8L3N2Zz4=')] opacity-20" />
        
        <div className="relative px-4 py-12 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-7xl">
            <div className="flex items-center gap-4 mb-8">
              <Button 
                variant="outline" 
                size="icon" 
                className="bg-white/10 border-white/20 text-white hover:bg-white/20 backdrop-blur-sm"
                onClick={handleBackNavigation}
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <h1 className="text-4xl font-bold tracking-tight">
                <span className="bg-gradient-to-r from-white to-blue-200 bg-clip-text text-transparent">
                  Candidate Profile
                </span>
              </h1>
            </div>
            
            {/* Candidate Header Info */}
            <div className="flex flex-col md:flex-row items-start md:items-center gap-6 mb-8">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white font-bold text-3xl shadow-lg">
                {candidate.firstName?.[0] || ""}{candidate.lastName?.[0] || ""}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-3">
                  <h2 className="text-3xl font-bold text-white mb-2">
                    {candidate.firstName} {candidate.lastName}
                  </h2>
                </div>
                <p className="text-xl text-blue-100 mb-3">{candidate.position || "Position not specified"}</p>
                <div className="flex flex-wrap items-center gap-4">
                  <div className="inline-flex items-center rounded-full bg-white/10 px-4 py-2 text-sm font-medium backdrop-blur-sm">
                    <Mail className="mr-2 h-4 w-4" />
                    {candidate.email}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="grid gap-8 lg:grid-cols-3">
        {/* Sidebar */}
        <div className="space-y-6">
          <Card className="border border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <CardHeader className="bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-t-lg">
              <CardTitle className="text-xl font-semibold flex items-center gap-2">
                <User className="h-5 w-5" />
                Candidate Details
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6 space-y-6">
              <div className="space-y-4">
                <div className="p-4 rounded-xl bg-gradient-to-br from-blue-50 to-blue-100 hover:from-blue-100 hover:to-blue-200 transition-colors duration-200 dark:from-slate-800 dark:to-slate-800 dark:hover:from-slate-700 dark:hover:to-slate-700">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-blue-600 flex items-center justify-center">
                      <Mail className="h-5 w-5 text-white" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-blue-700 dark:text-blue-300">Email</p>
                      <p className="break-all text-gray-900 dark:text-gray-100">{candidate.email}</p>
                    </div>
                  </div>
                </div>
                
                <div className="p-4 rounded-xl bg-gradient-to-br from-gray-50 to-gray-100 hover:from-gray-100 hover:to-gray-200 transition-colors duration-200 dark:from-slate-800 dark:to-slate-800 dark:hover:from-slate-700 dark:hover:to-slate-700">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-gray-600 flex items-center justify-center">
                      <Phone className="h-5 w-5 text-white" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Phone</p>
                      <p className="text-gray-900 dark:text-gray-100">{candidate.phone || "Not provided"}</p>
                    </div>
                  </div>
                </div>
                
                <div className="p-4 rounded-xl bg-gradient-to-br from-blue-50 to-blue-100 hover:from-blue-100 hover:to-blue-200 transition-colors duration-200 dark:from-slate-800 dark:to-slate-800 dark:hover:from-slate-700 dark:hover:to-slate-700">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-blue-600 flex items-center justify-center">
                      <Calendar className="h-5 w-5 text-white" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-blue-700 dark:text-blue-300">Applied</p>
                      <p className="text-gray-900 dark:text-gray-100">{candidate.createdAt ? new Date(candidate.createdAt).toLocaleDateString() : "N/A"}</p>
                    </div>
                  </div>
                </div>
                
                <div className="p-4 rounded-xl bg-gradient-to-br from-gray-50 to-gray-100 hover:from-gray-100 hover:to-gray-200 transition-colors duration-200 dark:from-slate-800 dark:to-slate-800 dark:hover:from-slate-700 dark:hover:to-slate-700">
                  <div className="flex items-center">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-gray-600 flex items-center justify-center">
                        <CheckCircle className="h-5 w-5 text-white" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Status</p>
                        <Badge variant="outline" className="bg-blue-100 text-blue-700 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-300">
                          {candidate.status || "New"}
                        </Badge>
                      </div>
                    </div>
                  </div>
                </div>
                
                <div className="p-4 rounded-xl bg-gradient-to-br from-blue-50 to-blue-100 hover:from-blue-100 hover:to-blue-200 transition-colors duration-200 dark:from-slate-800 dark:to-slate-800 dark:hover:from-slate-700 dark:hover:to-slate-700">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-blue-600 flex items-center justify-center">
                        <ExternalLink className="h-5 w-5 text-white" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-blue-700 dark:text-blue-300">Source</p>
                        <SourceChip source={candidate.source || "Unknown"} onSourceChange={() => {}} />
                      </div>
                    </div>
                  </div>
                </div>
                
                {(candidate.skills && ((typeof candidate.skills === 'string' && candidate.skills.trim()) || (Array.isArray(candidate.skills) && candidate.skills.length > 0))) && (
                  <div className="p-4 rounded-xl bg-gradient-to-br from-gray-50 to-gray-100 hover:from-gray-100 hover:to-gray-200 transition-colors duration-200 dark:from-slate-800 dark:to-slate-800 dark:hover:from-slate-700 dark:hover:to-slate-700">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-lg bg-gray-600 flex items-center justify-center">
                        <Star className="h-5 w-5 text-white" />
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-gray-700 mb-2 dark:text-gray-300">Skills</p>
                        <div className="flex flex-wrap gap-2">
                          {candidate.skills && typeof candidate.skills === 'string' ? (
                            candidate.skills.split(',').map((skill, index) => (
                              <Badge key={index} variant="outline" className="bg-blue-100 text-blue-700 border-blue-200 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-300">
                                {skill.trim()}
                              </Badge>
                            ))
                          ) : Array.isArray(candidate.skills) ? (
                            candidate.skills.map((skill, index) => (
                              <Badge key={index} variant="outline" className="bg-blue-100 text-blue-700 border-blue-200 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-300">
                                {skill}
                              </Badge>
                            ))
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>


          {/* Embedding Status Card */}
          <Card className="border border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <CardHeader className="bg-gradient-to-r from-purple-600 to-purple-700 text-white rounded-t-lg">
              <CardTitle className="text-xl font-semibold flex items-center gap-2">
                <Brain className="h-5 w-5" />
                AI Embedding Status
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <CandidateEmbeddingCard
                embeddingStatus={embeddingStatus}
                checkingEmbedding={checkingEmbedding}
                handleCreateEmbedding={handleCreateEmbedding}
                creatingEmbedding={creatingEmbedding}
                candidateId={candidate._id}
                candidateName={`${candidate.firstName} ${candidate.lastName}`}
              />
            </CardContent>
          </Card>
        </div>

        {/* Main content */}
        <div className="lg:col-span-2 w-full max-w-full overflow-hidden">
          <Card className="border border-slate-200 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <CardContent className="p-3 sm:p-4 md:p-6">
              <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full max-w-full overflow-hidden" >
                <div className="mb-8">
                  {/* Modern Tab Navigation */}
                  <div className="relative">
                    {/* Background decoration */}
                    <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-blue-50 via-purple-50 to-pink-50 opacity-50 dark:from-slate-800 dark:via-slate-800 dark:to-slate-800" />
                    
                    {isMobile ? (
                      /* Mobile Dropdown Navigation */
                      <Select value={activeTab} onValueChange={setActiveTab}>
                        <SelectTrigger className="w-full h-12 text-base bg-white/80 border-gray-200 rounded-lg shadow-sm dark:border-slate-700 dark:bg-slate-800">
                          <SelectValue placeholder="Select a tab" />
                        </SelectTrigger>
                        <SelectContent className="bg-white border-gray-200 rounded-lg dark:border-slate-700 dark:bg-slate-900">
                          <SelectItem value="overview" className="text-base py-3 cursor-pointer">👤 Overview</SelectItem>
                          <SelectItem value="ai-insights" className="text-base py-3 cursor-pointer">✨ AI Insights</SelectItem>
                          <SelectItem value="cv" className="text-base py-3 cursor-pointer">📄 CV</SelectItem>
                          {peopleTransitionsEnabled && (
                            <SelectItem value="onboarding" className="text-base py-3 cursor-pointer">Transitions</SelectItem>
                          )}
                        </SelectContent>
                      </Select>
                    ) : (
                      /* Desktop Tab List Container */
                      <TabsList className={`relative grid w-full ${peopleTransitionsEnabled ? 'grid-cols-4' : 'grid-cols-3'} gap-1 sm:gap-2 bg-white/80 p-1 sm:p-2 rounded-lg shadow-sm border border-gray-200 h-auto dark:border-slate-700 dark:bg-slate-800`}>
                      {/* Overview Tab */}
                      <TabsTrigger 
                        value="overview"
                        className="group relative flex flex-col items-center gap-1 sm:gap-1.5 px-2 py-2 sm:px-3 sm:py-3 data-[state=active]:bg-blue-600 data-[state=active]:text-white data-[state=active]:shadow-sm rounded-lg font-medium transition-colors duration-200 hover:bg-blue-50 dark:hover:bg-slate-700"
                      >
                        <div className="relative">
                          <div className="absolute inset-0 bg-blue-400 blur-xl opacity-0 group-data-[state=active]:opacity-50 transition-opacity duration-300" />
                          <User className="relative h-4 w-4 sm:h-5 sm:w-5 mb-0.5 text-blue-600 group-data-[state=active]:text-white transition-colors" />
                        </div>
                        <span className="text-[10px] sm:text-xs font-semibold">Overview</span>
                        {candidate.workExperience && (
                          <span className="absolute -top-1 -right-1 h-1.5 w-1.5 sm:h-2 sm:w-2 rounded-full bg-green-500 ring-1 sm:ring-2 ring-white" />
                        )}
                      </TabsTrigger>
                      
                      {/* AI Insights Tab */}
                      <TabsTrigger 
                        value="ai-insights"
                        className="group relative flex flex-col items-center gap-1 sm:gap-1.5 px-2 py-2 sm:px-3 sm:py-3 data-[state=active]:bg-purple-600 data-[state=active]:text-white data-[state=active]:shadow-sm rounded-lg font-medium transition-colors duration-200 hover:bg-purple-50 dark:hover:bg-slate-700"
                      >
                        <div className="relative">
                          <div className="absolute inset-0 bg-purple-400 blur-xl opacity-0 group-data-[state=active]:opacity-50 transition-opacity duration-300" />
                          <div className="relative flex items-center justify-center">
                            <Sparkles className="h-4 w-4 sm:h-5 sm:w-5 mb-0.5 text-purple-600 group-data-[state=active]:text-white transition-colors" />
                            {candidate.aiAnalysis && (
                              <div className="absolute -top-1 -right-1">
                                <span className="relative flex h-1.5 w-1.5 sm:h-2 sm:w-2">
                                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75"></span>
                                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 sm:h-2 sm:w-2 bg-purple-500"></span>
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                        <span className="text-[10px] sm:text-xs font-semibold">AI Insights</span>
                      </TabsTrigger>
                      
                      {/* CV Tab */}
                      <TabsTrigger 
                        value="cv"
                        className="group relative flex flex-col items-center gap-1 sm:gap-1.5 px-2 py-2 sm:px-3 sm:py-3 data-[state=active]:bg-emerald-600 data-[state=active]:text-white data-[state=active]:shadow-sm rounded-lg font-medium transition-colors duration-200 hover:bg-emerald-50 dark:hover:bg-slate-700"
                      >
                        <div className="relative">
                          <div className="absolute inset-0 bg-emerald-400 blur-xl opacity-0 group-data-[state=active]:opacity-50 transition-opacity duration-300" />
                          <FileText className="relative h-4 w-4 sm:h-5 sm:w-5 mb-0.5 text-emerald-600 group-data-[state=active]:text-white transition-colors" />
                        </div>
                        <span className="text-[10px] sm:text-xs font-semibold">CV</span>
                        {candidate.resumeUrl && (
                          <span className="absolute -top-1 -right-1 h-1.5 w-1.5 sm:h-2 sm:w-2 rounded-full bg-emerald-500 ring-1 sm:ring-2 ring-white" />
                        )}
                      </TabsTrigger>

                      {peopleTransitionsEnabled && <TabsTrigger
                        value="onboarding"
                        className="group relative flex flex-col items-center gap-1 sm:gap-1.5 px-2 py-2 sm:px-3 sm:py-3 data-[state=active]:bg-amber-600 data-[state=active]:text-white data-[state=active]:shadow-sm rounded-lg font-medium transition-colors duration-200 hover:bg-amber-50 dark:hover:bg-slate-700"
                      >
                        <div className="relative">
                          <div className="absolute inset-0 bg-amber-400 blur-xl opacity-0 group-data-[state=active]:opacity-50 transition-opacity duration-300" />
                          <GraduationCap className="relative h-4 w-4 sm:h-5 sm:w-5 mb-0.5 text-amber-600 group-data-[state=active]:text-white transition-colors" />
                        </div>
                        <span className="text-[10px] sm:text-xs font-semibold">Transitions</span>
                        {onboardingRecords.length > 0 && (
                          <span className="absolute -top-1 -right-1 h-1.5 w-1.5 sm:h-2 sm:w-2 rounded-full bg-amber-500 ring-1 sm:ring-2 ring-white" />
                        )}
                      </TabsTrigger>}
                      </TabsList>
                    )}
                    
                    {/* Active Tab Indicator Line */}
                    <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-blue-500 to-transparent opacity-50 blur-sm" />
                  </div>
                  
                  {/* Tab Description */}
                  <div className="mt-4 text-center">
                    {activeTab === "overview" && (
                      <p className="text-sm text-gray-600 animate-in fade-in duration-300 dark:text-gray-400">
                        <span className="font-medium">Professional Background</span> • Experience, education, and career progression
                      </p>
                    )}
                    {activeTab === "ai-insights" && (
                      <p className="text-sm text-gray-600 animate-in fade-in duration-300 dark:text-gray-400">
                        <span className="font-medium">AI-Powered Analysis</span> • Strengths, concerns, and intelligent recommendations
                      </p>
                    )}
                    {activeTab === "cv" && (
                      <p className="text-sm text-gray-600 animate-in fade-in duration-300 dark:text-gray-400">
                        <span className="font-medium">Curriculum Vitae</span> • Candidate's resume and professional profile
                      </p>
                    )}
                    {peopleTransitionsEnabled && activeTab === "onboarding" && (
                      <p className="text-sm text-gray-600 animate-in fade-in duration-300 dark:text-gray-400">
                        <span className="font-medium">People Transitions</span> - documents, signatures, and candidate portal activity
                      </p>
                    )}
                    {activeTab === "feedback" && (
                      <p className="text-sm text-gray-600 animate-in fade-in duration-300 dark:text-gray-400">
                        <span className="font-medium">Interview Feedback</span> • Team evaluations and interview insights
                      </p>
                    )}
                  </div>
                </div>

            {/* Overview Tab */}
            <TabsContent value="overview" className="space-y-6 animate-in fade-in-50 duration-500">
              {/* Work Experience Section */}
              {candidate.workExperience && (
                <Card className="border-0 shadow-sm hover:shadow-md transition-shadow duration-300">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Briefcase className="h-5 w-5 text-primary" />
                      Professional Experience
                    </CardTitle>
                    <CardDescription>
                      Comprehensive analysis of career progression and achievements
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    {/* Experience Summary */}
                    {candidate.workExperience.experienceSummary && (
                      <div className="rounded-lg border bg-gradient-to-r from-blue-50 to-indigo-50 p-4 dark:from-blue-950/20 dark:to-indigo-950/20">
                        <h3 className="font-semibold text-blue-900 dark:text-blue-100 mb-2">Career Summary</h3>
                        <p className="text-blue-800 dark:text-blue-200 leading-relaxed">
                          {candidate.workExperience.experienceSummary}
                        </p>
                      </div>
                    )}

                    {/* Career Stats */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {candidate.workExperience.totalYearsExperience && (
                        <div className="text-center p-4 rounded-lg border bg-muted/50">
                          <div className="text-2xl font-bold text-primary">
                            {candidate.workExperience.totalYearsExperience}
                          </div>
                          <div className="text-sm text-muted-foreground">Years Experience</div>
                        </div>
                      )}
                      {candidate.workExperience.jobHistory && (
                        <div className="text-center p-4 rounded-lg border bg-muted/50">
                          <div className="text-2xl font-bold text-primary">
                            {candidate.workExperience.jobHistory.length}
                          </div>
                          <div className="text-sm text-muted-foreground">Positions Held</div>
                        </div>
                      )}
                      {candidate.workExperience.industryExperience && (
                        <div className="text-center p-4 rounded-lg border bg-muted/50">
                          <div className="text-2xl font-bold text-primary">
                            {candidate.workExperience.industryExperience.length}
                          </div>
                          <div className="text-sm text-muted-foreground">Industries</div>
                        </div>
                      )}
                    </div>

                    {/* Career Progression */}
                    {candidate.workExperience.careerProgression && (
                      <div>
                        <h3 className="font-semibold flex items-center gap-2 mb-3">
                          <Clock className="h-4 w-4 text-green-600" />
                          Career Progression
                        </h3>
                        <p className="text-muted-foreground leading-relaxed">
                          {candidate.workExperience.careerProgression}
                        </p>
                      </div>
                    )}

                    {/* Job History Timeline */}
                    {candidate.workExperience.jobHistory && candidate.workExperience.jobHistory.length > 0 && (
                      <div>
                        <h3 className="font-semibold flex items-center gap-2 mb-4">
                          <Building className="h-4 w-4 text-purple-600" />
                          Work History
                        </h3>
                        <div className="space-y-4">
                          {candidate.workExperience.jobHistory.map((job, index) => (
                            <div key={index} className="border rounded-lg p-4 hover:shadow-md transition-shadow">
                              <div className="flex flex-col md:flex-row md:items-start justify-between mb-3">
                                <div>
                                  <h4 className="font-semibold text-lg">{job.position}</h4>
                                  <p className="text-primary font-medium">{job.company}</p>
                                </div>
                                <Badge variant="outline" className="mt-2 md:mt-0">
                                  {job.duration}
                                </Badge>
                              </div>
                              
                              {job.responsibilities && (
                                <div className="mb-3">
                                  <h5 className="font-medium text-sm text-muted-foreground uppercase tracking-wide mb-1">
                                    Key Responsibilities & Achievements
                                  </h5>
                                  <p className="text-sm leading-relaxed">{job.responsibilities}</p>
                                </div>
                              )}

                              {job.impact && (
                                <div className="mb-3">
                                  <h5 className="font-medium text-sm text-green-700 dark:text-green-400 uppercase tracking-wide mb-1">
                                    Impact & Results
                                  </h5>
                                  <p className="text-sm leading-relaxed text-green-800 dark:text-green-300">
                                    {job.impact}
                                  </p>
                                </div>
                              )}

                              {job.technologies && job.technologies.length > 0 && (
                                <div>
                                  <h5 className="font-medium text-sm text-muted-foreground uppercase tracking-wide mb-2">
                                    Technologies Used
                                  </h5>
                                  <div className="flex flex-wrap gap-1">
                                    {job.technologies.map((tech, techIndex) => (
                                      <Badge key={techIndex} variant="secondary" className="text-xs">
                                        {tech}
                                      </Badge>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Key Achievements */}
                    {candidate.workExperience.keyAchievements && candidate.workExperience.keyAchievements.length > 0 && (
                      <div>
                        <h3 className="font-semibold flex items-center gap-2 mb-3">
                          <Star className="h-4 w-4 text-yellow-600" />
                          Key Achievements
                        </h3>
                        <div className="grid gap-2">
                          {candidate.workExperience.keyAchievements.map((achievement, index) => (
                            <div key={index} className="flex items-start gap-2 p-3 rounded-lg bg-yellow-50 dark:bg-yellow-950/20">
                              <Star className="h-4 w-4 text-yellow-600 mt-0.5 flex-shrink-0" />
                              <p className="text-sm text-yellow-800 dark:text-yellow-200">{achievement}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Industry Experience & Leadership */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {candidate.workExperience.industryExperience && candidate.workExperience.industryExperience.length > 0 && (
                        <div>
                          <h3 className="font-semibold flex items-center gap-2 mb-3">
                            <Building className="h-4 w-4 text-blue-600" />
                            Industry Experience
                          </h3>
                          <div className="flex flex-wrap gap-2">
                            {candidate.workExperience.industryExperience.map((industry, index) => (
                              <Badge key={index} variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300">
                                {industry}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}

                      {candidate.workExperience.leadershipExperience && (
                        <div>
                          <h3 className="font-semibold flex items-center gap-2 mb-3">
                            <Users className="h-4 w-4 text-purple-600" />
                            Leadership Experience
                          </h3>
                          <p className="text-sm text-muted-foreground leading-relaxed">
                            {candidate.workExperience.leadershipExperience}
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Technical Depth */}
                    {candidate.workExperience.technicalDepth && (
                      <div>
                        <h3 className="font-semibold flex items-center gap-2 mb-3">
                          <GraduationCap className="h-4 w-4 text-indigo-600" />
                          Technical Expertise Assessment
                        </h3>
                        <div className="rounded-lg border bg-gradient-to-r from-indigo-50 to-purple-50 p-4 dark:from-indigo-950/20 dark:to-purple-950/20">
                          <p className="text-indigo-800 dark:text-indigo-200 leading-relaxed">
                            {candidate.workExperience.technicalDepth}
                          </p>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
              <Card className="border-0 shadow-sm hover:shadow-md transition-shadow duration-300">
                <CardHeader className="rounded-t-lg border-b bg-muted/40">
                  <CardTitle className="flex items-center gap-2">
                    <FileText className="h-5 w-5 text-blue-600" />
                    Professional Summary
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-6">
                  <p className="text-foreground/90 leading-relaxed">{candidate.aiAnalysis?.summary || "No summary available"}</p>
                </CardContent>
              </Card>

              <Card className="border-0 shadow-sm hover:shadow-md transition-shadow duration-300">
                <CardHeader className="rounded-t-lg border-b bg-muted/40">
                  <CardTitle className="flex items-center gap-2">
                    <Briefcase className="h-5 w-5 text-purple-600" />
                    Experience Overview
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-6">
                  <p className="text-foreground/90 leading-relaxed">{candidate.experience || "No experience information available"}</p>
                </CardContent>
              </Card>

              <Card className="border-0 shadow-sm hover:shadow-md transition-shadow duration-300">
                <CardHeader className="rounded-t-lg border-b bg-muted/40">
                  <CardTitle className="flex items-center gap-2">
                    <GraduationCap className="h-5 w-5 text-emerald-600" />
                    Education Background
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-6">
                  <p className="text-foreground/90 leading-relaxed">{candidate.education || "No education information available"}</p>
                </CardContent>
              </Card>

              {/* Complete Education History */}
              {candidate.educationHistory && candidate.educationHistory.length > 0 && (
                <Card className="border-0 shadow-sm hover:shadow-md transition-shadow duration-300">
                  <CardHeader className="rounded-t-lg border-b bg-muted/40">
                    <CardTitle className="flex items-center gap-2">
                      <GraduationCap className="h-5 w-5 text-emerald-600" />
                      Complete Education History ({candidate.educationHistory.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-6 space-y-4">
                    {candidate.educationHistory.map((edu: any, index: number) => (
                      <div key={index} className="border-l-4 border-emerald-500 pl-4 py-2">
                        <h4 className="font-semibold text-foreground">
                          {edu.degree} {edu.fieldOfStudy && `in ${edu.fieldOfStudy}`}
                        </h4>
                        <p className="text-foreground/90">{edu.institution}</p>
                        {edu.location && <p className="text-sm text-muted-foreground">{edu.location}</p>}
                        {edu.graduationYear && <p className="text-sm text-muted-foreground">Graduated: {edu.graduationYear}</p>}
                        {edu.gpa && <p className="text-sm text-muted-foreground">GPA: {edu.gpa}</p>}
                        {edu.honors && <p className="text-sm text-emerald-600 font-medium">{edu.honors}</p>}
                        {edu.description && <p className="text-sm text-muted-foreground mt-1">{edu.description}</p>}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {/* Professional Certifications */}
              {candidate.certifications && candidate.certifications.length > 0 && (
                <Card className="border-0 shadow-sm hover:shadow-md transition-shadow duration-300">
                  <CardHeader className="rounded-t-lg border-b bg-muted/40">
                    <CardTitle className="flex items-center gap-2">
                      <Award className="h-5 w-5 text-amber-600" />
                      Professional Certifications ({candidate.certifications.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {candidate.certifications.map((cert: any, index: number) => (
                        <div key={index} className="border border-amber-200 rounded-lg p-4 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/20">
                          <h4 className="font-semibold text-foreground">{cert.name}</h4>
                          {cert.issuingOrganization && <p className="text-sm text-foreground/90">{cert.issuingOrganization}</p>}
                          <div className="mt-2 space-y-1">
                            {cert.issueDate && <p className="text-xs text-muted-foreground">Issued: {cert.issueDate}</p>}
                            {cert.expiryDate && <p className="text-xs text-muted-foreground">Expires: {cert.expiryDate}</p>}
                            {cert.credentialId && <p className="text-xs text-muted-foreground">ID: {cert.credentialId}</p>}
                          </div>
                          {cert.description && <p className="text-sm text-muted-foreground mt-2">{cert.description}</p>}
                          {cert.credentialUrl && (
                            <a href={cert.credentialUrl} target="_blank" rel="noopener noreferrer" 
                               className="text-xs text-blue-600 hover:underline mt-2 inline-block">
                              Verify Credential →
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Languages */}
              {candidate.languages && candidate.languages.length > 0 && (
                <Card className="border-0 shadow-sm hover:shadow-md transition-shadow duration-300">
                  <CardHeader className="rounded-t-lg border-b bg-muted/40">
                    <CardTitle className="flex items-center gap-2">
                      <Globe className="h-5 w-5 text-cyan-600" />
                      Languages ({candidate.languages.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-6">
                    <div className="flex flex-wrap gap-3">
                      {candidate.languages.map((lang: any, index: number) => (
                        <div key={index} className="rounded-md bg-cyan-100 px-4 py-2 dark:bg-cyan-950/40">
                          <span className="font-medium text-cyan-900 dark:text-cyan-100">{lang.language}</span>
                          {lang.proficiency && <span className="text-cyan-700 ml-2 dark:text-cyan-300">• {lang.proficiency}</span>}
                          {lang.certifications && <span className="text-xs text-cyan-600 block mt-1 dark:text-cyan-400">{lang.certifications}</span>}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Awards and Honors */}
              {candidate.awards && candidate.awards.length > 0 && (
                <Card className="border-0 shadow-sm hover:shadow-md transition-shadow duration-300">
                  <CardHeader className="rounded-t-lg border-b bg-muted/40">
                    <CardTitle className="flex items-center gap-2">
                      <Trophy className="h-5 w-5 text-yellow-600" />
                      Awards & Honors ({candidate.awards.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-6 space-y-3">
                    {candidate.awards.map((award: any, index: number) => (
                      <div key={index} className="flex items-start gap-3 p-3 bg-yellow-50 rounded-lg dark:bg-yellow-950/20">
                        <Trophy className="h-5 w-5 text-yellow-600 mt-1 flex-shrink-0" />
                        <div>
                          <h4 className="font-semibold text-foreground">{award.title}</h4>
                          {award.issuer && <p className="text-sm text-foreground/90">{award.issuer}</p>}
                          {award.date && <p className="text-xs text-muted-foreground">{award.date}</p>}
                          {award.description && <p className="text-sm text-muted-foreground mt-1">{award.description}</p>}
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {/* Projects */}
              {candidate.projects && candidate.projects.length > 0 && (
                <Card className="border-0 shadow-sm hover:shadow-md transition-shadow duration-300">
                  <CardHeader className="rounded-t-lg border-b bg-muted/40">
                    <CardTitle className="flex items-center gap-2">
                      <Code className="h-5 w-5 text-indigo-600" />
                      Projects ({candidate.projects.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-6 space-y-4">
                    {candidate.projects.map((project: any, index: number) => (
                      <div key={index} className="border border-indigo-200 rounded-lg p-4">
                        <div className="flex justify-between items-start">
                          <h4 className="font-semibold text-foreground">{project.title}</h4>
                          {project.url && (
                            <a href={project.url} target="_blank" rel="noopener noreferrer"
                               className="text-indigo-600 hover:underline text-sm">
                              View →
                            </a>
                          )}
                        </div>
                        {project.role && <p className="text-sm text-foreground/90 mt-1">Role: {project.role}</p>}
                        {project.description && <p className="text-sm text-muted-foreground mt-2">{project.description}</p>}
                        {project.technologies && project.technologies.length > 0 && (
                          <div className="flex flex-wrap gap-2 mt-3">
                            {project.technologies.map((tech: string, techIndex: number) => (
                              <span key={techIndex} className="px-2 py-1 bg-indigo-100 text-indigo-700 rounded text-xs dark:bg-indigo-950/50 dark:text-indigo-300">
                                {tech}
                              </span>
                            ))}
                          </div>
                        )}
                        {project.highlights && project.highlights.length > 0 && (
                          <ul className="mt-3 space-y-1">
                            {project.highlights.map((highlight: string, hIndex: number) => (
                              <li key={hIndex} className="text-sm text-muted-foreground flex items-start">
                                <span className="text-indigo-600 mr-2">•</span>
                                {highlight}
                              </li>
                            ))}
                          </ul>
                        )}
                        {(project.startDate || project.endDate) && (
                          <p className="text-xs text-muted-foreground mt-2">
                            {project.startDate} - {project.endDate || 'Present'}
                          </p>
                        )}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {/* Publications */}
              {candidate.publications && candidate.publications.length > 0 && (
                <Card className="border-0 shadow-sm hover:shadow-md transition-shadow duration-300">
                  <CardHeader className="rounded-t-lg border-b bg-muted/40">
                    <CardTitle className="flex items-center gap-2">
                      <BookOpen className="h-5 w-5 text-rose-600" />
                      Publications ({candidate.publications.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-6 space-y-4">
                    {candidate.publications.map((pub: any, index: number) => (
                      <div key={index} className="border-l-4 border-rose-500 pl-4 py-2">
                        <h4 className="font-semibold text-foreground">{pub.title}</h4>
                        {pub.publication && <p className="text-sm text-foreground/90 italic">{pub.publication}</p>}
                        {pub.authors && pub.authors.length > 0 && (
                          <p className="text-sm text-muted-foreground">Authors: {pub.authors.join(', ')}</p>
                        )}
                        {pub.publishDate && <p className="text-xs text-muted-foreground">{pub.publishDate}</p>}
                        {pub.description && <p className="text-sm text-muted-foreground mt-2">{pub.description}</p>}
                        {pub.url && (
                          <a href={pub.url} target="_blank" rel="noopener noreferrer"
                             className="text-sm text-rose-600 hover:underline mt-2 inline-block">
                            Read Publication →
                          </a>
                        )}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {/* Volunteer Work */}
              {candidate.volunteerWork && candidate.volunteerWork.length > 0 && (
                <Card className="border-0 shadow-sm hover:shadow-md transition-shadow duration-300">
                  <CardHeader className="rounded-t-lg border-b bg-muted/40">
                    <CardTitle className="flex items-center gap-2">
                      <Heart className="h-5 w-5 text-green-600" />
                      Volunteer Experience ({candidate.volunteerWork.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-6 space-y-4">
                    {candidate.volunteerWork.map((vol: any, index: number) => (
                      <div key={index} className="border border-green-200 rounded-lg p-4 bg-green-50/50 dark:border-green-900 dark:bg-green-950/20">
                        <h4 className="font-semibold text-foreground">{vol.role || 'Volunteer'}</h4>
                        {vol.organization && <p className="text-foreground/90">{vol.organization}</p>}
                        {(vol.startDate || vol.endDate) && (
                          <p className="text-sm text-muted-foreground">{vol.startDate} - {vol.endDate || 'Present'}</p>
                        )}
                        {vol.description && <p className="text-sm text-muted-foreground mt-2">{vol.description}</p>}
                        {vol.impact && (
                          <p className="text-sm text-green-700 mt-2 font-medium">Impact: {vol.impact}</p>
                        )}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {/* Professional Memberships */}
              {candidate.professionalMemberships && candidate.professionalMemberships.length > 0 && (
                <Card className="border-0 shadow-sm hover:shadow-md transition-shadow duration-300">
                  <CardHeader className="rounded-t-lg border-b bg-muted/40">
                    <CardTitle className="flex items-center gap-2">
                      <Users className="h-5 w-5 text-slate-600" />
                      Professional Memberships ({candidate.professionalMemberships.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {candidate.professionalMemberships.map((mem: any, index: number) => (
                        <div key={index} className="flex items-start gap-2 p-3 border border-gray-200 rounded-lg dark:border-slate-700">
                          <Users className="h-4 w-4 text-slate-600 mt-1" />
                          <div>
                            <h4 className="font-medium text-foreground">{mem.organization}</h4>
                            {mem.role && <p className="text-sm text-muted-foreground">{mem.role}</p>}
                            {mem.description && <p className="text-xs text-muted-foreground mt-1">{mem.description}</p>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Portfolio Links */}
              {candidate.portfolioLinks && Object.keys(candidate.portfolioLinks).some((key: string) => candidate.portfolioLinks[key]) && (
                <Card className="border-0 shadow-sm hover:shadow-md transition-shadow duration-300">
                  <CardHeader className="rounded-t-lg border-b bg-muted/40">
                    <CardTitle className="flex items-center gap-2">
                      <LinkIcon className="h-5 w-5 text-blue-600" />
                      Online Presence
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {candidate.portfolioLinks.github && (
                        <a href={candidate.portfolioLinks.github} target="_blank" rel="noopener noreferrer"
                           className="flex items-center gap-2 p-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors dark:border-slate-700 dark:hover:bg-slate-800">
                          <Github className="h-5 w-5 text-gray-700 dark:text-gray-300" />
                          <span className="text-sm text-foreground/90">GitHub Profile</span>
                        </a>
                      )}
                      {candidate.portfolioLinks.linkedin && (
                        <a href={candidate.portfolioLinks.linkedin} target="_blank" rel="noopener noreferrer"
                           className="flex items-center gap-2 p-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors dark:border-slate-700 dark:hover:bg-slate-800">
                          <Linkedin className="h-5 w-5 text-blue-600" />
                          <span className="text-sm text-foreground/90">LinkedIn</span>
                        </a>
                      )}
                      {candidate.portfolioLinks.personalWebsite && (
                        <a href={candidate.portfolioLinks.personalWebsite} target="_blank" rel="noopener noreferrer"
                           className="flex items-center gap-2 p-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors dark:border-slate-700 dark:hover:bg-slate-800">
                          <Globe className="h-5 w-5 text-green-600" />
                          <span className="text-sm text-foreground/90">Personal Website</span>
                        </a>
                      )}
                      {candidate.portfolioLinks.portfolio && (
                        <a href={candidate.portfolioLinks.portfolio} target="_blank" rel="noopener noreferrer"
                           className="flex items-center gap-2 p-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors dark:border-slate-700 dark:hover:bg-slate-800">
                          <Briefcase className="h-5 w-5 text-purple-600" />
                          <span className="text-sm text-foreground/90">Portfolio</span>
                        </a>
                      )}
                      {candidate.portfolioLinks.stackoverflow && (
                        <a href={candidate.portfolioLinks.stackoverflow} target="_blank" rel="noopener noreferrer"
                           className="flex items-center gap-2 p-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors dark:border-slate-700 dark:hover:bg-slate-800">
                          <Code className="h-5 w-5 text-orange-600" />
                          <span className="text-sm text-foreground/90">Stack Overflow</span>
                        </a>
                      )}
                      {candidate.portfolioLinks.medium && (
                        <a href={candidate.portfolioLinks.medium} target="_blank" rel="noopener noreferrer"
                           className="flex items-center gap-2 p-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors dark:border-slate-700 dark:hover:bg-slate-800">
                          <BookOpen className="h-5 w-5 text-gray-700 dark:text-gray-300" />
                          <span className="text-sm text-foreground/90">Blog/Medium</span>
                        </a>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Additional Sections */}
              {candidate.additionalSections && Object.keys(candidate.additionalSections).length > 0 && (
                <Card className="border-0 shadow-sm hover:shadow-md transition-shadow duration-300">
                  <CardHeader className="rounded-t-lg border-b bg-muted/40">
                    <CardTitle className="flex items-center gap-2">
                      <FileText className="h-5 w-5 text-violet-600" />
                      Additional Information
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-6 space-y-4">
                    {Object.entries(candidate.additionalSections).map(([sectionName, sectionContent]: [string, any], index: number) => (
                      <div key={index} className="border-l-4 border-violet-500 pl-4 py-2">
                        <h4 className="font-semibold text-foreground mb-2">{sectionName}</h4>
                        <p className="text-sm text-foreground/90 whitespace-pre-wrap">{sectionContent}</p>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            {/* AI Insights Tab */}
            <TabsContent value="ai-insights" className="space-y-6 animate-in fade-in-50 duration-500" >
              {candidate.aiAnalysis && (
                <>
                  <Card className="border-0 shadow-sm hover:shadow-md transition-shadow duration-300">
                    <CardHeader className="rounded-t-lg border-b bg-muted/40">
                      <CardTitle className="flex items-center gap-2">
                        <Brain className="h-5 w-5 text-purple-600" />
                        AI Analysis Summary
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-6">
                      <div className="prose prose-sm max-w-none dark:prose-invert">
                        <p className="text-foreground/90 leading-relaxed">{candidate.aiAnalysis.summary}</p>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="border-0 shadow-sm hover:shadow-md transition-shadow duration-300">
                    <CardHeader className="rounded-t-lg border-b bg-muted/40">
                      <CardTitle className="flex items-center gap-2">
                        <BarChart3 className="h-5 w-5 text-blue-600" />
                        Strengths & Areas of Concern
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-6">
                      <div className="grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-2">
                        <div className="space-y-2 sm:space-y-3 rounded-xl bg-gradient-to-br from-green-50 to-emerald-50 p-3 sm:p-5 border border-green-100 dark:border-green-900 dark:from-green-950/30 dark:to-emerald-950/30">
                          <h3 className="font-semibold text-green-800 flex items-center gap-2 dark:text-green-300">
                            <CheckCircle className="h-4 w-4 sm:h-5 sm:w-5" />
                            Key Strengths
                          </h3>
                          <ul className="ml-4 sm:ml-6 list-disc space-y-1 sm:space-y-2 text-sm text-green-700 dark:text-green-300">
                            {candidate.aiAnalysis.strengths?.map((item, index) => (
                              <li key={index} className="break-words">{item}</li>
                            )) || <li>No strengths identified</li>}
                          </ul>
                        </div>
                        <div className="space-y-2 sm:space-y-3 rounded-xl bg-gradient-to-br from-amber-50 to-orange-50 p-3 sm:p-5 border border-amber-100 dark:border-amber-900 dark:from-amber-950/30 dark:to-orange-950/30">
                          <h3 className="font-semibold text-amber-800 flex items-center gap-2 dark:text-amber-300">
                            <AlertCircle className="h-4 w-4 sm:h-5 sm:w-5" />
                            Areas to Consider
                          </h3>
                          <ul className="ml-4 sm:ml-6 list-disc space-y-1 sm:space-y-2 text-sm text-amber-700 dark:text-amber-300">
                            {candidate.aiAnalysis.potentialFlags?.map((item, index) => (
                              <li key={index} className="break-words">{item}</li>
                            )) || <li>No concerns identified</li>}
                          </ul>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </>
              )}
            </TabsContent>

            {/* CV Tab */}
            <TabsContent value="cv" className="space-y-6 animate-in fade-in-50 duration-500" >
              <Card className="border-0 shadow-sm hover:shadow-md transition-shadow duration-300">
                <CardHeader className="rounded-t-lg border-b bg-muted/40">
                  <CardTitle className="flex items-center gap-2">
                    <FileText className="h-5 w-5 text-emerald-600" />
                    Curriculum Vitae
                  </CardTitle>
                  <CardDescription>
                    View and download the candidate's CV/Resume
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {candidate.resumeUrl && (() => {
                      const resumeUrls = getResumeUrls()
                      const isPdf = resumeUrls?.isPdf
                      const isLoadingPdfUrls = isPdf && loadingUrls && !accessibleUrls
                      
                      return (
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between rounded-md border p-3 sm:p-4 gap-3 sm:gap-4">
                          <div className="flex items-center gap-3">
                            <div className="rounded-md bg-muted p-2">
                              <FileText className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
                            </div>
                            <div>
                              <h3 className="font-medium">CV Document {isPdf && "(PDF)"}</h3>
                              <p className="text-sm text-muted-foreground">
                                Submitted on {candidate.createdAt ? new Date(candidate.createdAt).toLocaleDateString() : "N/A"}
                              </p>
                              {isPdf && !resumeUrls?.hasAccessibleUrls && !isLoadingPdfUrls && (
                                <div className="flex items-center gap-1 mt-1">
                                  <AlertCircle className="h-3 w-3 text-amber-500" />
                                  <span className="text-xs text-amber-600">PDF access may be limited</span>
                                </div>
                              )}
                              {isLoadingPdfUrls && (
                                <div className="flex items-center gap-1 mt-1">
                                  <Loader2 className="h-3 w-3 animate-spin text-blue-500" />
                                  <span className="text-xs text-blue-600">Generating accessible links...</span>
                                </div>
                              )}
                            </div>
                          </div>
                          
                          <div className="flex flex-wrap items-center gap-2 mt-2 sm:mt-0">
                            {resumeUrls?.viewUrl && (
                              <Button variant="outline" size="sm" asChild className="w-full sm:w-auto">
                                <a href={resumeUrls.viewUrl} target="_blank" rel="noopener noreferrer">
                                  <ExternalLink className="mr-2 h-4 w-4" />
                                  View
                                </a>
                              </Button>
                            )}
                            {resumeUrls?.downloadUrl && (
                              <Button variant="outline" size="sm" asChild className="w-full sm:w-auto">
                                <a href={resumeUrls.downloadUrl} download>
                                  <Download className="mr-2 h-4 w-4" />
                                  Download
                                </a>
                              </Button>
                            )}
                            {isPdf && resumeUrls?.previewUrl && (
                              <Button variant="outline" size="sm" asChild className="w-full sm:w-auto">
                                <a href={resumeUrls.previewUrl} target="_blank" rel="noopener noreferrer">
                                  <FileText className="mr-2 h-4 w-4" />
                                  Preview
                                </a>
                              </Button>
                            )}
                          </div>
                        </div>
                      )
                    })()}
                    {!candidate.resumeUrl && (
                      <div className="rounded-md border border-dashed p-8">
                        <div className="flex flex-col items-center justify-center text-center">
                          <FileText className="h-10 w-10 text-muted-foreground" />
                          <h3 className="mt-4 text-lg font-medium">No CV available</h3>
                          <p className="mt-2 text-sm text-muted-foreground">This candidate hasn't submitted a CV document</p>
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {peopleTransitionsEnabled && <TabsContent value="onboarding" className="space-y-6 animate-in fade-in-50 duration-500">
              <div className="rounded-md border bg-white p-4 dark:border-slate-700 dark:bg-slate-900 sm:p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-foreground">People transitions</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Start an onboarding, exit, or retirement workflow or open an existing transition record.
                    </p>
                  </div>
                  <Button asChild>
                    <Link href={`/people-transitions/new?candidateId=${candidate._id}`}>
                      <GraduationCap className="mr-2 h-4 w-4" />
                      Start transition
                    </Link>
                  </Button>
                </div>

                <div className="mt-5 space-y-3">
                  {loadingOnboarding && (
                    <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">Loading transition history...</div>
                  )}
                  {!loadingOnboarding && onboardingRecords.length === 0 && (
                    <div className="rounded-md border border-dashed p-6 text-center">
                      <GraduationCap className="mx-auto h-8 w-8 text-amber-600" />
                      <h4 className="mt-3 font-semibold text-foreground">No transitions started yet</h4>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Starting a transition creates their candidate portal invitation.
                      </p>
                    </div>
                  )}
                  {!loadingOnboarding && onboardingRecords.map((record) => (
                    <Link
                      key={record._id}
                      href={`/people-transitions/${record._id}`}
                      className="flex flex-col gap-3 rounded-md border p-4 transition-colors hover:bg-gray-50 dark:hover:bg-slate-800 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div>
                        <div className="font-semibold text-foreground">{record.title}</div>
                        <div className="mt-1 text-sm text-muted-foreground">
                          Started {record.createdAt ? new Date(record.createdAt).toLocaleDateString() : "recently"} - {record.envelopes?.length || 0} signing packet(s)
                        </div>
                      </div>
                      <Badge variant="outline" className="w-fit capitalize">{record.status.replace("_", " ")}</Badge>
                    </Link>
                  ))}
                </div>
              </div>
            </TabsContent>}


          </Tabs>
            </CardContent>
          </Card>
        </div>
      </div>
      </div>
    </div>
  )
}

export default function CandidateDetailPage() {
  return <CandidateDetailInnerPage />
}
