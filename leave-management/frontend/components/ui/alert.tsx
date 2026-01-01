import * as React from "react"
import { cn } from "@/lib/utils"

export interface AlertProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "danger" | "warning" | "success"
}

export function Alert({ className, variant = "default", ...props }: AlertProps) {
  return (
    <div
      role="alert"
      className={cn(
        "relative w-full rounded-xl border p-4",
        {
          "bg-card text-card-foreground border-border": variant === "default",
          "bg-red-500/10 text-red-700 border-red-500/20": variant === "danger",
          "bg-amber-500/10 text-amber-700 border-amber-500/20": variant === "warning",
          "bg-emerald-500/10 text-emerald-700 border-emerald-500/20": variant === "success",
        },
        className
      )}
      {...props}
    />
  )
}

export function AlertTitle({
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h5 className={cn("mb-1 font-semibold leading-none tracking-tight", className)} {...props} />
  )
}

export function AlertDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <div className={cn("text-sm [&_p]:leading-relaxed", className)} {...props} />
  )
}

