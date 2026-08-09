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

function UsageRow({ window: usage }: { window: AiPlanWindow }) {
  const percent = usage.usedPercent
  const reset = resetLabel(usage.resetsAt)
  const remaining = percent == null ? null : Math.max(0, 100 - Math.round(percent))
  return (
    <div className="flex flex-col gap-1 border-t py-3 first:border-t-0 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <p className="text-sm font-medium">{windowLabel(usage.windowMinutes)}</p>
        {reset ? (
          <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />{reset}
          </p>
        ) : null}
      </div>
      <p className="text-sm tabular-nums text-muted-foreground">
        {percent == null ? "Usage not reported" : `${Math.round(percent)}% used · ${remaining}% remaining`}
      </p>
    </div>
  )
}

function capturedLabel(capturedAt?: string | null) {
  if (!capturedAt) return "No usage snapshot has been reported yet"
  const captured = new Date(capturedAt)
  if (Number.isNaN(captured.getTime())) return "Usage snapshot time unavailable"
  return `Last reported ${captured.toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit"
  })}`
}

function recordedLabel(value?: string | null) {
  if (!value) return null
  const recorded = new Date(value)
  if (Number.isNaN(recorded.getTime())) return null
  return `Recorded ${recorded.toLocaleString()}`
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
  observedAt,
  className = ""
}: {
  planType?: string | null
  rateLimits?: AiPlanRateLimits | null
  usageLimit?: AiPlanUsageLimit | null
  observedAt?: string | null
  className?: string
}) {
  const windows = [rateLimits?.primary, rateLimits?.secondary].filter(Boolean) as AiPlanWindow[]
  const usageLimitRecorded = recordedLabel(usageLimit?.at)

  return (
    <div
      className={`rounded-lg border border-black/10 p-4 dark:border-white/10 ${className}`}
      data-testid="chatgpt-plan-limits"
    >
      <div className="flex items-center gap-2.5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#0d0d0d] text-white dark:bg-white dark:text-[#0d0d0d]">
          <OpenAILogo className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium" data-testid="chatgpt-plan-label">{planLabel(planType)}</p>
          <p className="text-xs text-muted-foreground">{capturedLabel(observedAt || rateLimits?.capturedAt)}</p>
        </div>
      </div>

      {usageLimit?.message && (
        <div
          className="mt-3 flex gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[12.5px] leading-relaxed text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200"
          data-testid="chatgpt-plan-usage-limit"
        >
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {usageLimit.message}
            {usageLimitRecorded ? <span className="mt-1 block text-[11px] opacity-80">{usageLimitRecorded}</span> : null}
          </span>
        </div>
      )}

      {windows.length > 0 ? (
        <div className="mt-4">
          {windows.map((usage, index) => <UsageRow key={index} window={usage} />)}
        </div>
      ) : (
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground" data-testid="chatgpt-plan-no-limits">
          OpenAI has not reported a usage window for this connection. This page does not estimate a quota.
          You can check your account directly at{" "}
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
