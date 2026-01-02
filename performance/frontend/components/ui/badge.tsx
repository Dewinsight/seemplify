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
          "bg-purple-500/10 text-purple-300 border-purple-500/20": variant === "default",
          "bg-zinc-800/60 text-zinc-300 border-zinc-700": variant === "secondary",
          "bg-transparent text-zinc-300 border-zinc-700": variant === "outline",
          "bg-emerald-500/10 text-emerald-400 border-emerald-500/20": variant === "success",
          "bg-amber-500/10 text-amber-400 border-amber-500/20": variant === "warning",
          "bg-red-500/10 text-red-400 border-red-500/20": variant === "danger",
        },
        className
      )}
      {...props}
    />
  )
}
