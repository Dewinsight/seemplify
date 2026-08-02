"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, CalendarClock, Loader2, RefreshCw } from "lucide-react";
import {
  getPeopleTransitionTasks,
  updatePeopleTransitionWorkflowItem,
  type PeopleTransitionTask,
  type ProcessType,
  type WorkflowItemStatus,
} from "@/services/onboardingService";

const processOptions: Array<ProcessType | "all"> = ["all", "onboarding", "exit", "retirement"];
const statusOptions: Array<WorkflowItemStatus | "all"> = ["all", "pending", "in_progress", "blocked", "failed", "completed", "skipped"];
const dueOptions = ["all", "overdue", "due_soon", "upcoming", "none"] as const;
const ownerOptions = ["all", "me", "candidate", "system", "unassigned"] as const;

function candidateName(task: PeopleTransitionTask) {
  const candidate = task.transition?.candidate;
  return `${candidate?.firstName || ""} ${candidate?.lastName || ""}`.trim() || candidate?.email || "Candidate";
}

function formatDate(value?: string) {
  if (!value) return "No due date";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function inputDate(value?: string) {
  if (!value) return "";
  return new Date(value).toISOString().slice(0, 10);
}

function ownerLabel(task: PeopleTransitionTask) {
  if (task.ownerName || task.ownerEmail) return task.ownerName || task.ownerEmail;
  if (task.ownerType === "candidate") return "Candidate";
  if (task.ownerType === "system") return "System";
  return "Unassigned";
}

export default function PeopleTransitionTasksPage() {
  const [processType, setProcessType] = useState<ProcessType | "all">("all");
  const [status, setStatus] = useState<WorkflowItemStatus | "all">("all");
  const [due, setDue] = useState<(typeof dueOptions)[number]>("all");
  const [owner, setOwner] = useState<(typeof ownerOptions)[number]>("all");
  const [tasks, setTasks] = useState<PeopleTransitionTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState("");
  const [error, setError] = useState("");

  const filters = useMemo(() => ({ processType, status, due, owner }), [processType, status, due, owner]);

  async function loadTasks() {
    try {
      setLoading(true);
      setError("");
      setTasks(await getPeopleTransitionTasks(filters));
    } catch (loadError: any) {
      setError(loadError.message || "Failed to load tasks");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadTasks();
  }, [filters]);

  async function patchTask(task: PeopleTransitionTask, data: Partial<Pick<PeopleTransitionTask, "status" | "dueAt">>) {
    if (!task.transition?._id) return;
    try {
      setUpdatingId(task._id);
      const updated = await updatePeopleTransitionWorkflowItem(task.transition._id, task._id, data);
      setTasks((current) => current.map((item) => item._id === task._id ? { ...item, ...updated } : item));
    } finally {
      setUpdatingId("");
    }
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-gray-950 dark:text-white">People Transitions Tasks</h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">Manage owners, deadlines, blocked work, and overdue transition steps.</p>
        </div>
        <button
          type="button"
          onClick={loadTasks}
          className="inline-flex h-10 items-center gap-2 rounded-md border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </button>
      </div>

      <div className="grid gap-3 rounded-md border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-950 md:grid-cols-4">
        <select value={processType} onChange={(event) => setProcessType(event.target.value as ProcessType | "all")} className="h-10 rounded-md border border-gray-300 bg-white px-3 text-sm dark:border-gray-700 dark:bg-gray-900">
          {processOptions.map((option) => <option key={option} value={option}>{option === "all" ? "All processes" : option}</option>)}
        </select>
        <select value={status} onChange={(event) => setStatus(event.target.value as WorkflowItemStatus | "all")} className="h-10 rounded-md border border-gray-300 bg-white px-3 text-sm dark:border-gray-700 dark:bg-gray-900">
          {statusOptions.map((option) => <option key={option} value={option}>{option === "all" ? "All statuses" : option}</option>)}
        </select>
        <select value={due} onChange={(event) => setDue(event.target.value as (typeof dueOptions)[number])} className="h-10 rounded-md border border-gray-300 bg-white px-3 text-sm dark:border-gray-700 dark:bg-gray-900">
          {dueOptions.map((option) => <option key={option} value={option}>{option === "all" ? "All due states" : option.replace("_", " ")}</option>)}
        </select>
        <select value={owner} onChange={(event) => setOwner(event.target.value as (typeof ownerOptions)[number])} className="h-10 rounded-md border border-gray-300 bg-white px-3 text-sm dark:border-gray-700 dark:bg-gray-900">
          {ownerOptions.map((option) => <option key={option} value={option}>{option === "all" ? "All owners" : option}</option>)}
        </select>
      </div>

      <div className="overflow-hidden rounded-md border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-950">
        {loading ? (
          <div className="flex items-center gap-2 p-5 text-sm text-gray-600 dark:text-gray-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading tasks...
          </div>
        ) : error ? (
          <div className="p-5 text-sm text-red-700 dark:text-red-300">{error}</div>
        ) : tasks.length === 0 ? (
          <div className="p-5 text-sm text-gray-600 dark:text-gray-400">No tasks match these filters.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500 dark:bg-gray-900 dark:text-gray-400">
                <tr>
                  <th className="px-4 py-3 font-semibold">Task</th>
                  <th className="px-4 py-3 font-semibold">Process</th>
                  <th className="px-4 py-3 font-semibold">Candidate</th>
                  <th className="px-4 py-3 font-semibold">Owner</th>
                  <th className="px-4 py-3 font-semibold">Due</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 text-right font-semibold">Transition</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                {tasks.map((task) => (
                  <tr key={task._id} className={task.isOverdue ? "bg-red-50 dark:bg-red-950/20" : task.isDueSoon ? "bg-amber-50 dark:bg-amber-950/20" : ""}>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-gray-950 dark:text-white">{task.title}</div>
                      <div className="mt-1 text-xs text-gray-500">{task.type}</div>
                    </td>
                    <td className="px-4 py-3 capitalize text-gray-700 dark:text-gray-300">{task.transition?.processType || "onboarding"}</td>
                    <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{candidateName(task)}</td>
                    <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{ownerLabel(task)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <CalendarClock className="h-4 w-4 text-gray-400" />
                        <input
                          type="date"
                          value={inputDate(task.dueAt)}
                          onChange={(event) => patchTask(task, { dueAt: event.target.value || undefined })}
                          className="h-9 rounded-md border border-gray-300 bg-white px-2 text-sm dark:border-gray-700 dark:bg-gray-900"
                        />
                      </div>
                      <div className={`mt-1 text-xs ${task.isOverdue ? "font-semibold text-red-700" : task.isDueSoon ? "font-semibold text-amber-700" : "text-gray-500"}`}>
                        {task.isOverdue ? "Overdue" : task.isDueSoon ? "Due soon" : formatDate(task.dueAt)}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={task.status}
                        disabled={updatingId === task._id}
                        onChange={(event) => patchTask(task, { status: event.target.value as WorkflowItemStatus })}
                        className="h-9 rounded-md border border-gray-300 bg-white px-2 text-sm dark:border-gray-700 dark:bg-gray-900"
                      >
                        {statusOptions.filter((option) => option !== "all").map((option) => <option key={option} value={option}>{option}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {task.transition?._id && (
                        <Link href={`/people-transitions/${task.transition._id}`} className="inline-flex items-center gap-2 font-semibold text-blue-700 hover:text-blue-900 dark:text-blue-300">
                          Open <ArrowRight className="h-4 w-4" />
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
