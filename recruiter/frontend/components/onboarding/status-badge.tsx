"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const statusClass: Record<string, string> = {
  draft: "border-slate-200 bg-slate-50 text-slate-700",
  pending: "border-amber-200 bg-amber-50 text-amber-700",
  in_progress: "border-blue-200 bg-blue-50 text-blue-700",
  sent: "border-blue-200 bg-blue-50 text-blue-700",
  viewed: "border-cyan-200 bg-cyan-50 text-cyan-700",
  partially_signed: "border-violet-200 bg-violet-50 text-violet-700",
  ready: "border-emerald-200 bg-emerald-50 text-emerald-700",
  signed: "border-emerald-200 bg-emerald-50 text-emerald-700",
  completed: "border-green-200 bg-green-50 text-green-700",
  voided: "border-rose-200 bg-rose-50 text-rose-700",
  cancelled: "border-rose-200 bg-rose-50 text-rose-700",
  archived: "border-zinc-200 bg-zinc-50 text-zinc-700",
};

export function OnboardingStatusBadge({ status, className }: { status?: string; className?: string }) {
  const value = status || "draft";
  return (
    <Badge variant="outline" className={cn("capitalize", statusClass[value] || statusClass.draft, className)}>
      {value.replace(/_/g, " ")}
    </Badge>
  );
}
