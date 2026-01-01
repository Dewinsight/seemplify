'use client'

import React, { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { 
  ArrowLeft, 
  MapPin, 
  Building, 
  Clock, 
  Users, 
  MoreHorizontal,
  Edit,
  Globe,
  ExternalLink,
  CheckCircle,
  XCircle,
  Briefcase,
  Mail,
  Wand2
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

interface MobileJobHeaderProps {
  jobData: {
    _id: string
    title: string
    department: string
    location: string
    type: string
    salary: any
    applicantCount?: number
    status: string
    publiclyVisible: boolean
  }
  isMobile: boolean
  onBack: () => void
  onEdit: () => void
  onDelete: () => void
  onTogglePublic: () => void
  onEmailSettings: () => void
  onSetupWizard: () => void
  isUpdatingPublicStatus: boolean
  formatSalaryDisplay: (salary: any) => string
}

export function MobileJobHeader({
  jobData,
  isMobile,
  onBack,
  onEdit,
  onDelete,
  onTogglePublic,
  onEmailSettings,
  onSetupWizard,
  isUpdatingPublicStatus,
  formatSalaryDisplay
}: MobileJobHeaderProps) {
  const [showMobileDetails, setShowMobileDetails] = useState(false)

  if (isMobile) {
    return (
      <>
        {/* Mobile Header */}
        <div className="sticky top-0 z-50 bg-gradient-to-r from-blue-600 via-blue-700 to-gray-800 text-white" data-tutorial="job-header">
          <div className="px-4 py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <Button 
                  variant="ghost" 
                  size="sm"
                  onClick={onBack}
                  className="text-white hover:bg-white/10 p-2"
                >
                  <ArrowLeft className="h-5 w-5" />
                </Button>
                <div className="min-w-0 flex-1">
                  <h1 className="font-semibold text-lg truncate">{jobData.title}</h1>
                  <div className="flex items-center space-x-2 text-sm text-blue-100">
                    <span className="truncate">{jobData.department}</span>
                    <span>•</span>
                    <span className="truncate">{jobData.location}</span>
                  </div>
                </div>
              </div>
              
              <div className="flex items-center space-x-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowMobileDetails(!showMobileDetails)}
                  className="text-white hover:bg-white/10 p-2"
                >
                  <MoreHorizontal className="h-5 w-5" />
                </Button>
              </div>
            </div>
          </div>

          {/* Mobile Details Panel */}
          {showMobileDetails && (
            <div className="border-t border-white/20 bg-white/10 backdrop-blur-sm">
              <div className="px-4 py-4 space-y-4">
                {/* Job Stats */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="text-center">
                    <div className="text-lg font-bold">{jobData.applicantCount || 0}</div>
                    <div className="text-xs text-blue-100">Applicants</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-bold">{jobData.type}</div>
                    <div className="text-xs text-blue-100">Type</div>
                  </div>
                  <div className="text-center">
                    <Badge 
                      variant={jobData.status === 'active' ? 'default' : 'secondary'} 
                      className={cn(
                        "text-xs px-2 py-1",
                        jobData.status === 'active' 
                          ? "bg-green-500/20 text-green-100 border-green-400" 
                          : "bg-gray-500/20 text-gray-100 border-gray-400"
                      )}
                    >
                      {jobData.status}
                    </Badge>
                  </div>
                </div>

                {/* Mobile Actions */}
                <div className="w-full">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onEdit}
                    className="w-full border-white/30 text-white hover:bg-white/10 backdrop-blur-sm bg-blue-700/50"
                  >
                    <Edit className="h-4 w-4 mr-2" />
                    Edit Job
                  </Button>
                </div>

                {/* Public Status Toggle */}
                <div className="flex items-center justify-between p-3 bg-white/10 rounded-lg">
                  <div className="flex items-center space-x-2">
                    {jobData.publiclyVisible ? (
                      <Globe className="h-4 w-4 text-green-300" />
                    ) : (
                      <XCircle className="h-4 w-4 text-gray-300" />
                    )}
                    <span className="text-sm">
                      {jobData.publiclyVisible ? 'Public Job' : 'Private Job'}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={onTogglePublic}
                    disabled={isUpdatingPublicStatus}
                    className="text-white hover:bg-white/10"
                  >
                    {isUpdatingPublicStatus ? (
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                    ) : (
                      jobData.publiclyVisible ? 'Make Private' : 'Make Public'
                    )}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </>
    )
  }

  // Desktop header
  return (
    <div className="relative overflow-hidden bg-gradient-to-r from-blue-600 via-blue-700 to-gray-800 text-white dark:from-slate-800 dark:via-slate-800 dark:to-gray-800" data-tutorial="job-header">
      <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGRlZnM+CjxwYXR0ZXJuIGlkPSJncmlkIiB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHBhdHRlcm5Vbml0cz0idXNlclNwYWNlT25Vc2UiPgo8cGF0aCBkPSJNIDYwIDAgTCAwIDAgMCA2MCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSJyZ2JhKDI1NSwyNTUsMjU1LDAuMSkiIHN0cm9rZS13aWR0aD0iMSIvPgo8L3BhdHRlcm4+CjwvZGVmcz4KPHJlY3Qgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIgZmlsbD0idXJsKCNncmlkKSIvPgo8L3N2Zz4=')] opacity-20" />
      
      <div className="relative px-4 py-12 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <Button 
            variant="ghost" 
            onClick={onBack} 
            className="mb-6 text-white hover:bg-white/10 backdrop-blur-sm border border-white/20"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Jobs
          </Button>
          
          <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6 lg:gap-8">
            <div className="flex-1 min-w-0">
              <div className="flex flex-col sm:flex-row sm:items-start gap-4 mb-6">
                <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white font-bold text-xl sm:text-2xl shadow-lg flex-shrink-0">
                  {jobData.title.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight break-words">{jobData.title}</h1>
                  <div className="flex flex-col gap-2 mt-3">
                    <div className="flex items-center gap-2 text-blue-100">
                      <Building className="h-4 w-4 flex-shrink-0" />
                      <span className="text-sm sm:text-base truncate">{jobData.department}</span>
                    </div>
                    <div className="flex items-center gap-2 text-blue-100">
                      <MapPin className="h-4 w-4 flex-shrink-0" />
                      <span className="text-sm sm:text-base truncate">{jobData.location}</span>
                    </div>
                  </div>
                </div>
              </div>
              
              <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                <div className="inline-flex items-center rounded-full bg-white/10 px-3 py-2 text-xs sm:text-sm font-medium backdrop-blur-sm min-h-[36px]">
                  <Clock className="mr-2 h-4 w-4 flex-shrink-0" />
                  <span className="truncate">{jobData.type}</span>
                </div>
                <div className="inline-flex items-center rounded-full bg-white/10 px-3 py-2 text-xs sm:text-sm font-medium backdrop-blur-sm min-h-[36px]">
                  <Briefcase className="mr-2 h-4 w-4 flex-shrink-0" />
                  <span className="truncate">{formatSalaryDisplay(jobData.salary)}</span>
                </div>
                <div className="inline-flex items-center rounded-full bg-white/10 px-3 py-2 text-xs sm:text-sm font-medium backdrop-blur-sm min-h-[36px]">
                  <Users className="mr-2 h-4 w-4 flex-shrink-0" />
                  <span className="truncate">{jobData.applicantCount || 0} Applicants</span>
                </div>
                <Badge 
                  variant={jobData.status === 'active' ? 'default' : 'secondary'} 
                  className={cn(
                    "px-3 py-1.5 text-sm font-medium min-h-[36px] flex items-center",
                    jobData.status === 'active' 
                      ? "bg-green-500/20 text-green-100 border-green-400" 
                      : "bg-gray-500/20 text-gray-100 border-gray-400"
                  )}
                >
                  {jobData.status === 'active' ? (
                    <CheckCircle className="mr-2 h-4 w-4" />
                  ) : (
                    <XCircle className="mr-2 h-4 w-4" />
                  )}
                  {jobData.status}
                </Badge>
                {jobData.publiclyVisible && (
                  <Badge className="bg-blue-500/20 text-blue-100 border-blue-400 px-3 py-1.5 text-sm font-medium min-h-[36px] flex items-center">
                    <Globe className="mr-2 h-4 w-4" />
                    Public
                  </Badge>
                )}
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    className="bg-white/10 border-white/30 text-white hover:bg-white/20 backdrop-blur-sm"
                  >
                    <MoreHorizontal className="h-4 w-4 mr-2" />
                    More Actions
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>Job Actions</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={onEdit}>
                    <Edit className="mr-2 h-4 w-4" />
                    Edit Job
                  </DropdownMenuItem>
                  
                  <DropdownMenuItem onClick={onTogglePublic} disabled={isUpdatingPublicStatus}>
                    {jobData.publiclyVisible ? (
                      <>
                        <XCircle className="mr-2 h-4 w-4" />
                        Make Private
                      </>
                    ) : (
                      <>
                        <Globe className="mr-2 h-4 w-4" />
                        Make Public
                      </>
                    )}
                  </DropdownMenuItem>
                  
                  <DropdownMenuItem onClick={() => window.open(`/public/jobs/${jobData._id}`, '_blank')}>
                    <ExternalLink className="mr-2 h-4 w-4" />
                    View Public Link
                  </DropdownMenuItem>
                  
                  <DropdownMenuItem onClick={onEmailSettings}>
                    <Mail className="mr-2 h-4 w-4" />
                    Email Settings
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={onSetupWizard}>
                    <Wand2 className="mr-2 h-4 w-4" />
                    Setup Wizard
                  </DropdownMenuItem>
                  
                  <DropdownMenuSeparator />
                  
                  <DropdownMenuItem onClick={onDelete} className="text-red-600">
                    <XCircle className="mr-2 h-4 w-4" />
                    Delete Job
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
