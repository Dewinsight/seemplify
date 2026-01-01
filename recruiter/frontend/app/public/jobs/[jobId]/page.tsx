"use client"

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Progress } from '@/components/ui/progress'
import StickyHeader from '@/components/StickyHeader'
import { 
  MapPin, Clock, Calendar, Building, Users, GraduationCap, Award,
  CheckCircle, AlertCircle, Briefcase, Home, FileText, DollarSign,
  Target, Zap, Star, ArrowRight, Globe, Smartphone, Heart,
  TrendingUp, Shield, Menu, X, ArrowLeft, BookOpen, Sparkles
} from 'lucide-react'
import { formatSalary } from '@/services/jobService'
import { toast } from 'sonner'
import { PublicJobApplicationForm } from '@/components/ui/public-job-application-form'
import { apiRequest } from '@/services/apiConfig'

interface PublicJobData {
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
  requirements: string
  responsibilities: string
  skills?: string
  experience: string
  education: string
  salary?: {
    min: number
    max: number
    currency: string
    period: string
  }
  benefits?: string
  remote: boolean
  openings: number
  applicationDeadline?: string
  publicSlug: string
  publicUrl: string
  createdAt: string
  candidateApplyLimit?: number
  publicApplicationCount?: number
  organization?: {
    _id: string
    name: string
    logo?: string
    industry?: string
    size?: string
    website?: string
  }
}

