'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import StickyHeader from '@/components/StickyHeader'
import { apiRequest } from '@/services/apiConfig'
import { 
  Search, MapPin, Briefcase, Building2, DollarSign, Clock, 
  ChevronLeft, ChevronRight, X, Filter, Loader2, Menu,
  Shield, Sparkles, TrendingUp, Users
} from 'lucide-react'

interface Job {
  _id: string
  title: string
  department: {
    _id: string
    name: string
  } | string
  location: string
  type: string
  level: string
  description: string
  salary?: {
    min?: number
    max?: number
    currency?: string
    period?: string
  }
  remote: boolean
  openings: number
  createdAt: string
  organization: {
    _id: string
    name: string
    logo?: string
    industry?: string
    size?: string
  }
}

interface FilterOptions {
  locations: string[]
  departments: string[]
  types: string[]
  companies: Array<{ _id: string; name: string }>
}

interface PaginationData {
  total: number
  page: number
  pages: number
  limit: number
}

export default function PublicJobsPage() {
  const router = useRouter()
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const [jobs, setJobs] = useState<Job[]>([])
  const [filterOptions, setFilterOptions] = useState<FilterOptions>({
    locations: [],
    departments: [],
    types: [],
    companies: []
  })
  const [pagination, setPagination] = useState<PaginationData>({
    total: 0,
    page: 1,
    pages: 0,
    limit: 20
  })
  const [loading, setLoading] = useState(true)
  const [showMobileFilters, setShowMobileFilters] = useState(false)
  
  // Filter states
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [selectedLocations, setSelectedLocations] = useState<string[]>([])
  const [selectedDepartments, setSelectedDepartments] = useState<string[]>([])
  const [selectedTypes, setSelectedTypes] = useState<string[]>([])
  const [selectedCompanies, setSelectedCompanies] = useState<string[]>([])
  const [remoteOnly, setRemoteOnly] = useState(false)
  
  // Fetch jobs
  const fetchJobs = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      
      if (search) params.append('search', search)
      if (selectedLocations.length) params.append('location', selectedLocations.join(','))
      if (selectedDepartments.length) params.append('department', selectedDepartments.join(','))
      if (selectedTypes.length) params.append('type', selectedTypes.join(','))
      if (selectedCompanies.length) params.append('company', selectedCompanies.join(','))
      if (remoteOnly) params.append('remote', 'true')
      params.append('page', pagination.page.toString())
      params.append('limit', '20')
      
      const response = await apiRequest(`/api/jobs/public?${params}`)
      if (!response.ok) throw new Error('Failed to fetch jobs')
      
      const data = await response.json()
      
      setJobs(data.jobs)
      setPagination(data.pagination)
      setFilterOptions(data.filters)
    } catch (error) {
      console.error('Error fetching jobs:', error)
    } finally {
      setLoading(false)
    }
  }
  
  useEffect(() => {
    fetchJobs()
  }, [search, selectedLocations, selectedDepartments, selectedTypes, selectedCompanies, remoteOnly, pagination.page])
  
  // Search handler with debounce
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput)
      setPagination(prev => ({ ...prev, page: 1 }))
    }, 500)
    
    return () => clearTimeout(timer)
  }, [searchInput])
  
  // Helper functions
  const getRelativeTime = (date: string) => {
    const days = Math.floor((Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24))
    if (days === 0) return 'Today'
    if (days === 1) return 'Yesterday'
    if (days < 7) return `${days} days ago`
    if (days < 30) return `${Math.floor(days / 7)} weeks ago`
    return `${Math.floor(days / 30)} months ago`
  }
  
  const toggleFilter = (value: string, selected: string[], setter: (v: string[]) => void) => {
    if (selected.includes(value)) {
      setter(selected.filter(v => v !== value))
    } else {
      setter([...selected, value])
    }
    setPagination(prev => ({ ...prev, page: 1 }))
  }
  
  const clearAllFilters = () => {
    setSearchInput('')
    setSearch('')
    setSelectedLocations([])
    setSelectedDepartments([])
    setSelectedTypes([])
    setSelectedCompanies([])
    setRemoteOnly(false)
    setPagination(prev => ({ ...prev, page: 1 }))
  }
  
  const activeFilterCount = selectedLocations.length + selectedDepartments.length + 
                            selectedTypes.length + selectedCompanies.length + (remoteOnly ? 1 : 0)
  
  // Job Card Component
  const JobCard = ({ job }: { job: Job }) => (
    <Link href={`/public/jobs/${job._id}`} className="block">
      <motion.div
        whileHover={{ y: -5, scale: 1.01 }}
        transition={{ duration: 0.2 }}
      >
        <Card className="group hover:shadow-2xl transition-all duration-300 cursor-pointer border-l-4 border-l-transparent hover:border-l-blue-500 bg-white/5 backdrop-blur-sm border-white/10 h-full hover:bg-white/10">
          <CardContent className="p-4 sm:p-6">
            {/* Company Logo & Title */}
            <div className="flex items-start gap-3 sm:gap-4 mb-4">
              {job.organization.logo ? (
                <img 
                  src={job.organization.logo} 
                  alt={job.organization.name}
                  className="w-12 h-12 sm:w-16 sm:h-16 rounded-lg object-cover border border-white/20 group-hover:scale-110 transition-transform duration-300"
                />
              ) : (
                <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform duration-300 shadow-lg">
                  <Building2 className="h-6 w-6 sm:h-8 sm:w-8 text-white" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <h3 className="text-lg sm:text-xl font-bold text-white mb-1 line-clamp-2 group-hover:text-blue-400 transition-colors">
                  {job.title}
                </h3>
                <p className="text-sm sm:text-base text-slate-300 font-medium">
                  {job.organization.name}
                </p>
                {job.organization.industry && (
                  <p className="text-xs text-slate-400 mt-1">
                    {job.organization.industry}
                  </p>
                )}
              </div>
            </div>
            
            {/* Job Details Badges */}
            <div className="flex flex-wrap gap-2 mb-4">
              <Badge className="flex items-center gap-1 text-xs sm:text-sm bg-blue-500/20 text-blue-300 border-blue-500/30 hover:bg-blue-500/30">
                <MapPin className="h-3 w-3" />
                {job.remote ? 'Remote' : job.location}
              </Badge>
              <Badge className="text-xs sm:text-sm bg-purple-500/20 text-purple-300 border-purple-500/30 hover:bg-purple-500/30">
                <Briefcase className="h-3 w-3 mr-1" />
                {job.type}
              </Badge>
              {job.department && (
                <Badge className="text-xs sm:text-sm bg-green-500/20 text-green-300 border-green-500/30 hover:bg-green-500/30">
                  <Users className="h-3 w-3 mr-1" />
                  {typeof job.department === 'string' ? job.department : job.department.name}
                </Badge>
              )}
              {job.level && (
                <Badge className="text-xs sm:text-sm bg-amber-500/20 text-amber-300 border-amber-500/30 hover:bg-amber-500/30">
                  {job.level}
                </Badge>
              )}
            </div>
            
            {/* Description Preview */}
            {job.description && (
              <p className="text-sm text-slate-300 mb-4 line-clamp-2">
                {job.description}
              </p>
            )}
            
            {/* Footer: Salary & Date */}
            <div className="flex items-center justify-between pt-4 border-t border-white/10">
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 text-sm text-slate-400">
                {job.salary?.min && (
                  <span className="flex items-center gap-1 font-semibold text-green-400">
                    <DollarSign className="h-4 w-4" />
                    {job.salary.min.toLocaleString()}
                    {job.salary.max && `-${job.salary.max.toLocaleString()}`}
                    {job.salary.currency && ` ${job.salary.currency}`}
                  </span>
                )}
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {getRelativeTime(job.createdAt)}
                </span>
              </div>
              <Button 
                size="sm" 
                className="bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white border-0 shrink-0"
                onClick={(e) => {
                  e.preventDefault()
                  window.location.href = `/public/jobs/${job._id}`
                }}
              >
                Apply Now
              </Button>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </Link>
  )
  
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 text-white overflow-x-hidden">
      {/* Background Effects */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px] pointer-events-none"></div>
      <div className="absolute top-1/4 left-1/4 w-full max-w-[24rem] aspect-square bg-blue-500/20 rounded-full blur-3xl animate-pulse pointer-events-none"></div>
      <div className="absolute bottom-1/4 right-1/4 w-full max-w-[24rem] aspect-square bg-purple-500/20 rounded-full blur-3xl animate-pulse delay-1000 pointer-events-none"></div>
      
      {/* Sticky Header */}
      <StickyHeader>
        <div className="container mx-auto px-4 flex justify-between items-center">
          {/* Logo */}
          <Link href="/" className="flex items-center">
            <div className="relative">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-400 to-purple-500 rounded-xl flex items-center justify-center shadow-xl">
                <span className="font-extrabold text-white tracking-tighter">HR</span>
              </div>
              <div className="absolute -top-1 -right-1 w-3 h-3 bg-green-400 rounded-full border-2 border-slate-900 animate-pulse"></div>
            </div>
            <div className="ml-3">
              <h1 className="text-xl font-bold text-white">SmartHR</h1>
              <p className="text-slate-300 text-xs hidden sm:block">AI-Powered Recruitment</p>
            </div>
          </Link>
          
          {/* Desktop Navigation Links */}
          <nav className="hidden xl:flex items-center justify-center">
            <ul className="flex space-x-6">
              <li><Link href="/#features" className="text-slate-300 hover:text-white transition-colors">Features</Link></li>
              <li><Link href="/#pricing" className="text-slate-300 hover:text-white transition-colors">Pricing</Link></li>
              <li><Link href="/public/jobs" className="text-blue-400 hover:text-blue-300 transition-colors font-medium">Browse Jobs</Link></li>
            </ul>
          </nav>
          
          {/* Desktop Action Buttons */}
          <div className="hidden md:flex space-x-4 flex-shrink-0">
            <Button 
              variant="outline" 
              size="sm"
              className="bg-white/10 border-white/20 text-white hover:bg-white/20 hover:border-white/30"
              onClick={() => router.push('/login')}
            >
              Login
            </Button>
            <Button 
              size="sm"
              className="bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white border-0"
              onClick={() => router.push('/signup')}
            >
              Sign Up
            </Button>
          </div>
          
          {/* Mobile Menu Button */}
          <button
            className="xl:hidden p-2 text-white hover:bg-white/10 rounded-lg transition-colors"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            aria-label="Toggle menu"
          >
            {isMobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
        
        {/* Mobile Menu Overlay */}
        <AnimatePresence>
          {isMobileMenuOpen && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="fixed inset-0 bg-slate-900/95 backdrop-blur-md z-40 xl:hidden"
                onClick={() => setIsMobileMenuOpen(false)}
              />
              
              <motion.div
                initial={{ x: '100%' }}
                animate={{ x: 0 }}
                exit={{ x: '100%' }}
                transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                className="fixed top-0 right-0 bottom-0 w-80 max-w-[85vw] bg-slate-900/98 backdrop-blur-lg border-l border-white/10 z-50 xl:hidden overflow-y-auto"
              >
                <div className="flex justify-end p-4">
                  <button
                    onClick={() => setIsMobileMenuOpen(false)}
                    className="p-2 text-white hover:bg-white/10 rounded-lg transition-colors"
                    aria-label="Close menu"
                  >
                    <X className="w-6 h-6" />
                  </button>
                </div>
                
                <nav className="px-6 pb-6">
                  <ul className="space-y-4">
                    <li>
                      <Link 
                        href="/#features" 
                        className="block py-3 text-lg text-slate-300 hover:text-white transition-colors border-b border-white/10"
                        onClick={() => setIsMobileMenuOpen(false)}
                      >
                        Features
                      </Link>
                    </li>
                    <li>
                      <Link 
                        href="/#pricing" 
                        className="block py-3 text-lg text-slate-300 hover:text-white transition-colors border-b border-white/10"
                        onClick={() => setIsMobileMenuOpen(false)}
                      >
                        Pricing
                      </Link>
                    </li>
                    <li>
                      <Link 
                        href="/public/jobs" 
                        className="block py-3 text-lg text-blue-400 hover:text-blue-300 transition-colors border-b border-white/10 font-medium"
                        onClick={() => setIsMobileMenuOpen(false)}
                      >
                        Browse Jobs
                      </Link>
                    </li>
                  </ul>
                  
                  <div className="flex flex-col space-y-3 mt-8">
                    <Button 
                      variant="outline" 
                      className="w-full bg-white/10 border-white/20 text-white hover:bg-white/20 hover:border-white/30"
                      onClick={() => {
                        setIsMobileMenuOpen(false)
                        router.push('/login')
                      }}
                    >
                      Login
                    </Button>
                    <Button 
                      className="w-full bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white border-0"
                      onClick={() => {
                        setIsMobileMenuOpen(false)
                        router.push('/signup')
                      }}
                    >
                      Sign Up
                    </Button>
                  </div>
                </nav>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </StickyHeader>
      
      {/* Spacer for fixed header */}
      <div className="h-24"></div>

      {/* Hero Section */}
      <section className="relative z-10 container mx-auto px-4 py-12 sm:py-16">
        <motion.div 
          className="text-center max-w-4xl mx-auto"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <span className="inline-flex items-center px-3 py-1 rounded-full bg-blue-500/10 text-blue-400 text-sm font-medium mb-4">
            <Sparkles className="w-4 h-4 mr-2" />
            {!loading && `${pagination.total} Open Positions`}
          </span>
          <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold mb-4 leading-tight">
            Find Your Next
            <span className="block bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
              Career Opportunity
            </span>
          </h1>
          <p className="text-lg sm:text-xl text-slate-300 mb-6">
            Discover amazing career opportunities across leading companies powered by SmartHR
          </p>
          {!loading && (
            <div className="flex items-center justify-center gap-2 sm:gap-4 flex-wrap">
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.2 }}
              >
                <Badge className="bg-white/10 text-white border-white/20 text-sm sm:text-base px-4 py-2">
                  <TrendingUp className="h-4 w-4 mr-2" />
                  {pagination.total} Open Positions
                </Badge>
              </motion.div>
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.3 }}
              >
                <Badge className="bg-white/10 text-white border-white/20 text-sm sm:text-base px-4 py-2">
                  <Building2 className="h-4 w-4 mr-2" />
                  {filterOptions.companies.length} Companies
                </Badge>
              </motion.div>
            </div>
          )}
        </motion.div>
      </section>
      
      <div className="relative z-10 container mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Search Bar */}
        <motion.div 
          className="mb-6"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.5 }}
        >
          <div className="relative max-w-3xl mx-auto">
            <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 h-5 w-5 text-slate-400" />
            <Input
              type="search"
              placeholder="Search by job title, skills, or keywords..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="pl-12 pr-4 h-14 text-base sm:text-lg border-2 border-white/10 bg-white/5 backdrop-blur-sm focus:border-blue-500 shadow-lg text-white placeholder:text-slate-400"
            />
          </div>
        </motion.div>
        
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Filters Sidebar - Desktop */}
          <div className="hidden lg:block lg:col-span-1">
            <div className="sticky top-24">
              <Card className="border-2 border-white/10 bg-white/5 backdrop-blur-sm">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-bold text-white flex items-center gap-2">
                      <Filter className="h-5 w-5" />
                      Filters
                    </h2>
                    {activeFilterCount > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={clearAllFilters}
                        className="text-xs text-blue-400 hover:text-blue-300 hover:bg-white/10"
                      >
                        Clear All
                      </Button>
                    )}
                  </div>
                  
                  {/* Remote Only */}
                  <div className="mb-6">
                    <div className="flex items-center space-x-2 py-2 px-3 hover:bg-white/10 rounded-lg cursor-pointer transition-colors">
                      <Checkbox
                        id="remote"
                        checked={remoteOnly}
                        onCheckedChange={(checked) => {
                          setRemoteOnly(!!checked)
                          setPagination(prev => ({ ...prev, page: 1 }))
                        }}
                      />
                      <label
                        htmlFor="remote"
                        className="text-sm font-medium text-slate-300 cursor-pointer flex-1"
                      >
                        🌍 Remote Only
                      </label>
                    </div>
                  </div>
                  
                  {/* Location Filter */}
                  {filterOptions.locations.length > 0 && (
                    <div className="mb-6">
                      <h3 className="font-semibold text-sm text-white mb-3 flex items-center gap-2">
                        <MapPin className="h-4 w-4 text-blue-400" />
                        Location
                      </h3>
                      <div className="space-y-2 max-h-64 overflow-y-auto">
                        {filterOptions.locations.map((loc) => (
                          <div
                            key={loc}
                            className="flex items-center space-x-2 py-2 px-3 hover:bg-white/10 rounded-lg cursor-pointer transition-colors"
                          >
                            <Checkbox
                              id={`loc-${loc}`}
                              checked={selectedLocations.includes(loc)}
                              onCheckedChange={() => toggleFilter(loc, selectedLocations, setSelectedLocations)}
                            />
                            <label
                              htmlFor={`loc-${loc}`}
                              className="text-sm text-slate-300 cursor-pointer flex-1"
                            >
                              {loc}
                            </label>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {/* Department Filter */}
                  <div className="mb-6">
                    <h3 className="font-semibold text-sm text-white mb-3 flex items-center gap-2">
                      <Users className="h-4 w-4 text-purple-400" />
                      Department
                    </h3>
                    {filterOptions.departments.length > 0 ? (
                      <div className="space-y-2 max-h-64 overflow-y-auto">
                        {filterOptions.departments.map((dept) => (
                          <div
                            key={dept}
                            className="flex items-center space-x-2 py-2 px-3 hover:bg-white/10 rounded-lg cursor-pointer transition-colors group"
                          >
                            <Checkbox
                              id={`dept-${dept}`}
                              checked={selectedDepartments.includes(dept)}
                              onCheckedChange={() => toggleFilter(dept, selectedDepartments, setSelectedDepartments)}
                            />
                            <label
                              htmlFor={`dept-${dept}`}
                              className="text-sm text-slate-300 cursor-pointer flex-1 group-hover:text-white transition-colors"
                            >
                              {dept}
                            </label>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-400 px-3 py-2">No departments available</p>
                    )}
                  </div>
                  
                  {/* Job Type Filter */}
                  {filterOptions.types.length > 0 && (
                    <div className="mb-6">
                      <h3 className="font-semibold text-sm text-white mb-3 flex items-center gap-2">
                        <Briefcase className="h-4 w-4 text-green-400" />
                        Job Type
                      </h3>
                      <div className="space-y-2">
                        {filterOptions.types.map((t) => (
                          <div
                            key={t}
                            className="flex items-center space-x-2 py-2 px-3 hover:bg-white/10 rounded-lg cursor-pointer transition-colors"
                          >
                            <Checkbox
                              id={`type-${t}`}
                              checked={selectedTypes.includes(t)}
                              onCheckedChange={() => toggleFilter(t, selectedTypes, setSelectedTypes)}
                            />
                            <label
                              htmlFor={`type-${t}`}
                              className="text-sm text-slate-300 cursor-pointer flex-1"
                            >
                              {t}
                            </label>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {/* Company Filter */}
                  {filterOptions.companies.length > 0 && (
                    <div className="mb-6">
                      <h3 className="font-semibold text-sm text-white mb-3 flex items-center gap-2">
                        <Building2 className="h-4 w-4 text-amber-400" />
                        Company
                      </h3>
                      <div className="space-y-2 max-h-64 overflow-y-auto">
                        {filterOptions.companies.map((comp) => (
                          <div
                            key={comp._id}
                            className="flex items-center space-x-2 py-2 px-3 hover:bg-white/10 rounded-lg cursor-pointer transition-colors"
                          >
                            <Checkbox
                              id={`comp-${comp._id}`}
                              checked={selectedCompanies.includes(comp._id)}
                              onCheckedChange={() => toggleFilter(comp._id, selectedCompanies, setSelectedCompanies)}
                            />
                            <label
                              htmlFor={`comp-${comp._id}`}
                              className="text-sm text-slate-300 cursor-pointer flex-1 truncate"
                            >
                              {comp.name}
                            </label>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
          
          {/* Mobile Filter Button */}
          <div className="lg:hidden mb-4">
            <Button
              variant="outline"
              onClick={() => setShowMobileFilters(!showMobileFilters)}
              className="w-full h-12 flex items-center justify-center gap-2 bg-white/5 border-white/10 text-white hover:bg-white/10"
            >
              <Filter className="h-4 w-4" />
              Filters {activeFilterCount > 0 && `(${activeFilterCount})`}
            </Button>
            
            {/* Mobile Filters Drawer */}
            {showMobileFilters && (
              <Card className="mt-4 border-2 border-white/10 bg-white/5 backdrop-blur-sm">
                <CardContent className="p-4 max-h-96 overflow-y-auto">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-bold text-white">Filters</h2>
                    <Button variant="ghost" size="sm" onClick={() => setShowMobileFilters(false)}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="space-y-4">
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="remote-mobile"
                        checked={remoteOnly}
                        onCheckedChange={(checked) => setRemoteOnly(!!checked)}
                      />
                      <label htmlFor="remote-mobile" className="text-sm font-medium text-slate-300">
                        Remote Only
                      </label>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
          
          {/* Job Listings */}
          <div className="lg:col-span-3">
            {/* Active Filters & Job Count */}
            <div className="mb-6">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
                <div className="flex items-center gap-2">
                  <p className="text-base sm:text-lg font-semibold text-white">
                    {loading ? 'Loading...' : `${pagination.total} Jobs Found`}
                  </p>
                </div>
                {activeFilterCount > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearAllFilters}
                    className="text-blue-400 hover:text-blue-300 hover:bg-white/10"
                  >
                    Clear All Filters
                  </Button>
                )}
              </div>
              
              {/* Active Filter Badges */}
              {activeFilterCount > 0 && (
                <div className="flex flex-wrap gap-2">
                  {remoteOnly && (
                    <Badge className="flex items-center gap-1 bg-blue-500/20 text-blue-300 border-blue-500/30">
                      Remote
                      <X 
                        className="h-3 w-3 cursor-pointer hover:text-red-400" 
                        onClick={() => setRemoteOnly(false)}
                      />
                    </Badge>
                  )}
                  {selectedLocations.map((loc) => (
                    <Badge key={loc} className="flex items-center gap-1 bg-purple-500/20 text-purple-300 border-purple-500/30">
                      {loc}
                      <X 
                        className="h-3 w-3 cursor-pointer hover:text-red-400" 
                        onClick={() => toggleFilter(loc, selectedLocations, setSelectedLocations)}
                      />
                    </Badge>
                  ))}
                  {selectedDepartments.map((dept) => (
                    <Badge key={dept} className="flex items-center gap-1 bg-green-500/20 text-green-300 border-green-500/30">
                      {dept}
                      <X 
                        className="h-3 w-3 cursor-pointer hover:text-red-400" 
                        onClick={() => toggleFilter(dept, selectedDepartments, setSelectedDepartments)}
                      />
                    </Badge>
                  ))}
                  {selectedTypes.map((t) => (
                    <Badge key={t} className="flex items-center gap-1 bg-amber-500/20 text-amber-300 border-amber-500/30">
                      {t}
                      <X 
                        className="h-3 w-3 cursor-pointer hover:text-red-400" 
                        onClick={() => toggleFilter(t, selectedTypes, setSelectedTypes)}
                      />
                    </Badge>
                  ))}
                </div>
              )}
            </div>
            
            {/* Loading State */}
            {loading && (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="h-12 w-12 animate-spin text-blue-400" />
              </div>
            )}
            
            {/* Job Grid */}
            {!loading && jobs.length > 0 && (
              <div className="grid grid-cols-1 gap-4 sm:gap-6">
                {jobs.map((job, index) => (
                  <motion.div
                    key={job._id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: index * 0.05 }}
                  >
                    <JobCard job={job} />
                  </motion.div>
                ))}
              </div>
            )}
            
            {/* Empty State */}
            {!loading && jobs.length === 0 && (
              <Card className="border-2 border-dashed border-white/20 bg-white/5 backdrop-blur-sm">
                <CardContent className="p-12 text-center">
                  <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-white/10 flex items-center justify-center">
                    <Briefcase className="h-8 w-8 text-slate-400" />
                  </div>
                  <h3 className="text-xl font-semibold text-white mb-2">
                    No Jobs Found
                  </h3>
                  <p className="text-slate-300 mb-6">
                    Try adjusting your filters or search terms
                  </p>
                  <Button
                    variant="outline"
                    onClick={clearAllFilters}
                    className="border-blue-500/30 bg-blue-500/10 text-blue-400 hover:bg-blue-500/20"
                  >
                    Clear All Filters
                  </Button>
                </CardContent>
              </Card>
            )}
            
            {/* Pagination */}
            {!loading && pagination.pages > 1 && (
              <div className="mt-8 flex items-center justify-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPagination(prev => ({ ...prev, page: Math.max(1, prev.page - 1) }))}
                  disabled={pagination.page === 1}
                  className="bg-white/5 border-white/10 text-white hover:bg-white/10"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Previous
                </Button>
                
                <div className="flex items-center gap-1">
                  {[...Array(Math.min(5, pagination.pages))].map((_, i) => {
                    let pageNum = i + 1
                    if (pagination.pages > 5) {
                      if (pagination.page > 3) {
                        pageNum = pagination.page - 2 + i
                      }
                      if (pageNum > pagination.pages) {
                        pageNum = pagination.pages - 4 + i
                      }
                    }
                    
                    return (
                      <Button
                        key={pageNum}
                        variant={pagination.page === pageNum ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setPagination(prev => ({ ...prev, page: pageNum }))}
                        className={pagination.page === pageNum 
                          ? 'w-10 h-10 bg-gradient-to-r from-blue-500 to-purple-600 text-white'
                          : 'w-10 h-10 bg-white/5 border-white/10 text-white hover:bg-white/10'
                        }
                      >
                        {pageNum}
                      </Button>
                    )
                  })}
                </div>
                
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPagination(prev => ({ ...prev, page: Math.min(prev.pages, prev.page + 1) }))}
                  disabled={pagination.page === pagination.pages}
                  className="bg-white/5 border-white/10 text-white hover:bg-white/10"
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
      
      {/* Footer */}
      <footer className="relative z-10 container mx-auto px-4 py-16 border-t border-white/10 mt-16">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-12">
          <div className="space-y-4">
            <div className="flex items-center">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-400 to-purple-500 rounded-lg flex items-center justify-center shadow-lg">
                <span className="font-extrabold text-white text-sm">HR</span>
              </div>
              <h3 className="ml-3 text-white text-xl font-bold">SmartHR</h3>
            </div>
            <p className="text-slate-300 text-sm">
              Transforming human resources with AI-powered solutions for recruitment, management, and compliance.
            </p>
          </div>
          
          <div>
            <h4 className="font-bold text-white mb-4">Product</h4>
            <ul className="space-y-3">
              <li><Link href="/#features" className="text-slate-300 hover:text-white transition-colors">Features</Link></li>
              <li><Link href="/#pricing" className="text-slate-300 hover:text-white transition-colors">Pricing</Link></li>
              <li><Link href="/public/jobs" className="text-slate-300 hover:text-white transition-colors">Browse Jobs</Link></li>
            </ul>
          </div>
          
          <div>
            <h4 className="font-bold text-white mb-4">Company</h4>
            <ul className="space-y-3">
              <li><span className="text-slate-300">About</span></li>
              <li><span className="text-slate-300">Contact</span></li>
            </ul>
          </div>
          
          <div>
            <h4 className="font-bold text-white mb-4">Legal</h4>
            <ul className="space-y-3">
              <li><Link href="/terms" className="text-slate-300 hover:text-white transition-colors">Terms of Service</Link></li>
              <li><Link href="/privacy" className="text-slate-300 hover:text-white transition-colors">Privacy Policy</Link></li>
              <li><Link href="/cookies" className="text-slate-300 hover:text-white transition-colors">Cookies</Link></li>
            </ul>
          </div>
        </div>
        
        <div className="border-t border-white/10 pt-8 flex flex-col md:flex-row items-center justify-between">
          <p className="text-slate-300 text-sm">© 2025 SmartHR. All rights reserved.</p>
          <div className="flex items-center space-x-4 mt-4 md:mt-0">
            <div className="flex items-center space-x-2 text-slate-400 text-xs">
              <Shield className="w-3 h-3" />
              <span>Enterprise-grade security</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
