"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/hooks/use-toast"
import { Loader2, CheckCircle, XCircle, RefreshCw, AlertTriangle, Sparkles } from "lucide-react"
import * as candidateService from "@/services/candidateService"

interface CandidateEmbeddingCardProps {
  embeddingStatus: any
  checkingEmbedding: boolean
  handleCreateEmbedding: () => Promise<void>
  creatingEmbedding: boolean
  candidateId?: string
  candidateName?: string
}

export function CandidateEmbeddingCard({ 
  embeddingStatus, 
  checkingEmbedding, 
  handleCreateEmbedding, 
  creatingEmbedding,
  candidateId,
  candidateName 
}: CandidateEmbeddingCardProps) {
  const [refreshing, setRefreshing] = useState(false)
  const { toast } = useToast()

  const refreshEmbedding = async () => {
    if (!candidateId) {
      toast({
        title: "Error",
        description: "Candidate ID not available for refresh",
        variant: "destructive",
      })
      return
    }

    try {
      setRefreshing(true)
      const result = await candidateService.refreshEmbedding(candidateId)
      
      toast({
        title: "Success",
        description: `Enhanced embedding refreshed for ${result.candidateName}`,
      })
      
      // The parent component should handle refreshing the status
      // You might want to add a callback prop for this
    } catch (error: any) {
      console.error('Error refreshing embedding:', error)
      toast({
        title: "Error",
        description: error.message || "Failed to refresh embedding",
        variant: "destructive",
      })
    } finally {
      setRefreshing(false)
    }
  }

  if (checkingEmbedding) {
    return (
      <div className="flex items-center gap-3 text-gray-600">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span>Checking embedding status...</span>
      </div>
    )
  }

  if (embeddingStatus) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {embeddingStatus.isEmbedded && embeddingStatus.existsInPinecone ? (
              <CheckCircle className="h-5 w-5 text-green-600" />
            ) : (
              <XCircle className="h-5 w-5 text-red-600" />
            )}
            <div>
              <p className="text-sm font-medium">
                {embeddingStatus.isEmbedded && embeddingStatus.existsInPinecone 
                  ? "Embedded & Searchable" 
                  : "Not Embedded"}
              </p>
              {embeddingStatus.embeddingCreatedAt && (
                <p className="text-xs text-muted-foreground">
                  Created: {new Date(embeddingStatus.embeddingCreatedAt).toLocaleDateString()}
                </p>
              )}
            </div>
          </div>
        </div>
        
        <div className="flex gap-2">
          {embeddingStatus.needsEmbedding && (
            <Button 
              onClick={handleCreateEmbedding}
              disabled={creatingEmbedding}
              className="flex-1 bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-700 hover:to-purple-800"
            >
              {creatingEmbedding ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-4 w-4" />
                  Create AI Embedding
                </>
              )}
            </Button>
          )}
          
          {embeddingStatus.isEmbedded && candidateId && (
            <Button 
              onClick={refreshEmbedding} 
              disabled={refreshing}
              variant="outline"
              className="flex-1 border-blue-200 text-blue-700 hover:bg-blue-50"
            >
              {refreshing ? (
                <>
                  <Loader2 className="animate-spin h-4 w-4 mr-2" />
                  Refreshing...
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Refresh with Enhanced Data
                </>
              )}
            </Button>
          )}
        </div>

        {/* Enhanced Features Notice */}
        {embeddingStatus.isEmbedded && candidateId && (
          <div className="p-4 rounded-lg bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5" />
              <div>
                <h4 className="font-medium text-amber-800 mb-1">Enhanced Matching Available</h4>
                <p className="text-sm text-amber-700 mb-3">
                  Click "Refresh with Enhanced Data" to upgrade your embedding with:
                </p>
                <div className="grid grid-cols-2 gap-2 text-xs text-amber-700">
                  <div className="flex items-center gap-1">
                    <CheckCircle className="h-3 w-3" />
                    Detailed work experience
                  </div>
                  <div className="flex items-center gap-1">
                    <CheckCircle className="h-3 w-3" />
                    Career progression analysis
                  </div>
                  <div className="flex items-center gap-1">
                    <CheckCircle className="h-3 w-3" />
                    Industry experience mapping
                  </div>
                  <div className="flex items-center gap-1">
                    <CheckCircle className="h-3 w-3" />
                    AI-powered insights
                  </div>
                  <div className="flex items-center gap-1">
                    <CheckCircle className="h-3 w-3" />
                    Leadership assessment
                  </div>
                  <div className="flex items-center gap-1">
                    <CheckCircle className="h-3 w-3" />
                    Technology expertise
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
        
        <div className="text-xs text-muted-foreground bg-gray-50 p-3 rounded-lg">
          <p className="mb-1"><strong>Database:</strong> {embeddingStatus.isEmbedded ? "✓ Flagged" : "✗ Not flagged"}</p>
          <p><strong>Pinecone:</strong> {embeddingStatus.existsInPinecone ? "✓ Stored" : "✗ Not stored"}</p>
        </div>
      </div>
    )
  }

  // Fallback when status check failed
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 text-amber-600">
        <AlertTriangle className="h-5 w-5" />
        <span>Unable to check embedding status</span>
      </div>
      
      <Button 
        onClick={handleCreateEmbedding}
        disabled={creatingEmbedding}
        className="w-full bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-700 hover:to-purple-800"
      >
        {creatingEmbedding ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Creating Embedding...
          </>
        ) : (
          <>
            <Sparkles className="mr-2 h-4 w-4" />
            Create AI Embedding
          </>
        )}
      </Button>
      
      <p className="text-xs text-muted-foreground bg-amber-50 p-3 rounded-lg border border-amber-200">
        ⚠️ Status check failed, but you can still try to create the embedding. This will work if the candidate has sufficient data.
      </p>
    </div>
  )
} 