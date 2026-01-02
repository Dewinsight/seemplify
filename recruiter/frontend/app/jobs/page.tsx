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
      <Card className="relative overflow-hidden transition-all duration-300 hover:border-border hover:-translate-y-1 border border-border/50 bg-card/50 backdrop-blur-xl cursor-pointer active:scale-[0.98]">
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
              <h3 className="text-base font-bold line-clamp-2 mb-2 leading-snug">
                {job.title}
              </h3>
              <div className="flex items-center gap-2">
                <Badge className="text-xs px-2 py-0.5 bg-blue-500/20 text-blue-400 border-0">
                  {getDepartmentName(job.department)}
                </Badge>
                <span className="text-xs text-muted-foreground">•</span>
                <span className="text-xs text-muted-foreground">{job.type}</span>
              </div>
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild onClick={(e) => e.preventDefault()}>
                <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-accent">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="bg-popover border-border">
                <DropdownMenuLabel>Actions</DropdownMenuLabel>
                <DropdownMenuSeparator className="bg-border" />
                <DropdownMenuItem asChild>
                  <Link href={`/jobs/${job._id}`} className="flex items-center gap-2">
                    <Eye className="h-4 w-4" />
                    View Details
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
                  className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                >
                  {isDeleting ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Deleting...</> : <><Trash className="h-4 w-4 mr-2" />Delete</>}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Location + Applicants */}
          <div className="flex items-center gap-4 py-2.5 px-3 bg-muted/50 rounded-lg">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <MapPin className="h-4 w-4 text-blue-400" />
              <span className="text-sm text-muted-foreground truncate">{job.location}</span>
            </div>
            <div className="w-px h-4 bg-border"></div>
            <div className="flex items-center gap-1.5">
              <Users className="h-4 w-4 text-purple-400" />
              <span className="text-sm font-bold">{job.applicantCount || 0}</span>
            </div>
          </div>

          {/* Progress Bar */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-medium text-muted-foreground">Progress</span>
              <span className="text-xs font-bold">
                {job.status === 'active' ? '75%' : job.status === 'draft' ? '25%' : '100%'}
              </span>
            </div>
            <div className="w-full bg-muted rounded-full h-2">
              <div
                className={`h-2 rounded-full bg-gradient-to-r ${getStatusColor(job.status)} transition-all duration-500`}
                style={{ width: job.status === 'active' ? '75%' : job.status === 'draft' ? '25%' : '100%' }}
              />
            </div>
          </div>

          {/* Footer: Status + Date */}
          <div className="flex items-center justify-between pt-2 border-t border-border/50">
            <Badge
              className={`text-xs font-medium px-2.5 py-1 ${
                job.status === 'active'
                  ? 'bg-emerald-500/20 text-emerald-400'
                  : job.status === 'draft'
                  ? 'bg-amber-500/20 text-amber-400'
                  : 'bg-muted text-muted-foreground'
              }`}
            >
              {job.status}
            </Badge>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
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
          <h3 className="text-sm sm:text-base font-semibold text-foreground">{title}</h3>
          <button className="text-muted-foreground hover:text-foreground" onClick={() => setIsOpen(false)} aria-label="Close">×</button>
        </div>
        <div className="text-sm text-muted-foreground mb-3">{children}</div>
        <div className="flex items-center justify-between mt-2 gap-2">
          <button
            className="px-3 py-1.5 rounded border text-sm text-gray-700 hover:bg-gray-100"
            onClick={() => setCurrentStep(Math.max(0, (currentStep ?? 0) - 1))}
          >Prev</button>
          <div className="flex items-center gap-1">
            {Array.from({ length: total }).map((_, i) => (
              <span key={i} className={`h-2 w-2 rounded-full ${i === currentStep ? 'bg-blue-600' : 'bg-muted'}`}></span>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button className="px-2 py-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => setIsOpen(false)}>Skip</button>
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
    <div className="min-h-screen p-3 sm:p-4 lg:p-8 jobs-container">
      <div className="max-w-7xl mx-auto space-y-4 sm:space-y-6 lg:space-y-8">
        {/* Header - Mobile Optimized */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 lg:gap-6">
          <div>
            <h1 className="text-2xl sm:text-3xl lg:text-3xl font-bold tracking-tight text-foreground job-page-title">
              Job Management
            </h1>
            <p className="text-sm sm:text-base text-muted-foreground mt-1 sm:mt-2 job-page-description">
              Manage your job postings and track applications
            </p>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <Button variant="outline" size="sm" className="hidden sm:flex border-border" onClick={() => { setCurrentStep(0); setIsOpen(true) }}>
              Guided Tour
            </Button>
            <Button asChild size="sm" className="w-full sm:w-auto" data-tutorial="create-job-btn">
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
          <div className="bg-card/50 backdrop-blur-xl rounded-lg sm:rounded-xl p-3 sm:p-4 border border-border/50">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
              <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
                <Briefcase className="h-4 w-4 sm:h-5 sm:w-5 text-blue-400" />
              </div>
              <div>
                <p className="text-xs sm:text-sm font-medium text-muted-foreground">Total Jobs</p>
                <p className="text-xl sm:text-2xl font-bold">{jobs.length}</p>
              </div>
            </div>
          </div>
          <div className="bg-card/50 backdrop-blur-xl rounded-lg sm:rounded-xl p-3 sm:p-4 border border-border/50">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
              <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center">
                <Users className="h-4 w-4 sm:h-5 sm:w-5 text-emerald-400" />
              </div>
              <div>
                <p className="text-xs sm:text-sm font-medium text-muted-foreground">Active</p>
                <p className="text-xl sm:text-2xl font-bold">{jobs.filter(j => j.status === 'active').length}</p>
              </div>
            </div>
          </div>
          <div className="bg-card/50 backdrop-blur-xl rounded-lg sm:rounded-xl p-3 sm:p-4 border border-border/50">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
              <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-amber-500/20 flex items-center justify-center">
                <Clock className="h-4 w-4 sm:h-5 sm:w-5 text-amber-400" />
              </div>
              <div>
                <p className="text-xs sm:text-sm font-medium text-muted-foreground">Drafts</p>
                <p className="text-xl sm:text-2xl font-bold">{jobs.filter(j => j.status === 'draft').length}</p>
              </div>
            </div>
          </div>
          <div className="bg-card/50 backdrop-blur-xl rounded-lg sm:rounded-xl p-3 sm:p-4 border border-border/50">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
              <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
                <Calendar className="h-4 w-4 sm:h-5 sm:w-5 text-purple-400" />
              </div>
              <div>
                <p className="text-xs sm:text-sm font-medium text-muted-foreground">Applications</p>
                <p className="text-xl sm:text-2xl font-bold">{jobs.reduce((acc, job) => acc + (job.applicantCount || 0), 0)}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Search and Filters Card */}
        <Card className="bg-card/50 backdrop-blur-xl border-border/50" data-tutorial="search-filter-section">
          <CardHeader className="p-4 sm:p-6">
            <div className="space-y-4">

              {/* Search Bar - Full Width on Mobile */}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search jobs..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 pr-10 w-full bg-background border-border"
                    data-tutorial="search-jobs"
                  />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
                </div>

              {/* Filters - Horizontal Scroll on Mobile */}
              <div className="flex items-center gap-2 overflow-x-auto pb-2 -mx-4 px-4 sm:mx-0 sm:px-0 sm:overflow-visible">
                <Select value={selectedTab} onValueChange={setSelectedTab}>
                  <SelectTrigger className="min-w-[120px] bg-background border-border">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent className="bg-popover border-border">
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="closed">Closed</SelectItem>
                    <SelectItem value="paused">Paused</SelectItem>
                  </SelectContent>
                </Select>

                <Select value={selectedDepartment} onValueChange={setSelectedDepartment}>
                  <SelectTrigger className="min-w-[120px] bg-background border-border">
                    <SelectValue placeholder="Department" />
                  </SelectTrigger>
                  <SelectContent className="bg-popover border-border">
                    <SelectItem value="all">All Departments</SelectItem>
                    {departments.map(dept => (
                      <SelectItem key={dept} value={dept}>{dept}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={selectedLocation} onValueChange={setSelectedLocation}>
                  <SelectTrigger className="min-w-[120px] bg-background border-border">
                    <SelectValue placeholder="Location" />
                  </SelectTrigger>
                  <SelectContent className="bg-popover border-border">
                    <SelectItem value="all">All Locations</SelectItem>
                    {locations.map(loc => (
                      <SelectItem key={loc} value={loc}>{loc}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')}
                  className="border-border hover:bg-accent flex-shrink-0"
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
              <TabsList className="bg-muted border border-border">
                <TabsTrigger value="grid" className="data-[state=active]:bg-background">
                  Grid View
                </TabsTrigger>
                <TabsTrigger value="table" className="data-[state=active]:bg-background">
                  Table View
                </TabsTrigger>
              </TabsList>
            </Tabs>
            )}

            {/* Bulk Actions - Mobile Optimized */}
            {selectedJobs.length > 0 && (
              <div className="mb-4 sm:mb-6 p-3 sm:p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <span className="text-sm font-medium text-blue-300">
                    {selectedJobs.length} job{selectedJobs.length !== 1 ? 's' : ''} selected
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-border hover:bg-accent flex-1 sm:flex-initial"
                    >
                      <Download className="h-3 w-3 mr-1 sm:mr-2" />
                      <span className="hidden sm:inline">Export Selected</span>
                      <span className="sm:hidden">Export</span>
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isBulkProcessing}
                      className="border-red-500/30 text-red-400 hover:bg-red-500/10 disabled:opacity-50 flex-1 sm:flex-initial"
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
          <Card className="bg-card/50 backdrop-blur-xl border-border/50">
            <Table data-tutorial="jobs-table">
              <TableHeader>
                <TableRow className="border-border">
                  <TableHead className="w-12">
                    <Checkbox
                        checked={selectedJobs.length === filteredJobs.length && filteredJobs.length > 0}
                      onCheckedChange={handleSelectAll}
                      aria-label="Select all jobs"
                    />
                  </TableHead>
                  <TableHead className="font-semibold">Job Title</TableHead>
                  <TableHead className="font-semibold">Status</TableHead>
                  <TableHead className="font-semibold">Applications</TableHead>
                  <TableHead className="font-semibold">Created</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredJobs.map((job) => (
                  <TableRow
                    key={job._id}
                    className="border-border hover:bg-accent/50 transition-colors"
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
                            className="font-medium hover:text-blue-400 transition-colors"
                          >
                            {job.title}
                          </Link>
                          <p className="text-sm text-muted-foreground">{job.location}</p>
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
                    <TableCell className="text-muted-foreground" data-tutorial="applications-count">
                      {job.applicantCount || 0}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {job.createdAt ? new Date(job.createdAt).toLocaleDateString() : 'Unknown'}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="hover:bg-accent" data-tutorial="job-actions">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="bg-popover border-border">
                          <DropdownMenuLabel>Actions</DropdownMenuLabel>
                          <DropdownMenuSeparator className="bg-border" />
                          <DropdownMenuItem asChild>
                            <Link
                              href={`/jobs/${job._id}`}
                              className="flex items-center gap-2 cursor-pointer"
                            >
                              <Eye className="h-4 w-4" />
                              View Details
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem asChild>
                            <Link
                              href={`/jobs/${job._id}/edit`}
                              className="flex items-center gap-2 cursor-pointer"
                            >
                              <Edit className="h-4 w-4" />
                              Edit Job
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuSeparator className="bg-border" />
                          <DropdownMenuItem
                            onClick={() => handleDeleteClick(job)}
                            className="flex items-center gap-2 cursor-pointer text-red-400 hover:text-red-300 hover:bg-red-500/10"
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
          <Card className="bg-card/50 backdrop-blur-xl border-border/50">
            <CardContent className="text-center py-12">
              <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mx-auto mb-4">
                <Briefcase className="h-8 w-8 text-blue-400" />
              </div>
              <h3 className="text-lg font-semibold mb-2">
                {searchQuery || selectedTab !== "all" ? "No jobs found" : "No jobs yet"}
              </h3>
              <p className="text-muted-foreground mb-6">
                {searchQuery || selectedTab !== "all"
                  ? "Try adjusting your search criteria or filters"
                  : "Get started by posting your first job opening"
                }
              </p>
              {(!searchQuery && selectedTab === "all") && (
                <Button asChild>
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
        <DialogContent className="sm:max-w-[500px] bg-card border-border">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-400" />
              Delete Job?
            </DialogTitle>
            <DialogDescription>
              This action cannot be undone. Are you sure you want to delete this job posting?
            </DialogDescription>
          </DialogHeader>

          {jobToDelete && (
            <div className="space-y-4 py-4">
              <div className="rounded-lg border border-border p-4 space-y-2 bg-muted/50">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-muted-foreground">Job Title:</span>
                  <span className="text-sm font-bold">{jobToDelete.title}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-muted-foreground">Department:</span>
                  <span className="text-sm">{getDepartmentName(jobToDelete.department)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-muted-foreground">Location:</span>
                  <span className="text-sm">{jobToDelete.location}</span>
                </div>
                {jobToDelete.applicantCount !== undefined && jobToDelete.applicantCount > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-muted-foreground">Applications:</span>
                    <span className="text-sm font-bold text-amber-400">{jobToDelete.applicantCount}</span>
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-red-500/30 p-3 bg-red-500/10">
                <p className="text-sm text-red-300 flex items-start gap-2">
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
              className="border-border"
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
