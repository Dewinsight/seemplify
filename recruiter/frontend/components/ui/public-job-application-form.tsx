"use client"

import { useState, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import {
  Upload,
  File,
  CheckCircle,
  AlertCircle,
  Loader2,
  X,
  User,
  Mail,
  Phone,
  FileText,
  Send
} from 'lucide-react'
import { toast } from 'sonner'
import { apiRequest } from '@/services/apiConfig'

const applicationFormSchema = z.object({
  firstName: z.string().min(2, {
    message: "First name must be at least 2 characters.",
  }),
  lastName: z.string().min(2, {
    message: "Last name must be at least 2 characters.",
  }),
  email: z.string().email({
    message: "Please enter a valid email address.",
  }),
  phone: z.string().min(10, {
    message: "Please enter a valid phone number.",
  }),
  isOrganizationStaff: z.boolean(),
  coverLetter: z.string().optional(),
})

type ApplicationFormValues = z.infer<typeof applicationFormSchema>

interface PublicJobApplicationFormProps {
  jobId: string
  jobTitle: string
  onClose: () => void
  onSuccess: () => void
}

type SubmissionStage = 'idle' | 'creating' | 'securing'

type CommittedApplication = {
  candidateId: string
  successUrl: string
}

type PublicApplicationCapability = {
  token: string
  expiresAt?: string
}

type PersistedApplicationAttempt = {
  idempotencyKey: string
  fingerprint: string
}

const PUBLIC_APPLICATION_ATTEMPT_PREFIX = 'seemplify_public_application_attempt_v1:'

async function applicationFingerprint(data: ApplicationFormValues) {
  const canonical = JSON.stringify({
    firstName: data.firstName.trim(),
    lastName: data.lastName.trim(),
    email: data.email.trim().toLowerCase(),
    phone: data.phone.trim(),
    coverLetter: data.coverLetter || '',
    isOrganizationStaff: Boolean(data.isOrganizationStaff),
  })
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical))
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  }
  // This value only reconciles a browser retry; the server independently
  // verifies its own SHA-256 request fingerprint.
  let hash = 2166136261
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `fallback-${(hash >>> 0).toString(16)}`
}

