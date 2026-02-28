import { cn } from "@/lib/utils"
import { Loader2, Users, Briefcase, Settings, Upload } from "lucide-react"
import { Skeleton } from "./skeleton"

// Basic spinner component
export function Spinner({ className, size = "default" }: { 
  className?: string
  size?: "sm" | "default" | "lg"
}) {
  const sizeClasses = {
    sm: "h-4 w-4",
    default: "h-6 w-6", 
    lg: "h-8 w-8"
  }
  
  return (
    <Loader2 className={cn("animate-spin", sizeClasses[size], className)} />
  )
}

// Loading button with spinner
export function LoadingButton({ 
  children, 
  loading, 
  disabled,
  className,
  ...props 
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { 
  loading?: boolean 
}) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none ring-offset-background",
        "bg-primary text-primary-foreground hover:bg-primary/90 h-10 py-2 px-4",
        className
      )}
      disabled={loading || disabled}
      {...props}
    >
      {loading && <Spinner size="sm" className="mr-2" />}
      {children}
    </button>
  )
}

// Full page loader with different variants
export function PageLoader({ 
  variant = "default",
  message = "Loading..."
}: {
  variant?: "default" | "candidates" | "jobs" | "settings" | "upload"
  message?: string
}) {
  const getIcon = () => {
    switch (variant) {
      case "candidates": return <Users className="h-12 w-12 text-blue-500 dark:text-blue-400" />
      case "jobs": return <Briefcase className="h-12 w-12 text-blue-500 dark:text-blue-400" />
      case "settings": return <Settings className="h-12 w-12 text-blue-500 dark:text-blue-400" />
      case "upload": return <Upload className="h-12 w-12 text-blue-500 dark:text-blue-400" />
      default: return <Loader2 className="h-12 w-12 text-blue-500 dark:text-blue-400 animate-spin" />
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-blue-50/30 dark:from-gray-950 dark:via-gray-900 dark:to-blue-950/30 flex items-center justify-center">
      <div className="text-center">
        <div className="w-24 h-24 rounded-full bg-gradient-to-br from-blue-100 to-purple-100 dark:from-blue-900/30 dark:to-purple-900/30 flex items-center justify-center mx-auto mb-6 shadow-lg">
          {getIcon()}
        </div>
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">{message}</h2>
        <p className="text-gray-600 dark:text-gray-400">Please wait while we load your content</p>
        <div className="mt-4">
          <div className="w-48 h-1 bg-gray-200 dark:bg-gray-700 rounded-full mx-auto overflow-hidden">
            <div className="h-full bg-gradient-to-r from-blue-500 to-purple-600 rounded-full animate-pulse"></div>
          </div>
        </div>
      </div>
    </div>
  )
}

// Card skeleton for different content types
export function CardSkeleton({ variant = "default" }: { variant?: "default" | "job" | "candidate" | "stat" }) {
  if (variant === "job") {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <Skeleton className="h-12 w-12 rounded-xl" />
            <div>
              <Skeleton className="h-5 w-32 mb-2" />
              <Skeleton className="h-4 w-24" />
            </div>
          </div>
          <Skeleton className="h-8 w-20" />
        </div>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        </div>
        <Skeleton className="h-2 w-full mb-4" />
        <div className="flex justify-between">
          <Skeleton className="h-8 w-16" />
          <Skeleton className="h-8 w-8" />
        </div>
      </div>
    )
  }

  if (variant === "candidate") {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
        <div className="p-4">
          <div className="flex items-center gap-3 mb-3">
            <Skeleton className="h-10 w-10 rounded-full" />
            <div className="flex-1">
              <Skeleton className="h-4 w-32 mb-1" />
              <Skeleton className="h-3 w-48" />
            </div>
          </div>
          <Skeleton className="h-4 w-full mb-2" />
          <Skeleton className="h-4 w-3/4 mb-3" />
          <div className="flex items-center justify-between">
            <Skeleton className="h-6 w-16" />
            <Skeleton className="h-4 w-12" />
          </div>
        </div>
      </div>
    )
  }

  if (variant === "stat") {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
        <div className="flex items-center gap-3">
          <Skeleton className="h-10 w-10 rounded-lg" />
          <div className="flex-1">
            <Skeleton className="h-4 w-24 mb-2" />
            <Skeleton className="h-8 w-16" />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
      <Skeleton className="h-6 w-3/4 mb-4" />
      <Skeleton className="h-4 w-full mb-2" />
      <Skeleton className="h-4 w-5/6 mb-2" />
      <Skeleton className="h-4 w-4/5" />
    </div>
  )
}

