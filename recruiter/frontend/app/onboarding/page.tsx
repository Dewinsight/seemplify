"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  FileCheck2,
  FileText,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { OnboardingStatusBadge } from "@/components/onboarding/status-badge";
import {
  getOnboardingDashboard,
  getOnboardingRecords,
  runOnboardingReminders,
  type CandidateOnboarding,
  type OnboardingAuditEvent,
  type ProcessType,
} from "@/services/onboardingService";
import { toast } from "sonner";

const processOptions: Array<{ value: ProcessType | "all"; label: string }> = [
  { value: "all", label: "All transitions" },
  { value: "onboarding", label: "Onboarding" },
  { value: "exit", label: "Exits" },
  { value: "retirement", label: "Retirement" },
];

function candidateName(transition: CandidateOnboarding) {
  const candidate = transition.candidate || {};
  return `${candidate.firstName || ""} ${candidate.lastName || ""}`.trim() || candidate.email || "Candidate";
}

function processLabel(transition: CandidateOnboarding) {
  if (transition.processType === "exit") return "Exit";
  if (transition.processType === "retirement") return "Retirement";
  return "Onboarding";
}

function formatEventAction(action: string) {
  return action
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export default function OnboardingDashboardPage() {
  const [records, setRecords] = useState<CandidateOnboarding[]>([]);
  const [events, setEvents] = useState<OnboardingAuditEvent[]>([]);
  const [dashboard, setDashboard] = useState<Awaited<ReturnType<typeof getOnboardingDashboard>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [reminding, setReminding] = useState(false);
  const [search, setSearch] = useState("");
  const [processType, setProcessType] = useState<ProcessType | "all">("all");

  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        setLoading(true);
        const [recordsResult, dashboardResult] = await Promise.all([
          getOnboardingRecords({ search, processType }),
          getOnboardingDashboard(processType),
        ]);
        if (!mounted) return;
        setRecords(recordsResult.data || []);
        setEvents(recordsResult.recentEvents || []);
        setDashboard(dashboardResult);
      } catch (error: any) {
        toast.error(error.message || "Failed to load people transitions");
      } finally {
        if (mounted) setLoading(false);
      }
    }

    const timer = setTimeout(load, 250);
    return () => {
      mounted = false;
      clearTimeout(timer);
    };
  }, [search, processType]);

  const stats = useMemo(() => {
    const active = records.filter((record) => ["pending", "in_progress"].includes(record.status)).length;
    const completed = records.filter((record) => record.status === "completed").length;
    const sentPackets = records.reduce(
      (count, record) => count + (record.envelopes || []).filter((envelope) =>
        ["sent", "viewed", "partially_signed"].includes(envelope.status)
      ).length,
      0
    );
    const completionRate = records.length ? Math.round((completed / records.length) * 100) : 0;
    return { active, completed, sentPackets, completionRate };
  }, [records]);

  const attentionItems = [
    {
      label: "Overdue workflow items",
      detail: "Steps that have passed their due date",
      value: dashboard?.overdueItems || 0,
      icon: AlertTriangle,
      iconClass: "text-red-600 dark:text-red-400",
    },
    {
      label: "Pending HR review",
      detail: "Transitions waiting for an internal decision",
      value: dashboard?.pendingApprovals || 0,
      icon: Clock,
      iconClass: "text-amber-600 dark:text-amber-400",
    },
    {
      label: "Candidate forms to review",
      detail: "Submitted information awaiting verification",
      value: dashboard?.formReviews || 0,
      icon: FileCheck2,
      iconClass: "text-teal-700 dark:text-teal-400",
    },
    {
      label: "Employee handoff issues",
      detail: "Completed transitions that did not hand off cleanly",
      value: dashboard?.handoffFailures || 0,
      icon: ShieldAlert,
      iconClass: "text-gray-700 dark:text-gray-300",
    },
  ];

  async function runReminders() {
    try {
      setReminding(true);
      const result = await runOnboardingReminders(processType);
      toast.success(`${result.sent} transition reminder(s) sent`);
    } catch (error: any) {
      toast.error(error.message || "Failed to run reminders");
    } finally {
      setReminding(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-950 dark:bg-gray-950 dark:text-gray-100">
      <div className="mx-auto max-w-screen-2xl px-4 py-6 lg:px-8">
        <header className="flex flex-col gap-4 border-b border-gray-200 pb-6 dark:border-gray-800 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">People Transitions</h1>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              Manage onboarding, exits, retirement, documents, signatures, and employee handoffs.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={runReminders} disabled={reminding}>
              <RefreshCw className={`h-4 w-4 ${reminding ? "animate-spin" : ""}`} />
              {reminding ? "Sending reminders" : "Run reminders"}
            </Button>
            <Button asChild variant="outline">
              <Link href="/people-transitions/documents">
                <FileText className="h-4 w-4" />
                Documents
              </Link>
            </Button>
            <Button asChild>
              <Link href="/people-transitions/new">
                <Plus className="h-4 w-4" />
                Start process
              </Link>
            </Button>
          </div>
        </header>

        <nav className="mt-5 flex gap-6 overflow-x-auto border-b border-gray-200 dark:border-gray-800" aria-label="Transition type">
          {processOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`whitespace-nowrap border-b-2 px-1 pb-3 text-sm font-medium transition-colors ${
                processType === option.value
                  ? "border-teal-700 text-gray-950 dark:border-teal-400 dark:text-white"
                  : "border-transparent text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
              }`}
              onClick={() => setProcessType(option.value)}
            >
              {option.label}
            </button>
          ))}
        </nav>

        <section className="mt-6 overflow-hidden rounded-md border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900" aria-label="Transition summary">
          <dl className="grid divide-y divide-gray-200 dark:divide-gray-800 sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-4">
            <div className="p-4">
              <dt className="text-sm text-gray-500 dark:text-gray-400">Active transitions</dt>
              <dd className="mt-2 flex items-center justify-between text-2xl font-semibold">
                {loading ? "—" : stats.active}
                <ArrowRight className="h-5 w-5 text-teal-700 dark:text-teal-400" />
              </dd>
            </div>
            <div className="p-4">
              <dt className="text-sm text-gray-500 dark:text-gray-400">Packets awaiting signatures</dt>
              <dd className="mt-2 flex items-center justify-between text-2xl font-semibold">
                {loading ? "—" : stats.sentPackets}
                <Send className="h-5 w-5 text-gray-400" />
              </dd>
            </div>
            <div className="p-4">
              <dt className="text-sm text-gray-500 dark:text-gray-400">Completed</dt>
              <dd className="mt-2 flex items-center justify-between text-2xl font-semibold">
                {loading ? "—" : stats.completed}
                <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              </dd>
            </div>
            <div className="p-4">
              <dt className="text-sm text-gray-500 dark:text-gray-400">Completion rate</dt>
              <dd className="mt-2 text-2xl font-semibold">{loading ? "—" : `${stats.completionRate}%`}</dd>
            </div>
          </dl>
        </section>

        <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <section className="overflow-hidden rounded-md border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
            <div className="flex flex-col gap-3 border-b border-gray-200 p-4 dark:border-gray-800 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-semibold">Transition records</h2>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Open a workspace to manage its forms, packets, and handoff.</p>
              </div>
              <div className="relative sm:w-72">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search people" className="pl-9" />
              </div>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Person</TableHead>
                    <TableHead>Process</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Packets</TableHead>
                    <TableHead>Started</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow><TableCell colSpan={6} className="py-12 text-center text-gray-500">Loading transition records…</TableCell></TableRow>
                  ) : records.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="py-12 text-center">
                        <div className="font-medium">No transitions found</div>
                        <div className="mt-1 text-sm text-gray-500">Start a process or change the current filters.</div>
                      </TableCell>
                    </TableRow>
                  ) : records.map((record) => (
                    <TableRow key={record._id}>
                      <TableCell>
                        <div className="font-medium">{candidateName(record)}</div>
                        <div className="text-xs text-gray-500">{record.candidate?.email}</div>
                      </TableCell>
                      <TableCell>{processLabel(record)}</TableCell>
                      <TableCell><OnboardingStatusBadge status={record.status} /></TableCell>
                      <TableCell>{record.envelopes?.length || 0}</TableCell>
                      <TableCell>{new Date(record.createdAt).toLocaleDateString()}</TableCell>
                      <TableCell className="text-right">
                        <Button asChild size="sm" variant="outline">
                          <Link href={`/people-transitions/${record._id}`}>Open</Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>

          <div className="space-y-5">
            <section className="overflow-hidden rounded-md border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
              <div className="flex items-center justify-between border-b border-gray-200 p-4 dark:border-gray-800">
                <div>
                  <h2 className="font-semibold">Needs attention</h2>
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Work that may block a transition.</p>
                </div>
                <Button asChild size="sm" variant="ghost">
                  <Link href="/people-transitions/tasks">View tasks</Link>
                </Button>
              </div>
              <div className="divide-y divide-gray-200 dark:divide-gray-800">
                {attentionItems.map((item) => (
                  <Link key={item.label} href="/people-transitions/tasks" className="flex items-center gap-3 p-4 hover:bg-gray-50 dark:hover:bg-gray-800/60">
                    <item.icon className={`h-5 w-5 shrink-0 ${item.iconClass}`} />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">{item.label}</div>
                      <div className="truncate text-xs text-gray-500 dark:text-gray-400">{item.detail}</div>
                    </div>
                    <strong className="text-lg">{loading ? "—" : item.value}</strong>
                  </Link>
                ))}
              </div>
            </section>

            <section className="rounded-md border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
              <h2 className="font-semibold">Recent transition activity</h2>
              <div className="mt-4 space-y-4">
                {events.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400">No transition activity yet.</p>
                ) : events.slice(0, 5).map((event) => (
                  <div key={event._id} className="border-b border-gray-200 pb-4 last:border-0 last:pb-0 dark:border-gray-800">
                    <div className="text-sm font-medium">{formatEventAction(event.action)}</div>
                    <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      {event.actorEmail || event.actorType} · {new Date(event.createdAt).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
