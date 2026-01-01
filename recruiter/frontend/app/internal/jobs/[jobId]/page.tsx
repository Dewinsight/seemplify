"use client"

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  MapPin, Clock, Calendar, Building, Users, GraduationCap, Award,
  CheckCircle, AlertCircle, Briefcase, FileText, DollarSign,
  ArrowLeft, Sparkles, User
} from 'lucide-react'
import { formatSalary, JobData } from '@/services/jobService'
import { toast } from 'sonner'
import { apiRequest } from '@/services/apiConfig'

interface InternalJobData {
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
  internalUrl: string
  createdAt: string
  internalCandidateApplyLimit?: number
  internalApplicationCount?: number
  internalSettings?: {
    requireEmployeeId: boolean
    notifyHiringManager: boolean
  }
  hiringManager?: {
    _id: string
    firstName: string
    lastName: string
    email: string
  }
}

export default function InternalJobPage() {
  const params = useParams()
  const router = useRouter()
  const jobId = params.jobId as string

  const [job, setJob] = useState<InternalJobData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showApplicationForm, setShowApplicationForm] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Form data
  const [formData, setFormData] = useState({
    candidateId: '',
    employeeId: '',
    notes: ''
  })

  useEffect(() => {
    fetchJobData()
  }, [jobId])

  const fetchJobData = async () => {
    try {
      setLoading(true)
      setError(null)

      const response = await apiRequest(`/api/jobs/internal/${jobId}`)

      if (!response.ok) {
        if (response.status === 404) {
          setError('Job not found or no longer available for internal applications')
        } else if (response.status === 400) {
          const errorData = await response.json()
          setError(errorData.message || 'This job is not currently accepting internal applications')
        } else {
          setError('Failed to load job details')
        }
        return
      }

      const data = await response.json()
      setJob(data.job)
    } catch (err) {
      console.error('Error fetching job:', err)
      setError('Unable to load job details. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleSubmitApplication = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!formData.candidateId) {
      toast.error('Please provide your candidate ID')
      return
    }

    if (job?.internalSettings?.requireEmployeeId && !formData.employeeId) {
      toast.error('Employee ID is required for this position')
      return
    }

    try {
      setIsSubmitting(true)

      const response = await apiRequest(`/api/jobs/internal/${jobId}/apply`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(formData)
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.message || 'Failed to submit application')
      }

      const result = await response.json()

      toast.success('Application submitted successfully!', {
        description: 'The hiring manager has been notified of your application.'
      })

      // Reset form and close
      setFormData({ candidateId: '', employeeId: '', notes: '' })
      setShowApplicationForm(false)

      // Refresh job data
      fetchJobData()

    } catch (err: any) {
      console.error('Error submitting application:', err)
      toast.error(err.message || 'Failed to submit application')
    } finally {
      setIsSubmitting(false)
    }
  }

  const getDepartmentName = () => {
    if (!job?.department) return 'N/A'
    return typeof job.department === 'string' ? job.department : job.department.name
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 py-12">
        <div className="container mx-auto px-4 max-w-5xl">
          <Skeleton className="h-12 w-3/4 mb-6" />
          <Skeleton className="h-64 w-full mb-6" />
          <Skeleton className="h-96 w-full" />
        </div>
      </div>
    )
  }

  if (error || !job) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 py-12">
        <div className="container mx-auto px-4 max-w-3xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <Alert variant="destructive">
              <AlertCircle className="h-5 w-5" />
              <AlertDescription className="text-lg">
                {error || 'Job not found'}
              </AlertDescription>
            </Alert>
            <Button
              onClick={() => router.push('/jobs')}
              className="mt-6"
              variant="outline"
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Jobs
            </Button>
          </motion.div>
        </div>
      </div>
    )
  }

  const applicationProgress = job.internalCandidateApplyLimit && job.internalCandidateApplyLimit > 0
    ? (job.internalApplicationCount || 0) / job.internalCandidateApplyLimit * 100
    : 0

  const isLimitReached = job.internalCandidateApplyLimit && job.internalCandidateApplyLimit > 0
    ? (job.internalApplicationCount || 0) >= job.internalCandidateApplyLimit
    : false

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 py-12">
      <div className="container mx-auto px-4 max-w-5xl">

        {/* Internal Badge & Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="mb-6"
        >
          <Badge className="bg-purple-600 text-white px-3 py-1 mb-4">
            <Building className="w-3 h-3 mr-1" />
            Internal Opportunity
          </Badge>

          <h1 className="text-4xl md:text-5xl font-bold text-slate-900 dark:text-white mb-2">
            {job.title}
          </h1>

          <div className="flex flex-wrap gap-3 mt-4">
            <Badge variant="outline" className="text-base">
              <Building className="w-4 h-4 mr-2" />
              {getDepartmentName()}
            </Badge>
            <Badge variant="outline" className="text-base">
              <MapPin className="w-4 h-4 mr-2" />
              {job.location}
            </Badge>
            <Badge variant="outline" className="text-base">
              <Briefcase className="w-4 h-4 mr-2" />
              {job.type}
            </Badge>
            {job.remote && (
              <Badge variant="outline" className="text-base bg-green-50 dark:bg-green-950">
                🌐 Remote
              </Badge>
            )}
          </div>
        </motion.div>

        {/* Application Limit Alert */}
        {job.internalCandidateApplyLimit && job.internalCandidateApplyLimit > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
          >
            <Alert className={isLimitReached ? 'bg-red-50 border-red-200' : 'bg-blue-50 border-blue-200'}>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                <strong>{job.internalApplicationCount || 0}</strong> of{' '}
                <strong>{job.internalCandidateApplyLimit}</strong> internal application slots filled
                <div className="mt-2 w-full bg-slate-200 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full transition-all ${
                      isLimitReached ? 'bg-red-500' : 'bg-blue-500'
                    }`}
                    style={{ width: `${Math.min(applicationProgress, 100)}%` }}
                  />
                </div>
              </AlertDescription>
            </Alert>
          </motion.div>
        )}

        <div className="grid md:grid-cols-3 gap-6 mt-6">
          {/* Main Content */}
          <motion.div
            className="md:col-span-2 space-y-6"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
          >
            {/* Description */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="w-5 h-5 text-purple-600" />
                  Job Description
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-slate-700 dark:text-slate-300 whitespace-pre-line leading-relaxed">
                  {job.description}
                </p>
              </CardContent>
            </Card>

            {/* Responsibilities */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CheckCircle className="w-5 h-5 text-green-600" />
                  Responsibilities
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-slate-700 dark:text-slate-300 whitespace-pre-line leading-relaxed">
                  {job.responsibilities}
                </p>
              </CardContent>
            </Card>

            {/* Requirements */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Award className="w-5 h-5 text-blue-600" />
                  Requirements
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-slate-700 dark:text-slate-300 whitespace-pre-line leading-relaxed">
                  {job.requirements}
                </p>
              </CardContent>
            </Card>

            {/* Skills */}
            {job.skills && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-yellow-600" />
                    Required Skills
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    {job.skills.split(',').map((skill, idx) => (
                      <Badge key={idx} variant="secondary">
                        {skill.trim()}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Benefits */}
            {job.benefits && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Award className="w-5 h-5 text-purple-600" />
                    Benefits
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-slate-700 dark:text-slate-300 whitespace-pre-line leading-relaxed">
                    {job.benefits}
                  </p>
                </CardContent>
              </Card>
            )}
          </motion.div>

          {/* Sidebar */}
          <motion.div
            className="space-y-6"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            {/* Apply Card */}
            <Card className="border-2 border-purple-200 dark:border-purple-800 sticky top-6">
              <CardHeader>
                <CardTitle className="text-purple-700 dark:text-purple-300">
                  Internal Application
                </CardTitle>
                <CardDescription>
                  Apply as an internal candidate
                </CardDescription>
              </CardHeader>
              <CardContent>
                {!showApplicationForm ? (
                  <Button
                    onClick={() => setShowApplicationForm(true)}
                    className="w-full bg-purple-600 hover:bg-purple-700"
                    size="lg"
                    disabled={isLimitReached}
                  >
                    {isLimitReached ? 'Application Limit Reached' : 'Apply Now'}
                  </Button>
                ) : (
                  <form onSubmit={handleSubmitApplication} className="space-y-4">
                    <div>
                      <label className="text-sm font-medium mb-1 block">
                        Candidate ID <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={formData.candidateId}
                        onChange={(e) => setFormData({...formData, candidateId: e.target.value})}
                        className="w-full px-3 py-2 border rounded-md"
                        placeholder="Your candidate ID"
                        required
                      />
                    </div>

                    {job.internalSettings?.requireEmployeeId && (
                      <div>
                        <label className="text-sm font-medium mb-1 block">
                          Employee ID <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          value={formData.employeeId}
                          onChange={(e) => setFormData({...formData, employeeId: e.target.value})}
                          className="w-full px-3 py-2 border rounded-md"
                          placeholder="Your employee ID"
                          required
                        />
                      </div>
                    )}

                    <div>
                      <label className="text-sm font-medium mb-1 block">
                        Notes (Optional)
                      </label>
                      <textarea
                        value={formData.notes}
                        onChange={(e) => setFormData({...formData, notes: e.target.value})}
                        className="w-full px-3 py-2 border rounded-md"
                        rows={4}
                        placeholder="Why are you interested in this role?"
                      />
                    </div>

                    <div className="flex gap-2">
                      <Button
                        type="submit"
                        className="flex-1 bg-purple-600 hover:bg-purple-700"
                        disabled={isSubmitting}
                      >
                        {isSubmitting ? 'Submitting...' : 'Submit'}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setShowApplicationForm(false)}
                        disabled={isSubmitting}
                      >
                        Cancel
                      </Button>
                    </div>
                  </form>
                )}
              </CardContent>
            </Card>

            {/* Job Details */}
            <Card>
              <CardHeader>
                <CardTitle>Job Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-start gap-3">
                  <GraduationCap className="w-5 h-5 text-slate-500 mt-0.5" />
                  <div>
                    <div className="text-sm text-slate-500">Education</div>
                    <div className="font-medium">{job.education}</div>
                  </div>
                </div>

                <Separator />

                <div className="flex items-start gap-3">
                  <Clock className="w-5 h-5 text-slate-500 mt-0.5" />
                  <div>
                    <div className="text-sm text-slate-500">Experience</div>
                    <div className="font-medium">{job.experience}</div>
                  </div>
                </div>

                <Separator />

                <div className="flex items-start gap-3">
                  <Users className="w-5 h-5 text-slate-500 mt-0.5" />
                  <div>
                    <div className="text-sm text-slate-500">Level</div>
                    <div className="font-medium">{job.level}</div>
                  </div>
                </div>

                {job.salary && (
                  <>
                    <Separator />
                    <div className="flex items-start gap-3">
                      <DollarSign className="w-5 h-5 text-slate-500 mt-0.5" />
                      <div>
                        <div className="text-sm text-slate-500">Salary Range</div>
                        <div className="font-medium">
                          {formatSalary(job.salary as JobData['salary'])}
                        </div>
                      </div>
                    </div>
                  </>
                )}

                <Separator />

                <div className="flex items-start gap-3">
                  <Users className="w-5 h-5 text-slate-500 mt-0.5" />
                  <div>
                    <div className="text-sm text-slate-500">Openings</div>
                    <div className="font-medium">{job.openings} position(s)</div>
                  </div>
                </div>

                {job.applicationDeadline && (
                  <>
                    <Separator />
                    <div className="flex items-start gap-3">
                      <Calendar className="w-5 h-5 text-slate-500 mt-0.5" />
                      <div>
                        <div className="text-sm text-slate-500">Deadline</div>
                        <div className="font-medium">
                          {new Date(job.applicationDeadline).toLocaleDateString()}
                        </div>
                      </div>
                    </div>
                  </>
                )}

                {job.hiringManager && (
                  <>
                    <Separator />
                    <div className="flex items-start gap-3">
                      <User className="w-5 h-5 text-slate-500 mt-0.5" />
                      <div>
                        <div className="text-sm text-slate-500">Hiring Manager</div>
                        <div className="font-medium">
                          {job.hiringManager.firstName} {job.hiringManager.lastName}
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </div>
    </div>
  )
}
