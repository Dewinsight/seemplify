"use client"

import type React from "react"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { z } from "zod"
import { Upload, FileText, Check, Loader2, RotateCcw, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/use-toast"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Progress } from "@/components/ui/progress"
import {
  uploadCV,
  createCandidateManually,
  retryCVProcessing,
  resumeCVProcessing,
  CandidateData,
  CVProcessingError,
  CVProcessingPendingError,
  type AcceptedCVProcessing,
  type CVProcessingStatus,
} from "@/services/candidateService"
import { useCreditError } from "@/hooks/useCreditError"
import { CreditErrorDialog } from "@/components/ui/credit-error-dialog"
import { useOrganization } from "@/context/OrganizationContext"
import { useUser } from "@/context/UserContext"

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
  const { currentOrganization } = useOrganization()
  const { state: userState } = useUser()
  const { creditError, showCreditDialog, setShowCreditDialog, handleError } = useCreditError()
  const [activeTab, setActiveTab] = useState("upload")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadedFile, setUploadedFile] = useState<File | null>(null)
  const [restoredFileName, setRestoredFileName] = useState<string | null>(null)
  const [uncertainUploadName, setUncertainUploadName] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [processingComplete, setProcessingComplete] = useState(false)
  const [createdCandidateId, setCreatedCandidateId] = useState<string | null>(null)
  const [processingResults, setProcessingResults] = useState<any>(null)
  const [queueStatus, setQueueStatus] = useState<CVProcessingStatus | null>(null)
  const [failedProcessing, setFailedProcessing] = useState<{
    accepted: AcceptedCVProcessing
    status: CVProcessingStatus
  } | null>(null)
  const [isRetrying, setIsRetrying] = useState(false)
  const processingAbortRef = useRef<AbortController | null>(null)
  const processingStorageKey = currentOrganization?._id && userState.user?._id
    ? `seemplify:single-cv-upload:v1:${currentOrganization._id}:${userState.user._id}`
    : null

  const clearRetainedProcessing = () => {
    if (processingStorageKey) localStorage.removeItem(processingStorageKey)
  }

  const form = useForm<CandidateFormValues>({
    resolver: zodResolver(candidateFormSchema),
    defaultValues,
  })

  useEffect(() => () => processingAbortRef.current?.abort(), [])

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
    clearRetainedProcessing();
    setUploadedFile(null);
    setRestoredFileName(null);
    setUncertainUploadName(null);
    setIsUploading(false);
    setIsProcessing(false);
    setProcessingComplete(false);
    setCreatedCandidateId(null);
    setProcessingResults(null);
    setUploadProgress(0);
    setQueueStatus(null);
    setFailedProcessing(null);
    setIsRetrying(false);
    form.reset(defaultValues);
    setActiveTab("upload");
  };

  const completeCVProcessing = (result: Awaited<ReturnType<typeof uploadCV>>) => {
    clearRetainedProcessing();
    const candidate: CandidateData = result.candidate;
    setCreatedCandidateId(candidate._id);
    setProcessingResults(result.processingResults);
    setQueueStatus(null);
    setFailedProcessing(null);

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
      title: "Candidate created",
      description: `${candidate.firstName} ${candidate.lastName} has been added to your candidate database.`,
    });
  };

  useEffect(() => {
    if (!processingStorageKey) return
    let cancelled = false
    let retained: { fileName?: string; idempotencyKey?: string; accepted?: AcceptedCVProcessing } | null = null
    try {
      retained = JSON.parse(localStorage.getItem(processingStorageKey) || "null")
    } catch {
      localStorage.removeItem(processingStorageKey)
    }
    if (!retained?.accepted?.jobId || !retained.accepted.statusToken || !retained.accepted.statusUrl) {
      if (retained?.idempotencyKey && retained.fileName) setUncertainUploadName(retained.fileName)
      return
    }
    setUncertainUploadName(null)
    setRestoredFileName(retained.fileName || "Retained CV")
    setQueueStatus(retained.accepted)
    setIsProcessing(true)
    processingAbortRef.current?.abort()
    const controller = new AbortController()
    processingAbortRef.current = controller
    void resumeCVProcessing(retained.accepted, (status) => {
      if (!cancelled) setQueueStatus(status)
    }, { signal: controller.signal }).then((result) => {
      if (!cancelled) completeCVProcessing(result)
    }).catch((error) => {
      if (cancelled) return
      if (error?.name === "AbortError") return
      setIsProcessing(false)
      if (error instanceof CVProcessingPendingError) {
        setQueueStatus(error.status)
        toast({
          title: "Processing continues in the background",
          description: "You can leave this page and follow the CV from Processing history.",
        })
        return
      }
      if (error instanceof CVProcessingError) {
        setQueueStatus(error.status)
        setFailedProcessing({ accepted: error.accepted, status: error.status })
      }
      toast({
        title: "CV processing needs attention",
        description: error instanceof Error ? error.message : "Open Processing history to inspect this CV.",
        variant: "destructive",
      })
    })
    return () => {
      cancelled = true
      controller.abort()
      if (processingAbortRef.current === controller) processingAbortRef.current = null
    }
    // completeCVProcessing intentionally reads the latest form instance; the
    // durable recovery should run only when this account/org key changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processingStorageKey])

  const handleProcessingRetry = async () => {
    if (!failedProcessing || isRetrying) return;
    setIsRetrying(true);
    setIsProcessing(true);
    processingAbortRef.current?.abort()
    const controller = new AbortController()
    processingAbortRef.current = controller
    try {
      const result = await retryCVProcessing(failedProcessing.accepted, (status) => {
        setQueueStatus(status);
        setFailedProcessing((current) => current ? { ...current, status } : current);
      }, 'failed', { signal: controller.signal });
      if (processingAbortRef.current === controller) processingAbortRef.current = null
      completeCVProcessing(result);
    } catch (error) {
      if (processingAbortRef.current === controller) processingAbortRef.current = null
      if ((error as Error)?.name === "AbortError") return
      setIsProcessing(false);
      if (error instanceof CVProcessingPendingError) {
        setQueueStatus(error.status)
        toast({
          title: "Retry continues in the background",
          description: "Follow this CV from Processing history.",
        })
        return
      }
      if (error instanceof CVProcessingError) {
        setQueueStatus(error.status);
        setFailedProcessing({ accepted: error.accepted, status: error.status });
      }
      toast({
        title: "CV retry failed",
        description: error instanceof Error ? error.message : "CV processing could not be retried.",
        variant: "destructive",
      });
    } finally {
      setIsRetrying(false);
    }
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
    setRestoredFileName(null)
    setUncertainUploadName(null)
    setIsUploading(true)
    setUploadProgress(0)
    setIsProcessing(false)
    setProcessingComplete(false)
    setCreatedCandidateId(null)
    setProcessingResults(null)
    setQueueStatus(null)
    setFailedProcessing(null)

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

    processingAbortRef.current?.abort()
    const controller = new AbortController()
    processingAbortRef.current = controller

    try {
      const fingerprint = `${file.name}:${file.size}:${file.lastModified}`
      let retained: { fingerprint?: string; idempotencyKey?: string } | null = null
      if (processingStorageKey) {
        try { retained = JSON.parse(localStorage.getItem(processingStorageKey) || "null") } catch { retained = null }
      }
      const idempotencyKey = retained?.fingerprint === fingerprint && retained.idempotencyKey
        ? retained.idempotencyKey
        : globalThis.crypto?.randomUUID?.() || `cv-${Date.now()}-${Math.random().toString(36).slice(2)}`
      if (processingStorageKey) {
        localStorage.setItem(processingStorageKey, JSON.stringify({ fingerprint, idempotencyKey, fileName: file.name }))
      }
      const result = await uploadCV(formData, (status) => {
        setQueueStatus(status)
        setIsUploading(false)
        setIsProcessing(true)
      }, {
        idempotencyKey,
        onAccepted: (accepted) => {
          if (processingStorageKey) {
            localStorage.setItem(processingStorageKey, JSON.stringify({
              fingerprint,
              idempotencyKey,
              fileName: file.name,
              accepted,
            }))
          }
        },
        signal: controller.signal,
      });

      if (processingAbortRef.current === controller) processingAbortRef.current = null

      clearInterval(progressInterval);
      setUploadProgress(100);
      setIsUploading(false);
      setIsProcessing(true);

      // Keep a short visual handoff after the queue reports completion.
      setTimeout(() => {
        completeCVProcessing(result);
      }, 750);

    } catch (error: any) {
      clearInterval(progressInterval);
      if (processingAbortRef.current === controller) processingAbortRef.current = null
      if (error?.name === "AbortError") return
      setIsUploading(false);
      setIsProcessing(false);
      if (error instanceof CVProcessingPendingError) {
        setQueueStatus(error.status)
        toast({
          title: "Processing continues in the background",
          description: "The CV is secure. You can leave this page and follow it from Processing history.",
        })
        return
      }
      if (error?.status === 409 && error?.code === "CV_IDEMPOTENCY_KEY_REUSED" && processingStorageKey) {
        localStorage.removeItem(processingStorageKey)
      }
      if (error instanceof CVProcessingError) {
        setQueueStatus(error.status);
        setFailedProcessing({ accepted: error.accepted, status: error.status });
      }
      
      const isCreditError = handleError(error)
      if (!isCreditError) {
        // ✅ Improved error messaging based on error type
        let errorTitle = "Upload Error";
        let errorDesc = error.message || "Could not upload or process the CV.";
        
        // Detect parsing/extraction failures (image-based CV, OCR failure, etc.)
        if (error.message?.includes('IMAGE_BASED_CV') || 
            error.message?.includes('Could not extract readable text') || 
            error.message?.includes('insufficient information') ||
            error.message?.includes('CV parsing failed') ||
            error.message?.includes('image-based')) {
          errorTitle = "Image-Based CV Detected";
          errorDesc = "There is a problem with your CV: it appears to be image-based or scanned. Do NOT use image-based or scanned CVs — we cannot extract information from them.\n\nPlease upload a text-based CV instead:\n• A PDF or DOCX file with selectable text (not a scan)\n• Or enter the candidate details manually below\n\nImportant: Ensure the email in your CV is correct — a wrong email can cause issues (application not received, contact problems).";
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

  const queueContinuesInBackground = Boolean(
    !isProcessing
    && queueStatus
    && ["queued", "processing", "waiting_for_chatgpt"].includes(queueStatus.state),
  )

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
                  {uncertainUploadName ? (
                    <div role="status" className="flex flex-col gap-3 border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                      <p>An earlier upload of <strong>{uncertainUploadName}</strong> may already be secured. Select the same file to reconnect safely, or inspect processing history.</p>
                      <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={() => router.push('/cv-processing')}>Processing history</Button>
                    </div>
                  ) : null}
                  <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-gray-300 p-12">
                    {!uploadedFile && !restoredFileName ? (
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
                        <p className="mb-4 text-center text-xs text-amber-600/90">
                          Do NOT use image-based or scanned CVs — use text-based PDF/DOCX only. Ensure the email in the CV is correct; a wrong email can cause issues.
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
                              <p className="font-medium">{uploadedFile?.name || restoredFileName}</p>
                              <p className="text-xs text-muted-foreground">
                                {uploadedFile ? `${(uploadedFile.size / 1024 / 1024).toFixed(2)} MB` : "Recovered from server"}
                              </p>
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              setUploadedFile(null)
                              setRestoredFileName(null)
                              setUncertainUploadName(null)
                              clearRetainedProcessing()
                              setUploadProgress(0)
                              setIsUploading(false)
                              setIsProcessing(false)
                              setProcessingComplete(false)
                              setQueueStatus(null)
                              setFailedProcessing(null)
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

                        {(isProcessing || queueContinuesInBackground) && (
                          <div className="mt-4 border-t pt-4">
                            <div className="flex items-center gap-2">
                              <Loader2 className="h-4 w-4 animate-spin text-primary" />
                              <p className="text-sm">
                                {queueStatus?.state === "waiting_for_chatgpt"
                                  ? "Local CV analysis is offline. Your CV is safely queued."
                                  : queueStatus?.state === "queued"
                                    ? queueStatus.attempts && queueStatus.attempts > 1
                                      ? `Automatic retry ${queueStatus.attempts} is queued${queueStatus.position ? ` · position ${queueStatus.position}` : ""}`
                                      : `Queued for analysis${queueStatus.position ? ` · position ${queueStatus.position}` : ""}`
                                    : "Processing CV and extracting information..."}
                              </p>
                            </div>
                            {queueStatus && <Progress value={queueStatus.progress} className="mt-3 h-2" />}
                            {queueStatus && (
                              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                                <span>Stage: {(queueStatus.stage || queueStatus.state).replace(/_/g, " ")}</span>
                                <span>Run: {queueStatus.attempts || 1}</span>
                                {queueStatus.retry?.nextAttemptAt && (
                                  <span>Next retry: {new Date(queueStatus.retry.nextAttemptAt).toLocaleTimeString()}</span>
                                )}
                              </div>
                            )}
                            {queueContinuesInBackground && queueStatus?.jobId ? (
                              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t pt-3">
                                <p className="text-xs text-muted-foreground">
                                  This upload is durable and continues after you leave this page.
                                </p>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() => router.push(`/cv-processing?jobId=${encodeURIComponent(queueStatus.jobId)}`)}
                                >
                                  View live details
                                </Button>
                              </div>
                            ) : null}
                          </div>
                        )}

                        {failedProcessing && !isProcessing && (
                          <div role="alert" className="mt-4 border-t border-red-200 pt-4 dark:border-red-900">
                            <div className="flex items-start justify-between gap-4">
                              <div>
                                <p className="text-sm font-medium text-red-700 dark:text-red-300">CV processing failed</p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {failedProcessing.status.error?.message || "The CV could not be parsed and analysed."}
                                </p>
                              </div>
                              <span className="shrink-0 text-xs text-muted-foreground">
                                {failedProcessing.status.attempts || 0} run{failedProcessing.status.attempts === 1 ? "" : "s"}
                              </span>
                            </div>
                            {!!failedProcessing.status.attemptHistory?.length && (
                              <div className="mt-3">
                                <p className="mb-1 text-xs font-medium text-foreground">Processing trail</p>
                                <div className="divide-y rounded-md border text-xs">
                                  {failedProcessing.status.attemptHistory.slice(-5).map((attempt) => (
                                    <div key={`${attempt.number}-${attempt.startedAt}`} className="flex items-center justify-between gap-3 px-3 py-2">
                                      <span>Run {attempt.number} · {attempt.trigger} · {(attempt.stage || "processing").replace(/_/g, " ")}</span>
                                      <span className={attempt.status === "completed" ? "text-green-600" : "text-red-600"}>
                                        {attempt.errorCode || attempt.status.replace(/_/g, " ")}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                            <div className="mt-3 flex items-center justify-between gap-3">
                              <p className="text-xs text-muted-foreground">
                                {failedProcessing.status.retry?.availableUntil
                                  ? `Stored CV retained until ${new Date(failedProcessing.status.retry.availableUntil).toLocaleDateString()}`
                                  : "Stored CV is no longer available for retry."}
                              </p>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={!failedProcessing.status.retry?.available || isRetrying}
                                onClick={handleProcessingRetry}
                              >
                                {isRetrying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}
                                Retry CV processing
                              </Button>
                            </div>
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
