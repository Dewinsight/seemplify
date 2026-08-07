"use client"

import { AlertCircle, Clock } from "lucide-react"
import { OpenAILogo } from "@/components/ui/openai-logo"
import type { AiPlanRateLimits, AiPlanUsageLimit, AiPlanWindow } from "@/services/aiAccountService"

/** OpenAI names the tiers in lower case; these are the labels people recognise. */
const PLAN_LABELS: Record<string, string> = {
  free: "ChatGPT Free",
  plus: "ChatGPT Plus",
  pro: "ChatGPT Pro",
  business: "ChatGPT Business",
  team: "ChatGPT Team",
  enterprise: "ChatGPT Enterprise",
  edu: "ChatGPT Edu"
}

export function planLabel(planType?: string | null) {
  const key = String(planType || "").trim().toLowerCase()
  if (!key) return "ChatGPT account"
  return PLAN_LABELS[key] || `ChatGPT ${key.charAt(0).toUpperCase()}${key.slice(1)}`
}

/** "5-hour limit" reads better than "300 minutes"; anything odd stays literal. */
function windowLabel(minutes: number | null) {
  if (!minutes) return "Usage limit"
  if (minutes % (60 * 24 * 7) === 0) {
    const weeks = minutes / (60 * 24 * 7)
    return weeks === 1 ? "Weekly limit" : `${weeks}-week limit`
  }
  if (minutes % (60 * 24) === 0) {
    const days = minutes / (60 * 24)
    return days === 1 ? "Daily limit" : `${days}-day limit`
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60
    return hours === 1 ? "Hourly limit" : `${hours}-hour limit`
  }
  return `${minutes}-minute limit`
}

function resetLabel(resetsAt: string | null) {
  if (!resetsAt) return null
  const when = new Date(resetsAt)
  if (Number.isNaN(when.getTime())) return null
  if (when.getTime() <= Date.now()) return "Resets shortly"
  return `Resets ${when.toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit"
  })}`
}

function UsageBar({ window: usage }: { window: AiPlanWindow }) {
  const percent = usage.usedPercent
  // Colour only where it changes a decision: nearly out, or out.
  const tone = percent == null ? "bg-muted-foreground/40"
    : percent >= 100 ? "bg-destructive"
      : percent >= 80 ? "bg-amber-500"
        : "bg-[#0d0d0d] dark:bg-white"
  const reset = resetLabel(usage.resetsAt)
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="font-medium">{windowLabel(usage.windowMinutes)}</span>
        <span className="tabular-nums text-muted-foreground">
          {percent == null ? "Usage unknown" : `${Math.round(percent)}% used`}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full transition-all ${tone}`}
          style={{ width: `${Math.max(2, Math.min(100, percent ?? 0))}%` }}
        />
      </div>
      {reset && (
        <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
          <Clock className="h-3 w-3" />{reset}
        </p>
      )}
    </div>
  )
}

/**
 * What the connected plan is and how much of it is left.
 *
 * AI in this workspace runs on the user's own ChatGPT plan, so when it stops
 * working the reason is usually their plan rather than the product. Showing
 * the tier and its usage windows turns "AI is broken" into "I am out until
 * Thursday", which is a thing a person can act on.
 */
export function ChatGptPlanLimits({
  planType,
  rateLimits,
  usageLimit,
  className = ""
}: {
  planType?: string | null
  rateLimits?: AiPlanRateLimits | null
  usageLimit?: AiPlanUsageLimit | null
  className?: string
}) {
  const windows = [rateLimits?.primary, rateLimits?.secondary].filter(Boolean) as AiPlanWindow[]

  return (
    <div
      className={`rounded-xl border border-black/10 p-4 dark:border-white/10 ${className}`}
      data-testid="chatgpt-plan-limits"
    >
      <div className="flex items-center gap-2.5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#0d0d0d] text-white dark:bg-white dark:text-[#0d0d0d]">
          <OpenAILogo className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium" data-testid="chatgpt-plan-label">{planLabel(planType)}</p>
          <p className="text-xs text-muted-foreground">Your plan runs this workspace's AI</p>
        </div>
      </div>

      {usageLimit?.message && (
        <div
          className="mt-3 flex gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[12.5px] leading-relaxed text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200"
          data-testid="chatgpt-plan-usage-limit"
        >
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{usageLimit.message}</span>
        </div>
      )}

      {windows.length > 0 ? (
        <div className="mt-4 space-y-3">
          {windows.map((usage, index) => <UsageBar key={index} window={usage} />)}
        </div>
      ) : (
        // Codex reports limits as a side effect of running work, so a freshly
        // connected account has none yet. Saying so beats an empty panel.
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground" data-testid="chatgpt-plan-no-limits">
          OpenAI reports your remaining allowance as you use it — run an AI task and your limits
          will appear here. You can always see the full picture at{" "}
          <a
            className="underline underline-offset-2 hover:text-foreground"
            href="https://chatgpt.com/#settings"
            target="_blank"
            rel="noreferrer noopener"
          >
            chatgpt.com
          </a>.
        </p>
      )}
    </div>
  )
}

export default ChatGptPlanLimits
