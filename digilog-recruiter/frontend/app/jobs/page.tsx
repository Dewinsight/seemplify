"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import {
  Briefcase,
  Search,
  Filter,
  Plus,
  ChevronDown,
  MapPin,
  Clock,
  Users,
  Calendar,
  ArrowUpDown,
  MoreHorizontal,
  Eye,
  Edit,
  Trash,
  Download,
  Loader2,
  X,
  AlertTriangle,
  Bot,
  Trash2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Checkbox } from "@/components/ui/checkbox"
import { getAllJobs, deleteJob, bulkDeleteJobs, type JobData } from "@/services/jobService"
import { toast } from "@/components/ui/use-toast"
import { StatusToggle } from "@/components/ui/status-toggle"
import { decodeObjectHtmlEntities } from "@/utils/htmlDecode"
import { PageLoader, CardSkeleton, LoadingOverlay, ErrorState, EmptyState } from "@/components/ui/loading"
import { TourProvider, useTour, type StepType } from "@reactour/tour"

// Helper function to get department name
const getDepartmentName = (department: string | { _id: string; name: string }): string => {
  return typeof department === 'object' && department !== null ? department.name : department
}

// Job card component with stunning design
function JobCard({ 
  job, 
  onStatusChange, 
  onDelete 
}: { 
  job: JobData; 
  onStatusChange?: (jobId: string, newStatus: any) => void;
  onDelete?: (jobId: string) => void;
}) {
  const [isDeleting, setIsDeleting] = useState(false)

  const handleDelete = async () => {
    if (!onDelete) return
    
    setIsDeleting(true)
    try {
      await deleteJob(job._id)
      toast({
        title: "Job Deleted",
        description: `${job.title} has been successfully deleted.`,
      })
      onDelete(job._id)
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

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'from-emerald-500 to-teal-600'
      case 'draft': return 'from-amber-500 to-orange-600'
      case 'closed': return 'from-slate-500 to-gray-600'
      case 'paused': return 'from-blue-500 to-indigo-600'
      default: return 'from-gray-500 to-slate-600'
    }
  }

  const getStatusColorDark = (status: string) => {
    switch (status) {
      case 'active': return 'from-emerald-400 to-teal-500'
      case 'draft': return 'from-amber-400 to-orange-500'
      case 'closed': return 'from-slate-400 to-gray-500'
      case 'paused': return 'from-blue-400 to-indigo-500'
      default: return 'from-gray-400 to-slate-500'
    }
  }

  const getJobTypeIcon = (type: string) => {
    switch (type) {
      case 'Full-time': return '💼'
      case 'Part-time': return '⏰'
      case 'Contract': return '📝'
      case 'Internship': return '🎓'
      case 'Freelance': return '🌟'
      default: return '💼'
    }
  }

  return (
    <Link href={`/jobs/${job._id}`} className="block group">
      <Card className="relative overflow-hidden transition-all duration-300 hover:shadow-2xl hover:shadow-blue-500/25 dark:hover:shadow-blue-400/20 hover:-translate-y-1 border border-gray-200/50 dark:border-gray-700/50 bg-white dark:bg-gray-800 shadow-md cursor-pointer active:scale-[0.98]">
        {/* Status Indicator Bar */}
        <div className={`absolute top-0 left-0 w-full h-1 bg-gradient-to-r ${getStatusColor(job.status)}`} />
        
        {/* Card Content */}
        <div className="p-5 space-y-4">
          {/* Header: Icon + Title + Menu */}
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold text-lg shadow-md flex-shrink-0">
              {job.title.charAt(0).toUpperCase()}
            </div>
            
            <div className="flex-1 min-w-0">
              <h3 className="text-base font-bold text-gray-900 dark:text-gray-100 line-clamp-2 mb-2 leading-snug">
                {job.title}
              </h3>
              <div className="flex items-center gap-2">
                <Badge className="text-xs px-2 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border-0">
                  {getDepartmentName(job.department)}
                </Badge>
                <span className="text-xs text-gray-500">•</span>
                <span className="text-xs text-gray-600 dark:text-gray-400">{job.type}</span>
              </div>
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild onClick={(e) => e.preventDefault()}>
                <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-gray-100 dark:hover:bg-gray-700">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="bg-white dark:bg-gray-800">
                <DropdownMenuLabel>Actions</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href={`/jobs/${job._id}`} className="flex items-center gap-2">
                    <Eye className="h-4 w-4" />
                    View Details
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href={`/ai-interviews?jobId=${job._id}`} className="flex items-center gap-2">
                    <Bot className="h-4 w-4" />
                    Create AI Interview
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href={`/jobs/${job._id}/edit`} className="flex items-center gap-2">
                    <Edit className="h-4 w-4" />
                    Edit Job
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem 
                  onClick={(e) => { e.preventDefault(); handleDelete(); }}
                  disabled={isDeleting}
                  className="text-red-600 hover:text-red-700 hover:bg-red-50"
                >
                  {isDeleting ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Deleting...</> : <><Trash className="h-4 w-4 mr-2" />Delete</>}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Location + Applicants */}
          <div className="flex items-center gap-4 py-2.5 px-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <MapPin className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              <span className="text-sm text-gray-700 dark:text-gray-300 truncate">{job.location}</span>
            </div>
            <div className="w-px h-4 bg-gray-300 dark:bg-gray-600"></div>
            <div className="flex items-center gap-1.5">
              <Users className="h-4 w-4 text-purple-600 dark:text-purple-400" />
              <span className="text-sm font-bold text-gray-900 dark:text-gray-100">{job.applicantCount || 0}</span>
            </div>
          </div>
          
          {/* Progress Bar */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Progress</span>
              <span className="text-xs font-bold text-gray-900 dark:text-gray-100">
                {job.status === 'active' ? '75%' : job.status === 'draft' ? '25%' : '100%'}
              </span>
            </div>
            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
              <div 
                className={`h-2 rounded-full bg-gradient-to-r ${getStatusColor(job.status)} transition-all duration-500`}
                style={{ width: job.status === 'active' ? '75%' : job.status === 'draft' ? '25%' : '100%' }}
              />
            </div>
          </div>

          {/* Footer: Status + Date */}
          <div className="flex items-center justify-between pt-2 border-t border-gray-100 dark:border-gray-700/50">
            <Badge 
              className={`text-xs font-medium px-2.5 py-1 ${
                job.status === 'active' 
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                  : job.status === 'draft' 
                  ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                  : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
              }`}
            >
              {job.status}
            </Badge>
            <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
              <Calendar className="h-3 w-3" />
              <span>{job.createdAt ? new Date(job.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'Unknown'}</span>
            </div>
          </div>
      </div>
    </Card>
    </Link>
  )
}

function JobsInnerPage() {
  const TourPopover = ({ title, children }: { title: string; children: React.ReactNode }) => {
    const { currentStep, setCurrentStep, setIsOpen, steps } = useTour() as any
    const total = (steps?.length ?? 0)
    return (
      <div className="p-3 sm:p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm sm:text-base font-semibold text-gray-900">{title}</h3>
          <button className="text-gray-500 hover:text-gray-700" onClick={() => setIsOpen(false)} aria-label="Close">×</button>
        </div>
        <div className="text-sm text-gray-700 mb-3">{children}</div>
        <div className="flex items-center justify-between mt-2 gap-2">
          <button
            className="px-3 py-1.5 rounded border text-sm text-gray-700 hover:bg-gray-100"
            onClick={() => setCurrentStep(Math.max(0, (currentStep ?? 0) - 1))}
          >Prev</button>
          <div className="flex items-center gap-1">
            {Array.from({ length: total }).map((_, i) => (
              <span key={i} className={`h-2 w-2 rounded-full ${i === currentStep ? 'bg-blue-600' : 'bg-gray-300'}`}></span>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button className="px-2 py-1 text-xs text-gray-500 hover:text-gray-700" onClick={() => setIsOpen(false)}>Skip</button>
            <button
              className="px-3 py-1.5 rounded bg-blue-600 text-white text-sm hover:bg-blue-700"
              onClick={() => {
                if ((currentStep ?? 0) + 1 < total) setCurrentStep((currentStep ?? 0) + 1); else setIsOpen(false)
              }}
            >{(currentStep ?? 0) + 1 < total ? 'Next' : 'Done'}</button>
          </div>
        </div>
      </div>
    )
  }
  
  const [jobs, setJobs] = useState<JobData[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedTab, setSelectedTab] = useState("all")
  const [selectedDepartment, setSelectedDepartment] = useState("all")
  const [selectedLocation, setSelectedLocation] = useState("all")
  const [selectedType, setSelectedType] = useState("all")
  const [view, setView] = useState<"grid" | "table">("table")
  const [windowWidth, setWindowWidth] = useState<number>(0)
  
  // Handle responsiveness
  useEffect(() => {
    // Set initial window width
    setWindowWidth(window.innerWidth)
    
    // Set initial view based on screen size
    if (window.innerWidth < 768) {
      setView("grid")
    } else {
      setView("table")
    }
    
    // Update window width on resize
    const handleResize = () => {
      setWindowWidth(window.innerWidth)
    }
    
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])
  const [selectedJobs, setSelectedJobs] = useState<string[]>([])
  const [deletingJobs, setDeletingJobs] = useState<Set<string>>(new Set())
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc")
  
  // Delete confirmation modal state
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [jobToDelete, setJobToDelete] = useState<JobData | null>(null)

  const [isBulkProcessing, setIsBulkProcessing] = useState(false)
  
  // Get tour controls at the top level (not inside render)
  const { setCurrentStep, setIsOpen } = useTour()
  
  const handleBulkDeleteJobs = async () => {
    if (selectedJobs.length === 0) return
    const confirmed = window.confirm(`Delete ${selectedJobs.length} selected job(s)? This action cannot be undone.`)
    if (!confirmed) return
    try {
      setIsBulkProcessing(true)
      const res = await bulkDeleteJobs(selectedJobs)
      const failures = res.failures || []
      const successCount = res.deleted || 0
      if (successCount > 0) {
        setJobs(prev => prev.filter(j => !res.results.some(r => r.id === j._id && r.success)))
        setSelectedJobs([])
        toast({ title: "Jobs deleted", description: `Deleted ${successCount} job(s)` })
      }
      if (failures.length > 0) {
        const sample = failures.slice(0, 3).map(f => f.id).join(', ')
        toast({ title: "Some deletions failed", description: `Failed ${failures.length} job(s)` + (sample ? ` (e.g. ${sample})` : ''), variant: "destructive" })
      }
      await fetchJobs()
    } catch (err: any) {
      toast({ title: "Bulk delete failed", description: err?.message || 'Error', variant: "destructive" })
    } finally {
      setIsBulkProcessing(false)
    }
  }

  const fetchJobs = async () => {
    try {
      setLoading(true)
      setError(null)
      const jobsData = await getAllJobs()
      // Decode HTML entities in all jobs for display and calculate applicant count
      const decodedJobs = (jobsData || []).map(job => {
        const decoded = decodeObjectHtmlEntities(job)
        // Calculate total applicants: shortlist (excluding moved_to_pipeline) + pipeline
        const shortlistCount = decoded.shortlist?.filter((item: any) => item.status !== 'moved_to_pipeline').length || 0
        const pipelineCount = decoded.applicants?.length || 0
        decoded.applicantCount = shortlistCount + pipelineCount
        return decoded
      })
      setJobs(decodedJobs)
    } catch (error: any) {
      console.error('Error fetching jobs:', error)
      setError(error.message || "Failed to fetch jobs.")
      toast({
        title: "Error",
        description: error.message || "Failed to fetch jobs.",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchJobs()
  }, [])

  // Filter jobs based on search query and selected filters
  const filteredJobs = jobs.filter((job) => {
    // Search filter
    const searchLower = searchQuery.toLowerCase()
    const departmentName = getDepartmentName(job.department)
    const matchesSearch = !searchQuery || 
      job.title.toLowerCase().includes(searchLower) ||
      departmentName?.toLowerCase().includes(searchLower) ||
      job.location.toLowerCase().includes(searchLower) ||
      job.description?.toLowerCase().includes(searchLower)

    if (!matchesSearch) return false

    // Status filter
    if (selectedTab === "active" && job.status !== "active") return false
    if (selectedTab === "draft" && job.status !== "draft") return false
    if (selectedTab === "closed" && job.status !== "closed") return false

    // Filter by department
    if (selectedDepartment !== "all" && departmentName !== selectedDepartment) return false

    // Filter by location
    if (selectedLocation !== "all" && job.location !== selectedLocation) return false

    // Filter by type
    if (selectedType !== "all" && job.type !== selectedType) return false

    return true
  })

  // Get unique departments, locations, and types for filters
  const departments = Array.from(new Set(jobs.map((job) => getDepartmentName(job.department))))
  const locations = Array.from(new Set(jobs.map((job) => job.location)))
  const types = Array.from(new Set(jobs.map((job) => job.type)))

  // Handle select all checkbox
  const handleSelectAll = () => {
    if (selectedJobs.length === filteredJobs.length) {
      setSelectedJobs([])
    } else {
      setSelectedJobs(filteredJobs.map((job) => job._id))
    }
  }

  // Handle individual job selection
  const handleSelectJob = (jobId: string) => {
    if (selectedJobs.includes(jobId)) {
      setSelectedJobs(selectedJobs.filter((id) => id !== jobId))
    } else {
      setSelectedJobs([...selectedJobs, jobId])
    }
  }

  // Handle status change for jobs
  const handleStatusChange = (jobId: string, newStatus: any) => {
    setJobs(prevJobs => 
      prevJobs.map(job => 
        job._id === jobId ? { ...job, status: newStatus } : job
      )
    )
  }

  // Handle job deletion
  const handleJobDelete = (jobId: string) => {
    setJobs(prevJobs => prevJobs.filter(job => job._id !== jobId))
    // Also remove from selected jobs if it was selected
    setSelectedJobs(prev => prev.filter(id => id !== jobId))
  }
  
  // Handle delete confirmation
  const handleDeleteClick = (job: JobData) => {
    setJobToDelete(job)
    setDeleteModalOpen(true)
  }
  
  // Handle delete confirmation submit
  const handleConfirmDelete = async () => {
    if (!jobToDelete) return
    
    try {
      await deleteJob(jobToDelete._id)
      toast({
        title: "Job Deleted",
        description: `${jobToDelete.title} has been successfully deleted.`,
      })
      handleJobDelete(jobToDelete._id)
      setDeleteModalOpen(false)
      setJobToDelete(null)
    } catch (error: any) {
      toast({
        title: "Delete Failed",
        description: error.message || "Failed to delete the job.",
        variant: "destructive",
      })
    }
  }

  if (loading) {
    return <PageLoader variant="jobs" message="Loading job postings..." />
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-blue-50/30 dark:from-gray-950 dark:via-gray-900 dark:to-blue-950/30 p-3 sm:p-4 lg:p-8 jobs-container">
      <div className="max-w-7xl mx-auto space-y-4 sm:space-y-6 lg:space-y-8">
        {/* Header - Mobile Optimized */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 lg:gap-6">
          <div>
            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-gray-900 dark:text-gray-100 bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent job-page-title">
              Job Management
            </h1>
            <p className="text-sm sm:text-base lg:text-lg text-gray-600 dark:text-gray-400 mt-1 sm:mt-2 job-page-description">
              Manage your job postings and track applications
            </p>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <Button variant="outline" size="sm" className="hidden sm:flex" onClick={() => { setCurrentStep(0); setIsOpen(true) }}>
              Guided Tour
            </Button>
            <Button asChild size="sm" className="bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 shadow-lg hover:shadow-xl transition-all duration-200 w-full sm:w-auto" data-tutorial="create-job-btn">
              <Link href="/jobs/new">
                <Plus className="h-4 w-4 mr-2" />
                <span className="hidden sm:inline">Post New Job</span>
                <span className="sm:hidden">New Job</span>
              </Link>
            </Button>
          </div>
        </div>

        {/* Analytics Stats Cards - Mobile Optimized 2x2 Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <div className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-900/30 dark:to-blue-800/30 rounded-lg sm:rounded-xl p-3 sm:p-4 border border-blue-200 dark:border-blue-700 shadow-md hover:shadow-lg transition-shadow">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
              <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-blue-500 dark:bg-blue-600 flex items-center justify-center">
                <Briefcase className="h-4 w-4 sm:h-5 sm:w-5 text-white" />
              </div>
              <div>
                <p className="text-xs sm:text-sm font-medium text-blue-700 dark:text-blue-300">Total Jobs</p>
                <p className="text-xl sm:text-2xl font-bold text-blue-900 dark:text-blue-100">{jobs.length}</p>
              </div>
            </div>
          </div>
          <div className="bg-gradient-to-br from-emerald-50 to-emerald-100 dark:from-emerald-900/30 dark:to-emerald-800/30 rounded-lg sm:rounded-xl p-3 sm:p-4 border border-emerald-200 dark:border-emerald-700 shadow-md hover:shadow-lg transition-shadow">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
              <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-emerald-500 dark:bg-emerald-600 flex items-center justify-center">
                <Users className="h-4 w-4 sm:h-5 sm:w-5 text-white" />
              </div>
              <div>
                <p className="text-xs sm:text-sm font-medium text-emerald-700 dark:text-emerald-300">Active</p>
                <p className="text-xl sm:text-2xl font-bold text-emerald-900 dark:text-emerald-100">{jobs.filter(j => j.status === 'active').length}</p>
              </div>
            </div>
          </div>
          <div className="bg-gradient-to-br from-amber-50 to-amber-100 dark:from-amber-900/30 dark:to-amber-800/30 rounded-lg sm:rounded-xl p-3 sm:p-4 border border-amber-200 dark:border-amber-700 shadow-md hover:shadow-lg transition-shadow">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
              <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-amber-500 dark:bg-amber-600 flex items-center justify-center">
                <Clock className="h-4 w-4 sm:h-5 sm:w-5 text-white" />
              </div>
              <div>
                <p className="text-xs sm:text-sm font-medium text-amber-700 dark:text-amber-300">Drafts</p>
                <p className="text-xl sm:text-2xl font-bold text-amber-900 dark:text-amber-100">{jobs.filter(j => j.status === 'draft').length}</p>
              </div>
            </div>
          </div>
          <div className="bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-900/30 dark:to-purple-800/30 rounded-lg sm:rounded-xl p-3 sm:p-4 border border-purple-200 dark:border-purple-700 shadow-md hover:shadow-lg transition-shadow">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
              <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-purple-500 dark:bg-purple-600 flex items-center justify-center">
                <Calendar className="h-4 w-4 sm:h-5 sm:w-5 text-white" />
              </div>
              <div>
                <p className="text-xs sm:text-sm font-medium text-purple-700 dark:text-purple-300">Applications</p>
                <p className="text-xl sm:text-2xl font-bold text-purple-900 dark:text-purple-100">{jobs.reduce((acc, job) => acc + (job.applicantCount || 0), 0)}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Search and Filters Card */}
        <Card className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-xl border-gray-200/50 dark:border-gray-700/50 shadow-lg" data-tutorial="search-filter-section">
          <CardHeader className="p-4 sm:p-6">
            <div className="space-y-4">
              
              {/* Search Bar - Full Width on Mobile */}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400 dark:text-gray-500" />
                  <Input
                    placeholder="Search jobs..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 pr-10 w-full bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700"
                    data-tutorial="search-jobs"
                  />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
                </div>
              
              {/* Filters - Horizontal Scroll on Mobile */}
              <div className="flex items-center gap-2 overflow-x-auto pb-2 -mx-4 px-4 sm:mx-0 sm:px-0 sm:overflow-visible">
                <Select value={selectedTab} onValueChange={setSelectedTab}>
                  <SelectTrigger className="min-w-[120px] bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent className="bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
                    <SelectItem value="all" className="text-gray-900 dark:text-gray-100">All Status</SelectItem>
                    <SelectItem value="active" className="text-gray-900 dark:text-gray-100">Active</SelectItem>
                    <SelectItem value="draft" className="text-gray-900 dark:text-gray-100">Draft</SelectItem>
                    <SelectItem value="closed" className="text-gray-900 dark:text-gray-100">Closed</SelectItem>
                    <SelectItem value="paused" className="text-gray-900 dark:text-gray-100">Paused</SelectItem>
                  </SelectContent>
                </Select>
                
                <Select value={selectedDepartment} onValueChange={setSelectedDepartment}>
                  <SelectTrigger className="min-w-[120px] bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
                    <SelectValue placeholder="Department" />
                  </SelectTrigger>
                  <SelectContent className="bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
                    <SelectItem value="all" className="text-gray-900 dark:text-gray-100">All Departments</SelectItem>
                    {departments.map(dept => (
                      <SelectItem key={dept} value={dept} className="text-gray-900 dark:text-gray-100">{dept}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                
                <Select value={selectedLocation} onValueChange={setSelectedLocation}>
                  <SelectTrigger className="min-w-[120px] bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
                    <SelectValue placeholder="Location" />
                  </SelectTrigger>
                  <SelectContent className="bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
                    <SelectItem value="all" className="text-gray-900 dark:text-gray-100">All Locations</SelectItem>
                    {locations.map(loc => (
                      <SelectItem key={loc} value={loc} className="text-gray-900 dark:text-gray-100">{loc}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                
                <Button 
                  variant="outline" 
                  size="icon"
                  onClick={() => setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')}
                  className="border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 flex-shrink-0"
                  data-tutorial="sort-jobs"
                >
                  <ArrowUpDown className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-4 sm:p-6">
            {/* View Toggle - Hidden on Mobile */}
            {windowWidth >= 768 && (
            <Tabs value={view} onValueChange={(value: any) => setView(value)} className="mb-6">
              <TabsList className="bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                <TabsTrigger value="grid" className="data-[state=active]:bg-white dark:data-[state=active]:bg-gray-700 data-[state=active]:text-gray-900 dark:data-[state=active]:text-gray-100">
                  Grid View
                </TabsTrigger>
                <TabsTrigger value="table" className="data-[state=active]:bg-white dark:data-[state=active]:bg-gray-700 data-[state=active]:text-gray-900 dark:data-[state=active]:text-gray-100">
                  Table View
                </TabsTrigger>
              </TabsList>
            </Tabs>
            )}

            {/* Bulk Actions - Mobile Optimized */}
            {selectedJobs.length > 0 && (
              <div className="mb-4 sm:mb-6 p-3 sm:p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <span className="text-sm font-medium text-blue-900 dark:text-blue-100">
                    {selectedJobs.length} job{selectedJobs.length !== 1 ? 's' : ''} selected
                  </span>
                  <div className="flex items-center gap-2">
                    <Button 
                      size="sm" 
                      variant="outline" 
                      className="border-blue-200 dark:border-blue-700 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-800/50 flex-1 sm:flex-initial"
                    >
                      <Download className="h-3 w-3 mr-1 sm:mr-2" />
                      <span className="hidden sm:inline">Export Selected</span>
                      <span className="sm:hidden">Export</span>
                    </Button>
                    <Button 
                      size="sm" 
                      variant="outline" 
                      disabled={isBulkProcessing} 
                      className="border-red-200 dark:border-red-700 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-800/50 disabled:opacity-50 flex-1 sm:flex-initial" 
                      onClick={handleBulkDeleteJobs}
                    >
                      <Trash className="h-3 w-3 mr-1 sm:mr-2" />
                      <span className="hidden sm:inline">Delete Selected</span>
                      <span className="sm:hidden">Delete</span>
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Jobs Display */}
        {error ? (
          <ErrorState
            title="Failed to load jobs"
            description={error}
            onRetry={fetchJobs}
          />
        ) : windowWidth < 768 || view === "grid" ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-6" data-tutorial="jobs-grid">
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <CardSkeleton key={i} variant="job" />
              ))
            ) : (
              filteredJobs.map((job) => (
                <JobCard
                  key={job._id}
                  job={job}
                  onStatusChange={handleStatusChange}
                  onDelete={handleJobDelete}
                />
              ))
            )}
          </div>
        ) : (
          <>
            {/* Desktop Table View (hidden on small screens) */}
          <Card className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-xl border-gray-200/50 dark:border-gray-700/50 shadow-lg">
            <Table data-tutorial="jobs-table">
              <TableHeader>
                <TableRow className="border-gray-200 dark:border-gray-700">
                  <TableHead className="w-12">
                    <Checkbox
                        checked={selectedJobs.length === filteredJobs.length && filteredJobs.length > 0}
                      onCheckedChange={handleSelectAll}
                      aria-label="Select all jobs"
                    />
                  </TableHead>
                  <TableHead className="text-gray-900 dark:text-gray-100 font-semibold">Job Title</TableHead>
                  <TableHead className="text-gray-900 dark:text-gray-100 font-semibold">Status</TableHead>
                  <TableHead className="text-gray-900 dark:text-gray-100 font-semibold">Applications</TableHead>
                  <TableHead className="text-gray-900 dark:text-gray-100 font-semibold">Created</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredJobs.map((job) => (
                  <TableRow 
                    key={job._id} 
                    className="border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                  >
                    <TableCell>
                      <Checkbox
                        checked={selectedJobs.includes(job._id)}
                        onCheckedChange={() => handleSelectJob(job._id)}
                        aria-label={`Select ${job.title}`}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white text-sm font-semibold">
                          {job.title.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <Link 
                            href={`/jobs/${job._id}`}
                            className="font-medium text-gray-900 dark:text-gray-100 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                          >
                            {job.title}
                          </Link>
                          <p className="text-sm text-gray-500 dark:text-gray-400">{job.location}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusToggle 
                        jobId={job._id} 
                        currentStatus={job.status} 
                        onStatusChange={(newStatus) => handleStatusChange(job._id, newStatus)}
                      />
                    </TableCell>
                    <TableCell className="text-gray-600 dark:text-gray-400" data-tutorial="applications-count">
                      {job.applicantCount || 0}
                    </TableCell>
                    <TableCell className="text-gray-600 dark:text-gray-400">
                      {job.createdAt ? new Date(job.createdAt).toLocaleDateString() : 'Unknown'}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="hover:bg-gray-100 dark:hover:bg-gray-700" data-tutorial="job-actions">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
                          <DropdownMenuLabel className="text-gray-900 dark:text-gray-100">Actions</DropdownMenuLabel>
                          <DropdownMenuSeparator className="bg-gray-200 dark:bg-gray-700" />
                          <DropdownMenuItem asChild>
                            <Link 
                              href={`/jobs/${job._id}`}
                              className="flex items-center gap-2 cursor-pointer text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100"
                            >
                              <Eye className="h-4 w-4" />
                              View Details
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem asChild>
                            <Link 
                              href={`/ai-interviews?jobId=${job._id}`}
                              className="flex items-center gap-2 cursor-pointer text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100"
                            >
                              <Bot className="h-4 w-4" />
                              Create AI Interview
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem asChild>
                            <Link 
                              href={`/jobs/${job._id}/edit`}
                              className="flex items-center gap-2 cursor-pointer text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100"
                            >
                              <Edit className="h-4 w-4" />
                              Edit Job
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuSeparator className="bg-gray-200 dark:bg-gray-700" />
                          <DropdownMenuItem 
                            onClick={() => handleDeleteClick(job)}
                            className="flex items-center gap-2 cursor-pointer text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/50"
                          >
                            <Trash2 className="h-4 w-4" />
                            Delete Job
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
          </>
        )}

        {/* Empty State */}
        {!loading && filteredJobs.length === 0 && (
          <Card className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-xl border-gray-200/50 dark:border-gray-700/50 shadow-lg">
            <CardContent className="text-center py-12">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-100 to-purple-100 dark:from-blue-900/30 dark:to-purple-900/30 flex items-center justify-center mx-auto mb-4">
                <Briefcase className="h-8 w-8 text-blue-500 dark:text-blue-400" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
                {searchQuery || selectedTab !== "all" ? "No jobs found" : "No jobs yet"}
              </h3>
              <p className="text-gray-600 dark:text-gray-400 mb-6">
                {searchQuery || selectedTab !== "all" 
                  ? "Try adjusting your search criteria or filters" 
                  : "Get started by posting your first job opening"
                }
              </p>
              {(!searchQuery && selectedTab === "all") && (
                <Button asChild className="bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700">
                  <Link href="/jobs/new">
                    <Plus className="h-4 w-4 mr-2" />
                    Post Your First Job
                  </Link>
                </Button>
              )}
            </CardContent>
          </Card>
        )}
      </div>
      
      {/* Delete Confirmation Modal */}
      <Dialog open={deleteModalOpen} onOpenChange={setDeleteModalOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              Delete Job?
            </DialogTitle>
            <DialogDescription>
              This action cannot be undone. Are you sure you want to delete this job posting?
            </DialogDescription>
          </DialogHeader>

          {jobToDelete && (
            <div className="space-y-4 py-4">
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-2 bg-gray-50 dark:bg-gray-800/50">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Job Title:</span>
                  <span className="text-sm font-bold text-gray-900 dark:text-gray-100">{jobToDelete.title}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Department:</span>
                  <span className="text-sm text-gray-900 dark:text-gray-100">{getDepartmentName(jobToDelete.department)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Location:</span>
                  <span className="text-sm text-gray-900 dark:text-gray-100">{jobToDelete.location}</span>
                </div>
                {jobToDelete.applicantCount !== undefined && jobToDelete.applicantCount > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Applications:</span>
                    <span className="text-sm font-bold text-amber-600 dark:text-amber-400">{jobToDelete.applicantCount}</span>
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-red-200 dark:border-red-800 p-3 bg-red-50 dark:bg-red-950/30">
                <p className="text-sm text-red-800 dark:text-red-200 flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                  <span>
                    This will permanently delete the job posting
                    {jobToDelete.applicantCount && jobToDelete.applicantCount > 0 
                      ? ` and all associated data, including ${jobToDelete.applicantCount} application(s).`
                      : ' and all associated data.'}
                  </span>
                </p>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteModalOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleConfirmDelete}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete Job
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
    </div>
  )
}

export default function JobsPage() {
  const steps: StepType[] = [
    { selector: "[data-tutorial='jobs-grid'], [data-tutorial='jobs-table']", content: "This is your Jobs list. Use the tabs above to switch between Grid and Table. Each row/card shows title, department, status, applications and created date.", position: 'top' },
    { selector: "[data-tutorial='create-job-btn']", content: "Create a new Job. You can add details, requirements and let AI optimize your description before publishing.", position: 'bottom' },
    { selector: "[data-tutorial='search-filter-section']", content: "Search by title/department/location and filter by status. Sorting and bulk actions help you manage large lists efficiently.", position: 'bottom' },
    { selector: "[data-tutorial='applications-count']", content: "Applications shows how many candidates applied. Click to dive into the pipeline for this job.", position: 'top' },
    { selector: "[data-tutorial='job-actions']", content: "Open the actions menu to view details, edit or share the job. More options appear based on status.", position: 'left' },
  ]
  return (
    <TourProvider 
      steps={steps} 
      scrollSmooth 
      onClickMask={() => {}}
      styles={{ 
        popover: (base) => ({ ...base, zIndex: 2147483000, pointerEvents: 'auto', maxWidth: 420 }),
        maskWrapper: (base) => ({ ...base, zIndex: 2147482000 }),
        maskArea: (base) => ({ ...base, pointerEvents: 'none' }),
      }}
    >
      <JobsInnerPage />
    </TourProvider>
  )
}