// Table skeleton
export function TableSkeleton({ 
  rows = 5, 
  columns = 6 
}: { 
  rows?: number
  columns?: number 
}) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="border-b border-gray-200 dark:border-gray-700 p-4">
        <div className="flex gap-4">
          {Array.from({ length: columns }).map((_, i) => (
            <Skeleton key={i} className="h-4 flex-1" />
          ))}
        </div>
      </div>
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="border-b border-gray-200 dark:border-gray-700 p-4 last:border-b-0">
          <div className="flex gap-4 items-center">
            {Array.from({ length: columns }).map((_, colIndex) => (
              <div key={colIndex} className="flex-1">
                {colIndex === 0 ? (
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-8 w-8 rounded-full" />
                    <Skeleton className="h-4 w-24" />
                  </div>
                ) : (
                  <Skeleton className="h-4 w-full" />
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// Loading overlay for sections
export function LoadingOverlay({ 
  isLoading, 
  children, 
  message = "Loading..." 
}: {
  isLoading: boolean
  children: React.ReactNode
  message?: string
}) {
  return (
    <div className="relative">
      {children}
      {isLoading && (
        <div className="absolute inset-0 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm flex items-center justify-center z-10 rounded-lg">
          <div className="text-center">
            <Spinner size="lg" className="mb-2" />
            <p className="text-sm text-gray-600 dark:text-gray-400">{message}</p>
          </div>
        </div>
      )}
    </div>
  )
}

// Inline loading state
export function InlineLoader({ 
  message = "Loading...", 
  className 
}: {
  message?: string
  className?: string
}) {
  return (
    <div className={cn("flex items-center gap-2 text-gray-600 dark:text-gray-400", className)}>
      <Spinner size="sm" />
      <span className="text-sm">{message}</span>
    </div>
  )
}

// Data loading states
export function EmptyState({
  icon: Icon = Users,
  title = "No data found",
  description = "There's nothing to show here yet.",
  action
}: {
  icon?: React.ElementType
  title?: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <div className="text-center py-12">
      <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-100 to-purple-100 dark:from-blue-900/30 dark:to-purple-900/30 flex items-center justify-center mx-auto mb-4">
        <Icon className="h-8 w-8 text-blue-500 dark:text-blue-400" />
      </div>
      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
        {title}
      </h3>
      <p className="text-gray-600 dark:text-gray-400 mb-6">
        {description}
      </p>
      {action}
    </div>
  )
}

// Error state with retry
export function ErrorState({
  title = "Something went wrong",
  description = "We couldn't load the data. Please try again.",
  onRetry,
  showRetry = true
}: {
  title?: string
  description?: string
  onRetry?: () => void
  showRetry?: boolean
}) {
  return (
    <div className="text-center py-12">
      <div className="w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center mx-auto mb-4">
        <Users className="h-8 w-8 text-red-500 dark:text-red-400" />
      </div>
      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
        {title}
      </h3>
      <p className="text-gray-600 dark:text-gray-400 mb-6">
        {description}
      </p>
      {showRetry && onRetry && (
        <LoadingButton onClick={onRetry} className="bg-red-600 hover:bg-red-700">
          Try Again
        </LoadingButton>
      )}
    </div>
  )
}
