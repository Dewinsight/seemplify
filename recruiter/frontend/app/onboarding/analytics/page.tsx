"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { BarChart3, Clock3, Loader2, RefreshCw, TriangleAlert } from "lucide-react";
import {
  getPeopleTransitionAnalytics,
  type PeopleTransitionAnalytics,
  type ProcessType,
} from "@/services/onboardingService";

const processOptions: Array<ProcessType | "all"> = ["all", "onboarding", "exit", "retirement"];

function StatCard({ label, value, helper, icon }: { label: string; value: string | number; helper?: string; icon: ReactNode }) {
  return (
    <div className="rounded-md border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-950">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-medium text-gray-600 dark:text-gray-400">{label}</div>
        <div className="text-gray-500">{icon}</div>
      </div>
      <div className="mt-2 text-2xl font-semibold text-gray-950 dark:text-white">{value}</div>
      {helper && <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{helper}</div>}
    </div>
  );
}

export default function PeopleTransitionAnalyticsPage() {
  const [processType, setProcessType] = useState<ProcessType | "all">("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [analytics, setAnalytics] = useState<PeopleTransitionAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const filters = useMemo(() => ({ processType, from, to }), [processType, from, to]);

  async function loadAnalytics() {
    try {
      setLoading(true);
      setError("");
      setAnalytics(await getPeopleTransitionAnalytics(filters));
    } catch (loadError: any) {
      setError(loadError.message || "Failed to load analytics");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAnalytics();
  }, [filters]);

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-gray-950 dark:text-white">People Transitions Analytics</h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">Track completion, bottlenecks, overdue work, and handoff failures.</p>
        </div>
        <button
          type="button"
          onClick={loadAnalytics}
          className="inline-flex h-10 items-center gap-2 rounded-md border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </button>
      </div>

      <div className="grid gap-3 rounded-md border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-950 md:grid-cols-3">
        <select value={processType} onChange={(event) => setProcessType(event.target.value as ProcessType | "all")} className="h-10 rounded-md border border-gray-300 bg-white px-3 text-sm dark:border-gray-700 dark:bg-gray-900">
          {processOptions.map((option) => <option key={option} value={option}>{option === "all" ? "All processes" : option}</option>)}
        </select>
        <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="h-10 rounded-md border border-gray-300 bg-white px-3 text-sm dark:border-gray-700 dark:bg-gray-900" />
        <input type="date" value={to} onChange={(event) => setTo(event.target.value)} className="h-10 rounded-md border border-gray-300 bg-white px-3 text-sm dark:border-gray-700 dark:bg-gray-900" />
      </div>

      {loading ? (
        <div className="flex items-center gap-2 rounded-md border border-gray-200 bg-white p-5 text-sm text-gray-600 shadow-sm dark:border-gray-800 dark:bg-gray-950 dark:text-gray-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading analytics...
        </div>
      ) : error ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-5 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/20 dark:text-red-300">{error}</div>
      ) : analytics ? (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Completion rate" value={`${analytics.completionRate}%`} helper={`${analytics.completed} of ${analytics.total} completed`} icon={<BarChart3 className="h-5 w-5" />} />
            <StatCard label="Average completion" value={`${analytics.averageCompletionHours}h`} helper="Completed records only" icon={<Clock3 className="h-5 w-5" />} />
            <StatCard label="Overdue tasks" value={analytics.overdueCount} helper="Open workflow items past due" icon={<TriangleAlert className="h-5 w-5" />} />
            <StatCard label="Failed handoffs" value={analytics.failedHandoffs} helper="Internal handoff records needing review" icon={<TriangleAlert className="h-5 w-5" />} />
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <section className="rounded-md border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-950">
              <h2 className="text-lg font-semibold text-gray-950 dark:text-white">Pending By Owner</h2>
              <div className="mt-4 space-y-3">
                {analytics.pendingOwnerBuckets.length === 0 ? (
                  <div className="text-sm text-gray-500">No pending owner buckets.</div>
                ) : analytics.pendingOwnerBuckets.map((bucket) => (
                  <div key={bucket.owner} className="flex items-center justify-between rounded-md border border-gray-200 px-3 py-2 text-sm dark:border-gray-800">
                    <span className="font-medium text-gray-800 dark:text-gray-200">{bucket.owner}</span>
                    <span className="font-semibold text-gray-950 dark:text-white">{bucket.count}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-md border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-950">
              <h2 className="text-lg font-semibold text-gray-950 dark:text-white">Bottlenecks By Type</h2>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="py-2 font-semibold">Type</th>
                      <th className="py-2 font-semibold">Open</th>
                      <th className="py-2 font-semibold">Overdue</th>
                      <th className="py-2 font-semibold">Blocked</th>
                      <th className="py-2 font-semibold">Failed</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                    {analytics.bottlenecksByType.map((bucket) => (
                      <tr key={bucket.type}>
                        <td className="py-2 capitalize text-gray-900 dark:text-gray-100">{bucket.type}</td>
                        <td className="py-2">{bucket.total}</td>
                        <td className="py-2">{bucket.overdue}</td>
                        <td className="py-2">{bucket.blocked}</td>
                        <td className="py-2">{bucket.failed}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </>
      ) : null}
    </div>
  );
}
