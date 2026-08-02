"use client"

import { useState, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
  isOrganizationStaff: z.boolean().default(false),
  coverLetter: z.string().optional(),
})

type ApplicationFormValues = z.infer<typeof applicationFormSchema>

interface PublicJobApplicationFormProps {
  jobId: string
  jobTitle: string
  onClose: () => void
  onSuccess: () => void
}

export function PublicJobApplicationForm({
  jobId, 
  jobTitle, 
  onClose, 
  onSuccess 
}: PublicJobApplicationFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [uploadedFile, setUploadedFile] = useState<File | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [submissionError, setSubmissionError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

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
    if (!allowedTypes.includes(file.type)) {
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

  // Uploads the CV for background parsing/enrichment. Deliberately not
  // awaited by the caller and never surfaced to the applicant - if parsing
  // fails (e.g. a scanned CV), the application has already been submitted
  // successfully and recruiters simply see an un-enriched candidate.
  const uploadCvInBackground = (candidateId: string, file: File) => {
    const formData = new FormData()
    formData.append('resume', file)
    formData.append('jobId', jobId)
    formData.append('candidateId', candidateId)
    const uploadIdempotencyKey = globalThis.crypto?.randomUUID?.()
      || `${jobId}-${Date.now()}-${Math.random().toString(36).slice(2)}`

    apiRequest(`/api/candidates/public/upload-cv`, {
      method: 'POST',
      headers: {
        'Idempotency-Key': uploadIdempotencyKey,
      },
      body: formData,
    }).catch((error) => {
      console.error('Background CV upload failed (application already submitted):', error)
    })
  }

  const handleSubmit = async (data: ApplicationFormValues) => {
    if (!uploadedFile) {
      setSubmissionError('Please upload your CV to continue')
      return
    }

    setSubmissionError(null)
    setIsSubmitting(true)

    try {
      // Create the candidate immediately from what the applicant typed -
      // no dependency on CV parsing.
      const createResponse = await apiRequest(`/api/candidates/public`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          firstName: data.firstName,
          lastName: data.lastName,
          email: data.email,
          phone: data.phone,
          jobId,
          isOrganizationStaff: data.isOrganizationStaff,
          coverLetter: data.coverLetter || '',
        }),
      })

      if (!createResponse.ok) {
        const errorData = await createResponse.json().catch(() => ({}))
        throw new Error(errorData.msg || errorData.error || 'Failed to submit application')
      }

      const { candidate } = await createResponse.json()
      const candidateId = candidate._id

      // Then, add candidate to job's shortlist - this is the application.
      const shortlistResponse = await apiRequest(`/api/jobs/public/${jobId}/shortlist`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          candidateId: candidateId,
          isOrganizationStaff: data.isOrganizationStaff,
          coverLetter: data.coverLetter || '',
          notes: data.coverLetter || 'Applied through public job page'
        }),
      })

      if (!shortlistResponse.ok) {
        const errorData = await shortlistResponse.json()
        throw new Error(errorData.error || 'Failed to submit application')
      }

      // Fire the CV off for background parsing/enrichment - do not wait on it.
      uploadCvInBackground(candidateId, uploadedFile)

      toast.success('Application submitted successfully!')

      // Redirect to success page with query parameters
      const successUrl = new URL('/public/jobs/application-success', window.location.origin)
      successUrl.searchParams.set('jobTitle', jobTitle)
      successUrl.searchParams.set('candidateName', `${data.firstName} ${data.lastName}`)
      successUrl.searchParams.set('email', data.email)

      window.location.href = successUrl.toString()
    } catch (error: any) {
      console.error('Error submitting application:', error)
      // Display error in form UI instead of toast
      setSubmissionError(error.message || 'Failed to submit application')
    } finally {
      setIsSubmitting(false)
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
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Send className="h-5 w-5" />
                Apply for {jobTitle}
              </CardTitle>
              <CardDescription>
                Fill out the form below to submit your application
              </CardDescription>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="h-8 w-8 p-0"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* CV Upload Section */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-medium">Upload Your CV</h3>
              <Badge variant="outline" className="text-xs">
                Required
              </Badge>
            </div>
            
            {!uploadedFile ? (
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
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
                      className="h-8 w-8 p-0"
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
                      Submitting...
                    </>
                  ) : (
                    <>
                      <Send className="h-4 w-4 mr-2" />
                      Submit Application
                    </>
                  )}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  )
} 
