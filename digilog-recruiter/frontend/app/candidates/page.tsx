"use client"

import { useState, useEffect, useMemo, useCallback } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import {
  ChevronDown,
  ChevronUp,
  Filter,
  FileSignature,
  MoreHorizontal,
  Plus,
  Search,
  SlidersHorizontal,
  Star,
  X,
  Users,
  ChevronLeft,
  ChevronRight,
  Upload,
  Loader2,
  ListPlus,
} from "lucide-react"
import useMobile from "@/hooks/use-mobile"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Checkbox } from "@/components/ui/checkbox"
import { OwnerChip } from "@/components/owner-chip"
import { SourceChip } from "@/components/source-chip"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { getAllCandidates, getCandidatesPaginated, deleteCandidate, bulkDeleteCandidates, type CandidateData } from "@/services/candidateService"
import { getAllJobs, addCandidateToShortlist, bulkAddToShortlist, type JobData } from "@/services/jobService"
import candidateShortlistService, { type CandidateShortlistInfo } from "@/services/candidateShortlistService"
import { AddToCandidateListDialog } from "@/components/candidate-lists/AddToCandidateListDialog"
import { toast } from "sonner"
import { TourProvider, useTour, type StepType } from "@reactour/tour"

// Helper function to format date
function formatDate(dateString: string) {
  const date = new Date(dateString)
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date)
}



// Star rating component
function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex">
      {[...Array(5)].map((_, i) => (
        <Star
          key={i}
          className={`h-4 w-4 ${
            i < rating
              ? "fill-yellow-400 text-yellow-400"
              : "fill-gray-200 text-gray-200 dark:fill-gray-700 dark:text-gray-700"
          }`}
        />
      ))}
    </div>
  )
}



// Pagination component
function Pagination({ 
  currentPage, 
  totalPages, 
  onPageChange,
  totalItems,
  itemsPerPage
}: {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  totalItems: number;
  itemsPerPage: number;
}) {
  const startItem = (currentPage - 1) * itemsPerPage + 1
  const endItem = Math.min(currentPage * itemsPerPage, totalItems)
  
  const getPageNumbers = () => {
    const pages = []
    const maxVisiblePages = 5
    
    if (totalPages <= maxVisiblePages) {
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i)
      }
    } else {
      if (currentPage <= 3) {
        for (let i = 1; i <= 4; i++) {
          pages.push(i)
        }
        pages.push('...', totalPages)
      } else if (currentPage >= totalPages - 2) {
        pages.push(1, '...')
        for (let i = totalPages - 3; i <= totalPages; i++) {
          pages.push(i)
        }
      } else {
        pages.push(1, '...', currentPage - 1, currentPage, currentPage + 1, '...', totalPages)
      }
    }
    
    return pages
  }

  if (totalPages <= 1) return null

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-4 px-2">
      <div className="text-sm text-gray-700 dark:text-gray-300">
        Showing {startItem} to {endItem} of {totalItems} candidates
      </div>
      
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1}
          className="border-gray-200 dark:border-gray-700"
        >
          <ChevronLeft className="h-4 w-4" />
          Previous
        </Button>
        
        <div className="flex items-center gap-1">
          {getPageNumbers().map((page, index) => (
            page === '...' ? (
              <span key={index} className="px-3 py-2 text-gray-500">...</span>
            ) : (
              <Button
                key={index}
                variant={currentPage === page ? "default" : "outline"}
                size="sm"
                onClick={() => onPageChange(page as number)}
                className={currentPage === page 
                  ? "bg-[#754BE5] hover:bg-[#6935CF] text-white" 
                  : "border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
                }
              >
                {page}
              </Button>
            )
          ))}
        </div>
        
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages}
          className="border-gray-200 dark:border-gray-700"
        >
          Next
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

