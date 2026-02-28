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
  Briefcase,
  Plus,
  Eye,
  FileSpreadsheet,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { toast } from "@/components/ui/use-toast"
import { bulkUploadJobs } from "@/services/jobService"
import { useCreditError } from "@/hooks/useCreditError"
import { CreditErrorDialog } from "@/components/ui/credit-error-dialog"

// File upload state
type FileStatus = "uploading" | "processing" | "success" | "error"

interface UploadedFile {
  id: string
  name: string
  size: number
  type: string
  status: FileStatus
  progress: number
  errorMessage?: string
  jobId?: string
  jobTitle?: string
  department?: string
}

export default function BulkJobUploadPage() {
  const router = useRouter()
  const { creditError, showCreditDialog, setShowCreditDialog, handleError } = useCreditError()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<UploadedFile[]>([])
  const [isProcessing, setIsProcessing] = useState(false)
  const [processingComplete, setProcessingComplete] = useState(false)
  const [processingStats, setProcessingStats] = useState({
    total: 0,
    success: 0,
    errors: 0,
  })

  // Handle file selection
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const newFiles: UploadedFile[] = Array.from(e.target.files)
        .filter(file => {
          // Only allow CSV and Excel file types
          const allowedTypes = ['text/csv', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];
          const allowedExtensions = ['.csv', '.xlsx'];
          return allowedTypes.includes(file.type) || allowedExtensions.some(ext => file.name.toLowerCase().endsWith(ext));
        })
        .map((file) => ({
          id: `file-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          name: file.name,
          size: file.size,
          type: file.type,
          status: "uploading" as FileStatus,
          progress: 0,
        }))

      if (newFiles.length === 0) {
        toast({
          title: "Invalid file types",
          description: "Please select only CSV or Excel (.xlsx) files.",
          variant: "destructive",
        });
        return;
      }

      setFiles([...files, ...newFiles])
      processFiles(newFiles);
    }
  }

  // Process uploaded files
  const processFiles = async (filesToProcess: UploadedFile[]) => {
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

        // Get the actual file from the file input
        const fileInput = fileInputRef.current;
        if (!fileInput?.files) continue;
        
        const actualFile = Array.from(fileInput.files).find(f => 
          f.name === fileData.name && f.size === fileData.size
        );
        
        if (!actualFile) continue;

        // Create FormData and upload
        const formData = new FormData();
        formData.append("jobsFile", actualFile);
        
        const result = await bulkUploadJobs(formData);
        
        // Update file status based on results
        const successCount = result.results.successful.length;
        const errorCount = result.results.failed.length;
        
        if (successCount > 0) {
          setFiles(prevFiles => 
            prevFiles.map(f => 
              f.id === fileData.id 
                ? { 
                    ...f, 
                    status: "success", 
                    progress: 100,
                    jobTitle: `${successCount} jobs created`,
                    department: `${errorCount} failed`,
                  }
                : f
            )
          );
        } else {
          throw new Error("No jobs were successfully created");
        }

      } catch (error: any) {
        // Check if it's a credit error
        const isCreditError = handleError(error)
        
        // Update file status to error
        setFiles(prevFiles => 
          prevFiles.map(f => 
            f.id === fileData.id 
              ? { 
                  ...f, 
                  status: "error", 
                  progress: 0,
                  errorMessage: isCreditError ? "Insufficient credits" : (error.message || "Failed to process jobs file")
                }
              : f
          )
        );
      }
    }

    // Update processing stats
    setFiles(prevFiles => {
      const successCount = prevFiles.filter(f => f.status === "success").length;
      const errorCount = prevFiles.filter(f => f.status === "error").length;
      
      setProcessingStats({
        total: prevFiles.length,
        success: successCount,
        errors: errorCount,
      });
      
      setIsProcessing(false);
      setProcessingComplete(true);
      
      toast({
        title: "Bulk processing complete",
        description: `Successfully processed ${successCount} out of ${prevFiles.length} files.`,
      });
      
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
    setProcessingStats({ total: 0, success: 0, errors: 0 })
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
        return "Processing jobs..."
      case "success":
        return `Success: ${file.jobTitle} (${file.department})`
      case "error":
        return `Error: ${file.errorMessage}`
      default:
        return "Pending"
    }
  }

  const downloadTemplate = () => {
    // Create a sample CSV template
    const headers = [
      "title", "department", "location", "type", "level", "description", 
      "requirements", "responsibilities", "skills", "experience", "education"
    ];
    
    const sampleData = [
      [
        "Senior Software Engineer",
        "Engineering", 
        "Lagos, Nigeria",
        "Full-time",
        "Senior",
        "We are seeking a Senior Software Engineer to join our team...",
        "5+ years of experience in software development, Bachelor's degree in Computer Science...",
        "Design and develop software solutions, Lead technical projects...",
        "JavaScript, React, Node.js, MongoDB",
        "5-10",
        "Bachelor"
      ]
    ];
    
    const csvContent = [headers, ...sampleData]
      .map(row => row.map(field => `"${field}"`).join(","))
      .join("\n");
    
    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "job_template.csv";
    a.click();
    window.URL.revokeObjectURL(url);
  };

  return (
    <div className="container mx-auto py-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Bulk Job Upload</h1>
          <p className="text-muted-foreground">
            Upload CSV or Excel files to create multiple job postings at once.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={downloadTemplate}>
            <Download className="mr-2 h-4 w-4" />
            Download Template
          </Button>
          <Button variant="outline" onClick={() => router.push("/jobs")}>
            <Briefcase className="mr-2 h-4 w-4" />
            View All Jobs
          </Button>
        </div>
      </div>

      <div className="grid gap-6">
        {/* Upload Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" />
              Upload Job Files
            </CardTitle>
            <CardDescription>
              Select CSV or Excel files containing job data. Each row will create a new job posting.
              Download the template above to see the required format.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div
              className="relative rounded-lg border-2 border-dashed border-gray-300 p-12 text-center hover:border-gray-400 transition-colors"
              onDragOver={handleDragOver}
              onDrop={handleDrop}
            >
              <div className="mx-auto flex max-w-[420px] flex-col items-center justify-center text-center">
                <div className="flex items-center justify-center w-12 h-12 mx-auto bg-gray-100 rounded-lg mb-4">
                  <FileSpreadsheet className="w-6 h-6 text-gray-600" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  {files.length === 0 ? "Upload Job Files" : "Add More Files"}
                </h3>
                <p className="text-sm text-gray-500 mb-6">
                  Drag and drop your CSV or Excel files here, or click to browse.
                  <br />
                  Supported formats: .csv, .xlsx
                </p>
                <Button
                  type="button"
                  variant="outline"
                  disabled={isProcessing}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Select Files
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".csv,.xlsx"
                  className="hidden"
                  onChange={handleFileSelect}
                />
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
                      Upload More Files
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
                        {file.status === "success" && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => router.push("/jobs")}
                          >
                            <Eye className="h-4 w-4 mr-1" />
                            View Jobs
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
                  <div className="text-sm text-green-600">Files Processed Successfully</div>
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
                <Button onClick={() => router.push("/jobs")}>
                  <Briefcase className="mr-2 h-4 w-4" />
                  View All Jobs
                </Button>
                <Button variant="outline" onClick={handleReset}>
                  <Plus className="mr-2 h-4 w-4" />
                  Upload More Files
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