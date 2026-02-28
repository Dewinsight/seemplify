"use client"

import type React from "react"
import { useState, useRef } from "react"
import { useRouter } from "next/navigation"
import {
  Upload,
  FileText,
  File,
  CheckCircle,
  AlertCircle,
  X,
  Download,
  ArrowRight,
  Loader2,
  Users,
  Briefcase,
  Plus,
  Eye,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useToast } from "@/hooks/use-toast"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { uploadCV } from "@/services/candidateService"
import { useCreditError } from "@/hooks/useCreditError"
import { CreditErrorDialog } from "@/components/ui/credit-error-dialog"

// File upload state
type FileStatus = "uploading" | "processing" | "success" | "error"

interface UploadedFile {
  id: string
  name: string
  size: number
  type: string
  file: File  // Store the actual File object
  status: FileStatus
  progress: number
  errorMessage?: string
  candidateId?: string
  candidateName?: string
  extractedFields?: number
}

export default function BulkUploadPage() {
  const router = useRouter()
  const { toast } = useToast()
  const { creditError, showCreditDialog, setShowCreditDialog, handleError } = useCreditError()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<UploadedFile[]>([])
  const activeProcessingCount = useRef(0)  // Track concurrent processing batches
  const [isProcessing, setIsProcessing] = useState(false)
  const [processingComplete, setProcessingComplete] = useState(false)
  const [processingStats, setProcessingStats] = useState({
    total: 0,
    success: 0,
    errors: 0,
    warnings: 0,
  })

  // Handle file selection
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const newFiles: UploadedFile[] = Array.from(e.target.files)
        .filter(file => {
          // Only allow CV file types
          const allowedTypes = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
          const allowedExtensions = ['.pdf', '.doc', '.docx'];
          return allowedTypes.includes(file.type) || allowedExtensions.some(ext => file.name.toLowerCase().endsWith(ext));
        })
        .map((file) => ({
          id: `file-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          name: file.name,
          size: file.size,
          type: file.type,
          file: file,  // Store the actual File object
          status: "uploading" as FileStatus,
          progress: 0,
        }))

      if (newFiles.length === 0) {
        toast({
          title: "Invalid file types",
          description: "Please select only PDF, DOC, or DOCX files.",
          variant: "destructive",
        });
        return;
      }

      setFiles([...files, ...newFiles])
      
      // Clear file input to allow selecting more files
      if (fileInputRef.current) {
        fileInputRef.current.value = ""
      }
      
      processFiles(newFiles);
    }
  }

  // Process uploaded files
  const processFiles = async (filesToProcess: UploadedFile[]) => {
    activeProcessingCount.current += 1;
    setIsProcessing(true);
    
    for (const fileData of filesToProcess) {
      try {
        // Update file status to processing
        setFiles(prevFiles => 
          prevFiles.map(f => 
            f.id === fileData.id 
              ? { ...f, status: "processing", progress: 50 }
              : f
          )
        );

        // Use the stored File object directly
        const actualFile = fileData.file;
        
        if (!actualFile) {
          console.error('No file object found for:', fileData.name);
          continue;
        }

        // Create FormData and upload
        const formData = new FormData();
        formData.append("resume", actualFile);
        
        console.log('📤 Uploading CV:', actualFile.name, 'Size:', actualFile.size);
        
        const result = await uploadCV(formData);
        
        // Update file status to success
        setFiles(prevFiles => 
          prevFiles.map(f => 
            f.id === fileData.id 
              ? { 
                  ...f, 
                  status: "success", 
                  progress: 100,
                  candidateId: result.candidate._id,
                  candidateName: `${result.candidate.firstName} ${result.candidate.lastName}`,
                  extractedFields: result.processingResults?.fieldsExtracted || 0
                }
              : f
          )
        );

      } catch (error: any) {
        // Check if it's a credit error
        const isCreditError = handleError(error)
        
        // ✅ Improved error messages for parsing failures
        let errorMessage = error.message || "Failed to process CV";
        
        if (isCreditError) {
          errorMessage = "Insufficient credits";
        } else if (error.message?.includes('IMAGE_BASED_CV') ||
                   error.message?.includes('Could not extract readable text') || 
                   error.message?.includes('insufficient information') ||
                   error.message?.includes('CV parsing failed') ||
                   error.message?.includes('image-based')) {
          errorMessage = "Image-based or scanned CV: Do NOT use image-based or scanned CVs. Please upload a text-based PDF or DOCX. Also ensure the email in the CV is correct — a wrong email can cause issues.";
        }
        
        // Update file status to error
        setFiles(prevFiles => 
          prevFiles.map(f => 
            f.id === fileData.id 
              ? { 
                  ...f, 
                  status: "error", 
                  progress: 0,
                  errorMessage: errorMessage
                }
              : f
          )
        );
      }
    }

    // Decrement active processing counter
    activeProcessingCount.current -= 1;
    
    // Update processing stats
    setFiles(prevFiles => {
      const successCount = prevFiles.filter(f => f.status === "success").length;
      const errorCount = prevFiles.filter(f => f.status === "error").length;
      const stillProcessing = prevFiles.filter(f => f.status === "uploading" || f.status === "processing").length;
      
      setProcessingStats({
        total: prevFiles.length,
        success: successCount,
        errors: errorCount,
        warnings: 0,
      });
      
      // Only mark as complete if no more files are being processed
      if (stillProcessing === 0 && activeProcessingCount.current === 0) {
        setIsProcessing(false);
        setProcessingComplete(true);
        
        toast({
          title: "Bulk processing complete",
          description: `Successfully created ${successCount} candidates from ${prevFiles.length} CVs.`,
        });
      }
      
      return prevFiles;
    });
  };

  // Handle file removal
  const handleRemoveFile = (fileId: string) => {
    setFiles(files.filter((file) => file.id !== fileId))
  }

  // Handle drag and drop
  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const input = fileInputRef.current;
      if (input) {
        input.files = e.dataTransfer.files;
        handleFileSelect({ target: input } as React.ChangeEvent<HTMLInputElement>);
      }
    }
  }

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes"
    const k = 1024
    const sizes = ["Bytes", "KB", "MB", "GB"]
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i]
  }

  const handleReset = () => {
    setFiles([])
    setIsProcessing(false)
    setProcessingComplete(false)
    setProcessingStats({ total: 0, success: 0, errors: 0, warnings: 0 })
    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }
  }

  const getStatusIcon = (status: FileStatus) => {
    switch (status) {
      case "uploading":
      case "processing":
        return <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
      case "success":
        return <CheckCircle className="h-4 w-4 text-green-500" />
      case "error":
        return <AlertCircle className="h-4 w-4 text-red-500" />
      default:
        return <File className="h-4 w-4 text-gray-500" />
    }
  }

  const getStatusText = (file: UploadedFile) => {
    switch (file.status) {
      case "uploading":
        return "Uploading..."
      case "processing":
        return "Creating candidate..."
      case "success":
        return `Candidate created: ${file.candidateName}`
      case "error":
        return `Error: ${file.errorMessage}`
      default:
        return "Pending"
    }
  }

  return (
    <div className="container mx-auto py-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Bulk CV Upload</h1>
          <p className="text-muted-foreground">
            Upload multiple CVs to automatically create candidate profiles with AI-powered data extraction.
          </p>
        </div>
        <Button variant="outline" onClick={() => router.push("/candidates")}>
          <Users className="mr-2 h-4 w-4" />
          View All Candidates
        </Button>
      </div>

      <div className="grid gap-6">
        {/* Upload Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" />
              Upload CVs
            </CardTitle>
            <CardDescription>
              Select multiple CV files (PDF, DOC, DOCX) to automatically create candidate profiles.
              Each CV will be processed with AI to extract candidate information.
              Do NOT use image-based or scanned CVs — use text-based PDFs or Word documents only.
              Ensure the email in each CV is correct — a wrong email can cause issues (application not received, contact problems).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div
                className={`relative rounded-lg border-2 p-12 text-center transition-all duration-300 ${
                  files.length === 0
                    ? 'border-dashed border-gray-300 hover:border-gray-400'
                    : 'border-solid border-blue-400 bg-blue-50/30 hover:border-blue-500 hover:bg-blue-50/50'
                }`}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
            >
              <div className="mx-auto flex max-w-[420px] flex-col items-center justify-center text-center">
                <div className={`flex items-center justify-center w-12 h-12 mx-auto rounded-lg mb-4 transition-all duration-300 ${
                  files.length === 0
                    ? 'bg-gray-100'
                    : 'bg-blue-100 animate-pulse'
                }`}>
                  <Upload className={`w-6 h-6 transition-colors ${
                    files.length === 0 ? 'text-gray-600' : 'text-blue-600'
                  }`} />
                </div>
                <h3 className="text-lg font-semibold mb-2 transition-colors">
                  {files.length === 0 ? "Upload CV Files" : "Add More CVs"}
                </h3>
                <p className="text-sm mb-6">
                  Drag and drop your CV files here, or click to browse.
                  <br />
                  Supports PDF, DOC, DOCX files up to 5MB each.
                </p>
                <Button
                  type="button"
                  variant={files.length === 0 ? "outline" : "default"}
                  onClick={() => fileInputRef.current?.click()}
                  className={`transition-all duration-300 ${
                    files.length === 0
                      ? ''
                      : 'bg-blue-600 hover:bg-blue-700 hover:scale-105 hover:shadow-lg'
                  }`}
                >
                  <Plus className={`mr-2 h-4 w-4 transition-transform duration-300 ${
                    files.length > 0 ? 'animate-bounce' : ''
                  }`} />
                  {files.length === 0 ? "Select CV Files" : "Add More CVs"}
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".pdf,.doc,.docx"
                  className="hidden"
                  onChange={handleFileSelect}
                />
                {files.length > 0 && (
                  <div className="mt-4 flex items-center justify-center gap-2 text-sm text-blue-600 animate-fade-in">
                    <CheckCircle className="h-4 w-4" />
                    <span>{files.length} CV{files.length !== 1 ? 's' : ''} ready for upload</span>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Progress and Results */}
        {files.length > 0 && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  Processing Results
                </CardTitle>
                <div className="flex gap-2">
                  {processingComplete && (
                    <Button variant="outline" onClick={handleReset}>
                      <Plus className="mr-2 h-4 w-4" />
                      Upload More CVs
                    </Button>
                  )}
                </div>
              </div>
              {processingComplete && (
                <div className="flex gap-4 text-sm">
                  <Badge variant="outline" className="text-green-600">
                    {processingStats.success} Successful
                  </Badge>
                  {processingStats.errors > 0 && (
                    <Badge variant="outline" className="text-red-600">
                      {processingStats.errors} Failed
                    </Badge>
                  )}
                </div>
              )}
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[400px]">
                <div className="space-y-3">
                  {files.map((file) => (
                    <div
                      key={file.id}
                      className="flex items-center justify-between rounded-lg border p-4 transition-colors hover:bg-gray-50"
                    >
                      <div className="flex items-center gap-3 flex-1">
                        {getStatusIcon(file.status)}
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">{file.name}</p>
                          <p className="text-sm text-gray-500">{formatFileSize(file.size)}</p>
                          <p className="text-xs text-gray-400">{getStatusText(file)}</p>
                          {file.status === "processing" && (
                            <Progress value={file.progress} className="w-full mt-2" />
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {file.status === "success" && file.candidateId && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => router.push(`/candidates/${file.candidateId}`)}
                          >
                            <Eye className="h-4 w-4 mr-1" />
                            View
                          </Button>
                        )}
                        {file.status !== "processing" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRemoveFile(file.id)}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        )}

        {/* Summary Section */}
        {processingComplete && (
          <Card>
            <CardHeader>
              <CardTitle>Processing Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-3">
                <div className="text-center p-4 rounded-lg bg-green-50">
                  <div className="text-2xl font-bold text-green-600">{processingStats.success}</div>
                  <div className="text-sm text-green-600">Candidates Created</div>
                </div>
                <div className="text-center p-4 rounded-lg bg-red-50">
                  <div className="text-2xl font-bold text-red-600">{processingStats.errors}</div>
                  <div className="text-sm text-red-600">Processing Errors</div>
                </div>
                <div className="text-center p-4 rounded-lg bg-blue-50">
                  <div className="text-2xl font-bold text-blue-600">{processingStats.total}</div>
                  <div className="text-sm text-blue-600">Total Files</div>
                </div>
              </div>
              <div className="mt-6 flex justify-center gap-4">
                <Button onClick={() => router.push("/candidates")}>
                  <Users className="mr-2 h-4 w-4" />
                  View All Candidates
                </Button>
                <Button variant="outline" onClick={handleReset}>
                  <Plus className="mr-2 h-4 w-4" />
                  Upload More CVs
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Credit Error Dialog */}
      <CreditErrorDialog 
        open={showCreditDialog} 
        onOpenChange={setShowCreditDialog} 
        error={creditError} 
      />
    </div>
  )
}