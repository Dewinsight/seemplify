// Credit error handling utilities
import { toast } from "@/components/ui/use-toast"
import { Button } from "@/components/ui/button"

export interface CreditError {
  error: string;
  message: string;
  details: {
    action: string;
    required: number;
    available: number;
    deficit: number;
  };
  suggestions: string[];
  timestamp?: string;
}

// Map action types to user-friendly names
export const ACTION_NAMES: Record<string, string> = {
  createJob: "Create Job",
  uploadCandidate: "Upload Candidate CV",
  scheduleInterview: "Schedule Interview",
  aiMatching: "AI Matching",
  generateQuestions: "Generate Interview Questions",
  aiAnalysis: "AI Interview Analysis",
  bulkUpload: "Bulk Job Upload",
  reEmbed: "Re-embed Job",
  bulkAnalysis: "Bulk AI Analysis"
};

// Map action types to emoji icons
export const ACTION_ICONS: Record<string, string> = {
  createJob: "💼",
  uploadCandidate: "📄",
  scheduleInterview: "📅",
  aiMatching: "🤖",
  generateQuestions: "❓",
  aiAnalysis: "🔍",
  bulkUpload: "📦",
  reEmbed: "🔄",
  bulkAnalysis: "📊"
};

export function handleCreditError(error: CreditError) {
  const actionName = ACTION_NAMES[error.details.action] || error.details.action;
  const actionIcon = ACTION_ICONS[error.details.action] || "💳";
  
  // Show toast with detailed error
  toast({
    variant: "destructive",
    title: `${actionIcon} Insufficient Credits`,
    description: (
      <div className="space-y-2">
        <p className="font-medium">{actionName} requires {error.details.required} credits</p>
        <p className="text-sm">You have {error.details.available} credits remaining</p>
        <p className="text-sm text-muted-foreground">Need {error.details.deficit} more credits</p>
      </div>
    ),
    action: (
      <Button 
        variant="outline" 
        size="sm" 
        onClick={() => window.location.href = '/analytics/credits'}
      >
        Purchase Credits
      </Button>
    ),
    duration: 10000 // Show for 10 seconds
  });
  
  // Log error details for debugging
  console.error("💳 Credit Error:", {
    action: error.details.action,
    actionName,
    required: error.details.required,
    available: error.details.available,
    deficit: error.details.deficit,
    message: error.message
  });
}

export function isCreditError(error: any): error is CreditError {
  return (
    error &&
    error.error === 'INSUFFICIENT_CREDITS' &&
    error.details &&
    typeof error.details.required === 'number' &&
    typeof error.details.available === 'number'
  );
}

// Helper to extract credit error from various error formats
export function extractCreditError(error: any): CreditError | null {
  // Direct credit error response
  if (isCreditError(error)) {
    return error;
  }
  
  // Error wrapped in response data
  if (error.data && isCreditError(error.data)) {
    return error.data;
  }
  
  // Error from response.json()
  if (error.response && error.response.data && isCreditError(error.response.data)) {
    return error.response.data;
  }
  
  return null;
}

