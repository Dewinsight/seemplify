"use client"

import Link from "next/link"
import { Check, ClipboardList, FileSignature, Hourglass, Lock, type LucideIcon } from "lucide-react"
import { StatusPill } from "@/components/candidate-ui"
import type { CandidateBrand } from "@/lib/brand"
import type { CandidateOnboarding } from "@/lib/types"
import { buildTransitionFlow, type TransitionFlowStep, type TransitionFlowStepType } from "@/lib/transition-flow"
import { cn } from "@/lib/utils"

const stepIcons: Record<TransitionFlowStepType, LucideIcon> = {
  form: ClipboardList,
  document_fill: ClipboardList,
  document_sign: FileSignature,
  waiting: Hourglass,
  complete: Check,
}

function dateLabel(value?: string) {
  if (!value) return ""
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(value))
}

function StepContent({
  brand,
  step,
  active,
  index,
}: {
  brand: CandidateBrand
  step: TransitionFlowStep
  active: boolean
  index: number
}) {
  const Icon = stepIcons[step.type] || FileSignature
  const done = step.status === "completed" || step.status === "signed" || step.status === "approved" || step.status === "under_review"
  return (
    <>
      <span className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-md border text-sm font-semibold",
        active
          ? cn(brand.accentBgClass, brand.accentBorderClass, brand.accentTextClass)
          : done
            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
            : "border-slate-200 bg-white text-slate-500",
      )}>
        {done ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-start justify-between gap-2">
          <span>
            <span className="block text-sm font-semibold text-slate-950">{index + 1}. {step.label}</span>
            <span className="mt-1 block text-xs text-slate-500">
              {step.meta}
              {step.dueAt ? ` - due ${dateLabel(step.dueAt)}` : ""}
            </span>
          </span>
          {step.disabled && <Lock className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />}
        </span>
        <span className="mt-2 block">
          <StatusPill status={step.status} />
        </span>
      </span>
    </>
  )
}

export function TransitionFlowNav({
  brand,
  record,
  currentStepId,
  title = "Packet steps",
}: {
  brand: CandidateBrand
  record?: CandidateOnboarding | null
  currentStepId?: string
  title?: string
}) {
  const steps = buildTransitionFlow(record)
  if (!record || steps.length === 0) return null

  const nextActionStep = steps.find((step) => step.actionable)
  const activeStepId = currentStepId || nextActionStep?.id || steps.find((step) => step.type === "complete")?.id || steps[0]?.id
  const activeIndex = Math.max(0, steps.findIndex((step) => step.id === activeStepId))
  const pendingCount = steps.filter((step) => step.actionable).length

  return (
    <section className="rounded-md border border-slate-200 bg-white p-4 shadow-soft">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-950">{title}</h2>
          <p className="mt-1 text-xs text-slate-500">
            {pendingCount ? `${pendingCount} action${pendingCount === 1 ? "" : "s"} waiting` : "No candidate action waiting"}
          </p>
        </div>
        <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", brand.accentBgClass, brand.accentTextClass)}>
          {activeIndex + 1}/{steps.length}
        </span>
      </div>

      <ol className="mt-4 space-y-2">
        {steps.map((step, index) => {
          const active = step.id === activeStepId
          const className = cn(
            "flex w-full items-start gap-3 rounded-md border p-3 text-left transition",
            active ? cn("border-slate-300 bg-slate-50", brand.focusRingClass) : "border-slate-200 bg-white",
            !step.disabled && "hover:bg-slate-50",
          )

          if (step.disabled) {
            return (
              <li key={step.id}>
                <div className={className}>
                  <StepContent brand={brand} step={step} active={active} index={index} />
                </div>
              </li>
            )
          }

          return (
            <li key={step.id}>
              <Link href={step.href} className={className}>
                <StepContent brand={brand} step={step} active={active} index={index} />
              </Link>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

export function TransitionFlowTopNav({
  brand,
  record,
  currentStepId,
  title = "Packet steps",
}: {
  brand: CandidateBrand
  record?: CandidateOnboarding | null
  currentStepId?: string
  title?: string
}) {
  const steps = buildTransitionFlow(record)
  if (!record || steps.length === 0) return null

  const nextActionStep = steps.find((step) => step.actionable)
  const activeStepId = currentStepId || nextActionStep?.id || steps.find((step) => step.type === "complete")?.id || steps[0]?.id
  const activeIndex = Math.max(0, steps.findIndex((step) => step.id === activeStepId))
  const pendingCount = steps.filter((step) => step.actionable).length

  return (
    <section className="rounded-md border border-slate-200 bg-white p-3 shadow-soft" aria-label={title}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-950">{title}</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Step {activeIndex + 1} of {steps.length}
            {pendingCount ? ` - ${pendingCount} action${pendingCount === 1 ? "" : "s"} waiting` : ""}
          </p>
        </div>
        <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold", brand.accentBgClass, brand.accentTextClass)}>
          {activeIndex + 1}/{steps.length}
        </span>
      </div>

      <ol className="mt-3 flex gap-2 overflow-x-auto pb-1">
        {steps.map((step, index) => {
          const Icon = stepIcons[step.type] || FileSignature
          const done = step.status === "completed" || step.status === "signed" || step.status === "approved" || step.status === "under_review"
          const active = step.id === activeStepId
          const className = cn(
            "flex min-w-[210px] items-center gap-2 rounded-md border px-3 py-2 text-left",
            active ? "border-slate-400 bg-slate-50" : "border-slate-200 bg-white",
            step.disabled ? "text-slate-400" : "text-slate-700",
            !step.disabled && "hover:bg-slate-50",
          )
          const content = (
            <>
              <span className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-md border text-xs font-semibold",
                done
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : active
                    ? cn(brand.accentBgClass, brand.accentBorderClass, brand.accentTextClass)
                    : "border-slate-200 bg-white text-slate-500",
              )}>
                {done ? <Check className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-xs font-semibold text-slate-950">{index + 1}. {step.label}</span>
                <span className="mt-0.5 block truncate text-[11px] text-slate-500">{step.meta}</span>
              </span>
            </>
          )

          if (step.disabled) {
            return (
              <li key={step.id}>
                <div className={className}>{content}</div>
              </li>
            )
          }

          return (
            <li key={step.id}>
              <Link href={step.href} className={className}>{content}</Link>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
