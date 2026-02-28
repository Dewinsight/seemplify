"use client"

import React from 'react'
import { Badge } from '@/components/ui/badge'
import { XCircle, Clock, AlertTriangle } from 'lucide-react'

interface RejectionStatusBadgeProps {
  status?: 'rejected' | 'moved_to_pipeline' | 'shortlisted' | string
  variant?: 'compact' | 'detailed'
  rejectedAt?: string
  className?: string
}

export function RejectionStatusBadge({ 
  status, 
  variant = 'compact', 
  rejectedAt,
  className = "" 
}: RejectionStatusBadgeProps) {
  if (status !== 'rejected') {
    return null
  }

  const formatRejectionTime = (timestamp?: string) => {
    if (!timestamp) return 'Recently'
    
    const date = new Date(timestamp)
    const now = new Date()
    const diffInHours = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60))
    
    if (diffInHours < 1) return 'Just now'
    if (diffInHours < 24) return `${diffInHours}h ago`
    if (diffInHours < 48) return 'Yesterday'
    
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      ...(date.getFullYear() !== now.getFullYear() && { year: 'numeric' })
    })
  }

  if (variant === 'detailed') {
    return (
      <div className={`inline-flex items-center gap-2 ${className}`}>
        <Badge 
          variant="destructive" 
          className="bg-red-100 text-red-800 border-red-300 dark:bg-red-900 dark:text-red-200 dark:border-red-700 animate-pulse"
        >
          <XCircle className="h-3 w-3 mr-1" />
          REJECTED
        </Badge>
        {rejectedAt && (
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {formatRejectionTime(rejectedAt)}
          </span>
        )}
      </div>
    )
  }

  return (
    <Badge 
      variant="destructive" 
      className={`bg-red-100 text-red-800 border-red-300 dark:bg-red-900 dark:text-red-200 dark:border-red-700 text-xs px-2 py-0.5 font-bold animate-pulse ${className}`}
    >
      <XCircle className="h-3 w-3 mr-1" />
      REJECTED
    </Badge>
  )
}

// Enhanced status badge for comprehensive status display
interface ComprehensiveStatusBadgeProps {
  status?: 'rejected' | 'moved_to_pipeline' | 'shortlisted' | string
  rejectedAt?: string
  movedToPipelineAt?: string
  className?: string
}

export function ComprehensiveStatusBadge({ 
  status, 
  rejectedAt, 
  movedToPipelineAt,
  className = "" 
}: ComprehensiveStatusBadgeProps) {
  const getStatusConfig = () => {
    switch (status) {
      case 'rejected':
        return {
          label: 'REJECTED',
          icon: <XCircle className="h-3 w-3" />,
          className: 'bg-red-100 text-red-800 border-red-300 dark:bg-red-900 dark:text-red-200 animate-pulse',
          timestamp: rejectedAt
        }
      case 'moved_to_pipeline':
        return {
          label: 'IN PIPELINE',
          icon: <Clock className="h-3 w-3" />,
          className: 'bg-green-100 text-green-800 border-green-300 dark:bg-green-900 dark:text-green-200',
          timestamp: movedToPipelineAt
        }
      case 'shortlisted':
        return {
          label: 'ACTIVE',
          icon: <AlertTriangle className="h-3 w-3" />,
          className: 'bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-900 dark:text-blue-200',
          timestamp: null
        }
      default:
        return {
          label: 'PENDING',
          icon: <Clock className="h-3 w-3" />,
          className: 'bg-gray-100 text-gray-800 border-gray-300 dark:bg-gray-700 dark:text-gray-300',
          timestamp: null
        }
    }
  }

  const config = getStatusConfig()
  
  return (
    <Badge 
      variant="outline"
      className={`text-xs px-2 py-1 font-bold ${config.className} ${className}`}
    >
      {config.icon}
      <span className="ml-1">{config.label}</span>
    </Badge>
  )
}
