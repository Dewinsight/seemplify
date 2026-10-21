import * as React from "react"
import { cn } from "@/lib/utils"

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "secondary" | "outline" | "success" | "warning" | "danger"
}

export function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-lg border px-2.5 py-0.5 text-xs font-medium transition-colors",
        {
          "bg-primary/10 text-primary border-primary/20": variant === "default",
          "bg-muted text-muted-foreground border-border": variant === "secondary",
          "bg-transparent text-muted-foreground border-input": variant === "outline",
          "bg-positive/10 text-positive border-positive/20": variant === "success",
          "bg-warning/10 text-warning border-warning/20": variant === "warning",
          "bg-danger/10 text-danger border-danger/20": variant === "danger",
        },
        className
      )}
      {...props}
    />
  )
}
