import * as React from "react"
import { cn } from "@/lib/utils"

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "secondary" | "outline" | "success" | "warning" | "danger"
}

export function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
        {
          "bg-primary/10 text-primary border-primary/20": variant === "default",
          "bg-secondary text-secondary-foreground border-border": variant === "secondary",
          "bg-transparent text-foreground border-border": variant === "outline",
          "bg-emerald-500/10 text-emerald-700 border-emerald-500/20": variant === "success",
          "bg-amber-500/10 text-amber-700 border-amber-500/20": variant === "warning",
          "bg-red-500/10 text-red-700 border-red-500/20": variant === "danger",
        },
        className
      )}
      {...props}
    />
  )
}