export function PublicJobApplicationForm({
  jobId, 
  jobTitle, 
  onClose, 
  onSuccess 
}: PublicJobApplicationFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submissionStage, setSubmissionStage] = useState<SubmissionStage>('idle')
  const [committedApplication, setCommittedApplication] = useState<CommittedApplication | null>(null)
  const [uploadedFile, setUploadedFile] = useState<File | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [submissionError, setSubmissionError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const applicationAttemptRef = useRef<PersistedApplicationAttempt | null>(null)
  const submittedDataRef = useRef<ApplicationFormValues | null>(null)
  // The raw bearer capability deliberately stays in memory. A reload replays
  // candidate creation with the original idempotency key to rotate it.
  const applicationCapabilityRef = useRef<PublicApplicationCapability | null>(null)

  const attemptStorageKey = `${PUBLIC_APPLICATION_ATTEMPT_PREFIX}${jobId}`

  const getApplicationAttempt = async (data: ApplicationFormValues) => {
    const fingerprint = await applicationFingerprint(data)
    let current = applicationAttemptRef.current

    if (!current && typeof window !== 'undefined') {
      try {
        const stored = sessionStorage.getItem(attemptStorageKey)
        if (stored) current = JSON.parse(stored) as PersistedApplicationAttempt
      } catch {
        // Storage can be unavailable in privacy-restricted browser contexts.
      }
    }

    if (!current || current.fingerprint !== fingerprint) {
      current = {
        idempotencyKey: globalThis.crypto?.randomUUID?.()
          || `${jobId}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        fingerprint,
      }
    }

    applicationAttemptRef.current = current
    if (typeof window !== 'undefined') {
      try {
        sessionStorage.setItem(attemptStorageKey, JSON.stringify(current))
      } catch {
        // The in-memory attempt still protects retries in this render.
      }
    }
    return current
  }

  const clearApplicationAttempt = () => {
    applicationAttemptRef.current = null
    applicationCapabilityRef.current = null
    if (typeof window !== 'undefined') {
      try {
        sessionStorage.removeItem(attemptStorageKey)
      } catch {
        // Nothing sensitive is left in memory after durable acceptance.
      }
    }
  }

  const form = useForm<ApplicationFormValues>({
    resolver: zodResolver(applicationFormSchema),
    defaultValues: {
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      isOrganizationStaff: false,
      coverLetter: '',
    },
  })

  // CV upload no longer blocks the form: we just stage the file locally.
  // It's sent to the backend (and parsed/analyzed) in the background once
  // the application is submitted, so applicants never wait on extraction.
  const handleFileUpload = (file: File) => {
    if (!file) return

    setUploadError(null)

    const allowedTypes = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
    const allowedExtensions = ['.pdf', '.doc', '.docx']
    const lowerName = file.name.toLowerCase()
    const hasAllowedExtension = allowedExtensions.some((extension) => lowerName.endsWith(extension))
    const hasGenericType = !file.type || file.type === 'application/octet-stream'
    if (!allowedTypes.includes(file.type) && !(hasGenericType && hasAllowedExtension)) {
      setUploadError('Please upload a PDF or Word document')
      return
    }

    if (file.size > 10 * 1024 * 1024) {
      toast.error('File size must be less than 10MB')
      return
    }

    setUploadedFile(file)
  }

  const handleFileInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      handleFileUpload(file)
    }
  }

  // Wait only until the server has durably retained the file and returned a
  // tracked 202 response. Analysis remains asynchronous and can safely
  // continue after navigation.
  const secureCvForBackgroundProcessing = async (
    candidateId: string,
    file: File,
    idempotencyKey: string,
    capabilityToken: string,
  ) => {
    const formData = new FormData()
    formData.append('resume', file)
    formData.append('jobId', jobId)
    formData.append('candidateId', candidateId)

    const response = await apiRequest(`/api/candidates/public/upload-cv`, {
      skipAuth: true,
      method: 'POST',
      headers: {
        'Idempotency-Key': idempotencyKey,
        'X-Public-Application-Token': capabilityToken,
        'X-Public-Job-Id': jobId,
        'X-Public-Candidate-Id': candidateId,
      },
      body: formData,
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok || response.status !== 202 || !payload.jobId) {
      throw new Error(payload.msg || payload.message || payload.error || 'Your CV could not be secured for background processing')
    }
    return payload
  }

  const handleSubmit = async (data: ApplicationFormValues) => {
    if (!uploadedFile) {
      setSubmissionError('Please upload your CV to continue')
      return
    }

    setSubmissionError(null)
    setIsSubmitting(true)
    let applicationWasCommitted = Boolean(committedApplication)

    try {
      const submissionData = committedApplication && submittedDataRef.current
        ? submittedDataRef.current
        : data
      submittedDataRef.current = submissionData
      const applicationAttempt = await getApplicationAttempt(submissionData)
      const applicationIdempotencyKey = applicationAttempt.idempotencyKey

      // This is also the recovery handshake after a reload or an uncertain CV
      // response: the original key converges on the same candidate and rotates
      // a fresh, short-lived capability without storing that capability.
      setSubmissionStage('creating')
      const createResponse = await apiRequest(`/api/candidates/public`, {
        skipAuth: true,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': applicationIdempotencyKey,
        },
        body: JSON.stringify({
          firstName: submissionData.firstName,
          lastName: submissionData.lastName,
          email: submissionData.email,
          phone: submissionData.phone,
          jobId,
          isOrganizationStaff: submissionData.isOrganizationStaff,
          coverLetter: submissionData.coverLetter || '',
        }),
      })

      if (!createResponse.ok) {
        const errorData = await createResponse.json().catch(() => ({}))
        throw new Error(errorData.msg || errorData.error || 'Failed to submit application')
      }

      const createPayload = await createResponse.json().catch(() => ({}))
      const candidateId = createPayload.candidate?._id
      const capability = createPayload.applicationCapability as PublicApplicationCapability | undefined
      if (!candidateId || !capability?.token) {
        throw new Error('This application could not be resumed in this browser session. Please retry from the same browser tab used to begin it.')
      }
      applicationCapabilityRef.current = capability

      // Redirect to success page with query parameters
      const successUrl = new URL('/public/jobs/application-success', window.location.origin)
      successUrl.searchParams.set('jobTitle', jobTitle)
      successUrl.searchParams.set('candidateName', `${submissionData.firstName} ${submissionData.lastName}`)
      successUrl.searchParams.set('email', submissionData.email)

      const committed = committedApplication || { candidateId, successUrl: successUrl.toString() }
      applicationWasCommitted = true
      setCommittedApplication(committed)
      setSubmissionStage('securing')
      await secureCvForBackgroundProcessing(candidateId, uploadedFile, applicationIdempotencyKey, capability.token)
      clearApplicationAttempt()

      toast.success('Application submitted successfully!')
      window.location.href = committed.successUrl
    } catch (error: any) {
      console.error('Error submitting application:', error)
      setSubmissionError(applicationWasCommitted
        ? `Your application was submitted, but we could not securely upload your CV. It has not been sent for analysis yet. ${error.message || 'Please retry the CV upload.'}`
        : error.message || 'Failed to submit application')
    } finally {
      setIsSubmitting(false)
      setSubmissionStage('idle')
    }
  }

  const removeFile = () => {
    setUploadedFile(null)
    setUploadError(null) // Clear error when removing file
    setSubmissionError(null) // Clear submission error when removing file
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !isSubmitting) onClose() }}>
      <DialogContent
        className="max-h-[90vh] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto"
        showCloseButton={!isSubmitting}
      >
        <DialogHeader>
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="flex items-center gap-2">
                <Send className="h-5 w-5" />
                Apply for {jobTitle}
              </DialogTitle>
              <DialogDescription>
                Fill out the form below to submit your application
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="space-y-6">
          {/* CV Upload Section */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-medium">Upload Your CV</h3>
              <Badge variant="outline" className="text-xs">
                Required
              </Badge>
            </div>
            
            {!uploadedFile ? (
              <div
                className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault()
                  const file = event.dataTransfer.files?.[0]
                  if (file) handleFileUpload(file)
                }}
              >
                <div className="space-y-2">
                  <Upload className="h-8 w-8 mx-auto text-gray-400" />
                  <div>
                    <p className="text-sm text-gray-600">
                      Click to upload or drag and drop your CV
                    </p>
                    <p className="text-xs text-gray-500">
                      PDF, DOC, or DOCX (max 10MB)
                    </p>
                    <p className="text-xs text-amber-600/90 mt-1">
                      For best results avoid image-based or scanned CVs. Ensure the email in your CV is correct — a wrong email can cause issues.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                    className="mt-2"
                  >
                    <Upload className="h-4 w-4 mr-2" />
                    Choose File
                  </Button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.doc,.docx"
                    onChange={handleFileInputChange}
                    className="hidden"
                  />
                </div>
              </div>
            ) : (
              <div className="border rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <File className="h-5 w-5 text-blue-500" />
                    <div>
                      <p className="text-sm font-medium">{uploadedFile.name}</p>
                      <p className="text-xs text-gray-500">
                        {(uploadedFile.size / 1024 / 1024).toFixed(2)} MB
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-green-500" />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={removeFile}
                      disabled={isSubmitting}
                      className="h-8 w-8 p-0"
                      aria-label={`Remove ${uploadedFile.name}`}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* ✅ Display upload error in the form UI */}
            {uploadError && (
              <Alert variant="destructive" className="mt-4">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="whitespace-pre-line">
                  {uploadError}
                </AlertDescription>
              </Alert>
            )}

          </div>

          {/* Application Form */}
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="firstName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-2">
                        <User className="h-4 w-4" />
                        First Name
                      </FormLabel>
                      <FormControl>
                        <Input placeholder="John" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="lastName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Last Name</FormLabel>
                      <FormControl>
                        <Input placeholder="Doe" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-2">
                      <Mail className="h-4 w-4" />
                      Email Address
                    </FormLabel>
                    <FormControl>
                      <Input placeholder="john.doe@example.com" type="email" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-2">
                      <Phone className="h-4 w-4" />
                      Phone Number
                    </FormLabel>
                    <FormControl>
                      <Input placeholder="+1234567890" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="isOrganizationStaff"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={(checked) => field.onChange(Boolean(checked))}
                      />
                    </FormControl>
                    <div className="space-y-1 leading-none">
                      <FormLabel>Are you currently staff of this organization?</FormLabel>
                      <FormDescription>
                        Select this only if you currently work at this company.
                      </FormDescription>
                    </div>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="coverLetter"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-2">
                      <FileText className="h-4 w-4" />
                      Cover Letter (Optional)
                    </FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Tell us why you're interested in this position..."
                        className="min-h-[100px]"
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      A brief message about your interest in the role and why you'd be a good fit.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Display submission error in the form UI */}
              {submissionError && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    {submissionError}
                  </AlertDescription>
                </Alert>
              )}

              <div className="flex items-center justify-between pt-4">
                <Button type="button" variant="outline" onClick={onClose}>
                  Cancel
                </Button>
                <Button 
                  type="submit" 
                  disabled={isSubmitting || !uploadedFile}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          {submissionStage === 'securing'
                            ? 'Securing CV for background processing…'
                            : 'Creating application…'}
                    </>
                  ) : (
                    <>
                      <Send className="h-4 w-4 mr-2" />
                      {committedApplication ? 'Retry CV upload' : 'Submit Application'}
                    </>
                  )}
                </Button>
              </div>
            </form>
          </Form>
        </div>
      </DialogContent>
    </Dialog>
  )
} 
