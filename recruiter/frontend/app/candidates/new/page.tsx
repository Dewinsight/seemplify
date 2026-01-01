"use client"

import type React from "react"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { z } from "zod"
import { Upload, FileText, Check, Loader2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/use-toast"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Progress } from "@/components/ui/progress"
import { uploadCV, createCandidateManually, CandidateData } from "@/services/candidateService" // Import the service
import { useCreditError } from "@/hooks/useCreditError"
import { CreditErrorDialog } from "@/components/ui/credit-error-dialog"

const MAX_FILE_SIZE = 5000000 // 5MB
const ACCEPTED_FILE_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]

const candidateFormSchema = z.object({
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
    message: "Phone number must be at least 10 characters.",
  }),
  location: z.string().optional(),
  position: z.string().min(2, {
    message: "Position must be at least 2 characters.",
  }),
  experience: z.string().min(1, {
    message: "Please select experience level.",
  }),
  education: z.string().min(1, {
    message: "Please select education level.",
  }),
  skills: z.string().optional(),
  resume: z.any().optional(),
  coverLetter: z.string().optional(),
})

export type CandidateFormValues = z.infer<typeof candidateFormSchema> // Export the type

const defaultValues: Partial<CandidateFormValues> = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  location: "",
  position: "",
  experience: "",
  education: "",
  skills: "",
  coverLetter: "",
}

