"use client"

import { useState } from "react"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { toast } from "@/components/ui/use-toast"
import { updateJob } from "@/services/jobService"
import { Badge } from "@/components/ui/badge"

interface StatusToggleProps {
  jobId: string
  currentStatus: 'draft' | 'active' | 'paused' | 'closed' | 'archived'
  onStatusChange?: (newStatus: 'draft' | 'active' | 'paused' | 'closed' | 'archived') => void
  className?: string
}

export function StatusToggle({ jobId, currentStatus, onStatusChange, className = "" }: StatusToggleProps) {
  const [isUpdating, setIsUpdating] = useState(false)
  const [status, setStatus] = useState(currentStatus)

  const handleToggle = async (checked: boolean) => {
    const newStatus = checked ? 'active' : 'paused'
    
    setIsUpdating(true)
    try {
      await updateJob(jobId, { status: newStatus })
      setStatus(newStatus)
      onStatusChange?.(newStatus)
      
      toast({
        title: "Status Updated",
        description: `Job is now ${newStatus}.`,
      })
    } catch (error: any) {
      toast({
        title: "Update Failed",
        description: error.message || "Failed to update job status.",
        variant: "destructive",
      })
    } finally {
      setIsUpdating(false)
    }
  }

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case 'active':
        return 'default'
      case 'paused':
        return 'secondary'
      case 'draft':
        return 'outline'
      case 'closed':
        return 'destructive'
      case 'archived':
        return 'outline'
      default:
        return 'outline'
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'text-green-600'
      case 'paused':
        return 'text-yellow-600'
      case 'draft':
        return 'text-gray-600'
      case 'closed':
        return 'text-red-600'
      case 'archived':
        return 'text-muted-foreground'
      default:
        return 'text-gray-600'
    }
  }

  // For draft, closed, or archived jobs, just show a badge without toggle
  if (status === 'draft' || status === 'closed' || status === 'archived') {
    return (
      <div className={className}>
        <Badge variant={getStatusBadgeVariant(status)} className={getStatusColor(status)}>
          {status.charAt(0).toUpperCase() + status.slice(1)}
        </Badge>
      </div>
    )
  }

  return (
    <div className={`flex items-center space-x-3 ${className}`}>
      <Switch
        id={`status-toggle-${jobId}`}
        checked={status === 'active'}
        onCheckedChange={handleToggle}
        disabled={isUpdating}
      />
      <Label 
        htmlFor={`status-toggle-${jobId}`} 
        className={`text-sm font-medium cursor-pointer ${getStatusColor(status)}`}
      >
        {status === 'active' ? 'Active' : 'Paused'}
      </Label>
    </div>
  )
} 