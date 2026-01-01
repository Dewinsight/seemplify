"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm, useWatch, type SubmitHandler } from "react-hook-form"
import { z } from "zod"
import { ChevronRight, Check, Loader2, Sparkles, Wand2, Plus, CheckCircle, XCircle, Settings } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card"
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Checkbox } from "@/components/ui/checkbox"
import { toast } from "@/components/ui/use-toast"
import { createJob, type JobFormData } from "@/services/jobService"
import { generateJobDescription as aiGenerateJobDescription, generateJobRequirements as aiGenerateJobRequirements } from "@/services/aiService"
import { Badge } from "@/components/ui/badge"
import { prepareFormDataForSave } from "@/utils/htmlDecode"

import { Progress } from "@/components/ui/progress"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import DepartmentSelect from "@/components/department-select"
import DepartmentManagement from "@/components/department-management"
import { CurrencySelector } from "@/components/ui/currency-selector"
import { getCurrencySymbol, DEFAULT_CURRENCY } from "@/lib/currencies"
import { CurrencyManagementDialog } from "@/components/settings/currency-management-dialog"
import { getCurrencies } from "@/services/currencyService"
import { useCreditError } from "@/hooks/useCreditError"
import { CreditErrorDialog } from "@/components/ui/credit-error-dialog"

const jobFormSchema = z.object({
  title: z.string().min(2, {
    message: "Job title must be at least 2 characters.",
  }),
  department: z.string().min(1, {
    message: "Please select a department.",
  }),
  location: z.string().min(2, {
    message: "Location must be at least 2 characters.",
  }),
  type: z.enum(['Full-time', 'Part-time', 'Contract', 'Internship', 'Freelance'], {
    required_error: "Please select a job type.",
  }),
  level: z.enum(['Entry', 'Mid', 'Senior', 'Lead', 'Executive'], {
    required_error: "Please select a job level.",
  }),
  description: z.string().min(10, {
    message: "Job description must be at least 10 characters.",
  }),
  requirements: z.string().min(10, {
    message: "Job requirements must be at least 10 characters.",
  }),
  responsibilities: z.string().min(10, {
    message: "Job responsibilities must be at least 10 characters.",
  }),
  experience: z.enum(['0-1', '1-3', '3-5', '5-10', '10+'], {
    required_error: "Please select experience requirement.",
  }),
  education: z.enum(['High School', 'Associate', 'Bachelor', 'Master', 'PhD', 'Professional Certificate'], {
    required_error: "Please select education requirement.",
  }),
  skills: z.string().optional(),
  minSalary: z.number().min(0).optional(),
  maxSalary: z.number().min(0).optional(),
  currency: z.string().default(DEFAULT_CURRENCY),
  benefits: z.string().optional(),
  remote: z.boolean().default(false),
  openings: z.number().min(1).default(1),
  applicationDeadline: z.string().optional(),
  isPublic: z.boolean().default(false),
  candidateApplyLimit: z.number().min(1).optional(),
}).refine((data) => {
  // If job is public, candidateApplyLimit must be provided
  if (data.isPublic && (!data.candidateApplyLimit || data.candidateApplyLimit <= 0)) {
    return false;
  }
  return true;
}, {
  message: "Candidate apply limit is required for public jobs",
  path: ["candidateApplyLimit"],
})

type JobFormValues = z.infer<typeof jobFormSchema>

const defaultValues: Partial<JobFormValues> = {
  title: "",
  department: "",
  location: "",
  type: "Full-time",
  level: "Mid",
  description: "",
  requirements: "",
  responsibilities: "",
  experience: "1-3",
  education: "Bachelor",
  skills: "",
  minSalary: undefined,
  maxSalary: undefined,
  currency: DEFAULT_CURRENCY,
  benefits: "",
  remote: false,
  openings: 1,
  applicationDeadline: "",
  isPublic: false,
  candidateApplyLimit: undefined,
}

// Define which fields are required for each tab
const TAB_FIELD_MAPPING = {
  basic: ['title', 'department', 'location', 'type', 'level'] as const,
  description: ['description'] as const,
  requirements: ['requirements', 'responsibilities', 'experience', 'education'] as const,
  compensation: [] as const, // All fields optional in this tab
}

