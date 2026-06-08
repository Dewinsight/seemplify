import { cn } from "@/lib/utils"

interface PulseDotProps {
  color?: "green" | "blue" | "purple" | "amber" | "pink"
  size?: "sm" | "md" | "lg"
  className?: string
}

export function PulseDot({ color = "green", size = "md", className }: PulseDotProps) {
  const colorClasses = {
    green: "bg-green-500",
    blue: "bg-blue-500",
    purple: "bg-purple-500",
    amber: "bg-amber-500",
    pink: "bg-pink-500",
  }

  const sizeClasses = {
    sm: "h-1.5 w-1.5 before:h-1.5 before:w-1.5",
    md: "h-2 w-2 before:h-2 before:w-2",
    lg: "h-2.5 w-2.5 before:h-2.5 before:w-2.5",
  }

  return (
    <span className={cn("relative flex rounded-full", colorClasses[color], sizeClasses[size], className)}>
      <span
        className={cn("animate-ping absolute inline-flex h-full w-full rounded-full opacity-75", colorClasses[color])}
      />
    </span>
  )
}
