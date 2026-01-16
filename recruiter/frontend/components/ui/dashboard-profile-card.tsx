"use client";

import React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  Mail,
  Building,
  Settings,
  CheckCircle,
  AlertTriangle,
  Edit,
  MapPin,
  Clock,
  Sparkles,
  Crown,
  Phone,
} from "lucide-react";
import { Button } from "./button";
import { Badge } from "./badge";
import { Avatar, AvatarFallback, AvatarImage } from "./avatar";
import { Progress } from "./progress";
import { Card, CardContent } from "./card";
import { useUser } from "@/context/UserContext";
import { useOrganization } from "@/context/OrganizationContext";

interface DashboardProfileCardProps {
  className?: string;
}

export function DashboardProfileCard({ className }: DashboardProfileCardProps) {
  const { state, getUserDisplayName, getUserAvatar } = useUser();
  const { currentOrganization } = useOrganization();
  const { user } = state;

  if (!user) return null;

  // Use backend-calculated profile completion (single source of truth)
  const completionPercentage = user.profileCompletion?.percentage || 0;
  const profileComplete = completionPercentage === 100;
  const backendMissingFields = user.profileCompletion?.missingFields || [];

  // Map backend field names to user-friendly labels
  const fieldNameMap: Record<string, { label: string; required: boolean }> = {
    'profile.firstName': { label: 'First Name', required: true },
    'profile.lastName': { label: 'Last Name', required: true },
    'profile.title': { label: 'Job Title', required: true },
    'profile.phone': { label: 'Phone Number', required: true },
    'profile.bio': { label: 'Bio', required: false },
    'profile.avatar': { label: 'Profile Picture', required: false },
  };

  // Get missing fields with user-friendly names
  const missingFields = backendMissingFields
    .map(field => fieldNameMap[field]?.label || field)
    .filter(Boolean);

  // Count required vs optional missing fields
  const requiredMissing = backendMissingFields.filter(field => fieldNameMap[field]?.required).length;
  const optionalMissing = backendMissingFields.filter(field => !fieldNameMap[field]?.required).length;

  const getCompletionColor = (percentage: number) => {
    if (percentage === 100) return "text-emerald-600 dark:text-emerald-400";
    if (percentage >= 75) return "text-blue-600 dark:text-blue-400";
    if (percentage >= 50) return "text-amber-600 dark:text-amber-400";
    return "text-red-600 dark:text-red-400";
  };

  const getCompletionBadgeVariant = (percentage: number): "default" | "secondary" | "destructive" => {
    if (percentage === 100) return "default";
    if (percentage >= 50) return "secondary";
    return "destructive";
  };

  return (
    <Card className={cn(
      "overflow-hidden glass-card",
      "border-border/50 dark:border-white/5 shadow-lg hover:shadow-xl transition-all duration-300",
      className
    )} data-tutorial="dashboard-profile-card-inner">
      {/* Modern header with gradient */}
      <div className="relative h-24 sm:h-28 md:h-32 lg:h-28 xl:h-32 2xl:h-36 bg-gradient-to-br from-indigo-500 via-indigo-600 to-teal-600">
        <div className="absolute inset-0 bg-black/20" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />

        {/* Pattern overlay */}
        <div className="absolute inset-0 opacity-20">
          <div className="absolute inset-0" style={{
            backgroundImage: `radial-gradient(circle at 2px 2px, white 1px, transparent 1px)`,
            backgroundSize: '32px 32px'
          }} />
        </div>

        {/* Edit button */}
        <Button
          size="sm"
          variant="ghost"
          asChild
          className="absolute top-4 right-4 h-8 w-8 p-0 text-white hover:bg-white/20 backdrop-blur-sm"
        >
          <Link href="/settings">
            <Edit className="h-4 w-4" />
          </Link>
        </Button>

        {/* Avatar positioned at bottom */}
        <div className="absolute -bottom-8 sm:-bottom-9 md:-bottom-10 lg:-bottom-9 xl:-bottom-10 2xl:-bottom-12 left-4 sm:left-5 md:left-6">
          <div className="relative">
            <Avatar className="h-16 w-16 sm:h-18 sm:w-18 md:h-20 md:w-20 lg:h-18 lg:w-18 xl:h-20 xl:w-20 2xl:h-24 2xl:w-24 border-4 border-background shadow-xl">
              <AvatarImage src={getUserAvatar() || undefined} alt={getUserDisplayName()} />
              <AvatarFallback className="text-xl font-semibold bg-gradient-to-br from-indigo-500 to-teal-600 text-white">
                {getUserDisplayName().charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            {profileComplete && (
              <div className="absolute -bottom-1 -right-1 bg-emerald-500 rounded-full p-1 border-2 border-background">
                <CheckCircle className="h-3 w-3 text-white" />
              </div>
            )}
          </div>
        </div>
      </div>

      <CardContent className="pt-10 sm:pt-12 md:pt-14 lg:pt-12 xl:pt-14 2xl:pt-16 pb-4 sm:pb-5 md:pb-6 px-4 sm:px-5 md:px-6 space-y-4 sm:space-y-5 md:space-y-6">
        {/* User info */}
        <div>
          <h3 className="text-xl font-semibold">{getUserDisplayName()}</h3>
          <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
            <Mail className="h-3 w-3" />
            {user.email}
          </p>
        </div>

        {/* Quick info grid */}
        <div className="grid grid-cols-2 gap-4">
          {user.profile?.title && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Sparkles className="h-3 w-3" />
                Title
              </p>
              <p className="text-sm font-medium">{user.profile.title}</p>
            </div>
          )}

          {/* Display current organization from context */}
          {(currentOrganization?.name || user.company?.name) && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Building className="h-3 w-3" />
                Organization
              </p>
              <p className="text-sm font-medium">
                {currentOrganization?.name || user.company?.name}
              </p>
            </div>
          )}


          {user.role && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Sparkles className="h-3 w-3" />
                Role
              </p>
              <p className="text-sm font-medium capitalize">{user.role}</p>
            </div>
          )}

          {user.profile?.phone && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Phone className="h-3 w-3" />
                Phone
              </p>
              <p className="text-sm font-medium">{user.profile.phone}</p>
            </div>
          )}
        </div>

        {/* Profile completion section */}
        <div className="space-y-3 pt-4 border-t border-border/50">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Profile Strength</span>
            <div className="flex items-center gap-2">
              <span className={cn("text-sm font-bold", getCompletionColor(completionPercentage))}>
                {completionPercentage}%
              </span>
              {!profileComplete && (
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
              )}
            </div>
          </div>

          <div className="relative">
            <Progress
              value={completionPercentage}
              className="h-2 bg-muted"
            />
            <div
              className="absolute inset-0 h-2 rounded-full bg-gradient-to-r from-indigo-500 to-teal-500 opacity-20"
              style={{ width: `${completionPercentage}%` }}
            />
          </div>

          {!profileComplete && (
            <div className="space-y-3">
              {requiredMissing > 0 && (
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-amber-600 dark:text-amber-400">
                    {requiredMissing} required field{requiredMissing !== 1 ? 's' : ''}
                  </span>
                  {optionalMissing > 0 && (
                    <span> and {optionalMissing} optional field{optionalMissing !== 1 ? 's' : ''}</span>
                  )} remaining
                </p>
              )}
              {requiredMissing === 0 && optionalMissing > 0 && (
                <p className="text-xs text-muted-foreground">
                  <span className="text-emerald-600 dark:text-emerald-400">All required fields complete!</span> Add {optionalMissing} optional field{optionalMissing !== 1 ? 's' : ''} to reach 100%
                </p>
              )}
              <Button
                asChild
                className="w-full bg-gradient-to-r from-indigo-500 to-teal-600 hover:from-indigo-600 hover:to-teal-700 text-white shadow-md hover:shadow-lg transition-all duration-300"
                size="sm"
              >
                <Link href="/settings">
                  <Settings className="h-4 w-4 mr-2" />
                  {requiredMissing > 0 ? 'Complete Required Fields' : 'Add Optional Fields'} ({missingFields.length})
                </Link>
              </Button>
            </div>
          )}

          {profileComplete && (
            <div className="flex items-center justify-center gap-2 py-2">
              <CheckCircle className="h-4 w-4 text-emerald-500" />
              <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                Profile Complete
              </span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}