export default function CreateJobPage() {
  const router = useRouter()
  const { creditError, showCreditDialog, setShowCreditDialog, handleError } = useCreditError()
  const [activeTab, setActiveTab] = useState("basic")
  const [completedTabs, setCompletedTabs] = useState<string[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isGeneratingDescription, setIsGeneratingDescription] = useState(false)
  const [isGeneratingRequirements, setIsGeneratingRequirements] = useState(false)
  const [creationStep, setCreationStep] = useState<string>("")
  const [showProgress, setShowProgress] = useState(false)
  
  // Success/Error modal states
  const [showSuccessModal, setShowSuccessModal] = useState(false)
  const [showErrorModal, setShowErrorModal] = useState(false)
  const [createdJob, setCreatedJob] = useState<any>(null)
  const [errorDetails, setErrorDetails] = useState<string>("")

  const [showDepartmentDialog, setShowDepartmentDialog] = useState(false)
  const [showCurrencyDialog, setShowCurrencyDialog] = useState(false)
  const [currencyRefreshKey, setCurrencyRefreshKey] = useState(0)
  const [aiAssistantError, setAiAssistantError] = useState<string>("")

  const form = useForm<JobFormValues>({
    resolver: zodResolver(jobFormSchema) as any,
    defaultValues,
  })

  // Fetch organization's default currency on mount
  useEffect(() => {
    const fetchDefaultCurrency = async () => {
      try {
        const data = await getCurrencies()
        const orgDefaultCurrency = data.defaultCurrency || DEFAULT_CURRENCY
        
        // Update the form's currency field with organization's default
        form.setValue('currency', orgDefaultCurrency)
        
        console.log('✅ Set default currency to:', orgDefaultCurrency)
      } catch (error) {
        console.error('Failed to fetch default currency, using USD:', error)
        // Fallback to USD if fetch fails
        form.setValue('currency', DEFAULT_CURRENCY)
      }
    }
    
    fetchDefaultCurrency()
  }, [form])

  // Watch the benefits field for performance optimization
  const watchedBenefits = useWatch({
    control: form.control,
    name: "benefits",
    defaultValue: "",
  })

  // Watch required fields and clear error when they're filled
  const watchedTitle = useWatch({ control: form.control, name: "title" })
  const watchedDepartment = useWatch({ control: form.control, name: "department" })
  const watchedLocation = useWatch({ control: form.control, name: "location" })

  useEffect(() => {
    // Clear error if all required fields are filled
    if (aiAssistantError && watchedTitle && watchedDepartment && watchedLocation) {
      setAiAssistantError("")
    }
  }, [watchedTitle, watchedDepartment, watchedLocation, aiAssistantError])

  const onSubmit = async (data: JobFormValues) => {
    setIsSubmitting(true)
    setShowProgress(true)

    try {
      // Step 1: Preparing job data
      setCreationStep("Preparing job data...")
      await new Promise(resolve => setTimeout(resolve, 500))

      // Decode HTML entities from all text fields to prevent &amp; appearing as &amp; instead of &
      const cleanedData = prepareFormDataForSave(data);

      // Transform form data to match API expectations
      const jobData: JobFormData = {
        title: cleanedData.title,
        department: cleanedData.department,
        location: cleanedData.location,
        type: cleanedData.type,
        level: cleanedData.level,
        description: cleanedData.description,
        requirements: cleanedData.requirements,
        responsibilities: cleanedData.responsibilities,
        experience: cleanedData.experience,
        education: cleanedData.education,
        skills: cleanedData.skills,
        benefits: cleanedData.benefits,
        remote: cleanedData.remote,
        openings: cleanedData.openings,
        salary: cleanedData.minSalary || cleanedData.maxSalary ? {
          min: cleanedData.minSalary || 0,
          max: cleanedData.maxSalary || 0,
          currency: (cleanedData.currency || DEFAULT_CURRENCY) as any,
          period: 'annually',
        } : undefined,
        applicationDeadline: cleanedData.applicationDeadline,
        status: 'active',
      };

      // Step 2: Creating job posting
      setCreationStep("Creating job posting...")
      await new Promise(resolve => setTimeout(resolve, 300))

      const result = await createJob(jobData);
      
      // Step 3: Finalizing
      setCreationStep("Finalizing job creation...")
      await new Promise(resolve => setTimeout(resolve, 300))
      
      setIsSubmitting(false);
      setShowProgress(false);
      
      // Show success modal instead of toast + redirect
      setCreatedJob(result.job);
      setShowSuccessModal(true);
      
    } catch (error: any) {
      setIsSubmitting(false);
      setShowProgress(false);
      setCreationStep("");
      
      // Check if it's a credit error
      const isCreditError = handleError(error);
      
      if (!isCreditError) {
        // Show error modal for non-credit errors
        setErrorDetails(error.message || "An unexpected error occurred while creating the job.");
        setShowErrorModal(true);
      }
      
      console.error("Failed to create job:", error);
    }
  }

  const generateJobDescription = async () => {
    const title = form.getValues("title")
    const department = form.getValues("department")
    const location = form.getValues("location")
    const level = form.getValues("level")
    const type = form.getValues("type")
    const experience = form.getValues("experience")
    const education = form.getValues("education")

    // Clear any previous errors
    setAiAssistantError("")

    // Validate required fields
    const missingFields: string[] = []
    if (!title) missingFields.push("job title")
    if (!department) missingFields.push("department")
    if (!location) missingFields.push("location")

    if (missingFields.length > 0) {
      const errorMessage = `Please fill in ${missingFields.join(", ")} before generating the job description.`
      setAiAssistantError(errorMessage)
      toast({
        title: "Missing Information",
        description: errorMessage,
        variant: "destructive",
      })
      return
    }

    setIsGeneratingDescription(true)
    setAiAssistantError("")

    try {
      const result = await aiGenerateJobDescription({
        title,
        department,
        level,
        location,
        type,
        experience,
        education,
      })

      form.setValue("description", result.description)
      
      // If we got responsibilities array, convert to string and set it
      if (result.responsibilities && result.responsibilities.length > 0) {
        const responsibilitiesText = result.responsibilities.map(item => `• ${item}`).join('\n')
        form.setValue("responsibilities", responsibilitiesText)
      }

      // If we got skills array, convert to string and set it
      if (result.skills && result.skills.length > 0) {
        const skillsText = result.skills.join(', ')
        form.setValue("skills", skillsText)
      }

      // If we got benefits array, map to benefit IDs and set it
      if (result.benefits && result.benefits.length > 0) {
        const benefitsText = result.benefits.join('\n• ')
        form.setValue("benefits", '• ' + benefitsText)
      }

      setIsGeneratingDescription(false)

      toast({
        title: "Description Generated",
        description: "AI has created a comprehensive job description based on your inputs.",
      })
    } catch (error: any) {
      setIsGeneratingDescription(false)
      const errorMessage = error.message || "Failed to generate job description. Please try again."
      setAiAssistantError(errorMessage)
      toast({
        title: "Generation Failed",
        description: errorMessage,
        variant: "destructive",
      })
    }
  }

  const generateJobRequirements = async () => {
    const title = form.getValues("title")
    const department = form.getValues("department")
    const location = form.getValues("location")
    const level = form.getValues("level")
    const type = form.getValues("type")
    const experience = form.getValues("experience")
    const education = form.getValues("education")

    // Clear any previous errors
    setAiAssistantError("")

    // Validate required fields
    const missingFields: string[] = []
    if (!title) missingFields.push("job title")
    if (!department) missingFields.push("department")
    if (!location) missingFields.push("location")

    if (missingFields.length > 0) {
      const errorMessage = `Please fill in ${missingFields.join(", ")} before generating the job requirements.`
      setAiAssistantError(errorMessage)
      toast({
        title: "Missing Information",
        description: errorMessage,
        variant: "destructive",
      })
      return
    }

    setIsGeneratingRequirements(true)
    setAiAssistantError("")

    try {
      const result = await aiGenerateJobRequirements({
        title,
        department,
        level,
        type,
        experience,
        education,
      })

      form.setValue("requirements", result.requirements)
      setIsGeneratingRequirements(false)

      toast({
        title: "Requirements Generated",
        description: "AI has created detailed job requirements based on your inputs.",
      })
    } catch (error: any) {
      setIsGeneratingRequirements(false)
      const errorMessage = error.message || "Failed to generate job requirements. Please try again."
      setAiAssistantError(errorMessage)
      toast({
        title: "Generation Failed",
        description: errorMessage,
        variant: "destructive",
      })
    }
  }


  const handleNextTab = async (newTab: string) => {
    const currentTabFields = TAB_FIELD_MAPPING[activeTab as keyof typeof TAB_FIELD_MAPPING]
    const nextTabFields = TAB_FIELD_MAPPING[newTab as keyof typeof TAB_FIELD_MAPPING]

    // Check if all required fields in the next tab are filled
    const isNextTabValid = nextTabFields.every(field => {
      const formValue = form.getValues(field)
      return formValue !== undefined && formValue !== null && formValue !== ""
    })

    if (!isNextTabValid) {
      toast({
        title: "Incomplete Fields",
        description: `Please fill in all required fields in the "${newTab}" tab before proceeding.`,
        variant: "destructive",
      })
      return
    }

    setActiveTab(newTab)
    // If going forward, validate current tab first
    await handleNextTab(newTab)
  }

  // Navigation handlers for success/error modals
  const handleViewJob = () => {
    setShowSuccessModal(false)
    if (createdJob) {
      router.push(`/jobs/${createdJob._id}`)
    }
  }

  const handleCreateAnother = () => {
    setShowSuccessModal(false)
    form.reset(defaultValues)
    setActiveTab("basic")
    setCompletedTabs([])
  }

  const handleTryAgain = () => {
    setShowErrorModal(false)
  }

  const handleCancelJobCreation = () => {
    setShowErrorModal(false)
    router.push('/jobs')
  }



  return (
    <div className="container mx-auto p-4 sm:p-6">
      <div className="mb-6 flex flex-col sm:flex-row items-start sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Create New Job</h1>
          <p className="text-muted-foreground text-sm sm:text-base">
            Fill out the form below to create a new job posting.
          </p>
          {showProgress && (
            <div className="mt-4 p-4 bg-blue-50 rounded-lg border border-blue-200">
              <div className="flex items-center space-x-3">
                <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
                <div>
                  <p className="text-sm font-medium text-blue-900">Creating your job posting...</p>
                  <p className="text-xs text-blue-600">{creationStep}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-8">
        <div className="w-full lg:w-2/3">
          <Card>
            <CardHeader>
              <CardTitle>Job Details</CardTitle>
              <CardDescription>
                Enter the details for the new job posting. All fields marked with * are required.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="relative w-full overflow-x-auto bg-muted p-1 rounded-lg flex justify-start scrollbar-hide">
                  <TabsTrigger value="basic" className="flex-shrink-0">Basic Info</TabsTrigger>
                  <TabsTrigger value="description" className="flex-shrink-0">Description</TabsTrigger>
                  <TabsTrigger value="requirements" className="flex-shrink-0">Requirements</TabsTrigger>
                  <TabsTrigger value="compensation" className="flex-shrink-0">Compensation</TabsTrigger>
                </TabsList>

                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8 pt-6">
                    <TabsContent value="basic" className="space-y-4">
                      <div className="grid gap-4 sm:grid-cols-2">
                        <FormField
                          control={form.control}
                          name="title"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Job Title *</FormLabel>
                              <FormControl>
                                <Input placeholder="e.g. Senior Software Engineer" {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="department"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Department *</FormLabel>
                              <DepartmentSelect
                                value={field.value}
                                onValueChange={field.onChange}
                                placeholder="Select department"
                                showCreateOption={true}
                                onCreateDepartment={() => setShowDepartmentDialog(true)}
                              />
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <FormField
                          control={form.control}
                          name="location"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Location *</FormLabel>
                              <FormControl>
                                <Input placeholder="e.g. Lagos, Nigeria" {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="type"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Job Type *</FormLabel>
                              <Select onValueChange={field.onChange} defaultValue={field.value}>
                                <FormControl>
                                  <SelectTrigger>
                                    <SelectValue placeholder="Select job type" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="Full-time">Full-time</SelectItem>
                                  <SelectItem value="Part-time">Part-time</SelectItem>
                                  <SelectItem value="Contract">Contract</SelectItem>
                                  <SelectItem value="Internship">Internship</SelectItem>
                                  <SelectItem value="Freelance">Freelance</SelectItem>
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <FormField
                          control={form.control}
                          name="level"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Job Level *</FormLabel>
                              <Select onValueChange={field.onChange} defaultValue={field.value}>
                                <FormControl>
                                  <SelectTrigger>
                                    <SelectValue placeholder="Select job level" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="Entry">Entry</SelectItem>
                                  <SelectItem value="Mid">Mid</SelectItem>
                                  <SelectItem value="Senior">Senior</SelectItem>
                                  <SelectItem value="Lead">Lead</SelectItem>
                                  <SelectItem value="Executive">Executive</SelectItem>
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="experience"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Experience Required *</FormLabel>
                              <Select onValueChange={field.onChange} defaultValue={field.value}>
                                <FormControl>
                                  <SelectTrigger>
                                    <SelectValue placeholder="Select experience level" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="0-1">0-1 years</SelectItem>
                                  <SelectItem value="1-3">1-3 years</SelectItem>
                                  <SelectItem value="3-5">3-5 years</SelectItem>
                                  <SelectItem value="5-10">5-10 years</SelectItem>
                                  <SelectItem value="10+">10+ years</SelectItem>
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <FormField
                          control={form.control}
                          name="education"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Education Required *</FormLabel>
                              <Select onValueChange={field.onChange} defaultValue={field.value}>
                                <FormControl>
                                  <SelectTrigger>
                                    <SelectValue placeholder="Select education level" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="High School">High School</SelectItem>
                                  <SelectItem value="Associate">Associate</SelectItem>
                                  <SelectItem value="Bachelor">Bachelor</SelectItem>
                                  <SelectItem value="Master">Master</SelectItem>
                                  <SelectItem value="PhD">PhD</SelectItem>
                                  <SelectItem value="Professional Certificate">Professional Certificate</SelectItem>
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="openings"
                          render={({ field }) => (
                            <FormItem className="flex-1">
                              <FormLabel>Number of Openings</FormLabel>
                              <FormControl>
                                <Input
                                  type="number"
                                  min="1"
                                  value={field.value || ""}
                                  onChange={(e) => field.onChange(e.target.value ? Number(e.target.value) : 1)}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                      <div className="flex justify-end">
                        <Button type="button" onClick={() => setActiveTab("description")}>
                          Next <ChevronRight className="ml-2 h-4 w-4" />
                        </Button>
                      </div>
                    </TabsContent>

                    <TabsContent value="description" className="space-y-4">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-medium">Job Description *</h3>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="outline"
                                size="sm"
                                className="gap-2"
                                onClick={generateJobDescription}
                                disabled={isGeneratingDescription}
                              >
                                {isGeneratingDescription ? (
                                  <>
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    Generating...
                                  </>
                                ) : (
                                  <>
                                    <Wand2 className="h-4 w-4" />
                                    Generate with AI
                                  </>
                                )}
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>Generate a job description based on the title and department</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                      <FormField
                        control={form.control}
                        name="description"
                        render={({ field }) => (
                          <FormItem>
                            <FormControl>
                              <Textarea
                                placeholder="Enter a detailed job description..."
                                className="min-h-[200px]"
                                {...field}
                              />
                            </FormControl>
                            <FormDescription>
                              Describe the role, responsibilities, and what a typical day looks like.
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="responsibilities"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Job Responsibilities *</FormLabel>
                            <FormControl>
                              <Textarea
                                placeholder="Enter job responsibilities..."
                                className="min-h-[150px]"
                                {...field}
                              />
                            </FormControl>
                            <FormDescription>
                              List the key responsibilities and duties for this role.
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <div className="flex justify-between">
                        <Button type="button" variant="outline" onClick={() => setActiveTab("basic")}>
                          Back
                        </Button>
                        <Button type="button" onClick={() => setActiveTab("requirements")}>
                          Next <ChevronRight className="ml-2 h-4 w-4" />
                        </Button>
                      </div>
                    </TabsContent>

                    <TabsContent value="requirements" className="space-y-4">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-medium">Job Requirements *</h3>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="outline"
                                size="sm"
                                className="gap-2"
                                onClick={generateJobRequirements}
                                disabled={isGeneratingRequirements}
                              >
                                {isGeneratingRequirements ? (
                                  <>
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    Generating...
                                  </>
                                ) : (
                                  <>
                                    <Wand2 className="h-4 w-4" />
                                    Generate with AI
                                  </>
                                )}
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>Generate job requirements based on the title and department</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                      <FormField
                        control={form.control}
                        name="requirements"
                        render={({ field }) => (
                          <FormItem>
                            <FormControl>
                              <Textarea placeholder="Enter job requirements..." className="min-h-[200px]" {...field} />
                            </FormControl>
                            <FormDescription>
                              List qualifications, skills, experience, and education requirements.
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="skills"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Required Skills</FormLabel>
                            <FormControl>
                              <Textarea
                                placeholder="Enter required skills (comma-separated)..."
                                className="min-h-[100px]"
                                {...field}
                              />
                            </FormControl>
                            <FormDescription>
                              List the key skills and technologies required for this role.
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="remote"
                        render={({ field }) => (
                          <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                            <FormControl>
                              <Checkbox
                                checked={field.value}
                                onCheckedChange={field.onChange}
                              />
                            </FormControl>
                            <div className="space-y-1 leading-none">
                              <FormLabel>
                                Remote Work Available
                              </FormLabel>
                              <FormDescription>
                                Check if this position allows remote work.
                              </FormDescription>
                            </div>
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="applicationDeadline"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Application Deadline</FormLabel>
                            <FormControl>
                              <Input type="date" {...field} />
                            </FormControl>
                            <FormDescription>
                              Optional deadline for applications.
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <div className="flex justify-between">
                        <Button type="button" variant="outline" onClick={() => setActiveTab("description")}>
                          Back
                        </Button>
                        <Button type="button" onClick={() => setActiveTab("compensation")}>
                          Next <ChevronRight className="ml-2 h-4 w-4" />
                        </Button>
                      </div>
                    </TabsContent>

                    <TabsContent value="compensation" className="space-y-6">
                      <div className="space-y-4">
                        <h3 className="text-lg font-medium">Salary Range</h3>
                        <div className="flex items-end gap-3">
                          <FormField
                            control={form.control}
                            name="currency"
                            render={({ field }) => (
                              <FormItem className="flex-1">
                                <FormLabel>Currency</FormLabel>
                                <CurrencySelector
                                  key={currencyRefreshKey}
                                  value={field.value}
                                  onValueChange={field.onChange}
                                  placeholder="Select currency"
                                />
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="default"
                            onClick={() => setShowCurrencyDialog(true)}
                            className="flex-shrink-0"
                          >
                            <Settings className="mr-2 h-4 w-4" />
                            Manage
                          </Button>
                        </div>
                        <div className="flex items-center gap-4">
                          <FormField
                            control={form.control}
                            name="minSalary"
                            render={({ field }) => (
                              <FormItem className="flex-1">
                                <FormLabel>Minimum Salary ({getCurrencySymbol(form.watch('currency'))})</FormLabel>
                                <FormControl>
                                  <Input
                                    type="number"
                                    value={field.value || ""}
                                    onChange={(e) => field.onChange(e.target.value ? Number(e.target.value) : undefined)}
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={form.control}
                            name="maxSalary"
                            render={({ field }) => (
                              <FormItem className="flex-1">
                                <FormLabel>Maximum Salary ({getCurrencySymbol(form.watch('currency'))})</FormLabel>
                                <FormControl>
                                  <Input
                                    type="number"
                                    value={field.value || ""}
                                    onChange={(e) => field.onChange(e.target.value ? Number(e.target.value) : undefined)}
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>
                      </div>

                      <div className="space-y-4">
                        <FormField
                          control={form.control}
                          name="benefits"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Benefits & Perks</FormLabel>
                              <FormControl>
                                <Textarea
                                  placeholder="List benefits, perks, and what makes your company great to work for..."
                                  className="min-h-[120px]"
                                  {...field}
                                />
                              </FormControl>
                              <FormDescription>
                                Describe the benefits package, perks, and company culture. This can also be auto-generated when using AI job description.
                              </FormDescription>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>

                      {/* Public Job Settings */}
                      <div className="space-y-4 border-t pt-6">
                        <div>
                          <h3 className="text-lg font-medium mb-1">Public Job Settings</h3>
                          <p className="text-sm text-muted-foreground">
                            Control how external candidates can apply and manage your credit allocation
                          </p>
                        </div>
                        
                        <FormField
                          control={form.control}
                          name="isPublic"
                          render={({ field }) => (
                            <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4 bg-muted/50">
                              <FormControl>
                                <Checkbox
                                  checked={field.value}
                                  onCheckedChange={field.onChange}
                                />
                              </FormControl>
                              <div className="space-y-1 leading-none">
                                <FormLabel className="text-base">
                                  Make this job public
                                </FormLabel>
                                <FormDescription className="text-sm leading-relaxed">
                                  Enable external candidates to apply directly. Each application uses credits for AI-powered CV parsing, analysis, and matching.
                                </FormDescription>
                              </div>
                            </FormItem>
                          )}
                        />
                        
                        {form.watch('isPublic') && (
                          <FormField
                            control={form.control}
                            name="candidateApplyLimit"
                            render={({ field }) => (
                              <FormItem className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                                <div className="flex items-center gap-2 mb-2">
                                  <FormLabel className="text-base font-semibold">Maximum Applications *</FormLabel>
                                  <TooltipProvider>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <div className="h-4 w-4 rounded-full bg-blue-500 text-white flex items-center justify-center text-xs cursor-help">
                                          ?
                                        </div>
                                      </TooltipTrigger>
                                      <TooltipContent className="max-w-xs">
                                        <p className="font-semibold mb-2">Why do I need to set a limit?</p>
                                        <ul className="space-y-1 text-xs">
                                          <li>• <strong>Cost Control:</strong> Each application triggers AI CV parsing, analysis, and matching</li>
                                          <li>• <strong>Budget Planning:</strong> Credits are reserved upfront so you know exact costs</li>
                                          <li>• <strong>Resource Management:</strong> Helps the system allocate processing capacity</li>
                                          <li>• <strong>Quality Focus:</strong> Encourages targeted, well-defined job postings</li>
                                        </ul>
                                      </TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                </div>
                                <FormControl>
                                  <Input
                                    type="number"
                                    min="1"
                                    placeholder="e.g., 50"
                                    value={field.value || ""}
                                    onChange={(e) => field.onChange(e.target.value ? Number(e.target.value) : undefined)}
                                    className="bg-white dark:bg-gray-950"
                                  />
                                </FormControl>
                                <FormDescription className="text-sm leading-relaxed mt-2">
                                  <div className="space-y-2">
                                    <p>
                                      <strong>Set the maximum number of applications you want to receive.</strong> This helps us manage costs and system resources efficiently.
                                    </p>
                                    <div className="bg-white dark:bg-gray-900 rounded p-3 border border-blue-300 dark:border-blue-700">
                                      <p className="text-xs font-medium text-muted-foreground mb-1">💡 Cost Breakdown:</p>
                                      <p className="text-sm">
                                        Each application includes AI-powered CV parsing, data extraction, candidate scoring, and intelligent matching.
                                      </p>
                                      <div className="mt-2 pt-2 border-t border-blue-200 dark:border-blue-800">
                                        <p className="font-semibold text-blue-700 dark:text-blue-300">
                                          {field.value || 0} applications × 3 credits = <span className="text-lg">{(field.value || 0) * 3} credits</span> reserved
                                        </p>
                                        <p className="text-xs text-muted-foreground mt-1">
                                          Credits are reserved upfront. Unused credits are automatically refunded if you unpublish or delete this job.
                                        </p>
                                      </div>
                                    </div>
                                  </div>
                                </FormDescription>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        )}
                      </div>

                      <div className="flex justify-between">
                        <Button type="button" variant="outline" onClick={() => setActiveTab("requirements")}>
                          Back
                        </Button>
                        <Button type="submit" disabled={isSubmitting}>
                          {isSubmitting ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              {creationStep || "Creating..."}
                            </>
                          ) : (
                            <>
                              <Plus className="mr-2 h-4 w-4" />
                              Create Job Posting
                            </>
                          )}
                        </Button>
                      </div>
                    </TabsContent>


                  </form>
                </Form>
              </Tabs>
            </CardContent>
          </Card>
        </div>

        <div className="w-full lg:w-1/3">
          <Card>
              <CardHeader>
                <CardTitle className="text-lg">AI Assistant</CardTitle>
                <CardDescription>Let AI help you create an effective job posting</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-md bg-muted p-4">
                  <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-purple-500" />
                    AI-Powered Features
                  </h3>
                  <ul className="space-y-3 text-sm">
                    <li className="flex items-start gap-2">
                      <Wand2 className="h-4 w-4 text-purple-500 mt-0.5 shrink-0" />
                      <span>Generate job descriptions and requirements with one click</span>
                    </li>
                  </ul>
                </div>

                {aiAssistantError && (
                  <div className="rounded-md bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 p-3">
                    <div className="flex items-start gap-2">
                      <XCircle className="h-4 w-4 text-red-600 dark:text-red-400 mt-0.5 shrink-0" />
                      <p className="text-sm text-red-800 dark:text-red-200">{aiAssistantError}</p>
                    </div>
                  </div>
                )}

                <div className="flex flex-col gap-2">
                  <Button
                    variant="outline"
                    className="justify-start gap-2 text-sm"
                    onClick={generateJobDescription}
                    disabled={isGeneratingDescription}
                  >
                    {isGeneratingDescription ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Wand2 className="h-4 w-4" />
                    )}
                    Generate Job Description
                  </Button>

                  <Button
                    variant="outline"
                    className="justify-start gap-2 text-sm"
                    onClick={generateJobRequirements}
                    disabled={isGeneratingRequirements}
                  >
                    {isGeneratingRequirements ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Wand2 className="h-4 w-4" />
                    )}
                    Generate Requirements
                  </Button>
                </div>
              </CardContent>
            </Card>
        </div>
      </div>

      {/* Department Management Dialog */}
      <Dialog open={showDepartmentDialog} onOpenChange={setShowDepartmentDialog}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Manage Departments</DialogTitle>
            <DialogDescription>
              Create and manage your organization's departments
            </DialogDescription>
          </DialogHeader>
          <DepartmentManagement 
            onDepartmentCreated={(department) => {
              // The department select will automatically update via global events
              console.log('New department created:', department.name);
            }}
            onDepartmentDeleted={(departmentId) => {
              // The department select will automatically update via global events
              console.log('Department deleted:', departmentId);
            }}
          />
        </DialogContent>
      </Dialog>

      {/* Currency Management Dialog */}
      <CurrencyManagementDialog
        open={showCurrencyDialog}
        onOpenChange={setShowCurrencyDialog}
        onCurrencyChange={async () => {
          // Refresh the currency selector when currencies are updated
          setCurrencyRefreshKey(prev => prev + 1)
          
          // Re-fetch default currency in case it changed
          try {
            const data = await getCurrencies()
            const orgDefaultCurrency = data.defaultCurrency || DEFAULT_CURRENCY
            form.setValue('currency', orgDefaultCurrency)
            console.log('✅ Updated default currency to:', orgDefaultCurrency)
          } catch (error) {
            console.error('Failed to refetch default currency:', error)
          }
        }}
      />

      {/* Success Modal */}
      <Dialog open={showSuccessModal} onOpenChange={setShowSuccessModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-green-600">
              <CheckCircle className="h-6 w-6" />
              Job Created Successfully!
            </DialogTitle>
            <DialogDescription>
              Your job posting has been created and is now active.
            </DialogDescription>
          </DialogHeader>
          
          <div className="py-6 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
              <CheckCircle className="h-10 w-10 text-green-600" />
            </div>
            
            {createdJob && (
              <div className="space-y-2">
                <h3 className="text-lg font-semibold">{createdJob.title}</h3>
                <p className="text-sm text-muted-foreground">
                  has been created and is now active
                </p>
              </div>
            )}
          </div>
          
          <div className="flex gap-3">
            <Button
              className="flex-1"
              onClick={handleViewJob}
            >
              View Job
            </Button>
            <Button
              variant="outline"
              className="flex-1"
              onClick={handleCreateAnother}
            >
              Create Another
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Error Modal */}
      <Dialog open={showErrorModal} onOpenChange={setShowErrorModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <XCircle className="h-6 w-6" />
              Job Creation Failed
            </DialogTitle>
            <DialogDescription>
              We encountered an error while creating your job posting.
            </DialogDescription>
          </DialogHeader>
          
          <div className="py-6 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-100">
              <XCircle className="h-10 w-10 text-red-600" />
            </div>
            
            <div className="space-y-2">
              <p className="text-sm font-medium">Failed to create job posting</p>
              {errorDetails && (
                <p className="text-xs text-muted-foreground px-4">
                  {errorDetails}
                </p>
              )}
            </div>
          </div>
          
          <div className="flex gap-3">
            <Button
              className="flex-1"
              onClick={handleTryAgain}
            >
              Try Again
            </Button>
            <Button
              variant="ghost"
              className="flex-1"
              onClick={handleCancelJobCreation}
            >
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Credit Error Dialog */}
      <CreditErrorDialog 
        open={showCreditDialog} 
        onOpenChange={setShowCreditDialog} 
        error={creditError} 
      />
    </div>
  )
}
