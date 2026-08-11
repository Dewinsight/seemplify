"use client"

import Link from "next/link"
import type { ReactNode } from "react"
import { usePathname } from "next/navigation"
import { Check, FileSignature, Files, LayoutDashboard, LogOut, UserRound } from "lucide-react"
import { CandidateBrandMark } from "@/components/candidate-brand-mark"
import { type CandidateBrand } from "@/lib/brand"
import { fullName } from "@/lib/api"
import type { CandidateAccount } from "@/lib/types"
import { cn } from "@/lib/utils"

export function statusClass(status: string) {
  if (status === "completed" || status === "signed") return "border-emerald-200 bg-emerald-50 text-emerald-700"
  if (status === "cancelled" || status === "voided" || status === "declined") return "border-rose-200 bg-rose-50 text-rose-700"
  if (status === "in_progress" || status === "sent" || status === "viewed" || status === "partially_signed") {
    return "border-blue-200 bg-blue-50 text-blue-700"
  }
  return "border-slate-200 bg-slate-50 text-slate-700"
}

export function StatusPill({ status }: { status: string }) {
  return (
    <span className={cn("inline-flex w-fit items-center rounded-full border px-2.5 py-1 text-xs font-semibold capitalize", statusClass(status))}>
      {status.replace(/_/g, " ")}
    </span>
  )
}

export function CandidateShell({
  brand,
  account,
  title,
  subtitle,
  onSignOut,
  children,
}: {
  brand: CandidateBrand
  account?: CandidateAccount | null
  title: string
  subtitle?: string
  onSignOut?: () => void | Promise<void>
  children: ReactNode
}) {
  const pathname = usePathname()
  const navItems = [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, active: pathname === "/dashboard" },
    { href: "/documents", label: "Documents", icon: Files, active: pathname === "/documents" || pathname.startsWith("/documents/") },
    { href: "/profile", label: "Profile", icon: UserRound, active: pathname === "/profile" },
  ]

  return (
    <main className={cn("candidate-portal min-h-screen", brand.canvasClass)} data-candidate-brand={brand.id}>
      <div className="mx-auto flex min-h-screen max-w-[1600px]">
        <aside className={cn("sticky top-0 hidden h-screen w-64 shrink-0 border-r px-5 py-5 lg:block", brand.sidebarClass)}>
          <div>
            <CandidateBrandMark brand={brand} compact />
            <div className="mt-4 border-l-2 border-current pl-3 text-sm font-semibold text-slate-950">
              Candidate portal
            </div>
          </div>

          <nav className="mt-8 space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon
              return (
                <Link
                  key={item.label}
                  href={item.href}
                  className={cn(
                    "flex h-11 items-center gap-3 rounded-md px-3 text-sm font-semibold transition",
                    item.active ? brand.navActiveClass : "text-slate-600 hover:bg-slate-100 hover:text-slate-950",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              )
            })}
          </nav>

          <div className="absolute bottom-5 left-5 right-5 border-t border-slate-200 pt-4">
            <div className={cn("text-xs font-semibold uppercase tracking-[0.12em]", brand.accentTextClass)}>{brand.dashboardEyebrow}</div>
            <p className="mt-2 text-xs leading-5 text-slate-600">Private access to your forms, signatures, and completed documents.</p>
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-20 border-b border-slate-200 bg-white">
            <div className="flex items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
              <div className="flex min-w-0 items-center gap-3">
                <div className="lg:hidden">
                  <CandidateBrandMark brand={brand} compact />
                </div>
                <div className="min-w-0">
                  <div className={cn("text-[11px] font-semibold uppercase tracking-[0.12em]", brand.accentTextClass)}>{brand.portalName}</div>
                  <h1 className="truncate text-lg font-semibold text-slate-950 sm:text-xl">{title}</h1>
                  {subtitle && <p className="mt-0.5 hidden truncate text-sm text-slate-500 sm:block">{subtitle}</p>}
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="hidden text-right text-sm md:block">
                  <div className="font-semibold text-slate-950">{fullName(account)}</div>
                  <div className="text-slate-500">{account?.email}</div>
                </div>
                {onSignOut && (
                  <button onClick={onSignOut} className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                    <LogOut className="h-4 w-4" />
                    <span className="hidden sm:inline">Sign out</span>
                  </button>
                )}
              </div>
            </div>
            <nav className="flex gap-1 overflow-x-auto border-t border-slate-200 px-4 py-2 sm:px-6 lg:hidden">
              {navItems.map((item) => {
                const Icon = item.icon
                return (
                  <Link
                    key={item.label}
                    href={item.href}
                    className={cn(
                      "inline-flex h-10 shrink-0 items-center gap-2 rounded-md px-3 text-sm font-semibold transition",
                      item.active ? brand.navActiveClass : "text-slate-600 hover:bg-slate-100 hover:text-slate-950",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                )
              })}
            </nav>
          </header>

          <div className="px-4 py-6 sm:px-6 lg:px-8">{children}</div>
        </div>
      </div>
    </main>
  )
}

