"use client"

import type React from "react"
import { useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { cva } from "class-variance-authority"
import { ArrowUp, ArrowDown, TrendingUp, TrendingDown, Sparkles } from "lucide-react"

const statCardVariants = cva(
  "relative overflow-hidden transition-all duration-300 hover:scale-[1.01] group cursor-pointer rounded-xl border bg-white dark:bg-slate-900 shadow-md hover:shadow-lg", // Stronger shadows
  {
    variants: {
      variant: {
        default: "border-gray-300 dark:border-slate-600 hover:border-indigo-400 dark:hover:border-indigo-500 hover:shadow-indigo-200/60 dark:hover:shadow-indigo-900/50",
        secondary: "border-indigo-300 dark:border-indigo-700 bg-indigo-50/50 dark:bg-indigo-950/30 hover:border-indigo-400 dark:hover:border-indigo-500 hover:shadow-indigo-300/60 dark:hover:shadow-indigo-900/50", 
        accent: "border-teal-300 dark:border-teal-700 bg-teal-50/50 dark:bg-teal-950/30 hover:border-teal-400 dark:hover:border-teal-500 hover:shadow-teal-300/60 dark:hover:shadow-teal-900/50",
      }
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

interface StatCardProps {
  title: string
  value: number
  icon: React.ReactNode
  trend?: {
    value: number
    direction: "up" | "down"
    label: string
  }
  variant?: "default" | "secondary" | "accent"
  className?: string
  description?: string
}

export function StatCard({ title, value, icon, trend, variant = "default", className, description }: StatCardProps) {
  const [isHovered, setIsHovered] = useState(false)

  const iconGradientClass = {
    default: "from-gray-500 to-gray-600 dark:from-gray-400 dark:to-gray-500",     // Primary (60%) - Gray
    secondary: "from-indigo-500 to-indigo-600 dark:from-indigo-400 dark:to-indigo-500", // Secondary (30%) - Indigo  
    accent: "from-teal-500 to-teal-600 dark:from-teal-400 dark:to-teal-500",     // Accent (10%) - Teal
  }

  const trendConfig = {
    up: {
      color: "text-teal-600 dark:text-teal-400",     // Use accent color for positive trends
      bgColor: "bg-teal-100 dark:bg-teal-500/20",
      icon: <ArrowUp className="w-3 h-3" />,
    },
    down: {
      color: "text-red-600 dark:text-red-400",       // Keep red for negative trends (universal)
      bgColor: "bg-red-100 dark:bg-red-500/20",
      icon: <ArrowDown className="w-3 h-3" />,
    },
  }

  const currentTrend = trend && trendConfig[trend.direction]

  return (
    <Card
      className={cn(statCardVariants({ variant }), className)}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Simplified Shimmer Effect */}
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 dark:via-white/10 to-transparent transform -skew-x-12 translate-x-[-100%] group-hover:translate-x-[200%] transition-transform duration-700"></div>
      </div>

      <CardContent className="p-4 sm:p-5 md:p-6 relative">
        <div className="flex items-start justify-between space-y-0">
          {/* Title and Description */}
          <div className="space-y-1 flex-1 pr-3">
            <p className="text-sm sm:text-sm font-semibold text-gray-700 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-gray-100 transition-colors duration-300">
              {title}
            </p>
            {description && (
              <p className="text-xs text-muted-foreground dark:text-gray-400 hidden sm:block leading-relaxed">{description}</p>
            )}
          </div>

          {/* Simplified Icon */}
          <div className={cn(
            "relative flex h-10 w-10 sm:h-11 sm:w-11 items-center justify-center rounded-lg transition-all duration-300",
            "bg-gradient-to-br shadow-sm group-hover:shadow-md group-hover:scale-105",
            iconGradientClass[variant]
          )}>
            <div className="text-white">{icon}</div>
          </div>
        </div>

        {/* Value with Responsive Design */}
        <div className="mt-3 sm:mt-4 space-y-3">
          {/* Main Value */}
          <div className={cn(
            "text-2xl sm:text-3xl font-bold transition-all duration-300 text-gray-900 dark:text-gray-100",
            isHovered && "scale-105"
          )}>
            {value.toLocaleString()}
          </div>
          
          {/* Trend Indicator - Responsive */}
          {trend && currentTrend && (
            <div className="flex items-center justify-between">
              <div className={cn(
                "inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all duration-300",
                currentTrend.bgColor,
                currentTrend.color,
                "group-hover:scale-105"
              )}>
                {currentTrend.icon}
                <span>{Math.abs(trend.value)}%</span>
                <span className="hidden sm:inline text-muted-foreground dark:text-gray-400">{trend.label}</span>
              </div>
              
              {/* Trend Visualization - Hidden on mobile */}
              <div className={cn(
                "hidden sm:flex items-center justify-center w-8 h-8 rounded-full transition-all duration-300",
                currentTrend?.bgColor,
                "group-hover:scale-110"
              )}>
                {trend.direction === "up" ? (
                  <TrendingUp className={cn("w-4 h-4", currentTrend?.color)} />
                ) : (
                  <TrendingDown className={cn("w-4 h-4", currentTrend?.color)} />
                )}
              </div>
            </div>
          )}
        </div>

        {/* Simplified Bottom Accent */}
        <div className={cn(
          "absolute bottom-0 left-0 h-1 transition-all duration-300",
          `bg-gradient-to-r ${iconGradientClass[variant]}`,
          isHovered ? "w-full" : "w-12"
        )}></div>
      </CardContent>
    </Card>
  )
}
