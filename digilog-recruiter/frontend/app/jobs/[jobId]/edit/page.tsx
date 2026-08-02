"use client"

import { useState, useEffect, use } from "react"
import { useRouter } from "next/navigation"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm, useWatch, type Resolver } from "react-hook-form"
import { z } from "zod"
import { ChevronRight, Check, Loader2, ArrowLeft, Settings, Briefcase, FileText, CheckSquare, DollarSign, Info } from "lucide-react"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { toast } from "@/components/ui/use-toast"
import { updateJob, getJobById, type JobFormData, type JobData } from "@/services/jobService"
import Link from "next/link"
import DepartmentSelect from "@/components/department-select"
import { prepareFormDataForSave } from "@/utils/htmlDecode"
import DepartmentManagement from "@/components/department-management"
import { CurrencySelector } from "@/components/ui/currency-selector"
import { getCurrencySymbol, DEFAULT_CURRENCY } from "@/lib/currencies"
import { CurrencyManagementDialog } from "@/components/settings/currency-management-dialog"
import { getCurrencies } from "@/services/currencyService"

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
  status: z.enum(['draft', 'active', 'paused', 'closed', 'archived']).optional(),
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

interface EditJobPageProps {
  params: Promise<{
    jobId: string
  }>
}

export default function EditJobPage({ params }: EditJobPageProps) {
  const resolvedParams = use(params)
  const router = useRouter()
  const [activeTab, setActiveTab] = useState("basic")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [jobData, setJobData] = useState<JobData | null>(null)
  const [showDepartmentDialog, setShowDepartmentDialog] = useState(false)
  const [showCurrencyDialog, setShowCurrencyDialog] = useState(false)
  const [currencyRefreshKey, setCurrencyRefreshKey] = useState(0)

  const form = useForm<JobFormValues>({
    resolver: zodResolver(jobFormSchema) as Resolver<JobFormValues>,
    defaultValues: {
      currency: DEFAULT_CURRENCY,
    },
  })

  // Watch currency for salary labels (prevents re-render issues)
  const watchedCurrency = useWatch({ control: form.control, name: 'currency' })

  // Prevent form submission on Enter key in input fields
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
    }
  }

  // Load job data on component mount
  useEffect(() => {
    const loadJobData = async () => {
      try {
        setIsLoading(true)
        const job = await getJobById(resolvedParams.jobId)
        setJobData(job)
        
        // Convert job data to form values
        const formData: JobFormValues = {
          title: job.title,
          department: typeof job.department === 'object' ? job.department._id : job.department,
          location: job.location,
          type: job.type,
          level: job.level,
          description: job.description,
          requirements: job.requirements,
          responsibilities: job.responsibilities,
          experience: job.experience,
          education: job.education,
          skills: job.skills || "",
          minSalary: job.salary?.min,
          maxSalary: job.salary?.max,
          currency: job.salary?.currency || DEFAULT_CURRENCY,
          benefits: job.benefits || "",
          remote: job.remote,
          openings: job.openings,
          applicationDeadline: job.applicationDeadline ? 
            new Date(job.applicationDeadline).toISOString().split('T')[0] : "",
          status: job.status,
          isPublic: job.isPublic || false,
          candidateApplyLimit: (job as any).candidateApplyLimit || undefined,
        }

        // Reset form with job data
        form.reset(formData)
        setIsLoading(false)
      } catch (error: unknown) {
        console.error("Failed to load job:", error)
        const message = error instanceof Error ? error.message : "Failed to load job data."
        toast({
          title: "Error Loading Job",
          description: message,
          variant: "destructive",
        })
        setIsLoading(false)
      }
    }

    loadJobData()
  }, [resolvedParams.jobId])

  async function onSubmit(data: JobFormValues) {
    setIsSubmitting(true)

    try {
      // Decode HTML entities from all text fields to prevent &amp; appearing as &amp; instead of &
      const cleanedData = prepareFormDataForSave(data);

      // Transform form data to match API expectations
      const updateData: Partial<JobFormData> = {
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
          currency: (cleanedData.currency || 'USD') as any,
          period: 'annually' as const,
        } as any : undefined,
        applicationDeadline: cleanedData.applicationDeadline,
        status: cleanedData.status,
        isPublic: cleanedData.isPublic,
        candidateApplyLimit: cleanedData.candidateApplyLimit,
      };

      const result = await updateJob(resolvedParams.jobId, updateData);
      
      setIsSubmitting(false);
      toast({
        title: "Job Updated Successfully",
        description: `${result.title} has been updated.`,
      });
      router.push(`/jobs/${resolvedParams.jobId}`);
    } catch (error: unknown) {
      setIsSubmitting(false);
      const message = error instanceof Error ? error.message : "An unexpected error occurred."
      toast({
        title: "Error Updating Job",
        description: message,
        variant: "destructive",
      });
      console.error("Failed to update job:", error);
    }
  }

  if (isLoading) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex items-center justify-center h-64">
          <div className="flex items-center gap-2">
            <Loader2 className="h-6 w-6 animate-spin" />
            <span>Loading job data...</span>
          </div>
        </div>
      </div>
    )
  }

  if (!jobData) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">Job Not Found</h1>
          <p className="text-muted-foreground mb-4">The job you're trying to edit doesn't exist.</p>
          <Link href="/jobs">
            <Button>Back to Jobs</Button>
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="container mx-auto p-4 sm:p-6 max-w-6xl">
      {/* Enhanced Header Section */}
      <div className="mb-8">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 mb-4">
          <Link href={`/jobs/${resolvedParams.jobId}`} className="flex-shrink-0">
            <Button variant="ghost" size="icon" className="hover:bg-gray-100">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-[#754BE5] to-[#6935CF] bg-clip-text text-transparent">
              Edit Job
            </h1>
            <p className="text-muted-foreground text-lg mt-1 truncate">
              Updating: "{jobData.title}"
            </p>
          </div>
        </div>
        {/* Progress Indicator */}
        <div className="w-full bg-gray-100 rounded-full h-1.5">
          <div 
            className="bg-gradient-to-r from-[#754BE5] to-[#6935CF] h-1.5 rounded-full transition-all duration-300"
            style={{ width: activeTab === 'basic' ? '25%' : activeTab === 'description' ? '50%' : activeTab === 'requirements' ? '75%' : '100%' }}
          />
        </div>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6" noValidate>
          <Tabs value={activeTab} onValueChange={(newTab) => {
            console.log('📑 TAB CHANGE DETECTED:', {
              from: activeTab,
              to: newTab,
              timestamp: new Date().toISOString(),
              stackTrace: new Error('Tab change stack trace').stack
            })
            setActiveTab(newTab)
          }} className="w-full">
            <TabsList className="grid w-full grid-cols-4 bg-gray-100/50 p-1 rounded-lg gap-1">
              <TabsTrigger value="basic" className="data-[state=active]:bg-white data-[state=active]:shadow-sm text-sm font-medium flex items-center gap-1">
                <Briefcase className="h-4 w-4" />
                <span className="hidden sm:inline">Basic Info</span>
                <span className="sm:hidden">Basic</span>
              </TabsTrigger>
              <TabsTrigger value="description" className="data-[state=active]:bg-white data-[state=active]:shadow-sm text-sm font-medium flex items-center gap-1">
                <FileText className="h-4 w-4" />
                <span className="hidden sm:inline">Description</span>
                <span className="sm:hidden">Desc</span>
              </TabsTrigger>
              <TabsTrigger value="requirements" className="data-[state=active]:bg-white data-[state=active]:shadow-sm text-sm font-medium flex items-center gap-1">
                <CheckSquare className="h-4 w-4" />
                <span className="hidden sm:inline">Requirements</span>
                <span className="sm:hidden">Reqs</span>
              </TabsTrigger>
              <TabsTrigger value="compensation" className="data-[state=active]:bg-white data-[state=active]:shadow-sm text-sm font-medium flex items-center gap-1">
                <DollarSign className="h-4 w-4" />
                <span className="hidden sm:inline">Compensation</span>
                <span className="sm:hidden">Comp</span>
              </TabsTrigger>
            </TabsList>

            {/* Basic Information Tab */}
            <TabsContent value="basic" className="space-y-6 mt-6">
              <Card className="border-0 shadow-xl bg-gradient-to-br from-white to-gray-50/50">
                <CardHeader className="bg-gradient-to-r from-[#F1ECFF] to-[#E9E2FB] rounded-t-lg border-b">
                  <CardTitle className="text-xl flex items-center gap-2">
                    <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                    Basic Information
                  </CardTitle>
                  <CardDescription>
                    Essential details about the job position
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="title"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Job Title</FormLabel>
                          <FormControl>
                            <Input placeholder="e.g. Senior Frontend Developer" {...field} />
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
                          <FormLabel>Department</FormLabel>
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

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="location"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Location</FormLabel>
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
                          <FormLabel>Job Type</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
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

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <FormField
                      control={form.control}
                      name="level"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Experience Level</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select level" />
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
                      name="openings"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Number of Openings</FormLabel>
                          <FormControl>
                            <Input 
                              type="number" 
                              min="1" 
                              placeholder="1" 
                              {...field}
                              onChange={(e) => field.onChange(parseInt(e.target.value) || 1)}
                              onKeyDown={handleKeyDown}
                            />
                          </FormControl>
                          <FormMessage />
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
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                              This position allows for remote work
                            </FormDescription>
                          </div>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="status"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Job Status</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select status" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="draft">Draft</SelectItem>
                              <SelectItem value="active">Active</SelectItem>
                              <SelectItem value="paused">Paused</SelectItem>
                              <SelectItem value="closed">Closed</SelectItem>
                              <SelectItem value="archived">Archived</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Description Tab */}
            <TabsContent value="description" className="space-y-6 mt-6">
              <Card className="border-0 shadow-xl bg-gradient-to-br from-white to-gray-50/50">
                <CardHeader className="bg-gradient-to-r from-green-50 to-emerald-50 rounded-t-lg border-b">
                  <CardTitle className="text-xl flex items-center gap-2">
                    <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                    Job Description
                  </CardTitle>
                  <CardDescription>
                    Detailed description of the role and company
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <FormField
                    control={form.control}
                    name="description"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Job Description</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="Describe the role, responsibilities, and what makes this position exciting..."
                            className="min-h-[150px]"
                            {...field}
                          />
                        </FormControl>
                        <FormDescription>
                          Provide a compelling description that attracts the right candidates
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
                        <FormLabel>Key Responsibilities</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="List the main responsibilities and tasks for this role..."
                            className="min-h-[120px]"
                            {...field}
                          />
                        </FormControl>
                        <FormDescription>
                          What will the person in this role be responsible for?
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="benefits"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Benefits & Perks</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="List the benefits, perks, and what makes your company great to work for..."
                            className="min-h-[100px]"
                            {...field}
                          />
                        </FormControl>
                        <FormDescription>
                          What benefits and perks do you offer?
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </CardContent>
              </Card>
            </TabsContent>

            {/* Requirements Tab */}
            <TabsContent value="requirements" className="space-y-6 mt-6">
              <Card className="border-0 shadow-xl bg-gradient-to-br from-white to-gray-50/50">
                <CardHeader className="bg-gradient-to-r from-orange-50 to-amber-50 rounded-t-lg border-b">
                  <CardTitle className="text-xl flex items-center gap-2">
                    <div className="w-2 h-2 bg-orange-500 rounded-full"></div>
                    Job Requirements
                  </CardTitle>
                  <CardDescription>
                    Skills, experience, and qualifications needed
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <FormField
                    control={form.control}
                    name="requirements"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Requirements</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="List the required skills, experience, and qualifications..."
                            className="min-h-[120px]"
                            {...field}
                          />
                        </FormControl>
                        <FormDescription>
                          What are the must-have requirements for this role?
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="experience"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Years of Experience</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select experience" />
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
                    <FormField
                      control={form.control}
                      name="education"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Education Level</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select education" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="High School">High School</SelectItem>
                              <SelectItem value="Associate">Associate Degree</SelectItem>
                              <SelectItem value="Bachelor">Bachelor's Degree</SelectItem>
                              <SelectItem value="Master">Master's Degree</SelectItem>
                              <SelectItem value="PhD">PhD</SelectItem>
                              <SelectItem value="Professional Certificate">Professional Certificate</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={form.control}
                    name="skills"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Skills & Technologies</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="List specific skills, technologies, tools, and frameworks..."
                            className="min-h-[100px]"
                            {...field}
                          />
                        </FormControl>
                        <FormDescription>
                          What specific skills and technologies should candidates have?
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </CardContent>
              </Card>
            </TabsContent>

            {/* Compensation Tab */}
            <TabsContent value="compensation" className="space-y-6 mt-6">
              <Card className="border-0 shadow-xl bg-gradient-to-br from-white to-gray-50/50">
                <CardHeader className="bg-gradient-to-r from-purple-50 to-[#F1ECFF] rounded-t-lg border-b">
                  <CardTitle className="text-xl flex items-center gap-2">
                    <div className="w-2 h-2 bg-purple-500 rounded-full"></div>
                    Compensation & Benefits
                  </CardTitle>
                  <CardDescription>
                    Salary range and additional compensation details
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
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
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="minSalary"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Minimum Salary ({getCurrencySymbol(watchedCurrency || 'USD')})</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              placeholder="e.g. 2000000"
                              value={field.value ?? ""}
                              onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : undefined)}
                              onKeyDown={handleKeyDown}
                            />
                          </FormControl>
                          <FormDescription>
                            Annual salary
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="maxSalary"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Maximum Salary ({getCurrencySymbol(watchedCurrency || 'USD')})</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              placeholder="e.g. 5000000"
                              value={field.value ?? ""}
                              onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : undefined)}
                              onKeyDown={handleKeyDown}
                            />
                          </FormControl>
                          <FormDescription>
                            Annual salary
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  
                  {/* Public Job Settings */}
                  <div className="space-y-4 border-t pt-6 mt-6">
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
                                onKeyDown={handleKeyDown}
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
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>

          {/* Navigation and Submit */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-6 border-t">
            <div className="flex gap-2 w-full sm:w-auto">
              {activeTab !== "basic" && (
                <Button 
                  type="button" 
                  variant="outline" 
                  onClick={(e) => {
                    // CRITICAL: Prevent any form submission
                    e.preventDefault()
                    e.stopPropagation()
                    
                    const tabs = ["basic", "description", "requirements", "compensation"]
                    const currentIndex = tabs.indexOf(activeTab)
                    if (currentIndex > 0) {
                      setActiveTab(tabs[currentIndex - 1])
                    }
                  }}
                  className="flex-1 sm:flex-none"
                >
                  Previous
                </Button>
              )}
              {activeTab !== "compensation" && (
                <Button 
                  type="button" 
                  onClick={(e) => {
                    // CRITICAL: Prevent any form submission
                    e.preventDefault()
                    e.stopPropagation()
                    
                    const tabs = ["basic", "description", "requirements", "compensation"]
                    const currentIndex = tabs.indexOf(activeTab)
                    if (currentIndex < tabs.length - 1) {
                      setActiveTab(tabs[currentIndex + 1])
                    }
                  }}
                  className="flex-1 sm:flex-none"
                >
                  Next
                  <ChevronRight className="ml-2 h-4 w-4" />
                </Button>
              )}
            </div>
            
            <div className="w-full sm:w-auto">
              <Button 
                type="submit" 
                disabled={isSubmitting}
                className="w-full sm:w-auto bg-blue-600 hover:bg-blue-700"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Updating Job...
                  </>
                ) : (
                  <>
                    <Check className="mr-2 h-4 w-4" />
                    Update Job
                  </>
                )}
              </Button>
            </div>
          </div>
        </form>
      </Form>

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
    </div>
  )
} 