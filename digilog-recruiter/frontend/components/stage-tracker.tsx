import { CheckCircle, Circle } from "lucide-react"

interface Stage {
  name: string
  completed: boolean
  current?: boolean
}

interface StageTrackerProps {
  stages: Stage[]
}

export function StageTracker({ stages }: StageTrackerProps) {
  return (
    <div className="space-y-4">
      {stages.map((stage, index) => (
        <div key={index} className="flex items-start gap-3">
          <div className="flex h-6 w-6 items-center justify-center">
            {stage.completed ? (
              <CheckCircle className="h-6 w-6 text-primary" />
            ) : stage.current ? (
              <div className="h-6 w-6 rounded-full border-2 border-primary bg-primary/20" />
            ) : (
              <Circle className="h-6 w-6 text-muted-foreground" />
            )}
          </div>
          <div className="flex-1">
            <p
              className={`text-sm font-medium ${stage.current ? "text-primary" : stage.completed ? "" : "text-muted-foreground"}`}
            >
              {stage.name}
            </p>
          </div>
        </div>
      ))}
    </div>
  )
}
