"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle as CircleAlert,
  CalendarClock,
  Check,
  Plus,
  RefreshCw,
  Search,
  Send,
  Users,
} from "lucide-react";
import { schedulingApi } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { getApiErrorMessage } from "@/lib/apiError";

function localInput(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}

type RosterMember = {
  userId: string;
  employeeId?: string;
  name: string;
  email?: string;
  teamIds: string[];
  effectiveExitAt?: string;
};
type RosterTeam = { teamId: string; name: string };
type ShiftTemplate = {
  _id: string;
  name: string;
  startTime?: string;
  endTime?: string;
  breakMinutes?: number;
  workMode?: string;
};

function applyTemplateTimes(startValue: string, template: ShiftTemplate) {
  if (!template.startTime || !template.endTime) return {};
  const day = startValue.slice(0, 10);
  const startAt = `${day}T${template.startTime}`;
  let endAt = `${day}T${template.endTime}`;
  if (new Date(endAt) <= new Date(startAt)) {
    const nextDay = new Date(`${day}T12:00:00`);
    nextDay.setDate(nextDay.getDate() + 1);
    endAt = `${localInput(nextDay).slice(0, 10)}T${template.endTime}`;
  }
  return { startAt, endAt };
}

export default function SchedulePage() {
  const { user } = useAuth();
  const [shifts, setShifts] = useState<any[]>([]);
  const [openShifts, setOpenShifts] = useState<any[]>([]);
  const [requests, setRequests] = useState<any[]>([]);
  const [templates, setTemplates] = useState<ShiftTemplate[]>([]);
  const [rosterMembers, setRosterMembers] = useState<RosterMember[]>([]);
  const [rosterTeams, setRosterTeams] = useState<RosterTeam[]>([]);
  const [memberSearch, setMemberSearch] = useState("");
  const [message, setMessage] = useState("");
  const [rosterError, setRosterError] = useState("");
  const [rosterBusy, setRosterBusy] = useState(false);
  const [rosterLoaded, setRosterLoaded] = useState(false);
  const [lastRosterSync, setLastRosterSync] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const automaticRosterSyncAttempted = useRef(false);
  const [form, setForm] = useState<any>({
    userId: "",
    teamId: "",
    startAt: localInput(new Date(Date.now() + 86400000)),
    endAt: localInput(new Date(Date.now() + 86400000 + 8 * 3600000)),
    workMode: "office",
    breakMinutes: 60,
    openShift: false,
  });
  const role = user?.currentOrganization?.role;
  const manager =
    ["owner", "admin", "hr_manager"].includes(role) ||
    user?.teams?.some(
      (t) =>
        t.organizationId === user?.currentOrganization?.id &&
        ["line_manager", "team_lead"].includes(t.role),
    );
  const range = useMemo(
    () => ({
      start: new Date(Date.now() - 7 * 86400000).toISOString(),
      end: new Date(Date.now() + 35 * 86400000).toISOString(),
    }),
    [],
  );
  const refreshRoster = useCallback(async (force = false) => {
    if (!manager) return;
    setRosterBusy(true);
    setRosterError("");
    try {
      let rosterData = force
        ? await schedulingApi.reconcileRoster()
        : await schedulingApi.getRoster();
      if (
        !force &&
        (rosterData.members || []).length === 0 &&
        !automaticRosterSyncAttempted.current
      ) {
        automaticRosterSyncAttempted.current = true;
        rosterData = await schedulingApi.reconcileRoster();
      }
      setRosterMembers(rosterData.members || []);
      setRosterTeams(rosterData.teams || []);
      setLastRosterSync(
        rosterData.synchronization?.reconciledAt ||
          rosterData.synchronization?.lastReconciledAt ||
          null,
      );
    } catch (error: any) {
      setRosterError(
        getApiErrorMessage(error, "The IDP roster could not be synchronized."),
      );
    } finally {
      setRosterLoaded(true);
      setRosterBusy(false);
    }
  }, [manager]);

  const load = useCallback(async () => {
    const rosterPromise = manager ? refreshRoster() : Promise.resolve();
    const [mine, open, requestData, templateData] = await Promise.all([
        schedulingApi.getShifts(range),
        schedulingApi.getShifts({ ...range, open: true, status: "published" }),
        schedulingApi.getRequests(),
        schedulingApi.getTemplates(),
      ]);
    setShifts(mine.shifts || []);
    setOpenShifts(open.shifts || []);
    setRequests(requestData.requests || []);
    setTemplates(templateData.templates || []);
    await rosterPromise;
  }, [manager, range, refreshRoster]);

  useEffect(() => {
    if (!user) return;
    void load().catch(() => setMessage("Schedule could not be loaded."));
  }, [load, user]);
  const eligibleMembers = useMemo(() => {
    const start = new Date(form.startAt);
    const query = memberSearch.trim().toLowerCase();
    return rosterMembers.filter((member) => {
      if (form.teamId && !member.teamIds.includes(form.teamId)) return false;
      if (
        member.effectiveExitAt &&
        !Number.isNaN(start.getTime()) &&
        start >= new Date(member.effectiveExitAt)
      )
        return false;
      return (
        !query ||
        [member.name, member.email, member.employeeId]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(query))
      );
    });
  }, [form.startAt, form.teamId, memberSearch, rosterMembers]);
  const invalidRange =
    !form.startAt ||
    !form.endAt ||
    new Date(form.endAt) <= new Date(form.startAt);
  const createShift = async () => {
    setMessage("");
    try {
      await schedulingApi.createShift({
        ...form,
        teamId: form.teamId || undefined,
        userId: form.openShift ? null : form.userId,
        startAt: new Date(form.startAt),
        endAt: new Date(form.endAt),
      });
      setShowCreate(false);
      setMessage("Draft shift created.");
      await load();
    } catch (error: any) {
      setMessage(
        getApiErrorMessage(error, "The draft shift could not be created."),
      );
    }
  };
  const publish = async () => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + 35 * 86400000);
    const result = await schedulingApi.publish({
      periodStart: start,
      periodEnd: end,
      note: "Published from schedule workspace",
    });
    setMessage(
      `${result.publishedCount} shift${result.publishedCount === 1 ? "" : "s"} published.`,
    );
    await load();
  };
  const acknowledge = async (id: string, accepted: boolean) => {
    await schedulingApi.acknowledge(id, accepted);
    await load();
  };
  const requestCover = async (id: string) => {
    await schedulingApi.createRequest({
      shiftId: id,
      type: "cover",
      reason: "I am available to cover this shift.",
    });
    setMessage("Cover request sent for manager approval.");
    await load();
  };
  const review = async (id: string, approved: boolean) => {
    await schedulingApi.reviewRequest(id, approved);
    await load();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--suite-ink)]">Schedule</h1>
          <p className="mt-1 text-sm text-[var(--suite-muted)]">
            Published shifts, availability, open cover and schedule
            acknowledgements.
          </p>
        </div>
        {manager && (
          <div className="flex gap-2">
            <button
              onClick={() => setShowCreate(!showCreate)}
              className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white"
            >
              <Plus className="h-4 w-4" />
              New shift
            </button>
            <button
              onClick={publish}
              className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-3 py-2 text-sm font-medium text-white hover:bg-teal-500"
            >
              <Send className="h-4 w-4" />
              Publish drafts
            </button>
          </div>
        )}
      </div>
      {message && (
        <div role="status" className="rounded-lg border border-teal-500/30 bg-teal-500/10 px-4 py-3 text-sm text-teal-800 dark:text-teal-200">
          {message}
        </div>
      )}
      {showCreate && (
        <section className="rounded-lg border border-[var(--suite-line-strong)] bg-[var(--suite-surface)] p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-[var(--suite-ink)]">
                Create a draft shift
              </h2>
              <p className="mt-1 text-xs text-[var(--suite-muted)]">
                People and teams come from the active IDP organization roster.
              </p>
            </div>
            <div className="flex items-center gap-3">
              {rosterLoaded && !rosterError && (
                <span className="text-xs text-[var(--suite-muted)]">
                  {rosterMembers.length} {rosterMembers.length === 1 ? "member" : "members"} · {rosterTeams.length} {rosterTeams.length === 1 ? "team" : "teams"}
                </span>
              )}
              <button
                type="button"
                onClick={() => void refreshRoster(true)}
                disabled={rosterBusy}
                className="inline-flex items-center gap-1.5 rounded-md border border-[var(--suite-line-strong)] px-2.5 py-1.5 text-xs font-medium text-[var(--suite-ink)] hover:bg-[var(--suite-surface-muted)] disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${rosterBusy ? "animate-spin" : ""}`} />
                Refresh roster
              </button>
            </div>
          </div>
          <div className="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <label className="space-y-1.5 text-xs font-medium text-zinc-400">
              Team
              <select
                aria-label="Team"
                value={form.teamId}
                onChange={(e) => {
                  const teamId = e.target.value;
                  const current = rosterMembers.find(
                    (member) => member.userId === form.userId,
                  );
                  setForm({
                    ...form,
                    teamId,
                    userId:
                      current && teamId && !current.teamIds.includes(teamId)
                        ? ""
                        : form.userId,
                  });
                }}
                disabled={rosterBusy || rosterTeams.length === 0}
                className="block w-full rounded-md border border-[var(--suite-line-strong)] bg-[var(--suite-canvas)] px-3 py-2.5 text-sm text-[var(--suite-ink)] disabled:opacity-60"
              >
                <option value="">All available teams</option>
                {rosterTeams.map((team) => (
                  <option key={team.teamId} value={team.teamId}>
                    {team.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1.5 text-xs font-medium text-zinc-400">
              Find a member
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-zinc-600" />
                <input
                  aria-label="Find a member"
                  placeholder="Search name, email or employee number"
                  value={memberSearch}
                  onChange={(e) => setMemberSearch(e.target.value)}
                  disabled={form.openShift || rosterBusy || rosterMembers.length === 0}
                  className="block w-full rounded-md border border-[var(--suite-line-strong)] bg-[var(--suite-canvas)] py-2.5 pl-9 pr-3 text-sm text-[var(--suite-ink)] disabled:opacity-50"
                />
              </div>
            </label>
            <label className="space-y-1.5 text-xs font-medium text-zinc-400">
              Assign to
              <select
                aria-label="Assign to"
                value={form.userId}
                onChange={(e) => setForm({ ...form, userId: e.target.value })}
                disabled={form.openShift || rosterBusy || rosterMembers.length === 0}
                className="block w-full rounded-md border border-[var(--suite-line-strong)] bg-[var(--suite-canvas)] px-3 py-2.5 text-sm text-[var(--suite-ink)] disabled:opacity-50"
              >
                <option value="">Select an IDP member</option>
                {eligibleMembers.map((member) => (
                  <option key={member.userId} value={member.userId}>
                    {member.name}
                    {member.employeeId
                      ? ` · ${member.employeeId}`
                      : member.email
                        ? ` · ${member.email}`
                        : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1.5 text-xs font-medium text-zinc-400">
              Starts
              <input
                aria-label="Shift starts"
                type="datetime-local"
                value={form.startAt}
                onChange={(e) => setForm({ ...form, startAt: e.target.value })}
                className="block w-full rounded-md border border-[var(--suite-line-strong)] bg-[var(--suite-canvas)] px-3 py-2.5 text-sm text-[var(--suite-ink)]"
              />
            </label>
            <label className="space-y-1.5 text-xs font-medium text-zinc-400">
              Ends
              <input
                aria-label="Shift ends"
                type="datetime-local"
                value={form.endAt}
                onChange={(e) => setForm({ ...form, endAt: e.target.value })}
                className="block w-full rounded-md border border-[var(--suite-line-strong)] bg-[var(--suite-canvas)] px-3 py-2.5 text-sm text-[var(--suite-ink)]"
              />
            </label>
            <label className="space-y-1.5 text-xs font-medium text-zinc-400">
              Work mode
              <select
                aria-label="Work mode"
                value={form.workMode}
                onChange={(e) => setForm({ ...form, workMode: e.target.value })}
                className="block w-full rounded-md border border-[var(--suite-line-strong)] bg-[var(--suite-canvas)] px-3 py-2.5 text-sm text-[var(--suite-ink)]"
              >
                <option value="office">Office</option>
                <option value="remote">Remote</option>
                <option value="client_site">Client site</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label className="space-y-1.5 text-xs font-medium text-zinc-400">
              Shift template
              <select
                aria-label="Shift template"
                value={form.templateId || ""}
                onChange={(e) => {
                  const template = templates.find(
                    (item) => item._id === e.target.value,
                  );
                  setForm({
                    ...form,
                    templateId: e.target.value || undefined,
                    ...(template ? applyTemplateTimes(form.startAt, template) : {}),
                    ...(template?.breakMinutes !== undefined
                      ? { breakMinutes: template.breakMinutes }
                      : {}),
                    ...(template?.workMode
                      ? { workMode: template.workMode }
                      : {}),
                  });
                }}
                className="block w-full rounded-md border border-[var(--suite-line-strong)] bg-[var(--suite-canvas)] px-3 py-2.5 text-sm text-[var(--suite-ink)]"
              >
                <option value="">No template</option>
                {templates.map((t) => (
                  <option key={t._id} value={t._id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-start gap-3 rounded-lg border border-zinc-800 px-3 py-2.5 text-sm text-zinc-300">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={form.openShift}
                onChange={(e) =>
                  setForm({
                    ...form,
                    openShift: e.target.checked,
                    userId: e.target.checked ? "" : form.userId,
                  })
                }
              />
              <span>
                <span className="block text-zinc-200">Open shift</span>
                <span className="mt-0.5 block text-xs text-zinc-500">
                  Let eligible members request cover.
                </span>
              </span>
            </label>
          </div>
          {rosterError && (
            <div role="alert" className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-sm text-red-800 dark:text-red-300">
              <span>{rosterError}</span>
              <button type="button" onClick={() => void refreshRoster(true)} className="font-semibold hover:underline">Try again</button>
            </div>
          )}
          {!rosterError && rosterBusy && (
            <p className="mt-4 text-sm text-[var(--suite-muted)]">Synchronizing active members and teams from IDP…</p>
          )}
          {!form.openShift && rosterLoaded && !rosterBusy && !rosterError && rosterMembers.length === 0 && (
            <p className="mt-4 text-sm text-amber-800 dark:text-amber-300">IDP returned no active organization members with Time &amp; Attendance access. Confirm member status and application access in IDP, then refresh the roster.</p>
          )}
          {!form.openShift && rosterMembers.length > 0 && eligibleMembers.length === 0 && (
            <p className="mt-4 text-sm text-amber-800 dark:text-amber-300">No members match the selected team, search, and shift date.</p>
          )}
          {lastRosterSync && (
            <p className="mt-3 text-xs text-[var(--suite-subtle)]">Roster last synchronized {new Date(lastRosterSync).toLocaleString()}.</p>
          )}
          {invalidRange && (
            <p className="mt-4 text-sm text-red-700 dark:text-red-300">Shift end must be after shift start.</p>
          )}
          <div className="mt-5 flex items-center gap-3">
            <button
              onClick={createShift}
              disabled={invalidRange || rosterBusy || (!form.openShift && !form.userId)}
              className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Create draft
            </button>
            <button
              onClick={() => setShowCreate(false)}
              className="px-3 py-2 text-sm text-zinc-400 hover:text-zinc-200"
            >
              Cancel
            </button>
          </div>
        </section>
      )}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/50">
          <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
              <CalendarClock className="h-4 w-4 text-teal-400" />
              Upcoming shifts
            </h2>
            <span className="text-xs text-zinc-500">
              {shifts.length} scheduled
            </span>
          </div>
          {shifts.length ? (
            shifts.map((shift) => (
              <div
                key={shift._id}
                className="border-b border-zinc-800 px-5 py-4 last:border-0"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-zinc-100">
                      {new Date(shift.startAt).toLocaleDateString(undefined, {
                        weekday: "short",
                        day: "numeric",
                        month: "short",
                      })}
                    </div>
                    <div className="mt-1 text-sm text-zinc-400">
                      {new Date(shift.startAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}{" "}
                      –{" "}
                      {new Date(shift.endAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}{" "}
                      · {shift.workMode.replace("_", " ")}
                    </div>
                    <div className="mt-1 text-xs text-zinc-600">
                      {shift.userId === user?.id
                        ? "You"
                        : shift.assignee?.name ||
                          (shift.userId
                            ? "Organization member"
                            : "Open shift")} {" "}
                      {shift.team?.name ? `· ${shift.team.name} ` : ""}·{" "}
                      {shift.status}
                    </div>
                  </div>
                  {shift.userId === user?.id &&
                    shift.status === "published" &&
                    shift.acknowledgement?.status === "pending" && (
                      <div className="flex gap-2">
                        <button
                          onClick={() => acknowledge(shift._id, true)}
                          className="rounded-md border border-teal-500/40 px-2.5 py-1.5 text-xs text-teal-300"
                        >
                          Acknowledge
                        </button>
                        <button
                          onClick={() => acknowledge(shift._id, false)}
                          className="rounded-md border border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-400"
                        >
                          Flag issue
                        </button>
                      </div>
                    )}
                </div>
              </div>
            ))
          ) : (
            <div className="p-10 text-center text-sm text-zinc-500">
              No shifts in the next five weeks.
            </div>
          )}
        </section>
        <aside className="space-y-6">
          <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
              <Users className="h-4 w-4 text-zinc-500" />
              Open shifts
            </h2>
            <div className="mt-4 space-y-4">
              {openShifts.length ? (
                openShifts.map((shift) => (
                  <div
                    key={shift._id}
                    className="border-b border-zinc-800 pb-4 last:border-0 last:pb-0"
                  >
                    <div className="text-sm text-zinc-200">
                      {new Date(shift.startAt).toLocaleString()}
                    </div>
                    <button
                      onClick={() => requestCover(shift._id)}
                      className="mt-2 text-xs font-medium text-teal-400 hover:text-teal-300"
                    >
                      Request cover
                    </button>
                  </div>
                ))
              ) : (
                <p className="text-sm text-zinc-500">No open shifts.</p>
              )}
            </div>
          </section>
          <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
              <CircleAlert className="h-4 w-4 text-zinc-500" />
              Requests
            </h2>
            <div className="mt-4 space-y-3">
              {requests.length ? (
                requests.slice(0, 8).map((request) => (
                  <div key={request._id} className="text-xs">
                    <div className="flex justify-between">
                      <span className="capitalize text-zinc-300">
                        {request.type}
                      </span>
                      <span className="text-zinc-500">{request.status}</span>
                    </div>
                    {manager && request.status === "pending" && (
                      <div className="mt-2 flex gap-3">
                        <button
                          onClick={() => review(request._id, true)}
                          className="flex items-center gap-1 text-teal-400"
                        >
                          <Check className="h-3 w-3" />
                          Approve
                        </button>
                        <button
                          onClick={() => review(request._id, false)}
                          className="text-zinc-400"
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </div>
                ))
              ) : (
                <p className="text-sm text-zinc-500">No requests.</p>
              )}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
