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
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Progress } from '@/components/ui/progress'
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
  const [uploadProgress, setUploadProgress] = useState(0)
  const [isUploading, setIsUploading] = useState(false)
  const [parsedCVData, setParsedCVData] = useState<any>(null)
  const [candidateId, setCandidateId] = useState<string | null>(null)
  const [showParsedData, setShowParsedData] = useState(false)
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
      coverLetter: '',
    },
  })

  const handleFileUpload = async (file: File) => {
    if (!file) return

    // Clear any previous errors
    setUploadError(null)

    // Validate file type
    const allowedTypes = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
    if (!allowedTypes.includes(file.type)) {
      setUploadError('Please upload a PDF or Word document')
      return
    }

    // Validate file size (10MB max)
    if (file.size > 10 * 1024 * 1024) {
      toast.error('File size must be less than 10MB')
      return
    }

    setIsUploading(true)
    setUploadProgress(0)

    try {
      const formData = new FormData()
      formData.append('resume', file) // Using 'resume' to match backend expectation
      formData.append('jobId', jobId) // Pass jobId to get organization from job

      // Show realistic progress for CV processing (can take several minutes)
      let progressValue = 0
      const progressInterval = setInterval(() => {
        progressValue += 1
        if (progressValue <= 30) {
          setUploadProgress(progressValue) // Quick initial upload
        } else if (progressValue <= 200) {
          setUploadProgress(30 + (progressValue - 30) * 0.3) // Slower CV parsing
        } else {
          setUploadProgress(Math.min(90, 30 + (progressValue - 30) * 0.2)) // Final processing
        }
      }, 1000) // Update every second for more realistic progress

      // Use the existing candidate creation endpoint (public)
      const response = await apiRequest(`/api/candidates/public/upload-cv`, {
        method: 'POST',
        body: formData,
      })

      clearInterval(progressInterval)
      setUploadProgress(100)

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ msg: 'Failed to upload CV' }))
        if (response.status === 408) {
          throw new Error('CV processing is taking longer than expected. Please try again or contact support.')
        }
        // Extract error message from various possible fields
        // Backend error handler sends: { error: "...", details: "..." } in dev mode
        const errorMsg = errorData.details ||        // Development error details (actual message)
                        errorData.msg ||             // Custom error message  
                        errorData.error?.message ||  // Nested error object
                        errorData.error ||           // Error string
                        'Failed to upload CV'
        throw new Error(errorMsg)
      }

      const result = await response.json()
      const candidate = result.candidate
      
      setUploadedFile(file)
      setCandidateId(candidate._id)
      setParsedCVData(result)
      setShowParsedData(true)
      setUploadError(null) // Clear any previous errors on success

      // Auto-fill form fields with candidate data
      if (candidate.firstName) form.setValue('firstName', candidate.firstName)
      if (candidate.lastName) form.setValue('lastName', candidate.lastName)
      if (candidate.email) form.setValue('email', candidate.email)
      if (candidate.phone) form.setValue('phone', candidate.phone)

      toast.success('CV uploaded and candidate created successfully!')
    } catch (error: any) {
      console.error('Error uploading CV:', error)
      
      // ✅ Display error directly in the form UI instead of toast
      let errorMessage = error.message || 'Failed to upload CV. Please try again.'
      
      // Detect parsing/extraction failures and provide helpful guidance
      if (error.message?.includes('Could not extract readable text') || 
          error.message?.includes('insufficient information') ||
          error.message?.includes('CV parsing failed')) {
        errorMessage = '⚠️ Unable to Read Resume File\n\n' +
                      'We couldn\'t extract text from your file. This usually happens with:\n\n' +
                      '• Scanned PDFs or images (not text-based)\n' +
                      '• Password-protected or corrupted files\n' +
                      '• Unsupported file formats\n\n' +
                      'What you can do:\n\n' +
                      '✓ Try uploading a text-based PDF or DOCX file\n' +
                      '✓ Or enter your information manually in the form below'
      }
      
      // Set error state to display in UI
      setUploadError(errorMessage)
    } finally {
      setIsUploading(false)
      setUploadProgress(0)
    }
  }

  const handleFileInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      handleFileUpload(file)
    }
  }

  const handleSubmit = async (data: ApplicationFormValues) => {
    if (!uploadedFile || !candidateId) {
      setSubmissionError('Please upload your CV to continue')
      return
    }

    // Clear any previous submission errors
    setSubmissionError(null)
    setIsSubmitting(true)

    try {
      // First, update the candidate with additional information
      const updateResponse = await apiRequest(`/api/candidates/public/${candidateId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...data,
          notes: data.coverLetter || '',
          source: 'public'
        }),
      })

      if (!updateResponse.ok) {
        const errorData = await updateResponse.json()
        throw new Error(errorData.error || 'Failed to update candidate')
      }

      // Then, add candidate to job's shortlist
      const shortlistResponse = await apiRequest(`/api/jobs/public/${jobId}/shortlist`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          candidateId: candidateId,
          coverLetter: data.coverLetter || '',
          notes: data.coverLetter || 'Applied through public job page'
        }),
      })

      if (!shortlistResponse.ok) {
        const errorData = await shortlistResponse.json()
        throw new Error(errorData.error || 'Failed to submit application')
      }

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
    setParsedCVData(null)
    setShowParsedData(false)
    setCandidateId(null)
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
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                    className="mt-2"
                  >
                    {isUploading ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Uploading...
                      </>
                    ) : (
                      <>
                        <Upload className="h-4 w-4 mr-2" />
                        Choose File
                      </>
                    )}
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

            {isUploading && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span>
                    {uploadProgress <= 30 ? 'Uploading CV...' : 
                     uploadProgress <= 60 ? 'Parsing CV content...' : 
                     uploadProgress <= 85 ? 'Analyzing with AI...' : 
                     'Finalizing candidate profile...'}
                  </span>
                  <span>{Math.round(uploadProgress)}%</span>
                </div>
                <Progress value={uploadProgress} className="h-2" />
                {uploadProgress > 30 && (
                  <p className="text-xs text-gray-500">
                    CV processing can take several minutes. Please wait...
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Parsed CV Data Preview */}
          {showParsedData && parsedCVData && (
            <Alert>
              <CheckCircle className="h-4 w-4" />
              <AlertDescription>
                <div className="space-y-2">
                  <p className="font-medium">CV uploaded and candidate created successfully!</p>
                  <p className="text-sm">
                    We've automatically filled in your information below. 
                    Please review and edit as needed.
                  </p>
                  {parsedCVData.candidate && (
                    <div className="mt-2 p-2 bg-gray-50 rounded text-xs">
                      <p><strong>Extracted:</strong> {parsedCVData.candidate.firstName} {parsedCVData.candidate.lastName}</p>
                      {parsedCVData.candidate.email && (
                        <p><strong>Email:</strong> {parsedCVData.candidate.email}</p>
                      )}
                      {parsedCVData.candidate.skills && (
                        <p><strong>Skills:</strong> {parsedCVData.candidate.skills}</p>
                      )}
                      {parsedCVData.candidate.position && (
                        <p><strong>Position:</strong> {parsedCVData.candidate.position}</p>
                      )}
                    </div>
                  )}
                </div>
              </AlertDescription>
            </Alert>
          )}

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