export default function PublicJobPage() {
  const params = useParams()
  const router = useRouter()
  const jobId = params.jobId as string
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  
  const [job, setJob] = useState<PublicJobData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showApplicationForm, setShowApplicationForm] = useState(false)

  useEffect(() => {
    fetchJobData()
  }, [jobId])

  const fetchJobData = async () => {
    try {
      setLoading(true)
      setError(null)
      
      const response = await apiRequest(`/api/jobs/public/${jobId}`)
      
      if (!response.ok) {
        if (response.status === 404) {
          setError('Job not found or no longer available')
        } else {
          setError('Failed to load job details')
        }
        return
      }
      
      const jobData = await response.json()
      setJob(jobData)
    } catch (err) {
      console.error('Error fetching job:', err)
      setError('Failed to load job details')
    } finally {
      setLoading(false)
    }
  }

  const handleApplyClick = () => {
    setShowApplicationForm(true)
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    })
  }

  const getDaysUntilDeadline = (deadline: string) => {
    const today = new Date()
    const deadlineDate = new Date(deadline)
    const diffTime = deadlineDate.getTime() - today.getTime()
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
    return diffDays
  }

  const getRelativeTime = (date: string) => {
    const days = Math.floor((Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24))
    if (days === 0) return 'Today'
    if (days === 1) return 'Yesterday'
    if (days < 7) return `${days} days ago`
    if (days < 30) return `${Math.floor(days / 7)} weeks ago`
    return `${Math.floor(days / 30)} months ago`
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 text-white">
        {/* Background Effects */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px] pointer-events-none"></div>
        
        <StickyHeader>
          <div className="container mx-auto px-4 flex justify-between items-center">
            <Link href="/" className="flex items-center">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-400 to-purple-500 rounded-xl flex items-center justify-center shadow-xl">
                <span className="font-extrabold text-white tracking-tighter">HR</span>
              </div>
              <div className="ml-3">
                <h1 className="text-xl font-bold text-white">SmartHR</h1>
                <p className="text-slate-300 text-xs hidden sm:block">AI-Powered Recruitment</p>
              </div>
            </Link>
            <div className="flex items-center gap-2">
              <Link href="/public/jobs">
                <Button variant="outline" size="sm" className="bg-white/10 border-white/20 text-white hover:bg-white/20">
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Back to Jobs
                </Button>
              </Link>
              </div>
            </div>
        </StickyHeader>
        
        <div className="h-24"></div>
        <div className="container mx-auto px-4 py-12 max-w-6xl">
          <div className="space-y-8">
            <Card className="bg-white/5 backdrop-blur-sm border-white/10">
              <CardContent className="p-8">
              <div className="space-y-6">
                  <Skeleton className="h-12 w-3/4 bg-white/20" />
                  <div className="flex gap-4">
                    <Skeleton className="h-8 w-24 bg-white/20" />
                    <Skeleton className="h-8 w-32 bg-white/20" />
                    <Skeleton className="h-8 w-28 bg-white/20" />
                  </div>
                  <Skeleton className="h-32 w-full bg-white/20" />
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 text-white flex items-center justify-center px-4">
        {/* Background Effects */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px] pointer-events-none"></div>
        
        <Card className="w-full max-w-lg bg-white/5 backdrop-blur-sm border-white/10">
          <CardHeader className="text-center pb-4">
            <div className="mx-auto w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mb-4">
              <AlertCircle className="h-8 w-8 text-red-400" />
            </div>
            <CardTitle className="text-2xl font-bold text-white mb-2">
              Job Not Found
            </CardTitle>
            <CardDescription className="text-base text-slate-300">
              {error}
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <Link href="/public/jobs">
              <Button className="w-full bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white border-0">
                Browse All Jobs
            </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!job) {
    return null
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 text-white overflow-x-hidden">
      {/* Background Effects */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px] pointer-events-none"></div>
      <div className="absolute top-1/4 left-1/4 w-full max-w-[24rem] aspect-square bg-blue-500/20 rounded-full blur-3xl animate-pulse pointer-events-none"></div>
      <div className="absolute bottom-1/4 right-1/4 w-full max-w-[24rem] aspect-square bg-purple-500/20 rounded-full blur-3xl animate-pulse delay-1000 pointer-events-none"></div>
      
      {/* Navbar */}
      <StickyHeader>
        <div className="container mx-auto px-4 flex justify-between items-center">
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
          
          <div className="hidden md:flex items-center gap-4">
            <Link href="/public/jobs">
              <Button variant="outline" size="sm" className="bg-white/10 border-white/20 text-white hover:bg-white/20">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Browse Jobs
              </Button>
            </Link>
            <Button 
              size="sm"
              className="bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white border-0"
              onClick={() => router.push('/signup')}
            >
              Sign Up
            </Button>
              </div>
              
          <button
            className="md:hidden p-2 text-white hover:bg-white/10 rounded-lg transition-colors"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          >
            {isMobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
              </div>
              
        {/* Mobile Menu */}
        <AnimatePresence>
          {isMobileMenuOpen && (
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="md:hidden bg-slate-900/95 backdrop-blur-md border-t border-white/10 p-4"
            >
              <div className="space-y-2">
                <Link href="/public/jobs">
                  <Button variant="ghost" className="w-full justify-start text-white hover:bg-white/10">
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    Browse Jobs
                  </Button>
                </Link>
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
            </motion.div>
          )}
        </AnimatePresence>
      </StickyHeader>
      
      <div className="h-24"></div>

      {/* Hero Section */}
      <section className="relative z-10 container mx-auto px-4 py-8 sm:py-12">
        <motion.div 
          className="max-w-5xl mx-auto"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          {/* Company Info */}
          {job.organization && (
            <div className="flex items-center gap-4 mb-6">
              {job.organization.logo ? (
                <img 
                  src={job.organization.logo} 
                  alt={job.organization.name}
                  className="w-16 h-16 sm:w-20 sm:h-20 rounded-xl object-cover border-2 border-white/20 shadow-lg"
                />
              ) : (
                <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-lg">
                  <Building className="h-8 w-8 sm:h-10 sm:w-10 text-white" />
            </div>
              )}
              <div>
                <p className="text-slate-300 text-sm sm:text-base">{job.organization.name}</p>
                {job.organization.industry && (
                  <p className="text-slate-400 text-xs sm:text-sm">{job.organization.industry}</p>
                )}
                </div>
              </div>
            )}

          {/* Application Limit Reached Banner */}
          {job.candidateApplyLimit && job.candidateApplyLimit > 0 && job.publicApplicationCount && job.publicApplicationCount >= job.candidateApplyLimit && (
            <Alert variant="destructive" className="mb-6 bg-red-900/20 border-red-500/50 text-red-200">
              <AlertCircle className="h-4 w-4" />
              <div>
                <h4 className="font-bold mb-1">Applications Closed</h4>
                <AlertDescription>
                  This position has received the maximum number of applications ({job.candidateApplyLimit}) and is no longer accepting new applicants.
                </AlertDescription>
              </div>
            </Alert>
          )}

          {/* Job Title */}
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold mb-4 leading-tight">
            <span className="bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
              {job.title}
            </span>
          </h1>

          {/* Key Details */}
          <div className="flex flex-wrap items-center gap-3 mb-8">
            <Badge className="bg-blue-500/20 text-blue-300 border-blue-500/30 px-3 py-1">
              <MapPin className="h-3 w-3 mr-1" />
              {job.remote ? 'Remote' : job.location}
              </Badge>
            <Badge className="bg-purple-500/20 text-purple-300 border-purple-500/30 px-3 py-1">
              <Briefcase className="h-3 w-3 mr-1" />
              {job.type}
              </Badge>
            {job.department && (
              <Badge className="bg-green-500/20 text-green-300 border-green-500/30 px-3 py-1">
                <Users className="h-3 w-3 mr-1" />
                {typeof job.department === 'string' ? job.department : job.department.name}
                </Badge>
              )}
            <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/30 px-3 py-1">
              <Award className="h-3 w-3 mr-1" />
              {job.level}
                </Badge>
            </div>

          {/* Application Counter */}
          {job.candidateApplyLimit && job.candidateApplyLimit > 0 && (
            <div className="mb-6 bg-slate-800/50 rounded-lg p-4 border border-slate-700/50">
              <div className="flex justify-between text-sm mb-2">
                <span className="text-slate-300">Applications Received</span>
                <span className="font-semibold text-blue-300">
                  {job.publicApplicationCount || 0} / {job.candidateApplyLimit}
                </span>
              </div>
              <Progress 
                value={((job.publicApplicationCount || 0) / job.candidateApplyLimit) * 100} 
                className="h-2 bg-slate-700"
              />
              {job.publicApplicationCount && job.candidateApplyLimit && 
               job.publicApplicationCount < job.candidateApplyLimit && (
                <p className="text-xs text-slate-400 mt-2">
                  {job.candidateApplyLimit - job.publicApplicationCount} spots remaining
                </p>
              )}
            </div>
          )}

          {/* Apply Button & Posted Date */}
          <div className="flex flex-col sm:flex-row items-center gap-4 mb-4">
            {(!job.candidateApplyLimit || job.candidateApplyLimit === 0 || 
              !job.publicApplicationCount || job.publicApplicationCount < job.candidateApplyLimit) ? (
              <Button 
                size="lg" 
                onClick={handleApplyClick}
                className="bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white border-0 px-8 py-4 text-lg font-semibold shadow-lg hover:shadow-xl transition-all duration-300"
              >
                Apply for This Position
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            ) : (
              <div className="bg-slate-800/50 rounded-lg p-6 border border-slate-700/50 text-center">
                <p className="text-slate-300 mb-2">This position is no longer accepting applications.</p>
                <p className="text-sm text-slate-400">All available spots have been filled.</p>
              </div>
            )}
            
            {job.openings > 1 && (
              <Badge className="bg-orange-500/20 text-orange-300 border-orange-500/30 px-4 py-2">
                <TrendingUp className="h-4 w-4 mr-2" />
                {job.openings} positions available
              </Badge>
            )}
            </div>

          {/* Posted & Deadline */}
          <div className="flex flex-col sm:flex-row items-center gap-4 text-sm text-slate-300">
            <span className="flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Posted {getRelativeTime(job.createdAt)}
            </span>
            {job.applicationDeadline && (
              <span className="flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                Deadline: {formatDate(job.applicationDeadline)}
                    {(() => {
                  const days = getDaysUntilDeadline(job.applicationDeadline)
                  return days > 0 ? ` (${days} days left)` : ' (Expired)'
                    })()}
              </span>
            )}
            </div>
        </motion.div>
      </section>

      {/* Main Content */}
      <div className="relative z-10 container mx-auto px-4 py-8 max-w-6xl">
        <div className="grid gap-6 lg:gap-8 lg:grid-cols-3">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6 order-2 lg:order-1">
            {/* Job Description */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.1 }}
            >
              <Card className="bg-white/5 backdrop-blur-sm border-white/10 hover:bg-white/10 transition-colors">
                <CardHeader className="pb-4">
                  <CardTitle className="text-2xl font-bold text-white flex items-center gap-2">
                    <BookOpen className="h-6 w-6 text-blue-400" />
                    Job Description
                  </CardTitle>
                  <CardDescription className="text-slate-300">What you'll be doing</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="prose prose-lg max-w-none">
                    <div className="text-slate-300 leading-relaxed">
                      {job.description?.split('\n').map((paragraph, index) => (
                      <p key={index} className="mb-4 last:mb-0">
                        {paragraph}
                      </p>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
            </motion.div>

            {/* Responsibilities */}
            {job.responsibilities && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.2 }}
              >
                <Card className="bg-white/5 backdrop-blur-sm border-white/10 hover:bg-white/10 transition-colors">
                  <CardHeader className="pb-4">
                    <CardTitle className="text-2xl font-bold text-white flex items-center gap-2">
                      <Target className="h-6 w-6 text-purple-400" />
                      Key Responsibilities
                    </CardTitle>
                    <CardDescription className="text-slate-300">Your daily impact</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                      {job.responsibilities.split('\n').filter(item => item.trim()).map((responsibility, index) => (
                        <div key={index} className="flex items-start gap-3 p-4 bg-white/5 rounded-lg border border-white/10 hover:bg-white/10 transition-colors">
                          <CheckCircle className="h-5 w-5 text-green-400 flex-shrink-0 mt-0.5" />
                          <span className="text-slate-300 leading-relaxed">{responsibility.replace(/^[•\-\*]\s*/, '')}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
              </motion.div>
            )}

            {/* Requirements */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.3 }}
            >
              <Card className="bg-white/5 backdrop-blur-sm border-white/10 hover:bg-white/10 transition-colors">
                <CardHeader className="pb-4">
                  <CardTitle className="text-2xl font-bold text-white flex items-center gap-2">
                    <Shield className="h-6 w-6 text-green-400" />
                    Requirements
                  </CardTitle>
                  <CardDescription className="text-slate-300">What we're looking for</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {(() => {
                      if (!job.requirements) return null;
                    
                    const lines = job.requirements.split('\n').map(line => line.trim()).filter(line => line);
                      if (lines.length === 0) return <p className="text-slate-400 italic">No specific requirements listed.</p>;
                    
                    const sections: { title: string; items: string[] }[] = [];
                    let currentSection = { title: '', items: [] as string[] };
                    
                    lines.forEach(line => {
                      if (line.endsWith(':') && !line.match(/^[•\-\*]\s/)) {
                        if (currentSection.title && currentSection.items.length > 0) {
                          sections.push(currentSection);
                        }
                        currentSection = { title: line.replace(':', ''), items: [] };
                      } else {
                        const cleanedItem = line.replace(/^[•\-\*]\s*/, '');
                        if (cleanedItem) {
                          currentSection.items.push(cleanedItem);
                        }
                      }
                    });
                    
                    if (currentSection.title && currentSection.items.length > 0) {
                      sections.push(currentSection);
                    }
                    
                    if (sections.length === 0) {
                      const items = lines.map(line => line.replace(/^[•\-\*]\s*/, '')).filter(item => item);
                      if (items.length > 0) {
                        sections.push({ title: '', items });
                      }
                    }
                    
                    return sections.map((section, sectionIndex) => (
                      <div key={sectionIndex} className="space-y-3">
                        {section.title && (
                            <h4 className="text-lg font-semibold text-white border-b border-white/20 pb-2">
                            {section.title}
                          </h4>
                        )}
                        <div className="space-y-2">
                          {section.items.map((item, itemIndex) => (
                              <div key={itemIndex} className="flex items-start gap-3 p-3 bg-white/5 rounded-lg border border-white/10 hover:bg-white/10 transition-colors">
                                <CheckCircle className="h-4 w-4 text-blue-400 flex-shrink-0 mt-0.5" />
                                <span className="text-slate-300 leading-relaxed">{item}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ));
                  })()}
                </div>
              </CardContent>
            </Card>
            </motion.div>

            {/* Skills */}
            {job.skills && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.4 }}
              >
                <Card className="bg-white/5 backdrop-blur-sm border-white/10 hover:bg-white/10 transition-colors">
                  <CardHeader className="pb-4">
                    <CardTitle className="text-2xl font-bold text-white flex items-center gap-2">
                      <Zap className="h-6 w-6 text-amber-400" />
                      Skills & Technologies
                    </CardTitle>
                    <CardDescription className="text-slate-300">Technical expertise we value</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {job.skills.split(',').map((skill, index) => (
                        <motion.div 
                          key={index}
                          initial={{ opacity: 0, scale: 0.8 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ delay: index * 0.05 }}
                        >
                        <Badge 
                            className="w-full justify-center py-3 px-4 text-sm font-medium bg-gradient-to-r from-blue-500/20 to-purple-500/20 text-white border-white/20 hover:from-blue-500/30 hover:to-purple-500/30 transition-all duration-200"
                        >
                          {skill.trim()}
                        </Badge>
                        </motion.div>
                    ))}
                  </div>
                </CardContent>
              </Card>
              </motion.div>
            )}

            {/* Benefits */}
            {job.benefits && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.5 }}
              >
                <Card className="bg-white/5 backdrop-blur-sm border-white/10 hover:bg-white/10 transition-colors">
                  <CardHeader className="pb-4">
                    <CardTitle className="text-2xl font-bold text-white flex items-center gap-2">
                      <Heart className="h-6 w-6 text-pink-400" />
                      Benefits & Perks
                    </CardTitle>
                    <CardDescription className="text-slate-300">What makes us special</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                      {job.benefits.split('\n').filter(item => item.trim()).map((benefit, index) => (
                        <div key={index} className="flex items-start gap-3 p-4 bg-white/5 rounded-lg border border-white/10 hover:bg-white/10 transition-colors">
                          <Star className="h-5 w-5 text-yellow-400 flex-shrink-0 mt-0.5" />
                          <span className="text-slate-300 leading-relaxed">{benefit.replace(/^[•\-\*]\s*/, '')}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
              </motion.div>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-6 order-1 lg:order-2">
            {/* Job Summary */}
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
            >
              <Card className="bg-white/5 backdrop-blur-sm border-white/10 hover:bg-white/10 transition-colors sticky top-24">
                <CardHeader className="pb-4">
                  <CardTitle className="text-xl font-bold text-white flex items-center gap-2">
                    <Sparkles className="h-5 w-5 text-blue-400" />
                    Job Summary
                  </CardTitle>
              </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between p-3 bg-white/5 rounded-lg border border-white/10">
                      <span className="font-medium text-slate-300">Job Type</span>
                      <Badge className="bg-blue-500/20 text-blue-300 border-blue-500/30">{job.type}</Badge>
                  </div>
                  
                    <div className="flex items-center justify-between p-3 bg-white/5 rounded-lg border border-white/10">
                      <span className="font-medium text-slate-300">Level</span>
                      <Badge className="bg-purple-500/20 text-purple-300 border-purple-500/30">{job.level}</Badge>
                  </div>
                  
                    <div className="flex items-center justify-between p-3 bg-white/5 rounded-lg border border-white/10">
                      <span className="font-medium text-slate-300">Experience</span>
                      <span className="font-semibold text-white">{job.experience} years</span>
                  </div>
                  
                    <div className="flex items-center justify-between p-3 bg-white/5 rounded-lg border border-white/10">
                      <span className="font-medium text-slate-300">Education</span>
                      <span className="font-semibold text-white">{job.education}</span>
                  </div>
                  
                    {job.salary && (
                      <div className="flex items-center justify-between p-3 bg-white/5 rounded-lg border border-white/10">
                        <span className="font-medium text-slate-300">Salary</span>
                        <span className="font-semibold text-green-400 text-right">
                          {formatSalary(job.salary as any)}
                      </span>
                    </div>
                  )}
                  
                    <div className="flex items-center justify-between p-3 bg-white/5 rounded-lg border border-white/10">
                      <span className="font-medium text-slate-300">Remote Work</span>
                      <Badge className={job.remote 
                        ? "bg-green-500/20 text-green-300 border-green-500/30" 
                        : "bg-slate-500/20 text-slate-300 border-slate-500/30"
                      }>
                        {job.remote ? "Available" : "Not Available"}
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
            </motion.div>

            {/* Apply CTA Card */}
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.6, delay: 0.3 }}
              className="lg:sticky lg:top-32"
            >
               <Card className="bg-white/10 backdrop-blur-md border-white/20 shadow-2xl relative overflow-hidden">
                 {/* Background gradient overlay */}
                 <div className="absolute inset-0 bg-gradient-to-br from-blue-500/30 to-purple-500/30 opacity-50"></div>
                 
                 <div className="relative z-10">
              <CardHeader className="text-center pb-4">
                     <CardTitle className="text-xl lg:text-2xl font-bold text-white mb-2">Ready to Apply?</CardTitle>
                     <CardDescription className="text-slate-100 text-sm lg:text-base">
                  Join our team and take the next step in your career journey
                </CardDescription>
              </CardHeader>
              <CardContent className="text-center">
                <Button 
                  onClick={handleApplyClick}
                       className="w-full bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white border-0 shadow-lg hover:shadow-2xl transition-all duration-300 h-12 lg:h-14 text-sm lg:text-base font-semibold"
                  size="lg"
                >
                       <ArrowRight className="mr-2 h-4 w-4 lg:h-5 lg:w-5" />
                       Apply Now
                </Button>
                     <p className="text-xs text-slate-200 mt-3 opacity-80">
                       No account required • Quick application
                  </p>
                   </CardContent>
                </div>
            </Card>
            </motion.div>

            {/* Deadline Warning */}
            {job.applicationDeadline && (() => {
              const days = getDaysUntilDeadline(job.applicationDeadline)
              if (days <= 7 && days > 0) {
                return (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.6, delay: 0.4 }}
                  >
                    <Alert className="border-amber-500/30 bg-amber-500/10 backdrop-blur-sm">
                      <AlertCircle className="h-5 w-5 text-amber-400" />
                      <AlertDescription className="text-amber-300 font-medium">
                      <strong>Hurry!</strong> Application deadline is in {days} day{days !== 1 ? 's' : ''}. 
                      Apply now to secure your spot!
                    </AlertDescription>
                  </Alert>
                  </motion.div>
                )
              }
              return null
            })()}
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

      {/* Application Form */}
      {showApplicationForm && (
        <PublicJobApplicationForm
          jobId={job._id}
          jobTitle={job.title}
          onClose={() => setShowApplicationForm(false)}
          onSuccess={() => {
            setShowApplicationForm(false)
            toast.success('Application submitted successfully! We will review your application and get back to you soon.')
          }}
        />
      )}
    </div>
  )
}