export default function CandidatesPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  
  const Pop = ({ title, children }: { title: string; children: React.ReactNode }) => {
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
          <button className="px-3 py-1.5 rounded border text-sm text-gray-700 hover:bg-gray-100" onClick={() => setCurrentStep(Math.max(0, (currentStep ?? 0) - 1))}>Prev</button>
          <div className="flex items-center gap-1">
            {Array.from({ length: total }).map((_, i) => (<span key={i} className={`h-2 w-2 rounded-full ${i === currentStep ? 'bg-[#754BE5]' : 'bg-gray-300'}`}></span>))}
          </div>
          <div className="flex items-center gap-2">
            <button className="px-2 py-1 text-xs text-gray-500 hover:text-gray-700" onClick={() => setIsOpen(false)}>Skip</button>
            <button className="px-3 py-1.5 rounded bg-[#754BE5] text-white text-sm hover:bg-[#6935CF]" onClick={() => { if ((currentStep ?? 0) + 1 < total) setCurrentStep((currentStep ?? 0) + 1); else setIsOpen(false) }}>{(currentStep ?? 0) + 1 < total ? 'Next' : 'Done'}</button>
          </div>
        </div>
      </div>
    )
  }

  const steps: StepType[] = [
    { selector: "[data-tutorial='filter-section']", content: <Pop title="Filters">Use search and filters to quickly narrow down candidates.</Pop>, position: 'bottom' },
    { selector: "[data-tutorial='search-input']", content: <Pop title="Search">Search by name, position, skills and more.</Pop>, position: 'bottom' },
    { selector: "[data-tutorial='candidates-table']", content: <Pop title="Candidates List">This is your candidates list. Click a row to open the profile.</Pop>, position: 'top' },
    { selector: "[data-tutorial='select-all-checkbox']", content: <Pop title="Bulk Select">Select candidates to perform bulk actions.</Pop>, position: 'bottom' },
    { selector: "[data-tutorial='candidate-actions']", content: <Pop title="Row Actions">Use row actions to view, edit, shortlist or delete.</Pop>, position: 'left' },
    { selector: "[data-tutorial='pagination']", content: <Pop title="Pagination">Navigate pages and change items per page here.</Pop>, position: 'top' },
    { selector: "[data-tutorial='add-candidate-btn']", content: <Pop title="Add Candidates">Add or upload candidates from here.</Pop>, position: 'bottom' },
  ]

  const StartTourButton = () => {
    const { setIsOpen, setCurrentStep } = useTour()
    return (
      <Button variant="outline" onClick={() => { setCurrentStep(0); setIsOpen(true) }}>
        Guided Tour
      </Button>
    )
  }

  function CandidatesInnerPage() {
    // State management
    const [candidates, setCandidates] = useState<CandidateData[]>([])
    const [loading, setLoading] = useState(true)
    const [selectedCandidates, setSelectedCandidates] = useState<string[]>([])
    const [sortConfig, setSortConfig] = useState<{
      key: string
      direction: "ascending" | "descending"
    }>({ key: "createdAt", direction: "descending" })

    // Server-side pagination state
    const [totalPages, setTotalPages] = useState(0)
    const [totalCandidates, setTotalCandidates] = useState(0)

    // Search and pagination state with URL sync
    const [searchInput, setSearchInput] = useState(searchParams.get('search') || "")
    const [searchTerm, setSearchTerm] = useState(searchParams.get('search') || "")
    const [currentPage, setCurrentPage] = useState(parseInt(searchParams.get('page') || "1"))
    const [itemsPerPage, setItemsPerPage] = useState(parseInt(searchParams.get('limit') || "10"))
    const [isSearching, setIsSearching] = useState(false)
    const isMobile = useMobile()

    // Add to Shortlist modal state
    const [showAddToShortlistModal, setShowAddToShortlistModal] = useState(false)
    const [selectedCandidateForShortlist, setSelectedCandidateForShortlist] = useState<CandidateData | null>(null)
    const [allJobs, setAllJobs] = useState<JobData[]>([])
    const [loadingJobs, setLoadingJobs] = useState(false)
    const [addingToShortlist, setAddingToShortlist] = useState(false)
    const [jobSearchTerm, setJobSearchTerm] = useState('')
    const [candidateShortlists, setCandidateShortlists] = useState<Record<string, CandidateShortlistInfo[]>>({})
    const [showAddToListDialog, setShowAddToListDialog] = useState(false)
    const [listDialogCandidateIds, setListDialogCandidateIds] = useState<string[]>([])
    const [showAllMatchingListDialog, setShowAllMatchingListDialog] = useState(false)

    // Debounced search - update searchTerm 500ms after user stops typing
    useEffect(() => {
      if (searchInput !== searchTerm) {
        setIsSearching(true)
      }
      
      const timeoutId = setTimeout(() => {
        setSearchTerm(searchInput)
        setIsSearching(false)
      }, 500)

      return () => clearTimeout(timeoutId)
    }, [searchInput])

    // Update URL when search/pagination changes
    useEffect(() => {
      const params = new URLSearchParams(window.location.search)
      const currentSearch = params.get('search') || ''
      const currentPageParam = parseInt(params.get('page') || '1')
      const currentLimitParam = parseInt(params.get('limit') || '10')
      
      // Only update URL if values actually changed
      if (currentSearch === searchTerm && 
          currentPageParam === currentPage && 
          currentLimitParam === itemsPerPage) {
        return
      }
      
      const newParams = new URLSearchParams()
      if (searchTerm) newParams.set('search', searchTerm)
      if (currentPage > 1) newParams.set('page', currentPage.toString())
      if (itemsPerPage !== 10) newParams.set('limit', itemsPerPage.toString())
      
      const newUrl = newParams.toString() ? `?${newParams.toString()}` : ''
      window.history.replaceState({}, '', `/candidates${newUrl}`)
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchTerm, currentPage, itemsPerPage])

    const fetchCandidates = useCallback(async () => {
      try {
        setLoading(true)
        const data = await getCandidatesPaginated({
          page: currentPage,
          limit: itemsPerPage,
          search: searchTerm || undefined
        })
        
        setCandidates(data.candidates || [])
        setTotalPages(data.totalPages || 0)
        setTotalCandidates(data.total || 0)
      } catch (error) {
        console.error("Error fetching candidates:", error)
        toast.error("Failed to fetch candidates")
        setCandidates([])
        setTotalPages(0)
        setTotalCandidates(0)
      } finally {
        setLoading(false)
      }
    }, [currentPage, searchTerm, itemsPerPage])

    // Load candidate shortlist information
    const loadCandidateShortlists = async () => {
      try {
        const data = await candidateShortlistService.getCandidateShortlists()
        setCandidateShortlists(data.candidateShortlists)
      } catch (error) {
        console.error('Error loading candidate shortlists:', error)
      }
    }

    // Fetch candidates when page, search, or itemsPerPage changes
    useEffect(() => {
      fetchCandidates()
    }, [fetchCandidates])

    // Load candidate shortlist information on mount
    useEffect(() => {
      loadCandidateShortlists()
    }, [])

    // Server handles filtering, sorting, and pagination
    // Use candidates directly from server response

    // Reset to first page when search changes (but don't trigger if already on page 1)
    useEffect(() => {
      if (searchTerm && currentPage !== 1) {
        setCurrentPage(1)
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchTerm])

    // Handle search input change (immediate UI update, debounced API call)
    const handleSearchChange = (value: string) => {
      setSearchInput(value)
    }

    // Handle page change
    const handlePageChange = (page: number) => {
      setCurrentPage(page)
    }

    // Handle sort request
    const requestSort = (key: string) => {
      let direction: "ascending" | "descending" = "ascending"
      if (sortConfig && sortConfig.key === key && sortConfig.direction === "ascending") {
        direction = "descending"
      }
      setSortConfig({ key, direction })
    }

    // Handle checkbox selection
    const toggleCandidateSelection = (candidateId: string) => {
      setSelectedCandidates((prev) =>
        prev.includes(candidateId) ? prev.filter((id) => id !== candidateId) : [...prev, candidateId],
      )
    }

    // Handle select all (for current page)
    const toggleSelectAll = () => {
      if (selectedCandidates.length === candidates.length) {
        setSelectedCandidates([])
      } else {
        setSelectedCandidates(candidates.map((c) => c._id))
      }
    }

    // Handle delete candidate
    const handleDeleteCandidate = async (candidateId: string, e: React.MouseEvent) => {
      e.stopPropagation()
      if (confirm("Are you sure you want to delete this candidate?")) {
        try {
          await deleteCandidate(candidateId)
          toast.success("Candidate deleted successfully")
          fetchCandidates() // Refresh the list
        } catch (error) {
          console.error("Error deleting candidate:", error)
          toast.error("Failed to delete candidate")
        }
      }
    }

    // Bulk actions handlers
    const [isBulkProcessing, setIsBulkProcessing] = useState(false)
    const handleBulkDelete = async () => {
      if (selectedCandidates.length === 0) return
      const confirmed = window.confirm(`Delete ${selectedCandidates.length} selected candidate(s)? This action cannot be undone.`)
      if (!confirmed) return
      try {
        setIsBulkProcessing(true)
        const result = await bulkDeleteCandidates(selectedCandidates)
        const failures = result.failures || []
        const successCount = result.deleted || 0
        if (successCount > 0) {
          toast.success(`Deleted ${successCount} candidate(s)`) 
        }
        if (failures.length > 0) {
          const sample = failures.slice(0, 3).map(f => f.id).join(', ')
          toast.error(`Failed to delete ${failures.length} candidate(s)` + (sample ? ` (e.g. ${sample})` : ''))
        }
        setSelectedCandidates([])
        await fetchCandidates()
      } catch (err: any) {
        toast.error(err.message || 'Bulk delete failed')
      } finally {
        setIsBulkProcessing(false)
      }
    }

    const [bulkShortlistMode, setBulkShortlistMode] = useState(false)

    const openBulkShortlist = () => {
      if (selectedCandidates.length === 0) return
      setBulkShortlistMode(true)
      setShowAddToShortlistModal(true)
      setSelectedCandidateForShortlist(null)
      setJobSearchTerm('')
      loadAllJobs()
    }

    const openAddSelectedToList = () => {
      if (selectedCandidates.length === 0) return
      setListDialogCandidateIds(selectedCandidates)
      setShowAddToListDialog(true)
    }

    const openAddCandidateToList = (candidateId: string, event: React.MouseEvent) => {
      event.stopPropagation()
      setListDialogCandidateIds([candidateId])
      setShowAddToListDialog(true)
    }

    // Load all jobs for shortlist selection
    const loadAllJobs = async () => {
      try {
        setLoadingJobs(true)
        const jobs = await getAllJobs({ status: 'active' }) // Only get active jobs
        setAllJobs(jobs || [])
      } catch (error) {
        console.error("Error loading jobs:", error)
        toast.error("Failed to load jobs")
      } finally {
        setLoadingJobs(false)
      }
    }

    // Handle opening add to shortlist modal
    const handleOpenAddToShortlist = (candidate: CandidateData, e: React.MouseEvent) => {
      e.stopPropagation()
      setSelectedCandidateForShortlist(candidate)
      setShowAddToShortlistModal(true)
      setJobSearchTerm('') // Reset search
      loadAllJobs()
    }

    // Handle closing modal
    const handleCloseModal = () => {
      setShowAddToShortlistModal(false)
      setSelectedCandidateForShortlist(null)
      setJobSearchTerm('')
      setAllJobs([])
    }

    // Handle adding candidate to selected job's shortlist
    const handleAddToJobShortlist = async (jobId: string, jobTitle: string) => {
      try {
        setAddingToShortlist(true)
        if (bulkShortlistMode) {
          const confirmed = window.confirm(`Move ${selectedCandidates.length} candidate(s) to "${jobTitle}" shortlist?`)
          if (!confirmed) return
          const res = await bulkAddToShortlist(jobId, selectedCandidates)
          toast.success(`Added ${res.addedCount} candidate(s) to ${jobTitle}. Skipped ${res.skippedCount}.`)
          setSelectedCandidates([])
          await fetchCandidates()
        } else {
          if (!selectedCandidateForShortlist) return
          await addCandidateToShortlist(jobId, selectedCandidateForShortlist._id)
          toast.success(`${selectedCandidateForShortlist.firstName} ${selectedCandidateForShortlist.lastName} added to ${jobTitle} shortlist`)
        }
        // Refresh shortlist data to update indicators
        await loadCandidateShortlists()
        handleCloseModal()
      } catch (error: any) {
        console.error("Error adding to shortlist:", error)
        toast.error(error.message || "Failed to add candidate(s) to shortlist")
      } finally {
        setAddingToShortlist(false)
        setBulkShortlistMode(false)
      }
    }

    // Get sort icon
    const getSortIcon = (key: string) => {
      if (sortConfig?.key !== key) {
        return <ChevronDown className="ml-1 h-4 w-4 opacity-50" />
      }
      return sortConfig.direction === "ascending" ? (
        <ChevronUp className="ml-1 h-4 w-4" />
      ) : (
        <ChevronDown className="ml-1 h-4 w-4" />
      )
    }

    // Clear all filters
    const clearFilters = () => {
      setSearchInput("")
      setSearchTerm("")
      setCurrentPage(1)
    }

    const hasActiveFilters = searchInput

    if (loading) {
      return (
        <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-[#F1ECFF]/30 dark:from-gray-950 dark:via-gray-900 dark:to-[#1E0059]/30 flex items-center justify-center">
          <div className="text-center">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#754BE5]/10 to-[#6935CF]/10 dark:from-[#754BE5]/20 dark:to-[#6935CF]/20 flex items-center justify-center mx-auto mb-4">
              <Users className="h-8 w-8 text-primary animate-pulse" />
            </div>
            <p className="text-lg font-medium text-gray-600 dark:text-gray-400">Loading candidates...</p>
          </div>
        </div>
      )
    }

    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-[#F1ECFF]/30 dark:from-gray-950 dark:via-gray-900 dark:to-[#1E0059]/30 p-4 lg:p-8 candidates-container">
        <div className="max-w-7xl mx-auto space-y-8">
          {/* Header */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
            <div>
              <h1 className="text-4xl font-bold text-gray-900 dark:text-gray-100 bg-gradient-to-r from-[#1E0059] to-[#754BE5] bg-clip-text text-transparent candidate-page-title">
                Candidate Management
              </h1>
              <p className="text-lg text-gray-600 dark:text-gray-400 mt-2 candidate-page-description">
                Discover and manage top talent for your organization
              </p>
            </div>
            <div className="flex items-center gap-3">
              <StartTourButton />
              <Button asChild variant="outline" className="border-gray-200 dark:border-gray-700">
                <Link href="/candidates/lists">
                  <ListPlus className="h-4 w-4 mr-2" />
                  Candidate Lists
                </Link>
              </Button>
              <Button asChild variant="outline" className="border-[#754BE5]/30 text-[#754BE5] hover:bg-[#754BE5]/10" data-tutorial="add-candidate-btn">
                <Link href="/bulk-upload">
                  <Upload className="h-4 w-4 mr-2" />
                  Add Candidates
                </Link>
              </Button>
            </div>
          </div>

          {/* Search and Filters */}
          <Card className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-xl border-gray-200/50 dark:border-gray-700/50 shadow-lg" data-tutorial="filter-section">
            <CardHeader className="pb-4">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <Users className="h-6 w-6 text-primary" />
                  <CardTitle className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                    Candidates Overview
                  </CardTitle>
                  {hasActiveFilters && (
                    <Badge variant="secondary" className="ml-2">
                      {totalCandidates} filtered
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <div className="relative">
                    {isSearching ? (
                      <Loader2 className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-blue-500 animate-spin" />
                    ) : (
                      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400 dark:text-gray-500" />
                    )}
                    <Input
                      placeholder="Search candidates by name, position, skills..."
                      value={searchInput}
                      onChange={(e) => handleSearchChange(e.target.value)}
                      className="pl-10 w-80 bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700"
                      data-tutorial="search-input"
                    />
                    {searchInput && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setSearchInput("")
                          setSearchTerm("")
                        }}
                        className="absolute right-1 top-1/2 transform -translate-y-1/2 h-6 w-6 p-0 hover:bg-gray-100 dark:hover:bg-gray-700"
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    )}
                  </div>

                  {hasActiveFilters && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={clearFilters}
                      className="border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
                    >
                      <X className="h-4 w-4 mr-1" />
                      Clear
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>


              {/* Bulk Actions */}
              {selectedCandidates.length > 0 && (
                <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-blue-900 dark:text-blue-100">
                      {selectedCandidates.length} candidate(s) selected
                    </span>
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="outline" className="border-[#754BE5]/30 text-[#754BE5] hover:bg-[#754BE5]/10">
                        Export Selected
                      </Button>
                      <Button size="sm" variant="outline" disabled={isBulkProcessing} className="border-emerald-200 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-800/50 disabled:opacity-50" onClick={openBulkShortlist}>
                        Move to Shortlist
                      </Button>
                      <Button size="sm" variant="outline" disabled={isBulkProcessing} className="border-gray-200 dark:border-gray-700" onClick={openAddSelectedToList}>
                        <ListPlus className="h-4 w-4 mr-2" />
                        Save to List
                      </Button>
                      <Button size="sm" variant="outline" disabled={isBulkProcessing} className="border-red-200 dark:border-red-700 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-800/50 disabled:opacity-50" onClick={handleBulkDelete}>
                        Delete Selected
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Candidates Table */}
          <Card className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-xl border-gray-200/50 dark:border-gray-700/50 shadow-lg" data-tutorial="candidates-table">
            <CardHeader className="pb-4">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div>
                  <CardTitle className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                    Candidates ({totalCandidates})
                  </CardTitle>
                  <CardDescription className="text-gray-600 dark:text-gray-400">
                    {searchInput 
                      ? `Filtered results showing ${totalCandidates} candidates`
                      : `Showing ${totalCandidates} candidates with ${itemsPerPage} per page`
                    }
                  </CardDescription>
                </div>
                <div className="flex items-center gap-3">
                  <Button
                    variant="outline"
                    onClick={() => setShowAllMatchingListDialog(true)}
                    disabled={totalCandidates === 0}
                    className="border-gray-200 dark:border-gray-700"
                  >
                    <ListPlus className="h-4 w-4 mr-2" />
                    List all {searchTerm ? "matching" : "candidates"}
                  </Button>
                  <Select
                    value={itemsPerPage.toString()}
                    onValueChange={(value) => setItemsPerPage(Number(value))}
                  >
                    <SelectTrigger className="w-[80px]">
                      <SelectValue placeholder="Items" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="10">10</SelectItem>
                      <SelectItem value="25">25</SelectItem>
                      <SelectItem value="50">50</SelectItem>
                      <SelectItem value="100">100</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {isMobile ? (
                <div className="space-y-4">
                  {candidates.map((candidate) => {
                    return (
                      <Card
                        key={candidate._id}
                        className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-xl border-gray-200/50 dark:border-gray-700/50 shadow-lg"
                        onClick={() => router.push(`/candidates/${candidate._id}`)}
                      >
                        <CardContent className="p-4">
                          <div className="flex items-start gap-4">
                            <Checkbox
                              checked={selectedCandidates.includes(candidate._id)}
                              onCheckedChange={() => toggleCandidateSelection(candidate._id)}
                              aria-label={`Select ${candidate.firstName} ${candidate.lastName}`}
                              onClick={(e) => e.stopPropagation()}
                            />
                            <Avatar className="h-12 w-12 ring-2 ring-gray-200 dark:ring-gray-700">
                              <AvatarFallback className="bg-gradient-to-br from-[#754BE5] to-[#6935CF] text-white font-semibold">
                                {candidate.firstName?.charAt(0) || ""}
                                {candidate.lastName?.charAt(0) || ""}
                              </AvatarFallback>
                            </Avatar>
                            <div className="flex-1">
                              <div className="flex items-center justify-between">
                                <h3 className="font-bold text-lg text-gray-900 dark:text-gray-100">{candidate.firstName} {candidate.lastName}</h3>
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="icon" onClick={(e) => e.stopPropagation()}>
                                      <MoreHorizontal className="h-4 w-4" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem onClick={() => router.push(`/candidates/${candidate._id}`)}>View Profile</DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => router.push(`/candidates/${candidate._id}/edit`)}>Edit</DropdownMenuItem>
                                    <DropdownMenuItem onClick={(e) => handleOpenAddToShortlist(candidate, e)}>Add to Shortlist</DropdownMenuItem>
                                    <DropdownMenuItem onClick={(e) => openAddCandidateToList(candidate._id, e)}>Add to List</DropdownMenuItem>
                                    <DropdownMenuItem onClick={(e) => handleDeleteCandidate(candidate._id, e)}>Delete</DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </div>
                              <p className="text-sm text-gray-500 dark:text-gray-400">{candidate.email}</p>
                              <p className="text-sm text-gray-700 dark:text-gray-300 mt-1">{candidate.position}</p>
                            </div>
                          </div>
                          <div className="mt-4 space-y-3">
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-gray-600 dark:text-gray-400">Date Added</span>
                              <span>{formatDate(candidate.createdAt || new Date().toISOString())}</span>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    )
                  })}
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="border-gray-200 dark:border-gray-700">
                      <TableHead className="w-12">
                        <Checkbox
                          checked={selectedCandidates.length === candidates.length && candidates.length > 0}
                          onCheckedChange={toggleSelectAll}
                          aria-label="Select all candidates"
                          data-tutorial="select-all-checkbox"
                        />
                      </TableHead>
                      <TableHead>
                        <button
                          className="flex items-center text-gray-900 dark:text-gray-100 font-semibold hover:text-primary transition-colors"
                          onClick={() => requestSort("name")}
                        >
                          Candidate
                          {getSortIcon("name")}
                        </button>
                      </TableHead>
                      <TableHead>
                        <button
                          className="flex items-center text-gray-900 dark:text-gray-100 font-semibold hover:text-primary transition-colors"
                          onClick={() => requestSort("position")}
                        >
                          Position
                          {getSortIcon("position")}
                        </button>
                      </TableHead>
                      <TableHead>
                        <button
                          className="flex items-center text-gray-900 dark:text-gray-100 font-semibold hover:text-primary transition-colors"
                          onClick={() => requestSort("experience")}
                        >
                          Experience
                          {getSortIcon("experience")}
                        </button>
                      </TableHead>

                      <TableHead>
                        <button
                          className="flex items-center text-gray-900 dark:text-gray-100 font-semibold hover:text-primary transition-colors"
                          onClick={() => requestSort("createdAt")}
                        >
                          Added
                          {getSortIcon("createdAt")}
                        </button>
                      </TableHead>
                      <TableHead className="w-12"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {candidates.map((candidate) => {
                      return (
                        <TableRow
                          key={candidate._id}
                          className="border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors cursor-pointer"
                          onClick={() => router.push(`/candidates/${candidate._id}`)}
                        >
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <Checkbox
                              checked={selectedCandidates.includes(candidate._id)}
                              onCheckedChange={() => toggleCandidateSelection(candidate._id)}
                              aria-label={`Select ${candidate.firstName} ${candidate.lastName}`}
                            />
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center space-x-3">
                              <Avatar className="h-10 w-10 ring-2 ring-gray-200 dark:ring-gray-700">
                                <AvatarFallback className="bg-gradient-to-br from-[#754BE5] to-[#6935CF] text-white font-semibold">
                                  {candidate.firstName?.charAt(0) || ""}
                                  {candidate.lastName?.charAt(0) || ""}
                                </AvatarFallback>
                              </Avatar>
                              <div>
                                <div className="font-medium text-gray-900 dark:text-gray-100 candidate-name">
                                  {candidate?.firstName || ''} {candidate?.lastName || ''}
                                </div>
                                <div className="text-sm text-gray-500 dark:text-gray-400 candidate-details">{candidate.email}</div>
                                
                                {/* Status indicators */}
                                <div className="flex flex-wrap gap-1 mt-1">
                                  {/* Shortlist indicators */}
                                  {candidateShortlists[candidate._id] && candidateShortlists[candidate._id].length > 0 && (
                                    <>
                                      {candidateShortlists[candidate._id].slice(0, 2).map((shortlist, index) => (
                                        <Badge 
                                          key={index}
                                          variant="secondary" 
                                          className="text-xs px-1.5 py-0.5 bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300"
                                        >
                                          📋 {shortlist.jobTitle.length > 15 ? shortlist.jobTitle.slice(0, 15) + '...' : shortlist.jobTitle}
                                        </Badge>
                                      ))}
                                      {candidateShortlists[candidate._id].length > 2 && (
                                        <Badge 
                                          variant="outline" 
                                          className="text-xs px-1.5 py-0.5"
                                        >
                                          +{candidateShortlists[candidate._id].length - 2} more
                                        </Badge>
                                      )}
                                    </>
                                  )}
                                  
                                  {/* Check for rejection indicators */}
                                  {candidateShortlists[candidate._id] && candidateShortlists[candidate._id].some(s => s.status === 'rejected') && (
                                    <Badge 
                                      variant="destructive" 
                                      className="text-xs px-1.5 py-0.5 bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300"
                                    >
                                      🚫 Rejected from shortlist
                                    </Badge>
                                  )}
                                </div>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="text-gray-900 dark:text-gray-100 font-medium">
                              {candidate.position || "Not specified"}
                            </div>
                            <div className="text-sm text-gray-500 dark:text-gray-400">
                              {candidate.skills
                                ? candidate.skills.split(',').slice(0, 2).map(skill => skill.trim()).join(', ')
                                : "No skills listed"}
                            </div>
                          </TableCell>
                          <TableCell className="text-gray-600 dark:text-gray-400">
                            {candidate.experience || "Not specified"}
                          </TableCell>
                          <TableCell className="text-gray-600 dark:text-gray-400">
                            {formatDate(candidate.createdAt || new Date().toISOString())}
                          </TableCell>
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="hover:bg-gray-100 dark:hover:bg-gray-700"
                                  data-tutorial="candidate-actions"
                                >
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
                                <DropdownMenuLabel className="text-gray-900 dark:text-gray-100">Actions</DropdownMenuLabel>
                                <DropdownMenuSeparator className="bg-gray-200 dark:bg-gray-700" />
                                <DropdownMenuItem
                                  onClick={() => router.push(`/candidates/${candidate._id}`)}
                                  className="text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 cursor-pointer"
                                >
                                  View Profile
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => router.push(`/candidates/${candidate._id}/edit`)}
                                  className="text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 cursor-pointer"
                                >
                                  Edit Candidate
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={(e) => handleOpenAddToShortlist(candidate, e)}
                                  className="text-primary hover:text-blue-700 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/20 cursor-pointer"
                                >
                                  Add to Shortlist
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={(e) => openAddCandidateToList(candidate._id, e)}
                                  className="text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 cursor-pointer"
                                >
                                  Add to List
                                </DropdownMenuItem>
                                <DropdownMenuSeparator className="bg-gray-200 dark:bg-gray-700" />
                                <DropdownMenuItem
                                  onClick={(e) => handleDeleteCandidate(candidate._id, e)}
                                  className="text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20 cursor-pointer"
                                >
                                  Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              )}

              {/* Pagination */}
              {candidates.length > 0 && (
                <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-700" data-tutorial="pagination">
                  <Pagination
                    currentPage={currentPage}
                    totalPages={totalPages}
                    onPageChange={handlePageChange}
                    totalItems={totalCandidates}
                    itemsPerPage={itemsPerPage}
                  />
                </div>
              )}

              {/* Empty State */}
              {candidates.length === 0 && (
                <div className="text-center py-12">
                  <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#754BE5]/10 to-[#6935CF]/10 dark:from-[#754BE5]/20 dark:to-[#6935CF]/20 flex items-center justify-center mx-auto mb-4">
                    <Users className="h-8 w-8 text-primary" />
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
                    No candidates found
                  </h3>
                  <p className="text-gray-600 dark:text-gray-400 mb-6">
                    {searchTerm
                      ? "Try adjusting your search criteria to find candidates" 
                      : "Start building your talent pool by adding candidates"
                    }
                  </p>
                  {!searchTerm && (
                    <Button asChild className="bg-gradient-to-r from-[#754BE5] to-[#6935CF] hover:from-[#6935CF] hover:to-[#5a2cb5]">
                      <Link href="/candidates/new">
                        <Plus className="h-4 w-4 mr-2" />
                        Add Your First Candidate
                      </Link>
                    </Button>
                  )}
                  {searchTerm && (
                    <Button 
                      onClick={clearFilters}
                      variant="outline"
                      className="border-gray-200 dark:border-gray-700"
                    >
                      <X className="h-4 w-4 mr-2" />
                      Clear Filters
                    </Button>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <AddToCandidateListDialog
          open={showAddToListDialog}
          onOpenChange={setShowAddToListDialog}
          candidateIds={listDialogCandidateIds}
          source="candidates"
          defaultName={`Selected candidates - ${new Date().toLocaleDateString()}`}
          countLabel={`${listDialogCandidateIds.length} selected candidate${listDialogCandidateIds.length === 1 ? "" : "s"} will be saved.`}
          onCompleted={() => {
            setListDialogCandidateIds([])
            setSelectedCandidates([])
          }}
        />

        <AddToCandidateListDialog
          open={showAllMatchingListDialog}
          onOpenChange={setShowAllMatchingListDialog}
          query={{ search: searchTerm || undefined, limit: 5000 }}
          source="candidates"
          defaultName={`${searchTerm ? "Matching candidates" : "All candidates"} - ${new Date().toLocaleDateString()}`}
          defaultDescription={searchTerm ? `Search: ${searchTerm}` : "Created from the full candidate table."}
          countLabel={`${Math.min(totalCandidates, 5000).toLocaleString()} candidate${Math.min(totalCandidates, 5000) === 1 ? "" : "s"} will be saved${totalCandidates > 5000 ? " (limited to 5,000)" : ""}.`}
          onCompleted={() => setShowAllMatchingListDialog(false)}
        />

        {/* Add to Shortlist Modal */}
        <Dialog open={showAddToShortlistModal} onOpenChange={handleCloseModal}>
          <DialogContent className="max-w-[95vw] sm:max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-xl font-bold flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-gradient-to-r from-[#754BE5] to-[#6935CF] flex items-center justify-center">
                  <Star className="h-5 w-5 text-white" />
                </div>
                Add Candidate to Shortlist
              </DialogTitle>
              <DialogDescription>
                {selectedCandidateForShortlist && (
                  <>Select a job to add <strong>{selectedCandidateForShortlist.firstName} {selectedCandidateForShortlist.lastName}</strong> to its shortlist.</>
                )}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {/* Search Bar for Jobs */}
              {!loadingJobs && allJobs.length > 0 && (
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <Input
                    type="text"
                    placeholder="Search jobs..."
                    className="pl-8"
                    value={jobSearchTerm}
                    onChange={(e) => setJobSearchTerm(e.target.value)}
                  />
                </div>
              )}

              {loadingJobs ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="animate-spin h-8 w-8 text-primary" />
                  <span className="ml-3 text-gray-600">Loading available jobs...</span>
                </div>
              ) : allJobs.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <Users className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                  <p>No active jobs available</p>
                  <p className="text-sm text-gray-400 mt-1">Create a job first to add candidates to shortlist</p>
                </div>
              ) : (
                <ScrollArea className="h-96">
                  {(() => {
                    const filteredJobs = allJobs.filter(job => 
                      !jobSearchTerm || 
                      job.title.toLowerCase().includes(jobSearchTerm.toLowerCase()) ||
                      (job.department && (typeof job.department === 'string' ? job.department : (job.department as any)?.name || '').toLowerCase().includes(jobSearchTerm.toLowerCase())) ||
                      job.location.toLowerCase().includes(jobSearchTerm.toLowerCase())
                    );

                    if (filteredJobs.length === 0 && jobSearchTerm) {
                      return (
                        <div className="text-center py-8 text-gray-500">
                          <Search className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                          <p>No jobs match your search</p>
                          <p className="text-sm text-gray-400 mt-1">Try a different search term</p>
                        </div>
                      );
                    }

                    return (
                      <div className="space-y-3">
                        {filteredJobs.map((job) => (
                    <div
                      key={job._id}
                      className={`border rounded-lg p-4 transition-all duration-200 ${
                        addingToShortlist 
                          ? 'cursor-not-allowed opacity-50' 
                          : 'hover:shadow-md hover:border-blue-300 cursor-pointer'
                      }`}
                      onClick={() => !addingToShortlist && handleAddToJobShortlist(job._id, job.title)}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <h4 className="font-semibold text-gray-900 dark:text-gray-100">{job.title}</h4>
                          <p className="text-sm text-gray-600 dark:text-gray-300">{(typeof job.department === 'object' && job.department !== null ? (job.department as any)?.name || '' : job.department) || 'N/A'} • {job.location}</p>
                          <div className="flex items-center gap-2 mt-2">
                            <Badge variant="outline" className="text-xs">
                              {job.type}
                            </Badge>
                            <Badge variant="outline" className="text-xs">
                              {job.level}
                            </Badge>
                            {job.priority === 'high' || job.priority === 'urgent' ? (
                              <Badge variant="destructive" className="text-xs">
                                {job.priority}
                              </Badge>
                            ) : null}
                          </div>
                        </div>
                        <div className="text-right text-sm text-gray-500 flex flex-col items-end gap-1">
                          <p>{job.openings} opening{job.openings !== 1 ? 's' : ''}</p>
                          {job.applicantCount !== undefined && (
                            <p>{job.applicantCount} applicant{job.applicantCount !== 1 ? 's' : ''}</p>
                          )}
                          {addingToShortlist ? (
                            <div className="flex items-center gap-2 text-blue-600">
                              <Loader2 className="animate-spin h-3 w-3" />
                              <span className="text-xs">Adding...</span>
                            </div>
                          ) : (
                            <Badge variant="secondary" className="text-xs hover:bg-blue-100 hover:text-blue-700 transition-colors">
                              Click to add
                            </Badge>
                          )}
                        </div>
                      </div>
                      </div>
                      ))}
                    </div>
                  );
                })()}
              </ScrollArea>
            )}
          </div>

          <div className="flex items-center justify-between pt-4 border-t">
            <p className="text-sm text-gray-500">
              Click on a job to add the candidate to its shortlist
            </p>
            <Button 
              variant="outline" 
              onClick={handleCloseModal}
              disabled={addingToShortlist}
            >
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

  return (
    <TourProvider 
      steps={steps}
      scrollSmooth
      showBadge={false}
      showNavigation={false}
      showDots={false}
      showCloseButton={false}
      components={{
        Navigation: () => null,
        Close: () => null,
      } as any}
      styles={{ 
        popover: (base) => ({ ...base, zIndex: 2147483000, pointerEvents: 'auto', maxWidth: 420 }),
        maskWrapper: (base) => ({ ...base, zIndex: 2147482000 }),
        maskArea: (base) => ({ ...base, pointerEvents: 'none' }),
      }}
    >
      <CandidatesInnerPage />
    </TourProvider>
  )
}
