"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Clock, FileSignature, FileText, Plus, Search, Send, ShieldCheck, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { OnboardingStatusBadge } from "@/components/onboarding/status-badge";
import { getOnboardingDashboard, getOnboardingRecords, runOnboardingReminders, type CandidateOnboarding, type OnboardingAuditEvent, type ProcessType } from "@/services/onboardingService";
import { toast } from "sonner";

const processOptions: Array<{ value: ProcessType | "all"; label: string }> = [
  { value: "all", label: "All" },
  { value: "onboarding", label: "Onboarding" },
  { value: "exit", label: "Exit" },
  { value: "retirement", label: "Retirement" },
];

function candidateName(onboarding: CandidateOnboarding) {
  const candidate = onboarding.candidate || {};
  return `${candidate.firstName || ""} ${candidate.lastName || ""}`.trim() || candidate.email || "Candidate";
}

function processLabel(onboarding: CandidateOnboarding) {
  const processType = onboarding.processType || "onboarding";
  if (processType === "exit") return "Exit";
  if (processType === "retirement") return "Retirement";
  return "Onboarding";
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
        const result = await getOnboardingRecords({ search, processType });
        const dashboardResult = await getOnboardingDashboard(processType);
        if (!mounted) return;
        setRecords(result.data || []);
        setEvents(result.recentEvents || []);
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
    const total = records.length;
    const inProgress = records.filter((record) => ["pending", "in_progress"].includes(record.status)).length;
    const completed = records.filter((record) => record.status === "completed").length;
    const sent = records.reduce((count, record) => count + (record.envelopes || []).filter((envelope) => ["sent", "viewed", "partially_signed"].includes(envelope.status)).length, 0);
    return { total, inProgress, completed, sent };
  }, [records]);

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
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-screen-2xl px-4 py-6 lg:px-8">
        <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-slate-950">People Transitions</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-600">
              Start onboarding, exit, and retirement processes, send signature packets, and track completion.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="button" variant="outline" onClick={runReminders} disabled={reminding}>
              <Clock className="h-4 w-4" />
              {reminding ? "Running..." : "Run reminders"}
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
        </div>

        <div className="mb-5 flex flex-wrap gap-2">
          {processOptions.map((option) => (
            <Button
              key={option.value}
              type="button"
              size="sm"
              variant={processType === option.value ? "default" : "outline"}
              onClick={() => setProcessType(option.value)}
            >
              {option.label}
            </Button>
          ))}
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          <Card className="rounded-md">
            <CardHeader className="pb-2"><CardTitle className="text-sm text-slate-500">Total</CardTitle></CardHeader>
            <CardContent className="flex items-end justify-between"><div className="text-3xl font-semibold">{stats.total}</div><Users className="h-5 w-5 text-slate-400" /></CardContent>
          </Card>
          <Card className="rounded-md">
            <CardHeader className="pb-2"><CardTitle className="text-sm text-slate-500">In progress</CardTitle></CardHeader>
            <CardContent className="flex items-end justify-between"><div className="text-3xl font-semibold">{stats.inProgress}</div><ArrowRight className="h-5 w-5 text-blue-500" /></CardContent>
          </Card>
          <Card className="rounded-md">
            <CardHeader className="pb-2"><CardTitle className="text-sm text-slate-500">Sent packets</CardTitle></CardHeader>
            <CardContent className="flex items-end justify-between"><div className="text-3xl font-semibold">{stats.sent}</div><Send className="h-5 w-5 text-violet-500" /></CardContent>
          </Card>
          <Card className="rounded-md">
            <CardHeader className="pb-2"><CardTitle className="text-sm text-slate-500">Completed</CardTitle></CardHeader>
            <CardContent className="flex items-end justify-between"><div className="text-3xl font-semibold">{stats.completed}</div><FileSignature className="h-5 w-5 text-emerald-500" /></CardContent>
          </Card>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-4">
          <Card className="rounded-md">
            <CardHeader className="pb-2"><CardTitle className="text-sm text-slate-500">Pending HR review</CardTitle></CardHeader>
            <CardContent className="flex items-end justify-between"><div className="text-3xl font-semibold">{dashboard?.pendingApprovals || 0}</div><ShieldCheck className="h-5 w-5 text-amber-600" /></CardContent>
          </Card>
          <Card className="rounded-md">
            <CardHeader className="pb-2"><CardTitle className="text-sm text-slate-500">Form reviews</CardTitle></CardHeader>
            <CardContent className="flex items-end justify-between"><div className="text-3xl font-semibold">{dashboard?.formReviews || 0}</div><FileText className="h-5 w-5 text-slate-400" /></CardContent>
          </Card>
          <Card className="rounded-md">
            <CardHeader className="pb-2"><CardTitle className="text-sm text-slate-500">Overdue items</CardTitle></CardHeader>
            <CardContent className="flex items-end justify-between"><div className="text-3xl font-semibold">{dashboard?.overdueItems || 0}</div><Clock className="h-5 w-5 text-rose-600" /></CardContent>
          </Card>
          <Card className="rounded-md">
            <CardHeader className="pb-2"><CardTitle className="text-sm text-slate-500">Handoff failures</CardTitle></CardHeader>
            <CardContent className="flex items-end justify-between"><div className="text-3xl font-semibold">{dashboard?.handoffFailures || 0}</div><ArrowRight className="h-5 w-5 text-slate-400" /></CardContent>
          </Card>
        </div>

        <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <section className="rounded-md border bg-white">
            <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">Transition records</h2>
                <p className="text-sm text-slate-500">Open a candidate transition workspace to manage packets and status.</p>
              </div>
              <div className="relative sm:w-80">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search candidate" className="pl-9" />
              </div>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Candidate</TableHead>
                    <TableHead>Process</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Envelopes</TableHead>
                    <TableHead>Started</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow><TableCell colSpan={6} className="py-10 text-center text-slate-500">Loading transition records...</TableCell></TableRow>
                  ) : records.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="py-10 text-center text-slate-500">No transition records found.</TableCell></TableRow>
                  ) : records.map((record) => (
                    <TableRow key={record._id}>
                      <TableCell>
                        <div className="font-medium text-slate-950">{candidateName(record)}</div>
                        <div className="text-xs text-slate-500">{record.candidate?.email}</div>
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

          <section className="rounded-md border bg-white p-4">
            <h2 className="text-lg font-semibold text-slate-950">Recent activity</h2>
            <div className="mt-4 space-y-3">
              {events.length === 0 ? (
                <p className="text-sm text-slate-500">No transition activity yet.</p>
              ) : events.map((event) => (
                <div key={event._id} className="border-b pb-3 last:border-0">
                  <div className="text-sm font-medium text-slate-900">{event.action.replace(/_/g, " ")}</div>
                  <div className="text-xs text-slate-500">{event.actorEmail || event.actorType} · {new Date(event.createdAt).toLocaleString()}</div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