export function MetricCard({
  icon,
  label,
  value,
  tone = "slate",
}: {
  icon: ReactNode
  label: string
  value: number | string
  tone?: "blue" | "emerald" | "amber" | "slate"
}) {
  const tones = {
    blue: "bg-[#f1edff] text-[#7047eb]",
    emerald: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-700",
    slate: "bg-slate-100 text-slate-700",
  }

  return (
    <div className="rounded-md border border-slate-200 bg-white p-5 shadow-soft">
      <div className={cn("flex h-10 w-10 items-center justify-center rounded-md", tones[tone])}>{icon}</div>
      <div className="mt-5 text-3xl font-semibold text-slate-950">{value}</div>
      <div className="mt-1 text-sm font-medium text-slate-600">{label}</div>
    </div>
  )
}

export function AuthShell({
  brand,
  eyebrow,
  title,
  description,
  children,
}: {
  brand: CandidateBrand
  eyebrow: string
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <main className={cn("candidate-portal min-h-screen px-4 py-6 sm:px-6 sm:py-8", brand.canvasClass)} data-candidate-brand={brand.id}>
      <div className="mx-auto grid min-h-[calc(100vh-3rem)] max-w-5xl overflow-hidden rounded-lg border border-slate-200 bg-white shadow-soft sm:min-h-[calc(100vh-4rem)] lg:grid-cols-[minmax(0,1fr)_420px]">
        <section className="hidden border-r border-slate-200 bg-slate-50 p-10 lg:flex lg:flex-col lg:justify-between">
          <div className="max-w-lg">
            <CandidateBrandMark brand={brand} />
            <div className={cn("mt-12 text-xs font-semibold uppercase tracking-[0.14em]", brand.accentTextClass)}>{eyebrow}</div>
            <h1 className="mt-4 max-w-xl text-4xl font-semibold leading-[1.08] tracking-[-0.035em] text-slate-950">{title}</h1>
            <p className="mt-5 max-w-lg text-base leading-7 text-slate-600">{description}</p>
          </div>

          <ol className="mt-10 space-y-4 border-l border-slate-300 pl-5">
            {["Accept your invitation", "Review your transition packet", "Complete and sign securely"].map((label) => (
              <li key={label} className="flex items-center gap-3 text-sm font-medium text-slate-700">
                <Check className={cn("h-4 w-4", brand.accentTextClass)} />
                {label}
              </li>
            ))}
          </ol>
        </section>

        <section className="flex flex-col justify-center p-6 sm:p-10">
          <div className="mb-7 lg:hidden">
            <CandidateBrandMark brand={brand} compact />
          </div>
          {children}
        </section>
      </div>
    </main>
  )
}

export function EmptyState({
  brand,
  title,
  description,
}: {
  brand: CandidateBrand
  title: string
  description: string
}) {
  return (
    <div className="p-8 text-center">
      <div className={cn("mx-auto flex h-12 w-12 items-center justify-center rounded-md", brand.accentBgClass)}>
        <FileSignature className={cn("h-6 w-6", brand.accentTextClass)} />
      </div>
      <h3 className="mt-4 font-semibold text-slate-950">{title}</h3>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-slate-600">{description}</p>
    </div>
  )
}

export function ProgressRail({ brand, value }: { brand: CandidateBrand; value: number }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-slate-100">
      <div className={cn("h-full rounded-full", brand.progressClass)} style={{ width: `${Math.max(0, Math.min(value, 100))}%` }} />
    </div>
  )
}
