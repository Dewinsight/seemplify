"use client"

import { useState, useEffect, useRef } from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import "@/styles/hiring-pipeline-tabs.css"
import {
  ArrowLeft,
  MapPin,
  Building,
  Clock,
  Calendar,
  Users,
  Edit,
  Trash,
  Download,
  CheckCircle,
  XCircle,
  MessageSquare,
  FileText,
  ChevronRight,
  BarChart,
  User,
  Mail,
  Phone,
  Paperclip,
  Star,
  StarHalf,
  Send,
  Plus,
  File,
  Loader2,
  MoreHorizontal,
  HelpCircle,
  Lightbulb,
  Wand2,
  Filter,
  RefreshCw,
  Briefcase,
  ExternalLink,
  Globe,
  Workflow,
  Settings,
  TrendingUp,
  Trophy,
  BarChart3,
  Sparkles,
} from "lucide-react"
import useMobile from "@/hooks/use-mobile"
import { Button } from "@/components/ui/button"
import { PublicJobDialog } from "@/components/jobs/public-job-dialog"
import { apiRequest, getAuthHeaders } from "@/services/apiConfig"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { ShortlistCard } from "@/components/ui/shortlist-card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Textarea } from "@/components/ui/textarea"
import { SimpleTabNavigation } from "@/components/ui/simple-tab-navigation"
import { MobileJobHeader } from "@/components/ui/mobile-job-header"
import { ResponsiveContentLayout, ResponsiveCard, ResponsiveTwoColumn, ResponsiveGrid, MobileStatCard } from "@/components/ui/responsive-content-layout"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { getJobById, deleteJob, updateJob, type JobData } from "@/services/jobService"
import { toast } from "@/components/ui/use-toast"
import { decodeObjectHtmlEntities, prepareFormDataForSave } from "@/utils/htmlDecode"
import { cn } from "@/lib/utils"
import { StatusToggle } from "@/components/ui/status-toggle"
import { JobEmbeddingCard } from "@/components/ui/job-embedding-card"
import { AdvancedQuestionGenerator } from "@/components/ui/advanced-question-generator"
import { QuestionQualityDisplay } from "@/components/ui/question-quality-display"
import { PipelineWithTabs } from "@/components/ui/pipeline-with-tabs"
import { PipelineAnalyticsEnhanced } from "@/components/ui/pipeline-analytics-enhanced"
import { InterviewStageConfiguration } from "@/components/ui/interview-stage-configuration"
import { InterviewSetupTab } from "@/components/ui/interview-setup-tab"
import { FeedbackLeaderboard } from "@/components/ui/feedback-leaderboard"
import { JobEmailSettings } from "@/components/ui/job-email-settings"
import { PipelineEmailManagementTab } from "@/components/ui/pipeline-email-management-tab"
import { FeedbackFormSettings } from "@/components/ui/feedback-form-settings"
import interviewService, { 
  InterviewQuestion, 
  InterviewQuestionCreateData, 
  GenerateQuestionsOptions,
  OptimizedGenerationOptions,
  QuestionQualityAnalysis,
  Interview
} from "@/services/interviewService"
import pipelineService, { PipelineApplicant } from "@/services/pipelineService"
import interviewStageService from "@/services/interviewStageService"
import { formatCurrency } from "@/lib/currencies"
import { useCreditError } from "@/hooks/useCreditError"
import { CreditErrorDialog } from "@/components/ui/credit-error-dialog"
import { JobSetupWizard } from "@/components/wizards/JobSetupWizard"