export default function UploadCVPage() {
  const router = useRouter()
  const { creditError, showCreditDialog, setShowCreditDialog, handleError } = useCreditError()
  const [activeTab, setActiveTab] = useState("upload")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadedFile, setUploadedFile] = useState<File | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [processingComplete, setProcessingComplete] = useState(false)
  const [createdCandidateId, setCreatedCandidateId] = useState<string | null>(null)
  const [processingResults, setProcessingResults] = useState<any>(null)

  const form = useForm<CandidateFormValues>({
    resolver: zodResolver(candidateFormSchema),
    defaultValues,
  })

  async function onSubmit(data: CandidateFormValues) {
    if (createdCandidateId) {
      // If candidate was created via CV upload, update the existing candidate
      setIsSubmitting(true);
      try {
        const { updateCandidate } = await import("@/services/candidateService");
        const result = await updateCandidate(createdCandidateId, data);
        setIsSubmitting(false);
        toast({
          title: "Candidate Updated",
          description: `${result.firstName} ${result.lastName} has been successfully updated with your changes.`,
        });
        router.push(`/candidates/${createdCandidateId}`);
      } catch (error: any) {
        setIsSubmitting(false);
        toast({
          title: "Error Updating Candidate",
          description: error.message || "An unexpected error occurred.",
          variant: "destructive",
        });
        console.error("Failed to update candidate:", error);
      }
      return;
    }

    // Create new candidate manually
    setIsSubmitting(true);
    try {
      const result = await createCandidateManually(data);
      setIsSubmitting(false);
      toast({
        title: "Candidate Added Manually",
        description: `${result.candidate.firstName} ${result.candidate.lastName} has been successfully added.`,
      });
      router.push("/candidates");
    } catch (error: any) {
      setIsSubmitting(false);
      toast({
        title: "Error Adding Candidate",
        description: error.message || "An unexpected error occurred.",
        variant: "destructive",
      });
      console.error("Failed to add candidate:", error);
    }
  }

  const handleViewCandidate = () => {
    if (createdCandidateId) {
      router.push(`/candidates/${createdCandidateId}`);
    }
  };

  const handleStartOver = () => {
    setUploadedFile(null);
    setIsUploading(false);
    setIsProcessing(false);
    setProcessingComplete(false);
    setCreatedCandidateId(null);
    setProcessingResults(null);
    setUploadProgress(0);
    form.reset(defaultValues);
    setActiveTab("upload");
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    if (file.size > MAX_FILE_SIZE) {
      toast({
        title: "File too large",
        description: `Please select a file smaller than ${MAX_FILE_SIZE / 1000000}MB.`,
        variant: "destructive",
      })
      return
    }

    if (!ACCEPTED_FILE_TYPES.includes(file.type) && !file.name.endsWith('.doc') && !file.name.endsWith('.docx')) {
      if (!(file.type === '' && (file.name.endsWith('.doc') || file.name.endsWith('.docx')))) {
        toast({
          title: "Invalid file type",
          description: "Please select a PDF, DOC, or DOCX file.",
          variant: "destructive",
        });
        return;
      }
    }

    setUploadedFile(file)
    setIsUploading(true)
    setUploadProgress(0)
    setIsProcessing(false)
    setProcessingComplete(false)
    setCreatedCandidateId(null)
    setProcessingResults(null)

    const formData = new FormData()
    formData.append("resume", file)

    // Simulate initial upload progress
    let progressInterval = setInterval(() => {
      setUploadProgress((prev) => {
        if (prev >= 30) {
          clearInterval(progressInterval)
          return 30
        }
        return prev + 10
      })
    }, 100)

    try {
      const result = await uploadCV(formData);

      clearInterval(progressInterval);
      setUploadProgress(100);
      setIsUploading(false);
      setIsProcessing(true);

      // Show processing animation for better UX
      setTimeout(() => {
        const candidate: CandidateData = result.candidate;
        setCreatedCandidateId(candidate._id);
        setProcessingResults(result.processingResults);

        // Auto-fill form with extracted data
        form.setValue("firstName", candidate.firstName || "");
        form.setValue("lastName", candidate.lastName || "");
        form.setValue("email", candidate.email || "");
        form.setValue("phone", candidate.phone || "");
        form.setValue("location", candidate.location || "");
        form.setValue("position", candidate.position || form.getValues("position") || "");
        form.setValue("experience", candidate.experience || "");
        form.setValue("education", candidate.education || "");
        form.setValue("skills", candidate.skills || "");

        setIsProcessing(false);
        setProcessingComplete(true);

        toast({
          title: "✅ Candidate Successfully Created!",
          description: `${candidate.firstName} ${candidate.lastName} has been automatically added to your candidate database.`,
        });

      }, 1500); // Short delay for better UX

    } catch (error: any) {
      clearInterval(progressInterval);
      setIsUploading(false);
      setIsProcessing(false);
      
      const isCreditError = handleError(error)
      if (!isCreditError) {
        // ✅ Improved error messaging based on error type
        let errorTitle = "Upload Error";
        let errorDesc = error.message || "Could not upload or process the CV.";
        
        // Detect parsing/extraction failures
        if (error.message?.includes('Could not extract readable text') || 
            error.message?.includes('insufficient information') ||
            error.message?.includes('CV parsing failed')) {
          errorTitle = "Unable to Read CV File";
          errorDesc = "The file appears to be a scanned PDF, image, or corrupted. Please try:\n• Uploading a text-based PDF\n• Uploading a DOCX file\n• Entering candidate details manually below";
        }
        
        toast({
          title: errorTitle,
          description: errorDesc,
          variant: "destructive",
        });
      }
      console.error("CV upload failed:", error);
    }
  }

  return (
    <div className="container mx-auto py-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Add Candidate</h1>
          <p className="text-muted-foreground">Upload a CV to automatically create a candidate profile, or enter information manually.</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Candidate Information</CardTitle>
          <CardDescription>Upload a CV to automatically extract information or enter details manually.</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="upload">Upload CV</TabsTrigger>
              <TabsTrigger value="personal">Personal Info</TabsTrigger>
              <TabsTrigger value="professional">Professional Info</TabsTrigger>
            </TabsList>

            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8 pt-6">
                <TabsContent value="upload" className="space-y-4">
                  <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-gray-300 p-12">
                    {!uploadedFile ? (
                      <>
                        <div className="mb-4 rounded-full bg-primary/10 p-3">
                          <Upload className="h-6 w-6 text-primary" />
                        </div>
                        <h3 className="mb-2 text-lg font-medium">Upload CV</h3>
                        <p className="mb-4 text-center text-sm text-muted-foreground">
                          Drag and drop your CV file here, or click to browse.
                          <br />
                          Supports PDF, DOC, DOCX (Max 5MB)
                        </p>
                        <Button variant="outline" className="relative">
                          <FileText className="mr-2 h-4 w-4" />
                          Select File
                          <input
                            type="file"
                            className="absolute inset-0 cursor-pointer opacity-0"
                            accept=".pdf,.doc,.docx"
                            onChange={handleFileUpload}
                          />
                        </Button>
                      </>
                    ) : (
                      <div className="w-full max-w-md">
                        <div className="mb-4 flex items-center justify-between rounded-lg border bg-muted/50 p-3">
                          <div className="flex items-center gap-3">
                            <div className="rounded-md bg-primary/10 p-2">
                              <FileText className="h-5 w-5 text-primary" />
                            </div>
                            <div>
                              <p className="font-medium">{uploadedFile.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {(uploadedFile.size / 1024 / 1024).toFixed(2)} MB
                              </p>
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              setUploadedFile(null)
                              setUploadProgress(0)
                              setIsUploading(false)
                              setIsProcessing(false)
                              setProcessingComplete(false)
                            }}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>

                        {isUploading && (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <p className="text-sm font-medium">Uploading...</p>
                              <p className="text-sm font-medium">{uploadProgress}%</p>
                            </div>
                            <Progress value={uploadProgress} className="h-2" />
                          </div>
                        )}

                        {isProcessing && (
                          <div className="mt-4 flex items-center gap-2">
                            <Loader2 className="h-4 w-4 animate-spin text-primary" />
                            <p className="text-sm">Processing CV and extracting information...</p>
                          </div>
                        )}

                        {processingComplete && (
                          <div className="mt-4 space-y-3">
                            <div className="rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-900 dark:bg-green-900/20">
                              <div className="flex items-center gap-2 mb-2">
                                <Check className="h-4 w-4 text-green-600 dark:text-green-400" />
                                <p className="text-sm font-medium text-green-600 dark:text-green-400">
                                  ✅ Candidate Successfully Created!
                                </p>
                              </div>
                              <p className="text-xs text-green-600/80 dark:text-green-400/80 mb-3">
                                {form.getValues("firstName")} {form.getValues("lastName")} has been automatically added to your candidate database with extracted information.
                              </p>
                              
                              {processingResults && (
                                <div className="text-xs text-green-600/70 dark:text-green-400/70 space-y-1">
                                  <div className="flex justify-between">
                                    <span>CV Text Extracted:</span>
                                    <span>{processingResults.textExtracted ? "✅" : "❌"}</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span>AI Analysis:</span>
                                    <span>{processingResults.aiAnalysis ? "✅" : "❌"}</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span>Fields Extracted:</span>
                                    <span>{processingResults.fieldsExtracted || 0}</span>
                                  </div>
                                </div>
                              )}
                              
                              <div className="flex gap-2 mt-3">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={handleViewCandidate}
                                  className="text-green-700 border-green-300 hover:bg-green-100"
                                >
                                  View Candidate Profile
                                </Button>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={handleStartOver}
                                  className="text-gray-600"
                                >
                                  Add Another CV
                                </Button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex justify-end">
                    <Button
                      type="button"
                      onClick={() => setActiveTab("personal")}
                      disabled={isUploading || isProcessing}
                    >
                      {processingComplete ? "Continue" : "Skip and Enter Manually"}
                    </Button>
                  </div>
                </TabsContent>

                <TabsContent value="personal" className="space-y-4">
                  {createdCandidateId && (
                    <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-900 dark:bg-blue-900/20">
                      <div className="flex items-center gap-2 mb-2">
                        <Check className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                        <p className="text-sm font-medium text-blue-600 dark:text-blue-400">
                          Candidate Already Created
                        </p>
                      </div>
                      <p className="text-xs text-blue-600/80 dark:text-blue-400/80">
                        This candidate was automatically created from the uploaded CV. You can review and update the information below before finalizing.
                      </p>
                    </div>
                  )}
                  <div className="grid gap-4 md:grid-cols-2">
                    <FormField
                      control={form.control}
                      name="firstName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>First Name *</FormLabel>
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
                          <FormLabel>Last Name *</FormLabel>
                          <FormControl>
                            <Input placeholder="Doe" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <FormField
                      control={form.control}
                      name="email"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Email *</FormLabel>
                          <FormControl>
                            <Input placeholder="john.doe@example.com" {...field} />
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
                          <FormLabel>Phone *</FormLabel>
                          <FormControl>
                            <Input placeholder="+1 (555) 123-4567" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  
                  <FormField
                    control={form.control}
                    name="location"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Location</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g. New York, NY" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="flex justify-between">
                    <Button type="button" variant="outline" onClick={() => setActiveTab("upload")}>
                      Back
                    </Button>
                    <Button type="button" onClick={() => setActiveTab("professional")}>
                      Next
                    </Button>
                  </div>
                </TabsContent>

                <TabsContent value="professional" className="space-y-4">
                  <FormField
                    control={form.control}
                    name="position"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Position Applied For *</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g. Senior Software Engineer" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="grid gap-4 md:grid-cols-2">
                    <FormField
                      control={form.control}
                      name="experience"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Years of Experience *</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select experience level" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="0-2">0-2 years</SelectItem>
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
                          <FormLabel>Highest Education *</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select education level" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="high-school">High School</SelectItem>
                              <SelectItem value="associates">Associate's Degree</SelectItem>
                              <SelectItem value="bachelors">Bachelor's Degree</SelectItem>
                              <SelectItem value="masters">Master's Degree</SelectItem>
                              <SelectItem value="doctorate">Doctorate</SelectItem>
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
                        <FormLabel>Skills</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="e.g. JavaScript, React, Node.js, etc."
                            className="min-h-[100px]"
                            {...field}
                          />
                        </FormControl>
                        <FormDescription>Enter skills separated by commas.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="coverLetter"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Cover Letter</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="Enter cover letter or additional notes..."
                            className="min-h-[150px]"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="flex justify-between">
                    <Button type="button" variant="outline" onClick={() => setActiveTab("personal")}>
                      Back
                    </Button>
                    <Button type="submit" disabled={isSubmitting}>
                      {isSubmitting ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          {createdCandidateId ? "Updating..." : "Creating..."}
                        </>
                      ) : (
                        <>
                          <Check className="mr-2 h-4 w-4" />
                          {createdCandidateId ? "Update & View Profile" : "Create Candidate"}
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

      {/* Credit Error Dialog */}
      <CreditErrorDialog 
        open={showCreditDialog} 
        onOpenChange={setShowCreditDialog} 
        error={creditError} 
      />
    </div>
  )
}