function JobDetailInnerPage() {
  const params = useParams()
  const router = useRouter()
  const { creditError, showCreditDialog, setShowCreditDialog, handleError } = useCreditError()
  const [activeTab, setActiveTab] = useState("overview")
  const [candidatesTab, setCandidatesTab] = useState("ai-matches")
  const [interviewsTab, setInterviewsTab] = useState("overview")
  const [hiringPipelineTab, setHiringPipelineTab] = useState("board")
  const [insightsTab, setInsightsTab] = useState("analytics")
  const [newNote, setNewNote] = useState("")
  const [jobData, setJobData] = useState<JobData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isUpdatingPublicStatus, setIsUpdatingPublicStatus] = useState(false)
  const [showPublicJobDialog, setShowPublicJobDialog] = useState(false)
  const [publicDialogMode, setPublicDialogMode] = useState<'enable' | 'disable' | 'increase'>('enable')
  const [creditInfo, setCreditInfo] = useState<any>(null)
  const isMobile = useMobile()
  const lastLoadedJobIdRef = useRef<string | null>(null)
  
  // Handle URL search params for tab navigation
  useEffect(() => {
    const handleTabNavigation = () => {
      if (typeof window !== 'undefined') {
        const searchParams = new URLSearchParams(window.location.search)
        const tab = searchParams.get('tab')
        console.log('Tab parameter detected:', tab)
        if (tab === 'shortlist') {
          console.log('Navigating to candidates -> shortlist')
          setActiveTab('candidates')
          setCandidatesTab('shortlist')
          // Clean up the URL
          window.history.replaceState({}, '', window.location.pathname)
        }
      }
    }
    
    // Check on mount
    handleTabNavigation()
    
    // Listen for route changes (when navigating to the same page with different params)
    const handleRouteChange = () => {
      setTimeout(handleTabNavigation, 50)
    }
    
    window.addEventListener('popstate', handleRouteChange)
    
    // Also check periodically in case router.push doesn't trigger popstate
    const checkInterval = setInterval(() => {
      const searchParams = new URLSearchParams(window.location.search)
      const tab = searchParams.get('tab')
      if (tab === 'shortlist') {
        handleTabNavigation()
      }
    }, 100)
    
    // Clear interval after 2 seconds (enough time to catch any navigation)
    setTimeout(() => clearInterval(checkInterval), 2000)
    
    return () => {
      window.removeEventListener('popstate', handleRouteChange)
      clearInterval(checkInterval)
    }
  }, [])
  
  // Function to navigate to the stage configuration (within hiring pipeline)
  const navigateToStagesTab = () => {
    console.log('Navigating to stage configuration');
    setActiveTab("hiring-pipeline");
    setHiringPipelineTab("configuration");
  }
  
  // Add a global function that can be called from anywhere
  useEffect(() => {
    // @ts-ignore
    window.navigateToJobStagesTab = navigateToStagesTab;
    // @ts-ignore
    window.navigateToOverview = () => {
      setActiveTab('overview')
    }
    // @ts-ignore
    window.navigateToHiringPipelineBoard = () => {
      setActiveTab('hiring-pipeline')
      setHiringPipelineTab('board')
    }
    // @ts-ignore
    window.navigateToHiringPipelineConfiguration = () => {
      setActiveTab('hiring-pipeline')
      setHiringPipelineTab('configuration')
    }
    // @ts-ignore
    window.navigateToCandidatesAiMatches = () => {
      setActiveTab('candidates')
      setCandidatesTab('ai-matches')
    }
    // @ts-ignore
    window.navigateToCandidatesShortlist = () => {
      setActiveTab('candidates')
      setCandidatesTab('shortlist')
    }
    // @ts-ignore
    window.navigateToInterviewsOverview = () => {
      setActiveTab('interviews')
      setInterviewsTab('overview')
    }
    // @ts-ignore
    window.navigateToInterviewsSetup = () => {
      setActiveTab('interviews')
      setInterviewsTab('setup')
    }
    // @ts-ignore
    window.navigateToInsightsAnalytics = () => {
      setActiveTab('insights')
      setInsightsTab('analytics')
    }
    
    return () => {
      // @ts-ignore
      delete window.navigateToJobStagesTab;
      // @ts-ignore
      delete window.navigateToOverview;
      // @ts-ignore
      delete window.navigateToHiringPipelineBoard;
      // @ts-ignore
      delete window.navigateToHiringPipelineConfiguration;
      // @ts-ignore
      delete window.navigateToCandidatesAiMatches;
      // @ts-ignore
      delete window.navigateToCandidatesShortlist;
      // @ts-ignore
      delete window.navigateToInterviewsOverview;
      // @ts-ignore
      delete window.navigateToInterviewsSetup;
      // @ts-ignore
      delete window.navigateToInsightsAnalytics;
    };
  }, []);
  
  // Listen for custom event from the pipeline component and URL hash changes
  useEffect(() => {
    const handleNavigateToStages = () => {
      console.log('Custom event: navigateToStages received');
      navigateToStagesTab();
    };
    
    // Listen for custom event
    document.addEventListener('navigateToStages', handleNavigateToStages);
    
    // Listen for URL hash changes
    const handleHashChange = () => {
      console.log('URL hash changed:', window.location.hash);
      if (window.location.hash === '#stages' || window.location.hash === '#configuration') {
        console.log('Detected #stages or #configuration hash, navigating to stage configuration');
        navigateToStagesTab();
      } else if (window.location.hash === '#pipeline' || window.location.hash === '#hiring-pipeline') {
        console.log('Detected #pipeline hash, navigating to hiring pipeline board');
        setActiveTab('hiring-pipeline');
        setHiringPipelineTab('board');
      }
    };
    
    // Check hash on initial load
    if (window.location.hash === '#stages' || window.location.hash === '#configuration') {
      console.log('Initial hash is #stages, navigating to stage configuration');
      setTimeout(() => navigateToStagesTab(), 100); // Small delay to ensure component is fully mounted
    } else if (window.location.hash === '#pipeline' || window.location.hash === '#hiring-pipeline') {
      console.log('Initial hash is #pipeline, navigating to hiring pipeline board');
      setTimeout(() => {
        setActiveTab('hiring-pipeline');
        setHiringPipelineTab('board');
      }, 100);
    }
    
    // Add hash change listener
    window.addEventListener('hashchange', handleHashChange);
    
    return () => {
      document.removeEventListener('navigateToStages', handleNavigateToStages);
      window.removeEventListener('hashchange', handleHashChange);
    };
  }, []);

  // Interview Questions State
  const [interviewQuestions, setInterviewQuestions] = useState<InterviewQuestion[]>([])
  const [questionsLoading, setQuestionsLoading] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  // Removed showGenerateDialog - only using advanced generator now
  const [editingQuestion, setEditingQuestion] = useState<InterviewQuestion | null>(null)
  
  // Interviews State
  const [jobInterviews, setJobInterviews] = useState<Interview[]>([])
  const [interviewsLoading, setInterviewsLoading] = useState(false)
  const [interviewStages, setInterviewStages] = useState<any[]>([])
  const [stagesLoading, setStagesLoading] = useState(false)
  const [newQuestion, setNewQuestionForm] = useState<InterviewQuestionCreateData>({
    question: '',
    type: 'general',
    difficulty: 'medium',
    interviewStage: 'first_round',
    category: '',
    expectedAnswer: '',
    tags: [],
    timeLimit: undefined,
  })
  // Removed generateOptions - only using advanced generator now
  const [questionsFilter, setQuestionsFilter] = useState({
    type: '',
    stage: '',
    difficulty: '',
  })
  
  // Advanced generation state
  const [showAdvancedGenerator, setShowAdvancedGenerator] = useState(false)
  const [qualityAnalyses, setQualityAnalyses] = useState<Record<string, QuestionQualityAnalysis>>({})
  const [analyzingQuestions, setAnalyzingQuestions] = useState<Set<string>>(new Set())

  // Pipeline state
  const [analyticsRefreshTrigger, setAnalyticsRefreshTrigger] = useState(0)

  // Simple candidate count for navigation (optional)
  const [candidateCount, setCandidateCount] = useState(0)
  const [showEmailSettingsDialog, setShowEmailSettingsDialog] = useState(false)
  const [showBulkRejectionDialog, setShowBulkRejectionDialog] = useState(false)
  const [isExportingReport, setIsExportingReport] = useState(false)

  // Listen for global email settings open event
  useEffect(() => {
    const handleOpenEmailSettings = () => {
      setActiveTab('hiring-pipeline')
      setHiringPipelineTab('email-settings')
    }
    
    window.addEventListener('openEmailSettings', handleOpenEmailSettings)
    return () => window.removeEventListener('openEmailSettings', handleOpenEmailSettings)
  }, [])
  const [showSetupWizard, setShowSetupWizard] = useState(false)

  // Backward compatibility: old tab value removed, redirect to board section
  useEffect(() => {
    if (hiringPipelineTab === 'email-management') {
      setHiringPipelineTab('board')
    }
  }, [hiringPipelineTab])
  
  // Mobile scroll to top functionality
  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // Optionally fetch candidate count using detailed pipeline
  useEffect(() => {
    const fetchCandidateCount = async () => {
      if (jobData?._id) {
        try {
          const pipeline = await pipelineService.getDetailedPipeline(jobData?._id)
          const totalCandidates = pipeline?.stages?.reduce((total: number, stage: any) => 
            total + (stage.candidates?.length || 0), 0) || 0
          setCandidateCount(totalCandidates)
        } catch (error) {
          console.error('Error fetching candidate count:', error)
          setCandidateCount(0)
        }
      }
    }
    
    fetchCandidateCount()
  }, [jobData])

  // Multi-stage pipeline state
  const [stagesRefreshTrigger, setStagesRefreshTrigger] = useState(0)
  const [selectedCandidate, setSelectedCandidate] = useState<any>(null)

  const fetchJobData = async (options?: { showLoading?: boolean }) => {
    const currentJobId = params.jobId as string
    const shouldShowLoading =
      options?.showLoading ??
      (!jobData || (lastLoadedJobIdRef.current !== null && lastLoadedJobIdRef.current !== currentJobId))

    try {
      if (shouldShowLoading) {
        setLoading(true)
      }

      const data = await getJobById(currentJobId)
      // Decode HTML entities in job data for display
      const decodedData = decodeObjectHtmlEntities(data)
      // Calculate total applicants: shortlist (excluding moved_to_pipeline) + pipeline
      const shortlistCount = decodedData.shortlist?.filter((item: any) => item.status !== 'moved_to_pipeline').length || 0
      const pipelineCount = decodedData.applicants?.length || 0
      decodedData.applicantCount = shortlistCount + pipelineCount
      setJobData(decodedData)
      setError(null)
      lastLoadedJobIdRef.current = currentJobId
    } catch (e: any) {
      console.error("Error fetching job data:", e)
      // Avoid blanking the entire page on background refresh failures.
      if (shouldShowLoading) {
        setError(e.message || "An error occurred while fetching job data.")
      }
      toast({
        title: "Error Loading Job",
        description: e.message || "Failed to load job details.",
        variant: "destructive",
      })
    } finally {
      if (shouldShowLoading) {
        setLoading(false)
      }
    }
  }

  // Fetch credit information
  const fetchCreditInfo = async () => {
    try {
      const response = await apiRequest('/api/credits/status', {
        method: 'GET',
        headers: getAuthHeaders(),
      })
      
      if (!response.ok) {
        throw new Error('Failed to fetch credit info')
      }
      
      const data = await response.json()
      console.log('💳 Credit info fetched:', data)
      
      if (data.success) {
        setCreditInfo(data.credits)
      }
    } catch (error) {
      console.error('Error fetching credit info:', error)
    }
  }

  useEffect(() => {
    if (params.jobId) {
      fetchJobData()
      fetchCreditInfo()
    }
  }, [params.jobId])


  const handleAddNote = () => {
    if (newNote.trim()) {
      // In a real app, you would add the note to the database
      // For now, we'll just clear the input
      setNewNote("")
    }
  }

  // Handle status change
  const handleStatusChange = (newStatus: any) => {
    if (jobData) {
      setJobData({ ...jobData, status: newStatus })
    }
  }

  // Handle job deletion
  const handleDeleteJob = async () => {
    if (!jobData) return
    
    setIsDeleting(true)
    try {
      await deleteJob(jobData?._id)
      toast({
        title: "Job Deleted",
        description: "The job has been successfully deleted.",
      })
      router.push('/jobs')
    } catch (error: any) {
      toast({
        title: "Delete Failed",
        description: error.message || "Failed to delete the job.",
        variant: "destructive",
      })
    } finally {
      setIsDeleting(false)
    }
  }

  // Handle public status toggle
  const handleTogglePublicStatus = async (isPublic: boolean) => {
    if (!jobData) return
    
    if (isPublic) {
      // Show dialog to set candidate limit
      setPublicDialogMode('enable')
      setShowPublicJobDialog(true)
    } else {
      // Show confirmation with refund info
      setPublicDialogMode('disable')
      setShowPublicJobDialog(true)
    }
  }

  // Handle actual public status update after dialog confirmation
  const handlePublicStatusUpdate = async (isPublic: boolean, candidateApplyLimit?: number) => {
    if (!jobData) return
    
    setIsUpdatingPublicStatus(true)
    try {
      const updateData = isPublic 
        ? { isPublic, candidateApplyLimit }
        : { isPublic }
      
      const updatedJob = await updateJob(jobData._id, updateData)
      // Recalculate applicant count (exclude moved_to_pipeline from shortlist)
      const shortlistCount = updatedJob.shortlist?.filter((item: any) => item.status !== 'moved_to_pipeline').length || 0
      const pipelineCount = updatedJob.applicants?.length || 0
      updatedJob.applicantCount = shortlistCount + pipelineCount
      setJobData(updatedJob)
      setShowPublicJobDialog(false)
      
      // Refresh credit info after update
      await fetchCreditInfo()
      
      toast({
        title: isPublic ? "Job Made Public" : "Job Made Private",
        description: isPublic 
          ? `Credits reserved for ${candidateApplyLimit} applications`
          : "Unused credits have been refunded",
      })
    } catch (error: any) {
      console.error('❌ Error updating job public status:', error)
      
      // Parse error response for better user feedback
      let errorTitle = "Update Failed"
      let errorMessage = "Failed to update job status."
      
      if (error.message) {
        // Check for specific error codes
        if (error.message.includes('INSUFFICIENT_CREDITS')) {
          errorTitle = "Insufficient Credits"
          errorMessage = "You don't have enough credits to make this job public. Please purchase more credits or reduce the candidate limit."
        } else if (error.message.includes('INVALID_APPLY_LIMIT')) {
          errorTitle = "Invalid Candidate Limit"
          errorMessage = "Please set a valid candidate apply limit (minimum 1)."
        } else if (error.message.includes('validation failed')) {
          errorTitle = "Validation Error"
          errorMessage = "There was a problem saving the job settings. Please try again or contact support."
        } else {
          errorMessage = error.message
        }
      }
      
      toast({
        title: errorTitle,
        description: errorMessage,
        variant: "destructive",
      })
      
      // Keep dialog open on error so user can adjust settings
      // setShowPublicJobDialog remains true
    } finally {
      setIsUpdatingPublicStatus(false)
    }
  }


  // Interview Questions Functions
  const fetchInterviewQuestions = async () => {
    if (!jobData) return
    
    setQuestionsLoading(true)
    try {
      const questions = await interviewService.getQuestionsByJob(jobData?._id, questionsFilter)
      // Decode HTML entities in questions for display (backend already handles this, but adding as safety measure)
      const decodedQuestions = questions.map(q => decodeObjectHtmlEntities(q))
      setInterviewQuestions(decodedQuestions)
    } catch (error: any) {
      toast({
        title: "Error Loading Questions",
        description: error.message || "Failed to load interview questions.",
        variant: "destructive",
      })
    } finally {
      setQuestionsLoading(false)
    }
  }

  // Interviews Functions
  const fetchJobInterviews = async () => {
    if (!jobData) return
    
    setInterviewsLoading(true)
    try {
      const interviews = await interviewService.getJobInterviews(jobData._id)
      setJobInterviews(interviews)
      console.log('📅 Loaded job interviews:', interviews)
    } catch (error: any) {
      console.error('Error loading job interviews:', error)
      toast({
        title: "Error Loading Interviews",
        description: error.message || "Failed to load job interviews.",
        variant: "destructive",
      })
    } finally {
      setInterviewsLoading(false)
    }
  }

  const fetchInterviewStages = async () => {
    if (!jobData) return
    
    setStagesLoading(true)
    try {
      const stages = await interviewStageService.getStagesForJob(jobData._id)
      setInterviewStages(stages || [])
      console.log('📊 Loaded interview stages:', stages)
    } catch (error: any) {
      console.error('Error loading interview stages:', error)
      setInterviewStages([])
    } finally {
      setStagesLoading(false)
    }
  }

  const handleCreateQuestion = async () => {
    if (!jobData || !newQuestion.question.trim()) {
      toast({
        title: "Validation Error",
        description: "Please provide a question.",
        variant: "destructive",
      })
      return
    }

    try {
      // Decode HTML entities from question text fields before saving
      const cleanedQuestion = prepareFormDataForSave(newQuestion)
      const createdQuestion = await interviewService.createQuestion(jobData?._id, cleanedQuestion)
      setInterviewQuestions(prev => [...prev, createdQuestion])
      setShowCreateDialog(false)
      setNewQuestionForm({
        question: '',
        type: 'general',
        difficulty: 'medium',
        interviewStage: 'first_round',
        category: '',
        expectedAnswer: '',
        tags: [],
        timeLimit: undefined,
      })
      
      // Automatically analyze the quality of the newly created question
      try {
        console.log('🔍 Automatically analyzing quality for new question:', createdQuestion._id)
        const analysis = await interviewService.analyzeQuestionQuality(createdQuestion._id)
        setQualityAnalyses(prev => ({
          ...prev,
          [createdQuestion._id]: analysis
        }))
        console.log('✅ Quality analysis completed for new question')
      } catch (analysisError) {
        console.warn('⚠️ Failed to analyze question quality:', analysisError)
        // Don't show error to user as this is automatic
      }
      
      toast({
        title: "Question Created",
        description: "Interview question has been created successfully.",
      })
    } catch (error: any) {
      toast({
        title: "Creation Failed",
        description: error.message || "Failed to create interview question.",
        variant: "destructive",
      })
    }
  }

  // Removed handleGenerateQuestions - only using advanced generator now

  const handleAdvancedGenerate = async (options: GenerateQuestionsOptions) => {
    if (!jobData) return
    
    setIsGenerating(true)
    try {
      const generatedQuestions = await interviewService.generateQuestions(jobData?._id, options)
      setInterviewQuestions(prev => [...prev, ...generatedQuestions])
      setShowAdvancedGenerator(false)
      toast({
        title: "Advanced Questions Generated",
        description: `Successfully generated ${generatedQuestions.length} optimized interview questions.`,
      })
    } catch (error: any) {
      const isCreditError = handleError(error)
      if (!isCreditError) {
        toast({
          title: "Generation Failed",
          description: error.message || "Failed to generate interview questions.",
          variant: "destructive",
        })
      }
    } finally {
      setIsGenerating(false)
    }
  }

  const handleOptimizedGenerate = async (options: OptimizedGenerationOptions) => {
    if (!jobData) return
    
    setIsGenerating(true)
    try {
      const result = await interviewService.generateOptimizedQuestionSet(jobData?._id, options)
      setInterviewQuestions(prev => [...prev, ...result.questions])
      setShowAdvancedGenerator(false)
      toast({
        title: "Optimized Question Suite Generated",
        description: `Generated ${result.questions.length} questions with ${Math.round(result.optimization.averageQuality * 100)}% average quality score.`,
      })
    } catch (error: any) {
      const isCreditError = handleError(error)
      if (!isCreditError) {
        toast({
          title: "Generation Failed",
          description: error.message || "Failed to generate optimized question suite.",
          variant: "destructive",
        })
      }
    } finally {
      setIsGenerating(false)
    }
  }

  const handleAnalyzeQuestion = async (questionId: string) => {
    setAnalyzingQuestions(prev => new Set([...prev, questionId]))
    try {
      const analysis = await interviewService.analyzeQuestionQuality(questionId)
      setQualityAnalyses(prev => ({ ...prev, [questionId]: analysis }))
      toast({
        title: "Quality Analysis Complete",
        description: "Question quality metrics have been generated.",
      })
    } catch (error: any) {
      toast({
        title: "Analysis Failed",
        description: error.message || "Failed to analyze question quality.",
        variant: "destructive",
      })
    } finally {
      setAnalyzingQuestions(prev => {
        const newSet = new Set(prev)
        newSet.delete(questionId)
        return newSet
      })
    }
  }

  const handleUpdateQuestion = async (questionId: string, updateData: Partial<InterviewQuestionCreateData>) => {
    try {
      // Decode HTML entities from question text fields before saving
      const cleanedData = prepareFormDataForSave(updateData)
      const updatedQuestion = await interviewService.updateQuestion(questionId, cleanedData)
      setInterviewQuestions(prev => 
        prev.map(q => q._id === questionId ? updatedQuestion : q)
      )
      setEditingQuestion(null)
      toast({
        title: "Question Updated",
        description: "Interview question has been updated successfully.",
      })
    } catch (error: any) {
      toast({
        title: "Update Failed",
        description: error.message || "Failed to update interview question.",
        variant: "destructive",
      })
    }
  }

  const handleDeleteQuestion = async (questionId: string) => {
    try {
      await interviewService.deleteQuestion(questionId)
      setInterviewQuestions(prev => prev.filter(q => q._id !== questionId))
      toast({
        title: "Question Deleted",
        description: "Interview question has been deleted successfully.",
      })
    } catch (error: any) {
      toast({
        title: "Deletion Failed",
        description: error.message || "Failed to delete interview question.",
        variant: "destructive",
      })
    }
  }

  // Load interview questions when tab is switched to questions or job data changes
  useEffect(() => {
    if (activeTab === 'questions' && jobData) {
      fetchInterviewQuestions()
    }
  }, [activeTab, jobData, questionsFilter])

  // Load interviews when tab is switched to interviews or job data changes
  useEffect(() => {
    if (activeTab === 'interviews' && jobData) {
      fetchJobInterviews()
      fetchInterviewStages()
    }
  }, [activeTab, jobData])

  // Helper functions to parse string data into arrays
  const parseStringToArray = (str: string): string[] => {
    if (!str) return []
    return str.split('\n').map(item => item.replace(/^[•\-*]\s*/, '').trim()).filter(Boolean)
  }

  const formatSalaryDisplay = (salary?: JobData['salary']): string => {
    if (!salary || (!salary.min && !salary.max)) return 'Not specified'
    const currency = salary.currency || 'USD'
    if (salary.min && salary.max) {
      return `${formatCurrency(salary.min, currency)} - ${formatCurrency(salary.max, currency)}`
    } else if (salary.min) {
      return `${formatCurrency(salary.min, currency)}+`
    } else if (salary.max) {
      return `Up to ${formatCurrency(salary.max, currency)}`
    }
    return 'Not specified'
  }

  // Pipeline handlers
  const handlePipelineApplicantsChange = (updatedApplicants: PipelineApplicant[]) => {
    console.log('📥 Parent received applicants update:', updatedApplicants.length, 'applicants')
    console.log('🔄 Setting pipeline applicants state...')
    if (jobData) {
      const shortlistCount = jobData.shortlist?.filter((item: any) => item.status !== 'moved_to_pipeline').length || 0
      const pipelineCount = updatedApplicants.length
      setJobData({
        ...jobData,
        applicants: updatedApplicants,
        applicantCount: shortlistCount + pipelineCount,
      })
    }
  }

  const handleAnalyticsUpdate = () => {
    setAnalyticsRefreshTrigger(prev => prev + 1)
  }

  // Multi-stage pipeline handlers
  const handleStagesUpdate = () => {
    setStagesRefreshTrigger(prev => prev + 1)
    handleAnalyticsUpdate()
  }

  const handleCandidateSelect = (candidate: any) => {
    setSelectedCandidate(candidate)
  }

  const handleExportPipelineReport = async () => {
    if (!jobData?._id || isExportingReport) return

    try {
      setIsExportingReport(true)
      const { blob, fileName } = await pipelineService.exportPipelineExcelReport(jobData._id)
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = fileName
      document.body.appendChild(link)
      link.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(link)

      toast({
        title: "Export Ready",
        description: "Detailed pipeline report downloaded successfully.",
      })
    } catch (error: any) {
      toast({
        title: "Export Failed",
        description: error?.message || "Unable to export pipeline report.",
        variant: "destructive",
      })
    } finally {
      setIsExportingReport(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <Loader2 className="animate-spin h-8 w-8 text-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Loading job details...</p>
        </div>
      </div>
    )
  }

  if (error || !jobData) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-center">
        <div className="max-w-md">
          <h2 className="text-2xl font-semibold mb-2">Job Not Found</h2>
          <p className="text-muted-foreground mb-4">
            {error || "The job you're looking for doesn't exist or has been removed."}
          </p>
          <Button onClick={() => router.push('/jobs')}>
            Back to Jobs
          </Button>
        </div>
      </div>
    )
  }

  // Extract department name for MobileJobHeader
  const departmentName = typeof jobData?.department === 'object' 
    ? (jobData.department as any)?.name 
    : jobData?.department;

  return (
    <div className={cn(
      "min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100 dark:from-slate-900 dark:via-slate-900 dark:to-gray-900",
      isMobile && "pb-20" // Add bottom padding on mobile for the bottom action bar
    )}>
      <JobSetupWizard isOpen={showSetupWizard} onClose={() => setShowSetupWizard(false)} />
      {/* Mobile-Responsive Header */}
      <div>
      <MobileJobHeader
        jobData={{
          _id: jobData._id,
          title: jobData.title,
          department: departmentName,
          location: jobData.location,
          type: jobData.type,
          salary: jobData.salary || {},
          applicantCount: jobData.applicantCount,
          status: jobData.status,
          publiclyVisible: jobData.isPublic || false
        }}
        isMobile={isMobile}
        onBack={() => router.back()}
        onEdit={() => router.push(`/jobs/${jobData?._id}/edit`)}
        onDelete={handleDeleteJob}
        onExportReport={handleExportPipelineReport}
        onEmailSettings={() => setShowEmailSettingsDialog(true)}
        onSetupWizard={() => setShowSetupWizard(true)}
        onTogglePublic={() => handleTogglePublicStatus(!jobData.isPublic)}
        isUpdatingPublicStatus={isUpdatingPublicStatus}
        isExportingReport={isExportingReport}
        formatSalaryDisplay={formatSalaryDisplay}
      />
      </div>

      {/* Guided Tour Button moved into header actions */}

      {/* Responsive Main Content */}
      <ResponsiveContentLayout>
        <div className="w-full">

                <div className="w-full">
              <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                {/* Simple Tab Navigation */}
                <div>
                <SimpleTabNavigation
                  activeTab={activeTab}
                  onTabChange={setActiveTab}
                  candidateCount={candidateCount}
                  isMobile={isMobile}
                />
                </div>

                <TabsContent value="overview" className="space-y-4 sm:space-y-6">
                  <Card className="border-0 bg-white/60 backdrop-blur-xl shadow-lg dark:bg-slate-800/60 dark:backdrop-blur-xl dark:shadow-2xl">
                    <CardHeader className="bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-t-lg">
                      <CardTitle className="text-xl font-semibold flex items-center gap-2">
                        <FileText className="h-5 w-5" />
                        Job Details
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4 sm:space-y-6 pt-4 sm:pt-6 px-3 sm:px-4 lg:px-6">
                        {/* Public Job Application Management */}
                        <div className="space-y-3">
                          <div className="flex items-center gap-3 px-1">
                            <div className="w-8 h-8 rounded-lg bg-gradient-to-r from-green-600 to-green-700 flex items-center justify-center">
                              <Globe className="h-4 w-4 text-white" />
                            </div>
                            <h3 className="text-base sm:text-lg font-bold text-gray-900 dark:text-gray-100">Public Applications</h3>
                          </div>
                          <div className="p-4 sm:p-5 lg:p-6 rounded-xl bg-gradient-to-br from-green-50/50 to-green-100/50 border border-green-200 dark:from-slate-800/50 dark:to-slate-700/50 dark:border-slate-700">
                            {/* Mobile-Responsive Toggle Section */}
                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4 sm:mb-6">
                              <div className="flex-1">
                                <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 mb-2">
                                  <p className="text-base sm:text-lg font-semibold text-gray-900 dark:text-gray-100">
                                    Enable Public Applications
                                  </p>
                                <Badge
                                  variant={jobData?.isPublic ? "default" : "secondary"}
                                  className={jobData?.isPublic ? "bg-green-600 hover:bg-green-700" : ""}
                                >
                                  {jobData?.isPublic ? 'Public' : 'Private'}
                                </Badge>
                              </div>
                              <p className="text-sm text-gray-600">
                                {jobData?.isPublic
                                  ? 'Anyone can apply through your public job link'
                                  : 'Applications can only be added by your hiring team'}
                              </p>
                            </div>
                            <div className="flex items-center gap-3">
                              {isUpdatingPublicStatus && (
                                <Loader2 className="h-4 w-4 animate-spin text-gray-500" />
                              )}
                              <Switch
                                checked={jobData?.isPublic || false}
                                onCheckedChange={handleTogglePublicStatus}
                                disabled={isUpdatingPublicStatus}
                                className="data-[state=checked]:bg-green-600"
                              />
                            </div>
                          </div>
                          
                          {/* Public Link Section - Only show when public */}
                          {jobData?.isPublic && (
                            <div className="space-y-4 pt-4 border-t border-green-200">
                              {jobData?.publicUrl ? (
                                <div className="space-y-3">
                                  <div className="flex items-center gap-2">
                                    <label className="text-sm font-medium text-gray-700">Public Job Link:</label>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={async () => {
                                        const fullUrl = `${window.location.origin}${jobData?.publicUrl}`
                                        await navigator.clipboard.writeText(fullUrl)
                                        toast({
                                          title: "Link Copied!",
                                          description: "Public job link copied to clipboard.",
                                        })
                                      }}
                                      className="h-7 px-2 text-xs"
                                    >
                                      Copy Link
                                    </Button>
                                  </div>
                                  <div className="p-3 bg-white rounded-lg border border-green-300">
                                    <code className="text-sm text-gray-800 break-all">
                                      {`${window.location.origin}${jobData?.publicUrl}`}
                                    </code>
                                  </div>
                                  
                                  <div className="flex items-center gap-4 text-sm text-gray-600">
                                    <div className="flex items-center gap-1">
                                      <Users className="h-4 w-4" />
                                      <span>{jobData?.analytics?.publicViews || 0} views</span>
                                    </div>
                                    <div className="flex items-center gap-1">
                                      <Send className="h-4 w-4" />
                                      <span>{jobData?.analytics?.publicApplications || 0} applications</span>
                                    </div>
                                  </div>

                                  {/* Application Slots Info & Management */}
                                  {jobData?.candidateApplyLimit && jobData.candidateApplyLimit > 0 && (
                                    <div className="p-3 bg-gradient-to-r from-blue-50 to-purple-50 dark:from-slate-800 dark:to-slate-700 rounded-lg border border-blue-200 dark:border-slate-600 space-y-2">
                                      <div className="flex items-center justify-between">
                                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Application Slots:</span>
                                        <span className="text-sm font-bold text-blue-600 dark:text-blue-400">
                                          {jobData?.publicApplicationCount || 0} / {jobData.candidateApplyLimit}
                                        </span>
                                      </div>
                                      <div className="w-full bg-gray-200 dark:bg-slate-600 rounded-full h-2">
                                        <div
                                          className="bg-gradient-to-r from-blue-600 to-purple-600 h-2 rounded-full transition-all duration-300"
                                          style={{
                                            width: `${Math.min(((jobData?.publicApplicationCount || 0) / jobData.candidateApplyLimit) * 100, 100)}%`
                                          }}
                                        />
                                      </div>
                                      <div className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-400">
                                        <span>
                                          {jobData.candidateApplyLimit - (jobData?.publicApplicationCount || 0)} slots remaining
                                        </span>
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          onClick={() => {
                                            setPublicDialogMode('increase')
                                            setShowPublicJobDialog(true)
                                          }}
                                          className="h-7 px-3 text-xs bg-blue-600 text-white hover:bg-blue-700 border-blue-600"
                                        >
                                          <Plus className="h-3 w-3 mr-1" />
                                          Increase Slots
                                        </Button>
                                      </div>
                                    </div>
                                  )}

                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => window.open(`${window.location.origin}${jobData?.publicUrl}`, '_blank')}
                                    className="w-full"
                                  >
                                    <ExternalLink className="h-4 w-4 mr-2" />
                                    Preview Public Job Page
                                  </Button>
                                </div>
                              ) : (
                                <div className="text-center py-4">
                                  <div className="flex items-center justify-center gap-2 text-blue-600 mb-2">
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    <span className="text-sm font-medium">Generating public link...</span>
                                  </div>
                                  <p className="text-xs text-gray-500">
                                    Your public job link will be available shortly
                                  </p>
                                </div>
                              )}
                            </div>
                          )}
                        </div>

                      {/* Mobile-First Stats Grid */}
                      <div className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                        <div className="group p-3 sm:p-4 lg:p-5 rounded-xl bg-gradient-to-br from-blue-50 to-blue-100 hover:from-blue-100 hover:to-blue-200 transition-all duration-200 dark:from-slate-800 dark:to-slate-700 dark:hover:from-slate-700 dark:hover:to-slate-600 min-h-[80px] flex items-center">
                          <div className="flex items-center gap-3 w-full">
                            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg bg-blue-600 flex items-center justify-center flex-shrink-0">
                              <Building className="h-4 w-4 sm:h-5 sm:w-5 text-white" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-medium text-blue-700 dark:text-blue-300 uppercase tracking-wide">Department</p>
                              <p className="text-sm sm:text-base lg:text-lg font-semibold text-gray-900 dark:text-gray-100 truncate">{typeof jobData?.department === 'object' ? (jobData?.department as any)?.name : jobData?.department}</p>
                            </div>
                          </div>
                        </div>
                        
                        <div className="group p-3 sm:p-4 lg:p-5 rounded-xl bg-gradient-to-br from-gray-50 to-gray-100 hover:from-gray-100 hover:to-gray-200 transition-all duration-200 dark:from-slate-800 dark:to-slate-700 dark:hover:from-slate-700 dark:hover:to-slate-600 min-h-[80px] flex items-center">
                          <div className="flex items-center gap-3 w-full">
                            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg bg-gray-600 flex items-center justify-center flex-shrink-0">
                              <MapPin className="h-4 w-4 sm:h-5 sm:w-5 text-white" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wide">Location</p>
                              <p className="text-sm sm:text-base lg:text-lg font-semibold text-gray-900 dark:text-gray-100 truncate">{jobData?.location}</p>
                            </div>
                          </div>
                        </div>
                        
                        <div className="group p-3 sm:p-4 lg:p-5 rounded-xl bg-gradient-to-br from-blue-50 to-blue-100 hover:from-blue-100 hover:to-blue-200 transition-all duration-200 dark:from-slate-800 dark:to-slate-700 dark:hover:from-slate-700 dark:hover:to-slate-600 min-h-[80px] flex items-center">
                          <div className="flex items-center gap-3 w-full">
                            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg bg-blue-600 flex items-center justify-center flex-shrink-0">
                              <Clock className="h-4 w-4 sm:h-5 sm:w-5 text-white" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-medium text-blue-700 dark:text-blue-300 uppercase tracking-wide">Job Type</p>
                              <p className="text-sm sm:text-base lg:text-lg font-semibold text-gray-900 dark:text-gray-100 truncate">{jobData?.type}</p>
                            </div>
                          </div>
                        </div>
                        
                        <div className="group p-3 sm:p-4 lg:p-5 rounded-xl bg-gradient-to-br from-green-50 to-green-100 hover:from-green-100 hover:to-green-200 transition-all duration-200 dark:from-slate-800 dark:to-slate-700 dark:hover:from-slate-700 dark:hover:to-slate-600 min-h-[80px] flex items-center">
                          <div className="flex items-center gap-3 w-full">
                            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg bg-green-600 flex items-center justify-center flex-shrink-0">
                              <Briefcase className="h-4 w-4 sm:h-5 sm:w-5 text-white" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-medium text-green-700 dark:text-green-300 uppercase tracking-wide">Salary</p>
                              <p className="text-sm sm:text-base lg:text-lg font-semibold text-gray-900 dark:text-gray-100 truncate">{formatSalaryDisplay(jobData?.salary)}</p>
                            </div>
                          </div>
                        </div>
                        
                        <div className="group p-3 sm:p-4 lg:p-5 rounded-xl bg-gradient-to-br from-purple-50 to-purple-100 hover:from-purple-100 hover:to-purple-200 transition-all duration-200 dark:from-slate-800 dark:to-slate-700 dark:hover:from-slate-700 dark:hover:to-slate-600 min-h-[80px] flex items-center">
                          <div className="flex items-center gap-3 w-full">
                            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg bg-purple-600 flex items-center justify-center flex-shrink-0">
                              <Calendar className="h-4 w-4 sm:h-5 sm:w-5 text-white" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-medium text-purple-700 dark:text-purple-300 uppercase tracking-wide">Posted</p>
                              <p className="text-sm sm:text-base lg:text-lg font-semibold text-gray-900 dark:text-gray-100 truncate">{jobData?.createdAt ? new Date(jobData?.createdAt).toLocaleDateString() : 'Not specified'}</p>
                            </div>
                          </div>
                        </div>
                        
                        <div className="group p-3 sm:p-4 lg:p-5 rounded-xl bg-gradient-to-br from-orange-50 to-orange-100 hover:from-orange-100 hover:to-orange-200 transition-all duration-200 dark:from-slate-800 dark:to-slate-700 dark:hover:from-slate-700 dark:hover:to-slate-600 min-h-[80px] flex items-center">
                          <div className="flex items-center gap-3 w-full">
                            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg bg-orange-600 flex items-center justify-center flex-shrink-0">
                              <Calendar className="h-4 w-4 sm:h-5 sm:w-5 text-white" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-medium text-orange-700 dark:text-orange-300 uppercase tracking-wide">Deadline</p>
                              <p className="text-sm sm:text-base lg:text-lg font-semibold text-gray-900 dark:text-gray-100 truncate">{jobData?.applicationDeadline ? new Date(jobData?.applicationDeadline).toLocaleDateString() : 'Open'}</p>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Separator */}
                      <div className="h-px bg-gradient-to-r from-transparent via-gray-300 to-transparent my-4 sm:my-6"></div>

                      {/* Mobile-Responsive Content Sections */}
                      <div className="space-y-4 sm:space-y-6">

                        {/* Job Description */}
                        <div className="space-y-3">
                          <div className="flex items-center gap-3 px-1">
                            <div className="w-8 h-8 rounded-lg bg-gradient-to-r from-blue-600 to-blue-700 flex items-center justify-center flex-shrink-0">
                              <FileText className="h-4 w-4 text-white" />
                            </div>
                            <h3 className="text-base sm:text-lg lg:text-xl font-bold text-gray-900 dark:text-gray-100">Description</h3>
                          </div>
                          <div className="p-4 sm:p-5 lg:p-6 rounded-xl bg-gradient-to-br from-blue-50/50 to-blue-100/50 border border-blue-200 dark:from-slate-800/50 dark:to-slate-700/50 dark:border-slate-700">
                            <div className="prose prose-sm sm:prose max-w-none dark:prose-invert">
                              <div className="text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap break-words text-sm sm:text-base">
                                {jobData?.description || 'No description available.'}
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Requirements & Responsibilities - Side by Side on Desktop, Stacked on Mobile */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
                          <div className="space-y-3">
                            <div className="flex items-center gap-3 px-1">
                              <div className="w-8 h-8 rounded-lg bg-gradient-to-r from-green-600 to-green-700 flex items-center justify-center">
                                <CheckCircle className="h-4 w-4 text-white" />
                              </div>
                              <h3 className="text-base sm:text-lg font-bold text-gray-900 dark:text-gray-100">Requirements</h3>
                            </div>
                            <div className="p-4 sm:p-5 rounded-xl bg-gradient-to-br from-green-50/50 to-green-100/50 border border-green-200 dark:from-slate-800/50 dark:to-slate-700/50 dark:border-slate-700">
                              {jobData?.requirements ? (
                                <div className="prose prose-sm max-w-none dark:prose-invert">
                                  <div className="text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap text-sm sm:text-base">
                                    {jobData?.requirements}
                                  </div>
                                </div>
                              ) : (
                                <p className="text-gray-500 dark:text-gray-400 italic text-sm">No requirements specified.</p>
                              )}
                            </div>
                          </div>

                          <div className="space-y-3">
                            <div className="flex items-center gap-3 px-1">
                              <div className="w-8 h-8 rounded-lg bg-gradient-to-r from-purple-600 to-purple-700 flex items-center justify-center">
                                <Star className="h-4 w-4 text-white" />
                              </div>
                              <h3 className="text-base sm:text-lg font-bold text-gray-900 dark:text-gray-100">Responsibilities</h3>
                            </div>
                            <div className="p-4 sm:p-5 rounded-xl bg-gradient-to-br from-purple-50/50 to-purple-100/50 border border-purple-200 dark:from-slate-800/50 dark:to-slate-700/50 dark:border-slate-700">
                              {jobData?.responsibilities ? (
                                <div className="prose prose-sm max-w-none dark:prose-invert">
                                  <div className="text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap text-sm sm:text-base">
                                    {jobData?.responsibilities}
                                  </div>
                                </div>
                              ) : (
                                <p className="text-gray-500 dark:text-gray-400 italic text-sm">No responsibilities specified.</p>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>

                        {/* Skills & Benefits - Grid Layout */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
                          {jobData?.skills && (
                            <div className="space-y-3">
                              <div className="flex items-center gap-3 px-1">
                                <div className="w-8 h-8 rounded-lg bg-gradient-to-r from-orange-600 to-orange-700 flex items-center justify-center">
                                  <Star className="h-4 w-4 text-white" />
                                </div>
                                <h3 className="text-base sm:text-lg font-bold text-gray-900 dark:text-gray-100">Required Skills</h3>
                              </div>
                              <div className="p-4 sm:p-5 rounded-xl bg-gradient-to-br from-orange-50/50 to-orange-100/50 border border-orange-200 dark:from-slate-800/50 dark:to-slate-700/50 dark:border-slate-700">
                                <div className="prose prose-sm max-w-none dark:prose-invert">
                                  <div className="text-gray-700 dark:text-gray-300 leading-relaxed text-sm sm:text-base">
                                    {jobData?.skills}
                                  </div>
                                </div>
                              </div>
                            </div>
                          )}

                          {jobData?.benefits && (
                            <div className="space-y-3">
                              <div className="flex items-center gap-3 px-1">
                                <div className="w-8 h-8 rounded-lg bg-gradient-to-r from-emerald-600 to-emerald-700 flex items-center justify-center">
                                  <Star className="h-4 w-4 text-white" />
                                </div>
                                <h3 className="text-base sm:text-lg font-bold text-gray-900 dark:text-gray-100">Benefits</h3>
                              </div>
                              <div className="p-4 sm:p-5 rounded-xl bg-gradient-to-br from-emerald-50/50 to-emerald-100/50 border border-emerald-200 dark:from-slate-800/50 dark:to-slate-700/50 dark:border-slate-700">
                                <div className="prose prose-sm max-w-none dark:prose-invert">
                                  <div className="text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap text-sm sm:text-base">
                                    {jobData?.benefits}
                                  </div>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
            </TabsContent>

                <TabsContent value="candidates" className="space-y-3 sm:space-y-4">
                  <Tabs value={candidatesTab} onValueChange={setCandidatesTab} className="w-full">
                    {/* Mobile-Optimized Sub-Tabs */}
                    <div className="mb-4">
                      {isMobile ? (
                        <div className="flex space-x-2 overflow-x-auto pb-2">
                          <Button
                            variant={candidatesTab === 'ai-matches' ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => setCandidatesTab('ai-matches')}
                            className={cn(
                              "min-w-fit whitespace-nowrap h-12 px-4",
                              candidatesTab === 'ai-matches' && "bg-blue-600 text-white shadow-md"
                            )}
                          >
                            🤖 AI Matches
                          </Button>
                          <Button
                            variant={candidatesTab === 'shortlist' ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => setCandidatesTab('shortlist')}
                            className={cn(
                              "min-w-fit whitespace-nowrap h-12 px-4",
                              candidatesTab === 'shortlist' && "bg-blue-600 text-white shadow-md"
                            )}
                          >
                            ⭐ Shortlist
                          </Button>
                        </div>
                      ) : (
                        <TabsList className="grid w-full grid-cols-2 bg-gradient-to-r from-gray-100 to-blue-50 dark:from-slate-700 dark:to-slate-800 p-2 rounded-xl h-auto sm:h-12 gap-1">
                          <TabsTrigger 
                            value="ai-matches"
                            className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-blue-600 data-[state=active]:to-blue-700 data-[state=active]:text-white data-[state=active]:shadow-lg rounded-lg font-medium transition-all duration-200 text-gray-700 dark:text-slate-300 dark:data-[state=active]:text-white hover:bg-white/50 dark:hover:bg-slate-600/50 text-sm sm:text-base min-h-[44px] px-3 py-2"
                          >
                            🤖 AI Matches
                          </TabsTrigger>
                          <TabsTrigger 
                            value="shortlist"
                            className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-blue-600 data-[state=active]:to-blue-700 data-[state=active]:text-white data-[state=active]:shadow-lg rounded-lg font-medium transition-all duration-200 text-gray-700 dark:text-slate-300 dark:data-[state=active]:text-white hover:bg-white/50 dark:hover:bg-slate-600/50 text-sm sm:text-base min-h-[44px] px-3 py-2"
                          >
                            ⭐ Shortlist
                          </TabsTrigger>
                        </TabsList>
                      )}
                    </div>
                    <TabsContent value="ai-matches">
                      <div data-tutorial="ai-matches">
                      <JobEmbeddingCard
                        jobId={jobData?._id}
                        onCandidateAdded={() => {
                          fetchJobData()
                          handleAnalyticsUpdate()
                        }}
                        pipelineCandidateIds={jobData?.applicants?.map(app => app.candidate._id) || []}
                        shortlistCandidateIds={jobData?.shortlist?.map(item => item.candidate) || []}
                      />
                      </div>
                    </TabsContent>
                    <TabsContent value="shortlist">
                      <div data-tutorial="shortlist-section">
                      <ShortlistCard
                        jobId={jobData?._id}
                        jobTitle={jobData?.title}
                        onCandidateMoved={() => {
                          fetchJobData()
                          handleAnalyticsUpdate()
                        }}
                      />
                      </div>
                    </TabsContent>
                  </Tabs>
                </TabsContent>

                <TabsContent value="questions" className="space-y-3 sm:space-y-4">
                  <Card className="border-0 bg-white/60 backdrop-blur-xl shadow-lg dark:bg-slate-800/60 dark:backdrop-blur-xl dark:shadow-2xl">
                    <CardHeader className="bg-gradient-to-r from-purple-600 to-purple-700 text-white rounded-t-lg">
                      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <CardTitle className="text-lg sm:text-xl font-semibold flex items-center gap-2">
                            <HelpCircle className="h-5 w-5 flex-shrink-0" />
                            <span className="truncate">Interview Questions</span>
                          </CardTitle>
                          <CardDescription className="text-purple-100 text-sm">
                            Manage interview questions for this position
                          </CardDescription>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="p-6">
                      {/* Filters */}
                      <div className="mb-6 p-4 bg-gradient-to-r from-gray-50 to-purple-50 rounded-lg dark:from-slate-800 dark:to-purple-900/30">
                        <div className="flex items-center gap-2 mb-3">
                          <Filter className="h-4 w-4 text-purple-600 flex-shrink-0" />
                          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Filters:</span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                          <select
                            className="px-3 py-2 border rounded-md text-sm bg-white dark:bg-slate-700 dark:border-slate-600 min-h-[40px]"
                            value={questionsFilter.type}
                            onChange={(e) => setQuestionsFilter(prev => ({ ...prev, type: e.target.value }))}
                          >
                            <option value="all_types">All Types</option>
                            <option value="technical">Technical</option>
                            <option value="behavioral">Behavioral</option>
                            <option value="situational">Situational</option>
                            <option value="cultural_fit">Cultural Fit</option>
                            <option value="general">General</option>
                            <option value="skills_based">Skills Based</option>
                            <option value="experience_based">Experience Based</option>
                          </select>
                          <select 
                            className="px-3 py-2 border rounded-md text-sm bg-white dark:bg-slate-700 dark:border-slate-600 min-h-[40px]"
                            value={questionsFilter.stage}
                            onChange={(e) => setQuestionsFilter(prev => ({ ...prev, stage: e.target.value }))}
                          >
                            <option value="all_stages">All Stages</option>
                            <option value="screening">Screening</option>
                            <option value="first_round">First Round</option>
                            <option value="technical">Technical</option>
                            <option value="final">Final</option>
                            <option value="hr">HR</option>
                            <option value="panel">Panel</option>
                          </select>
                          <select 
                            className="px-3 py-2 border rounded-md text-sm bg-white dark:bg-slate-700 dark:border-slate-600 min-h-[40px]"
                            value={questionsFilter.difficulty}
                            onChange={(e) => setQuestionsFilter(prev => ({ ...prev, difficulty: e.target.value }))}
                          >
                            <option value="all_difficulties">All Difficulties</option>
                            <option value="easy">Easy</option>
                            <option value="medium">Medium</option>
                            <option value="hard">Hard</option>
                          </select>
                          <Button 
                            variant="outline" 
                            size="sm" 
                            onClick={() => setQuestionsFilter({ type: '', stage: '', difficulty: '' })}
                            className="text-gray-600 dark:text-gray-300 dark:border-slate-600 min-h-[40px] w-full justify-center"
                          >
                            <RefreshCw className="h-4 w-4 mr-1" />
                            Clear
                          </Button>
                        </div>
                      </div>

                      {/* Questions List */}
                      {questionsLoading ? (
                        <div className="flex items-center justify-center py-12">
                          <Loader2 className="animate-spin h-8 w-8 text-purple-600 mr-3" />
                          <span className="text-gray-600">Loading interview questions...</span>
                        </div>
                      ) : interviewQuestions.length === 0 ? (
                        <div className="text-center py-12">
                          <div className="w-24 h-24 rounded-full bg-gradient-to-br from-purple-100 to-purple-200 flex items-center justify-center mb-6 mx-auto dark:from-purple-900/30 dark:to-purple-800/30">
                            <HelpCircle className="h-12 w-12 text-purple-600 dark:text-purple-400" />
                          </div>
                          <h3 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">🎯 Ready to interview?</h3>
                          <p className="text-lg text-gray-600 dark:text-gray-400 mb-6">
                            Create interview questions to help evaluate candidates for this position.
                          </p>
                          <div className="flex flex-wrap justify-center gap-3">
                            <Button 
                              onClick={() => setShowAdvancedGenerator(true)}
                              className="bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-700 hover:to-purple-800"
                            >
                              <Sparkles className="mr-2 h-5 w-5" />
                              Generate Advanced Questions
                            </Button>
                            <Button 
                              variant="outline" 
                              onClick={() => setShowCreateDialog(true)}
                              className="border-purple-200 text-purple-600 hover:bg-purple-50 dark:border-purple-700 dark:text-purple-300 dark:hover:bg-purple-900/20"
                            >
                              <Plus className="mr-2 h-4 w-4" />
                              Create Question
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {/* Action Buttons Row */}
                          <div className="flex items-center justify-between gap-3 pb-4 border-b">
                            <div className="text-sm text-gray-600 dark:text-gray-400">
                              Showing {interviewQuestions.length} question{interviewQuestions.length !== 1 ? 's' : ''}
                            </div>
                            <div className="flex items-center gap-2">
                              <Button 
                                variant="outline"
                                size="sm"
                                onClick={() => setShowAdvancedGenerator(true)}
                                className="min-h-[40px] border-purple-200 text-purple-600 hover:bg-purple-50"
                              >
                                <Sparkles className="h-4 w-4 mr-2" />
                                Generate Advanced Questions
                              </Button>
                              <Button 
                                variant="outline"
                                size="sm"
                                onClick={() => setShowCreateDialog(true)}
                                className="min-h-[40px]"
                              >
                                <Plus className="h-4 w-4 mr-2" />
                                Create Question
                              </Button>
                              <Button 
                                variant="ghost" 
                                size="sm" 
                                onClick={fetchInterviewQuestions}
                                className="text-purple-600 hover:text-purple-700 dark:text-purple-400 dark:hover:text-purple-300 min-h-[44px] px-3"
                              >
                                <RefreshCw className="h-4 w-4 mr-1" />
                                Refresh
                              </Button>
                            </div>
                          </div>

                          {interviewQuestions.map((question) => (
                            <Card key={question._id} className="border border-gray-200 hover:border-purple-300 transition-colors dark:border-slate-700 dark:hover:border-purple-600">
                              <CardContent className="p-6">
                                <div className="flex items-start justify-between gap-4">
                                  <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-2">
                                      <Badge 
                                        variant={question.type === 'technical' ? 'default' : 'secondary'}
                                        className={
                                          question.type === 'technical' ? 'bg-blue-100 text-blue-700' :
                                          question.type === 'behavioral' ? 'bg-green-100 text-green-700' :
                                          question.type === 'situational' ? 'bg-yellow-100 text-yellow-700' :
                                          'bg-gray-100 text-gray-700'
                                        }
                                      >
                                        {question.type.replace('_', ' ').toUpperCase()}
                                      </Badge>
                                      <Badge variant="outline" className="text-xs">
                                        {question.interviewStage.replace('_', ' ').toUpperCase()}
                                      </Badge>
                                      <Badge 
                                        variant="outline" 
                                        className={
                                          question.difficulty === 'easy' ? 'border-green-300 text-green-700' :
                                          question.difficulty === 'medium' ? 'border-yellow-300 text-yellow-700' :
                                          'border-red-300 text-red-700'
                                        }
                                      >
                                        {question.difficulty.toUpperCase()}
                                      </Badge>
                                      {question.isAIGenerated && (
                                        <Badge variant="outline" className="border-purple-300 text-purple-700 text-xs">
                                          <Lightbulb className="h-3 w-3 mr-1" />
                                          AI Generated
                                        </Badge>
                                      )}
                                    </div>
                                    <h4 className="font-semibold text-gray-900 dark:text-gray-100 mb-2 text-lg">
                                      {question.question}
                                    </h4>
                                    {question.expectedAnswer && (
                                      <div className="mt-3 p-3 bg-gray-50 dark:bg-slate-700/50 rounded-lg">
                                        <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Expected Answer:</p>
                                        <p className="text-sm text-gray-600 dark:text-gray-400">{question.expectedAnswer}</p>
                                      </div>
                                    )}
                                    {question.category && (
                                      <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">Category: {question.category}</p>
                                    )}
                                    
                                    {/* Quality Metrics Display */}
                                    <div className="mt-4">
                                      <QuestionQualityDisplay
                                        question={question}
                                        qualityAnalysis={qualityAnalyses[question._id]}
                                        onAnalyze={() => handleAnalyzeQuestion(question._id)}
                                        isAnalyzing={analyzingQuestions.has(question._id)}
                                      />
                                    </div>
                                  </div>
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button variant="ghost" size="sm" className="min-h-[44px] min-w-[44px] p-2">
                                        <MoreHorizontal className="h-4 w-4" />
                                        <span className="sr-only">Question actions</span>
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                      <DropdownMenuItem onClick={() => setEditingQuestion(question)}>
                                        <Edit className="mr-2 h-4 w-4" />
                                        Edit
                                      </DropdownMenuItem>
                                      <DropdownMenuSeparator />
                                      <DropdownMenuItem 
                                        onClick={() => handleDeleteQuestion(question._id)}
                                        className="text-red-600 focus:text-red-600"
                                      >
                                        <Trash className="mr-2 h-4 w-4" />
                                        Delete
                                      </DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                </div>
                              </CardContent>
                            </Card>
                                                     ))}
                         </div>
                       )}
                     </CardContent>
                   </Card>

                   {/* Edit Question Dialog */}
                   <Dialog open={!!editingQuestion} onOpenChange={(open) => !open && setEditingQuestion(null)}>
                     <DialogContent className="sm:max-w-lg mx-3 max-w-[calc(100vw-24px)] max-h-[90vh] overflow-y-auto">
                       <DialogHeader>
                         <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
                           <Edit className="h-5 w-5 text-purple-600 flex-shrink-0" />
                           <span className="truncate">Edit Interview Question</span>
                         </DialogTitle>
                         <DialogDescription className="text-sm">
                           Modify the interview question details.
                         </DialogDescription>
                       </DialogHeader>
                       {editingQuestion && (
                         <div className="space-y-4">
                           <div>
                             <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Question</label>
                            <Textarea 
                              placeholder="Enter your interview question..."
                              className="w-full mt-1 min-h-[120px]"
                              rows={5}
                              value={editingQuestion?.question}
                              onChange={(e) => setEditingQuestion(prev => prev ? { ...prev, question: e.target.value } : null)}
                            />
                           </div>
                           <div className="grid grid-cols-2 gap-4">
                             <div>
                               <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Type</label>
                               <select 
                                 className="w-full mt-1 p-2 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-700 text-gray-900 dark:text-gray-100"
                                 value={editingQuestion?.type}
                                 onChange={(e) => setEditingQuestion(prev => prev ? { ...prev, type: e.target.value as any } : null)}
                               >
                                 <option value="general">General</option>
                                 <option value="technical">Technical</option>
                                 <option value="behavioral">Behavioral</option>
                                 <option value="situational">Situational</option>
                                 <option value="cultural_fit">Cultural Fit</option>
                                 <option value="skills_based">Skills Based</option>
                                 <option value="experience_based">Experience Based</option>
                               </select>
                             </div>
                             <div>
                               <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Difficulty</label>
                               <select 
                                 className="w-full mt-1 p-2 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-700 text-gray-900 dark:text-gray-100"
                                 value={editingQuestion?.difficulty}
                                 onChange={(e) => setEditingQuestion(prev => prev ? { ...prev, difficulty: e.target.value as any } : null)}
                               >
                                 <option value="easy">Easy</option>
                                 <option value="medium">Medium</option>
                                 <option value="hard">Hard</option>
                               </select>
                             </div>
                           </div>
                           <div>
                             <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Interview Stage</label>
                             <select 
                               className="w-full mt-1 p-2 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-700 text-gray-900 dark:text-gray-100"
                               value={editingQuestion?.interviewStage}
                               onChange={(e) => setEditingQuestion(prev => prev ? { ...prev, interviewStage: e.target.value as any } : null)}
                             >
                               <option value="screening">Screening</option>
                               <option value="first_round">First Round</option>
                               <option value="technical">Technical</option>
                               <option value="final">Final</option>
                               <option value="hr">HR</option>
                               <option value="panel">Panel</option>
                             </select>
                           </div>
                           <div>
                             <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Expected Answer (Optional)</label>
                            <Textarea 
                              placeholder="Guidelines for what constitutes a good answer..."
                              className="w-full mt-1 min-h-[100px]"
                              rows={4}
                              value={editingQuestion?.expectedAnswer || ''}
                              onChange={(e) => setEditingQuestion(prev => prev ? { ...prev, expectedAnswer: e.target.value } : null)}
                            />
                           </div>
                         </div>
                       )}
                       <DialogFooter className="flex-col sm:flex-row gap-3 sm:gap-2 mt-6">
                         <Button variant="outline" onClick={() => setEditingQuestion(null)} className="w-full sm:w-auto order-2 sm:order-1">
                           Cancel
                         </Button>
                         <Button 
                           onClick={() => editingQuestion && handleUpdateQuestion(editingQuestion?._id, {
                             question: editingQuestion?.question,
                             type: editingQuestion?.type,
                             difficulty: editingQuestion?.difficulty,
                             interviewStage: editingQuestion?.interviewStage,
                             expectedAnswer: editingQuestion?.expectedAnswer,
                           })}
                           className="w-full sm:w-auto bg-purple-600 hover:bg-purple-700 order-1 sm:order-2"
                         >
                           <Edit className="mr-2 h-4 w-4" />
                           Update Question
                         </Button>
                       </DialogFooter>
                     </DialogContent>
                   </Dialog>

                   {/* Create Question Dialog */}
                   <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
                     <DialogContent className="sm:max-w-lg mx-3 max-w-[calc(100vw-24px)] max-h-[90vh] overflow-y-auto">
                       <DialogHeader>
                         <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
                           <Plus className="h-5 w-5 text-purple-600 flex-shrink-0" />
                           <span className="truncate">Create Interview Question</span>
                         </DialogTitle>
                         <DialogDescription className="text-sm">
                           Add a new interview question for this position.
                         </DialogDescription>
                       </DialogHeader>
                       <div className="space-y-4">
                         <div>
                           <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Question *</label>
                          <Textarea 
                            placeholder="Enter your interview question..."
                            className="w-full mt-1 min-h-[120px]"
                            rows={5}
                            value={newQuestion.question}
                            onChange={(e) => setNewQuestionForm(prev => ({ ...prev, question: e.target.value }))}
                          />
                         </div>
                         <div className="grid grid-cols-2 gap-4">
                           <div>
                             <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Type</label>
                             <select 
                               className="w-full mt-1 p-2 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-700 text-gray-900 dark:text-gray-100"
                               value={newQuestion.type}
                               onChange={(e) => setNewQuestionForm(prev => ({ ...prev, type: e.target.value as any }))}
                             >
                               <option value="general">General</option>
                               <option value="technical">Technical</option>
                               <option value="behavioral">Behavioral</option>
                               <option value="situational">Situational</option>
                               <option value="cultural_fit">Cultural Fit</option>
                               <option value="skills_based">Skills Based</option>
                               <option value="experience_based">Experience Based</option>
                             </select>
                           </div>
                           <div>
                             <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Difficulty</label>
                             <select 
                               className="w-full mt-1 p-2 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-700 text-gray-900 dark:text-gray-100"
                               value={newQuestion.difficulty}
                               onChange={(e) => setNewQuestionForm(prev => ({ ...prev, difficulty: e.target.value as any }))}
                             >
                               <option value="easy">Easy</option>
                               <option value="medium">Medium</option>
                               <option value="hard">Hard</option>
                             </select>
                           </div>
                         </div>
                         <div>
                           <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Interview Stage</label>
                           <select 
                             className="w-full mt-1 p-2 border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-700 text-gray-900 dark:text-gray-100"
                             value={newQuestion.interviewStage}
                             onChange={(e) => setNewQuestionForm(prev => ({ ...prev, interviewStage: e.target.value as any }))}
                           >
                             <option value="screening">Screening</option>
                             <option value="first_round">First Round</option>
                             <option value="technical">Technical</option>
                             <option value="final">Final</option>
                             <option value="hr">HR</option>
                             <option value="panel">Panel</option>
                           </select>
                         </div>
                         <div>
                           <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Category (Optional)</label>
                           <Input 
                             placeholder="e.g., Problem Solving, Communication..."
                             className="w-full mt-1"
                             value={newQuestion.category || ''}
                             onChange={(e) => setNewQuestionForm(prev => ({ ...prev, category: e.target.value }))}
                           />
                         </div>
                         <div>
                           <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Expected Answer (Optional)</label>
                          <Textarea 
                            placeholder="Guidelines for what constitutes a good answer..."
                            className="w-full mt-1 min-h-[100px]"
                            rows={4}
                            value={newQuestion.expectedAnswer || ''}
                            onChange={(e) => setNewQuestionForm(prev => ({ ...prev, expectedAnswer: e.target.value }))}
                          />
                         </div>
                         <div>
                           <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Time Limit (Optional)</label>
                           <Input 
                             type="number"
                             placeholder="Time in minutes"
                             className="w-full mt-1"
                             value={newQuestion.timeLimit || ''}
                             onChange={(e) => setNewQuestionForm(prev => ({ ...prev, timeLimit: e.target.value ? parseInt(e.target.value) : undefined }))}
                           />
                         </div>
                       </div>
                       <DialogFooter className="flex-col sm:flex-row gap-3 sm:gap-2 mt-6">
                         <Button variant="outline" onClick={() => setShowCreateDialog(false)} className="w-full sm:w-auto order-2 sm:order-1">
                           Cancel
                         </Button>
                         <Button 
                           onClick={handleCreateQuestion}
                           className="w-full sm:w-auto bg-purple-600 hover:bg-purple-700 order-1 sm:order-2"
                           disabled={!newQuestion.question.trim()}
                         >
                           <Plus className="mr-2 h-4 w-4" />
                           Create Question
                         </Button>
                       </DialogFooter>
                     </DialogContent>
                   </Dialog>
                </TabsContent>

                <TabsContent value="hiring-pipeline" className="space-y-3 sm:space-y-4">
                  <Tabs value={hiringPipelineTab} onValueChange={setHiringPipelineTab} className="hiring-pipeline-tabs">
                    <TabsList className="flex w-full bg-white dark:bg-slate-900 p-1 rounded-xl shadow-lg border border-slate-200 dark:border-slate-700 gap-1 mb-6" data-tutorial="pipeline-tabs">
                      <TabsTrigger 
                        value="board" 
                        className="flex-1 flex items-center justify-center h-11 sm:h-12 font-medium rounded-lg transition-all duration-200 data-[state=active]:bg-gradient-to-r data-[state=active]:from-blue-500 data-[state=active]:to-indigo-600 data-[state=active]:text-white data-[state=active]:shadow-md hover:bg-slate-100 dark:hover:bg-slate-800 group"
                      >
                        <div className="flex items-center gap-2">
                          <Workflow className="h-6 w-6 sm:h-5 sm:w-5 flex-shrink-0 transition-transform group-data-[state=active]:scale-110" />
                          <span className="hidden sm:inline text-sm font-semibold">Board</span>
                        </div>
                      </TabsTrigger>
                      <TabsTrigger 
                        value="configuration" 
                        className="flex-1 flex items-center justify-center h-11 sm:h-12 font-medium rounded-lg transition-all duration-200 data-[state=active]:bg-gradient-to-r data-[state=active]:from-blue-500 data-[state=active]:to-indigo-600 data-[state=active]:text-white data-[state=active]:shadow-md hover:bg-slate-100 dark:hover:bg-slate-800 group"
                      >
                        <div className="flex items-center gap-2">
                          <Settings className="h-6 w-6 sm:h-5 sm:w-5 flex-shrink-0 transition-transform group-data-[state=active]:scale-110" />
                          <span className="hidden sm:inline text-sm font-semibold">Configuration</span>
                        </div>
                      </TabsTrigger>
                      <TabsTrigger 
                        value="email-settings" 
                        className="flex-1 flex items-center justify-center h-11 sm:h-12 font-medium rounded-lg transition-all duration-200 data-[state=active]:bg-gradient-to-r data-[state=active]:from-blue-500 data-[state=active]:to-indigo-600 data-[state=active]:text-white data-[state=active]:shadow-md hover:bg-slate-100 dark:hover:bg-slate-800 group"
                      >
                        <div className="flex items-center gap-2">
                          <Mail className="h-6 w-6 sm:h-5 sm:w-5 flex-shrink-0 transition-transform group-data-[state=active]:scale-110" />
                          <span className="hidden sm:inline text-sm font-semibold">Email Settings</span>
                        </div>
                      </TabsTrigger>
                    </TabsList>

                    <TabsContent value="board" className="mt-0">
                      <div className="space-y-4 sm:space-y-6">
                        <Card className="border-0 bg-white/70 dark:bg-slate-800/60 backdrop-blur-xl shadow-sm dark:shadow-xl dark:border-slate-700">
                          <CardContent className="p-4 sm:p-5">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                              <div className="min-w-0">
                                <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                                  <Mail className="h-4 w-4 sm:h-5 sm:w-5 text-orange-500 flex-shrink-0" />
                                  <span className="truncate">Pipeline Rejection Center</span>
                                </h3>
                                <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                                  Reject selected candidates or reject everyone in a chosen stage from one place.
                                </p>
                              </div>
                              <Button
                                onClick={() => setShowBulkRejectionDialog(true)}
                                className="w-full sm:w-auto bg-gradient-to-r from-orange-600 to-red-600 hover:from-orange-700 hover:to-red-700"
                              >
                                <Send className="h-4 w-4 mr-2" />
                                Manage Rejections
                                {candidateCount > 0 && (
                                  <Badge className="ml-2 bg-white/20 text-white border-white/30">
                                    {candidateCount}
                                  </Badge>
                                )}
                              </Button>
                            </div>
                          </CardContent>
                        </Card>

                        <PipelineWithTabs
                          jobId={jobData?._id}
                          jobTitle={jobData?.title}
                          refreshTrigger={analyticsRefreshTrigger}
                          onCandidateSelect={handleCandidateSelect}
                          onStageUpdate={handleStagesUpdate}
                          onNavigateToStages={() => setHiringPipelineTab('configuration')}
                        />
                      </div>
                    </TabsContent>

                    <TabsContent value="configuration" className="mt-0">
                      <Card className="border-0 bg-white/60 dark:bg-slate-800/60 backdrop-blur-xl shadow-lg dark:shadow-2xl dark:border-slate-700">
                        <CardHeader className="bg-gradient-to-r from-indigo-600 to-indigo-700 text-white rounded-t-lg px-4 sm:px-6" data-tutorial="job-settings">
                          <CardTitle className="text-lg sm:text-xl font-semibold flex items-center gap-2">
                            <Settings className="h-5 w-5 flex-shrink-0" />
                            <span className="truncate">Stage Configuration</span>
                          </CardTitle>
                          <CardDescription className="text-indigo-100 text-sm">
                            Set up and manage interview stages for this position
                          </CardDescription>
                        </CardHeader>
                        <CardContent className="p-4 sm:p-6">
                          <InterviewStageConfiguration
                            jobId={jobData?._id}
                            onStagesUpdate={() => {
                              handleStagesUpdate()
                              // Optionally switch to board view after updating
                              // setHiringPipelineTab('board')
                            }}
                          />
                        </CardContent>
                      </Card>
                    </TabsContent>

                    <TabsContent value="email-settings" className="mt-0">
                      <Card className="border-0 bg-white/60 dark:bg-slate-800/60 backdrop-blur-xl shadow-lg dark:shadow-2xl dark:border-slate-700">
                        <CardHeader className="bg-gradient-to-r from-sky-500 to-blue-600 text-white rounded-t-lg px-4 sm:px-6">
                          <CardTitle className="text-lg sm:text-xl font-semibold flex items-center gap-2">
                            <Mail className="h-5 w-5 flex-shrink-0" />
                            <span className="truncate">Email Settings</span>
                          </CardTitle>
                          <CardDescription className="text-blue-100 text-sm">
                            Configure email notification templates and behavior for this job
                          </CardDescription>
                        </CardHeader>
                        <CardContent className="p-4 sm:p-6">
                          <JobEmailSettings
                            jobId={jobData?._id || ''}
                            jobTitle={jobData?.title || 'Job'}
                            onSettingsChange={(settings) => {
                              console.log('Email settings updated:', settings)
                            }}
                          />
                        </CardContent>
                      </Card>
                    </TabsContent>
                  </Tabs>
                </TabsContent>

                <TabsContent value="interviews" className="space-y-3 sm:space-y-4">
                  <Tabs value={interviewsTab} onValueChange={setInterviewsTab} className="interviews-tabs">
                    <TabsList className="interviews-tabs-list" data-tutorial="interviews-pipeline">
                      <TabsTrigger 
                        value="overview" 
                        className="interviews-tab-trigger data-[state=active]:!bg-white data-[state=active]:!text-[#059669]"
                      >
                        <Calendar className="h-4 w-4 mr-2 flex-shrink-0" />
                        <span>Overview</span>
                      </TabsTrigger>
                      <TabsTrigger 
                        value="setup" 
                        className="interviews-tab-trigger data-[state=active]:!bg-white data-[state=active]:!text-[#059669]"
                      >
                        <Plus className="h-4 w-4 mr-2 flex-shrink-0" />
                        <span>Setup Interview</span>
                      </TabsTrigger>
                      <TabsTrigger 
                        value="feedback-form" 
                        className="interviews-tab-trigger data-[state=active]:!bg-white data-[state=active]:!text-[#059669]"
                      >
                        <MessageSquare className="h-4 w-4 mr-2 flex-shrink-0" />
                        <span>Feedback Form</span>
                      </TabsTrigger>
                    </TabsList>

                    <TabsContent value="overview" className="mt-0">
                      <Card className="border-0 bg-white/60 dark:bg-slate-800/60 backdrop-blur-xl shadow-lg dark:shadow-2xl dark:border-slate-700">
                        <CardHeader className="bg-gradient-to-r from-emerald-600 to-emerald-700 text-white rounded-t-lg px-4 sm:px-6">
                          <CardTitle className="text-lg sm:text-xl font-semibold flex items-center gap-2">
                            <Calendar className="h-5 w-5 flex-shrink-0" />
                            <span className="truncate">Interview Overview</span>
                          </CardTitle>
                          <CardDescription className="text-emerald-100 text-sm">
                            All interviews scheduled for this position
                          </CardDescription>
                        </CardHeader>
                        <CardContent className="p-4 sm:p-6">
                      {interviewsLoading ? (
                        <div className="flex items-center justify-center py-8">
                          <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
                          <span className="ml-2 text-gray-600">Loading interviews...</span>
                        </div>
                      ) : jobInterviews.length === 0 ? (
                        <div className="text-center py-12">
                          <div className="w-24 h-24 rounded-full bg-gradient-to-br from-emerald-100 to-emerald-200 flex items-center justify-center mb-6 mx-auto dark:from-emerald-900/30 dark:to-emerald-800/30">
                            <Calendar className="h-12 w-12 text-emerald-600 dark:text-emerald-400" />
                          </div>
                          <h3 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">No interviews yet</h3>
                          <p className="text-lg text-gray-600 dark:text-gray-400 mb-6">
                            Schedule your first interview to get started.
                          </p>
                          <Button 
                            onClick={() => setInterviewsTab('setup')}
                            className="bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-700 hover:to-emerald-800"
                          >
                            <Plus className="mr-2 h-5 w-5" />
                            Setup Interview
                          </Button>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          <div className="flex items-center justify-between mb-4">
                            <div className="text-sm text-gray-600 dark:text-gray-400">
                              Showing {jobInterviews.length} interview{jobInterviews.length !== 1 ? 's' : ''}
                            </div>
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              onClick={fetchJobInterviews}
                              className="text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300 min-h-[44px] px-3"
                            >
                              <RefreshCw className="h-4 w-4 mr-1" />
                              Refresh
                            </Button>
                          </div>

                          {/* Interview History */}
                          <div className="space-y-3">
                            <h4 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
                              Interview History
                            </h4>
                            {jobInterviews
                              .sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime())
                              .map((interview) => {
                                const scheduledDate = new Date(interview.scheduledAt);
                                const candidateName = interview.candidateId?.firstName && interview.candidateId?.lastName 
                                  ? `${interview.candidateId.firstName} ${interview.candidateId.lastName}`
                                  : interview.candidateId?.email || 'Unknown Candidate';
                                
                                return (
                                  <Card key={interview._id} className="border border-gray-200 hover:border-emerald-300 transition-colors dark:border-slate-700 dark:hover:border-emerald-600">
                                    <CardContent className="p-4">
                                      <div className="flex items-center justify-between">
                                        <div className="flex-1">
                                          <div className="flex items-center gap-3 mb-2">
                                            <div className="flex items-center gap-2">
                                              <div className={`w-3 h-3 rounded-full ${
                                                interview.status === 'scheduled' || interview.status === 'confirmed' 
                                                  ? 'bg-blue-500' 
                                                  : interview.status === 'completed' 
                                                    ? 'bg-green-500'
                                                    : interview.status === 'cancelled'
                                                      ? 'bg-red-500'
                                                      : 'bg-gray-400'
                                              }`} />
                                              <h5 className="font-medium text-gray-900 dark:text-gray-100">
                                                {interview.title || `Interview - ${candidateName}`}
                                              </h5>
                                            </div>
                                            <Badge variant={interview.status === 'completed' ? 'default' : 'secondary'}>
                                              {interview.status}
                                            </Badge>
                                          </div>
                                          <div className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                                            <div className="flex items-center gap-4">
                                              <span className="flex items-center gap-1">
                                                <Users className="h-4 w-4" />
                                                {candidateName}
                                              </span>
                                              <span className="flex items-center gap-1">
                                                <Clock className="h-4 w-4" />
                                                {scheduledDate.toLocaleDateString()} at {scheduledDate.toLocaleTimeString()}
                                              </span>
                                              <span className="flex items-center gap-1">
                                                <Calendar className="h-4 w-4" />
                                                {interview.duration} min
                                              </span>
                                            </div>
                                          </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                          <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => window.open(`/interviews/${interview._id}/transcript?from=jobs&jobId=${jobData?._id}`, '_blank')}
                                          >
                                            View
                                          </Button>
                                        </div>
                                      </div>
                                    </CardContent>
                                  </Card>
                                );
                              })}
                          </div>
                        </div>
                      )}
                        </CardContent>
                      </Card>
                    </TabsContent>

                    <TabsContent value="setup" className="mt-0">
                      <InterviewSetupTab
                        jobId={jobData?._id}
                        jobTitle={jobData?.title}
                        stages={interviewStages}
                        loadingStages={stagesLoading}
                        onInterviewScheduled={() => {
                          setInterviewsTab('overview')
                          fetchJobInterviews()
                          handleAnalyticsUpdate()
                        }}
                        onNavigateToShortlist={() => {
                          setActiveTab('candidates')
                          setCandidatesTab('shortlist')
                        }}
                      />
                    </TabsContent>

                    <TabsContent value="feedback-form" className="mt-0">
                      <Card className="border-0 bg-white/60 dark:bg-slate-800/60 backdrop-blur-xl shadow-lg dark:shadow-2xl dark:border-slate-700">
                        <CardHeader className="bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-t-lg px-4 sm:px-6">
                          <CardTitle className="text-lg sm:text-xl font-semibold flex items-center gap-2">
                            <MessageSquare className="h-5 w-5 flex-shrink-0" />
                            <span className="truncate">Feedback Form Management</span>
                          </CardTitle>
                          <CardDescription className="text-purple-100 text-sm">
                            Configure job settings and manage organization templates & custom fields
                          </CardDescription>
                        </CardHeader>
                        <CardContent className="p-4 sm:p-6">
                          <FeedbackFormSettings jobId={jobData?._id || ''} />
                        </CardContent>
                      </Card>
                    </TabsContent>
                  </Tabs>
                </TabsContent>

                {/* Insights Tab - Merged Analytics & Rankings */}
                <TabsContent value="insights" className="space-y-3 sm:space-y-4">
                  <Tabs value={insightsTab} onValueChange={setInsightsTab} className="insights-tabs">
                    <TabsList className="insights-tabs-list">
                      <TabsTrigger 
                        value="analytics" 
                        className="insights-tab-trigger data-[state=active]:!bg-white data-[state=active]:!text-[#3B82F6]"
                      >
                        <BarChart3 className="h-4 w-4 mr-2 flex-shrink-0" />
                        <span>Analytics</span>
                      </TabsTrigger>
                      <TabsTrigger 
                        value="rankings" 
                        className="insights-tab-trigger data-[state=active]:!bg-white data-[state=active]:!text-[#7C3AED]"
                      >
                        <Trophy className="h-4 w-4 mr-2 flex-shrink-0" />
                        <span>Rankings</span>
                      </TabsTrigger>
                    </TabsList>

                    {/* Analytics Sub-Tab */}
                    <TabsContent value="analytics" className="mt-0 space-y-3 sm:space-y-4">
                      {/* Mobile-Responsive Key Metrics Grid */}
                      <ResponsiveGrid 
                        cols={{ mobile: 2, tablet: 2, desktop: 4 }}
                        gap="sm"
                        className="mb-4 sm:mb-6"
                      >
                        <MobileStatCard
                          title="Applicants"
                          value={jobData?.applicantCount || 0}
                          icon={<Users className="h-4 w-4 text-blue-600" />}
                          trend="up"
                          subtitle="Total applications"
                        />
                        
                        <MobileStatCard
                          title="Days Active"
                          value={jobData?.createdAt ? Math.ceil((new Date().getTime() - new Date(jobData?.createdAt).getTime()) / (1000 * 60 * 60 * 24)) : 0}
                          icon={<Calendar className="h-4 w-4 text-purple-600" />}
                          trend="neutral"
                          subtitle="Since posting"
                        />

                        <MobileStatCard
                          title="Questions"
                          value={interviewQuestions.length}
                          icon={<HelpCircle className="h-4 w-4 text-green-600" />}
                          trend="up"
                          subtitle="Interview ready"
                        />
                        
                        <MobileStatCard
                          title="Openings"
                          value={jobData?.openings || 1}
                          icon={<Building className="h-4 w-4 text-orange-600" />}
                          trend="neutral"
                          subtitle="Available positions"
                        />
                      </ResponsiveGrid>

                      {/* Advanced Pipeline Analytics */}
                      <div>
                      <ResponsiveCard
                        title="Advanced Pipeline Analytics"
                        subtitle="Comprehensive insights and AI-powered analytics for your hiring pipeline"
                        icon={<BarChart className="h-5 w-5" />}
                        variant="gradient"
                        size="lg"
                        mobileFullWidth
                        data-tutorial="job-analytics"
                      >
                          <PipelineAnalyticsEnhanced
                            jobId={jobData?._id}
                            refreshTrigger={analyticsRefreshTrigger}
                          />
                        </ResponsiveCard>
                      </div>

                      {/* Performance Indicators */}
                      <ResponsiveCard
                        title="Performance Indicators"
                        subtitle="Real-time hiring metrics and insights"
                        icon={<BarChart className="h-5 w-5" />}
                        variant="gradient"
                        mobileFullWidth
                      >
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
                          <div className="text-center p-4 sm:p-6 rounded-xl bg-white dark:bg-slate-800 shadow-sm">
                            <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center mx-auto mb-3 sm:mb-4">
                              <Users className="h-6 w-6 sm:h-8 sm:w-8 text-white" />
                            </div>
                            <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">Application Rate</h3>
                            <p className="text-2xl sm:text-3xl font-bold text-blue-600 mb-1">
                              {jobData?.createdAt ? 
                                Math.round((jobData?.applicantCount || 0) / Math.max(1, Math.ceil((new Date().getTime() - new Date(jobData?.createdAt).getTime()) / (1000 * 60 * 60 * 24)))) 
                                : 0}
                            </p>
                            <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">applications per day</p>
                          </div>
                          
                          <div className="text-center p-4 sm:p-6 rounded-xl bg-white dark:bg-slate-800 shadow-sm">
                            <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-full bg-gradient-to-br from-green-500 to-green-600 flex items-center justify-center mx-auto mb-3 sm:mb-4">
                              <CheckCircle className="h-6 w-6 sm:h-8 sm:w-8 text-white" />
                            </div>
                            <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">Job Readiness</h3>
                            <p className="text-2xl sm:text-3xl font-bold text-green-600 mb-1">
                              {Math.round(((jobData?.description ? 25 : 0) + 
                                         (jobData?.requirements ? 25 : 0) + 
                                         (jobData?.responsibilities ? 25 : 0) + 
                                         (interviewQuestions.length > 0 ? 25 : 0)))}%
                            </p>
                            <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">completeness score</p>
                          </div>
                          
                          <div className="text-center p-4 sm:p-6 rounded-xl bg-white dark:bg-slate-800 shadow-sm">
                            <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-full bg-gradient-to-br from-purple-500 to-purple-600 flex items-center justify-center mx-auto mb-3 sm:mb-4">
                              <Star className="h-6 w-6 sm:h-8 sm:w-8 text-white" />
                            </div>
                            <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">Position Demand</h3>
                            <p className="text-2xl sm:text-3xl font-bold text-purple-600 mb-1">
                              {jobData?.openings > 1 ? 'High' : 'Standard'}
                            </p>
                            <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">
                              {jobData?.openings} position{jobData?.openings > 1 ? 's' : ''} available
                            </p>
                          </div>
                        </div>
                      </ResponsiveCard>
                    </TabsContent>

                    {/* Rankings Sub-Tab */}
                    <TabsContent value="rankings" className="mt-0">
                      <FeedbackLeaderboard jobId={jobData?._id || ''} />
                    </TabsContent>
                  </Tabs>
                </TabsContent>


                {/* Statistics tab removed - merged into insights */}

                              </Tabs>
          </div>
        </div>
      </ResponsiveContentLayout>

      {/* Email Settings Dialog */}
      <Dialog open={showEmailSettingsDialog} onOpenChange={setShowEmailSettingsDialog}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Email Settings</DialogTitle>
            <DialogDescription>
              Configure email notification settings for {jobData?.title || 'this job'}
            </DialogDescription>
          </DialogHeader>
          <JobEmailSettings
            jobId={jobData?._id || ''}
            jobTitle={jobData?.title || 'Job'}
            onSettingsChange={(settings) => {
              console.log('Email settings updated:', settings)
            }}
          />
        </DialogContent>
      </Dialog>

      {/* Pipeline Rejection Center Dialog */}
      <Dialog open={showBulkRejectionDialog} onOpenChange={setShowBulkRejectionDialog}>
        <DialogContent className="max-w-5xl w-[95vw] max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Pipeline Rejection Center</DialogTitle>
            <DialogDescription>
              Select individual pipeline candidates or reject everyone in a selected scope.
            </DialogDescription>
          </DialogHeader>
          <PipelineEmailManagementTab
            jobId={jobData?._id}
            jobTitle={jobData?.title}
            onEmailSent={() => {
              toast({
                title: "Emails sent successfully",
                description: "Rejection emails have been sent to the selected candidates.",
              })
              setAnalyticsRefreshTrigger(prev => prev + 1)
              setShowBulkRejectionDialog(false)
            }}
          />
        </DialogContent>
      </Dialog>
      
      {/* Advanced Question Generator */}
      <AdvancedQuestionGenerator
        isOpen={showAdvancedGenerator}
        onClose={() => setShowAdvancedGenerator(false)}
        onGenerate={handleAdvancedGenerate}
        onGenerateOptimized={handleOptimizedGenerate}
        isGenerating={isGenerating}
        jobTitle={jobData?.title}
      />

      {/* Credit Error Dialog */}
      <CreditErrorDialog 
        open={showCreditDialog} 
        onOpenChange={setShowCreditDialog} 
        error={creditError} 
      />

      {/* Public Job Dialog */}
      <PublicJobDialog
        open={showPublicJobDialog}
        onOpenChange={setShowPublicJobDialog}
        mode={publicDialogMode}
        jobData={jobData}
        creditInfo={creditInfo}
        onConfirm={handlePublicStatusUpdate}
        isLoading={isUpdatingPublicStatus}
      />

    </div>
  )
}

export default function JobDetailPage() {
  return <JobDetailInnerPage />
}
