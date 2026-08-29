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
  scheduleType?: 'fixed' | 'flexible' | 'rotating';
  rotation?: { cycleDays?: number; activeDays?: number[] };
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
  const [schedulePolicy, setSchedulePolicy] = useState<any>(null);
  const [availability, setAvailability] = useState<any[]>([]);
  const [availabilityForm, setAvailabilityForm] = useState({ date: new Date(Date.now() + 86400000).toISOString().slice(0, 10), available: true, startTime: '09:00', endTime: '17:00', note: '' });
  const [swapFor, setSwapFor] = useState<string | null>(null);
  const [swapOptions, setSwapOptions] = useState<any[]>([]);
  const [selectedSwap, setSelectedSwap] = useState('');
  const [rosterMembers, setRosterMembers] = useState<RosterMember[]>([]);
  const [rosterTeams, setRosterTeams] = useState<RosterTeam[]>([]);
  const [memberSearch, setMemberSearch] = useState("");
  const [message, setMessage] = useState("");
  const [rosterError, setRosterError] = useState("");
  const [rosterBusy, setRosterBusy] = useState(false);
  const [rosterLoaded, setRosterLoaded] = useState(false);
  const [lastRosterSync, setLastRosterSync] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showTemplate, setShowTemplate] = useState(false);
  const [templateForm, setTemplateForm] = useState({ name: '', scheduleType: 'fixed', startTime: '09:00', endTime: '17:00', breakMinutes: 60, workMode: 'office', cycleDays: 14, activeDays: '0,1,2,3,4,7,8,9,10,11' });
  const automaticRosterSyncAttempted = useRef(false);
  const [form, setForm] = useState<any>({
    userId: "",
    teamId: "",
    startAt: localInput(new Date(Date.now() + 86400000)),
    endAt: localInput(new Date(Date.now() + 86400000 + 8 * 3600000)),
    workMode: "office",
    breakMinutes: 60,
    openShift: false,
    repeatUntil: "",
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
    const [mine, open, requestData, templateData, policyData, availabilityData] = await Promise.all([
        schedulingApi.getShifts(range),
        schedulingApi.getShifts({ ...range, open: true, status: "published" }),
        schedulingApi.getRequests(),
        schedulingApi.getTemplates(),
        schedulingApi.getPolicy(),
        schedulingApi.getAvailability(),
      ]);
    setShifts(mine.shifts || []);
    setOpenShifts(open.shifts || []);
    setRequests(requestData.requests || []);
    setTemplates(templateData.templates || []);
    setSchedulePolicy(policyData);
    setAvailability(availabilityData.availability || []);
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
      if (form.templateId && form.repeatUntil) {
        const result = await schedulingApi.generateFromTemplate(form.templateId, {
          userId: form.openShift ? null : form.userId,
          teamId: form.teamId || undefined,
          openShift: form.openShift,
          startDate: form.startAt.slice(0, 10),
          endDate: form.repeatUntil,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        });
        setMessage(`${result.generatedCount} draft shift${result.generatedCount === 1 ? '' : 's'} generated${result.existingCount ? `; ${result.existingCount} already existed` : ''}.`);
      } else {
        await schedulingApi.createShift({
          ...form,
          teamId: form.teamId || undefined,
          userId: form.openShift ? null : form.userId,
          startAt: new Date(form.startAt),
          endAt: new Date(form.endAt),
        });
        setMessage("Draft shift created.");
      }
      setShowCreate(false);
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
    setMessage(schedulePolicy?.schedulingSettings?.requestPolicies?.cover?.approvalRequired === false ? "Open shift assigned." : "Cover request sent for approval.");
    await load();
  };
  const createTemplate = async () => {
    try {
      await schedulingApi.createTemplate({
        name: templateForm.name,
        scheduleType: templateForm.scheduleType,
        startTime: templateForm.startTime,
        endTime: templateForm.endTime,
        breakMinutes: templateForm.breakMinutes,
        workMode: templateForm.workMode,
        rotation: templateForm.scheduleType === 'rotating' ? {
          cycleDays: templateForm.cycleDays,
          activeDays: templateForm.activeDays.split(',').map(value => Number(value.trim())).filter(Number.isInteger),
        } : undefined,
      });
      setShowTemplate(false);
      setTemplateForm({ name: '', scheduleType: 'fixed', startTime: '09:00', endTime: '17:00', breakMinutes: 60, workMode: 'office', cycleDays: 14, activeDays: '0,1,2,3,4,7,8,9,10,11' });
      setMessage('Shift template created.');
      await load();
    } catch (error: any) {
      setMessage(getApiErrorMessage(error, 'The shift template could not be created.'));
    }
  };
  const requestRelease = async (id: string) => {
    await schedulingApi.createRequest({ shiftId: id, type: 'release', reason: 'I need this published shift released.' });
    setMessage(schedulePolicy?.schedulingSettings?.requestPolicies?.release?.approvalRequired === false ? 'Shift released and reopened.' : 'Release request sent for approval.');
    await load();
  };
  const openSwap = async (id: string) => {
    const data = await schedulingApi.getSwapOptions(id);
    setSwapFor(id);
    setSwapOptions(data.options || []);
    setSelectedSwap(data.options?.[0]?.shiftId || '');
  };
  const requestSwap = async () => {
    const option = swapOptions.find(item => String(item.shiftId) === String(selectedSwap));
    if (!swapFor || !option) return;
    await schedulingApi.createRequest({
      shiftId: swapFor,
      type: 'swap',
      targetUserId: option.targetUserId,
      offeredShiftId: option.shiftId,
      reason: 'I would like to exchange these published shifts.',
    });
    setMessage('Swap sent to the other employee for consent.');
    setSwapFor(null);
    await load();
  };
  const respondToSwap = async (id: string, accepted: boolean) => {
    await schedulingApi.respondToRequest(id, accepted);
    setMessage(accepted ? 'Swap accepted and routed to its next required decision.' : 'Swap declined.');
    await load();
  };
  const saveAvailability = async () => {
    await schedulingApi.setAvailability(availabilityForm.date, availabilityForm);
    setMessage(`Availability saved for ${new Date(`${availabilityForm.date}T12:00:00`).toLocaleDateString()}.`);
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
              onClick={() => setShowTemplate(!showTemplate)}
              className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white"
            >
              Template
            </button>
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
      {showTemplate && <section className="rounded-lg border border-[var(--suite-line-strong)] bg-[var(--suite-surface)] p-5">
        <div><h2 className="text-sm font-semibold text-[var(--suite-ink)]">Create a shift template</h2><p className="mt-1 text-xs text-[var(--suite-muted)]">Use a fixed weekday pattern or a zero-based rotating cycle, then generate up to 93 days at a time.</p></div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="space-y-1.5 text-xs font-medium text-zinc-400">Name<input aria-label="Template name" required value={templateForm.name} onChange={event => setTemplateForm({ ...templateForm, name: event.target.value })} className="block w-full rounded-md border border-[var(--suite-line-strong)] bg-[var(--suite-canvas)] px-3 py-2.5 text-sm text-[var(--suite-ink)]" /></label>
          <label className="space-y-1.5 text-xs font-medium text-zinc-400">Pattern<select aria-label="Template pattern" value={templateForm.scheduleType} onChange={event => setTemplateForm({ ...templateForm, scheduleType: event.target.value })} className="block w-full rounded-md border border-[var(--suite-line-strong)] bg-[var(--suite-canvas)] px-3 py-2.5 text-sm text-[var(--suite-ink)]"><option value="fixed">Weekdays</option><option value="rotating">Rotating cycle</option></select></label>
          <label className="space-y-1.5 text-xs font-medium text-zinc-400">Starts<input aria-label="Template starts" type="time" value={templateForm.startTime} onChange={event => setTemplateForm({ ...templateForm, startTime: event.target.value })} className="block w-full rounded-md border border-[var(--suite-line-strong)] bg-[var(--suite-canvas)] px-3 py-2.5 text-sm text-[var(--suite-ink)]" /></label>
          <label className="space-y-1.5 text-xs font-medium text-zinc-400">Ends<input aria-label="Template ends" type="time" value={templateForm.endTime} onChange={event => setTemplateForm({ ...templateForm, endTime: event.target.value })} className="block w-full rounded-md border border-[var(--suite-line-strong)] bg-[var(--suite-canvas)] px-3 py-2.5 text-sm text-[var(--suite-ink)]" /></label>
          <label className="space-y-1.5 text-xs font-medium text-zinc-400">Break minutes<input aria-label="Template break minutes" type="number" min={0} max={720} value={templateForm.breakMinutes} onChange={event => setTemplateForm({ ...templateForm, breakMinutes: Number(event.target.value) })} className="block w-full rounded-md border border-[var(--suite-line-strong)] bg-[var(--suite-canvas)] px-3 py-2.5 text-sm text-[var(--suite-ink)]" /></label>
          <label className="space-y-1.5 text-xs font-medium text-zinc-400">Work mode<select aria-label="Template work mode" value={templateForm.workMode} onChange={event => setTemplateForm({ ...templateForm, workMode: event.target.value })} className="block w-full rounded-md border border-[var(--suite-line-strong)] bg-[var(--suite-canvas)] px-3 py-2.5 text-sm text-[var(--suite-ink)]"><option value="office">Office</option><option value="remote">Remote</option><option value="client_site">Client site</option><option value="other">Other</option></select></label>
          {templateForm.scheduleType === 'rotating' && <><label className="space-y-1.5 text-xs font-medium text-zinc-400">Cycle days<input aria-label="Rotation cycle days" type="number" min={1} max={365} value={templateForm.cycleDays} onChange={event => setTemplateForm({ ...templateForm, cycleDays: Number(event.target.value) })} className="block w-full rounded-md border border-[var(--suite-line-strong)] bg-[var(--suite-canvas)] px-3 py-2.5 text-sm text-[var(--suite-ink)]" /></label><label className="space-y-1.5 text-xs font-medium text-zinc-400">Working day offsets<input aria-label="Rotation active days" value={templateForm.activeDays} onChange={event => setTemplateForm({ ...templateForm, activeDays: event.target.value })} className="block w-full rounded-md border border-[var(--suite-line-strong)] bg-[var(--suite-canvas)] px-3 py-2.5 text-sm text-[var(--suite-ink)]" /><span className="block font-normal text-[var(--suite-muted)]">Example: 0,1,2,7,8,9 in a 14-day cycle.</span></label></>}
        </div>
        <div className="mt-5 flex gap-3"><button onClick={createTemplate} disabled={!templateForm.name.trim()} className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40">Save template</button><button onClick={() => setShowTemplate(false)} className="px-3 py-2 text-sm text-zinc-400">Cancel</button></div>
      </section>}
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
                    repeatUntil: e.target.value ? form.repeatUntil : "",
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
            {form.templateId && <label className="space-y-1.5 text-xs font-medium text-zinc-400">Repeat through
              <input aria-label="Repeat template through" type="date" min={form.startAt.slice(0, 10)} max={localInput(new Date(new Date(form.startAt).getTime() + 92 * 86400000)).slice(0, 10)} value={form.repeatUntil} onChange={(event) => setForm({ ...form, repeatUntil: event.target.value })} className="block w-full rounded-md border border-[var(--suite-line-strong)] bg-[var(--suite-canvas)] px-3 py-2.5 text-sm text-[var(--suite-ink)]" />
              <span className="block font-normal text-[var(--suite-muted)]">Leave empty for one shift. Rotating templates follow their saved cycle.</span>
            </label>}
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
        <section className="self-start overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/50">
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
                    (
                      <div className="flex flex-wrap gap-2">
                        {shift.acknowledgement?.status === "pending" && <>
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
                        </>}
                        {schedulePolicy?.schedulingSettings?.allowEmployeeRelease !== false && <button onClick={() => requestRelease(shift._id)} className="rounded-md border border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-300">Release</button>}
                        {schedulePolicy?.schedulingSettings?.allowShiftSwap !== false && <button onClick={() => openSwap(shift._id)} className="rounded-md border border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-300">Swap</button>}
                      </div>
                    )}
                </div>
                {swapFor === shift._id && <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
                  <label className="text-xs font-medium text-zinc-400">Exchange for
                    <select aria-label="Shift to receive" value={selectedSwap} onChange={(event) => setSelectedSwap(event.target.value)} className="mt-2 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200">
                      {swapOptions.map(option => <option key={option.shiftId} value={option.shiftId}>{option.assignee?.name} · {new Date(option.startAt).toLocaleString()}</option>)}
                    </select>
                  </label>
                  {!swapOptions.length && <p className="mt-2 text-xs text-zinc-500">No eligible team shifts are available to exchange.</p>}
                  <div className="mt-3 flex gap-3"><button disabled={!selectedSwap} onClick={requestSwap} className="text-xs font-medium text-teal-400 disabled:opacity-40">Send swap</button><button onClick={() => setSwapFor(null)} className="text-xs text-zinc-500">Cancel</button></div>
                </div>}
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
            <h2 className="text-sm font-semibold text-white">Your availability</h2>
            <p className="mt-1 text-xs text-zinc-500">Managers cannot assign outside unavailable dates or time windows when policy enforcement is on.</p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <input aria-label="Availability date" type="date" value={availabilityForm.date} onChange={(event) => setAvailabilityForm({ ...availabilityForm, date: event.target.value })} className="col-span-2 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-2 text-xs text-zinc-200" />
              <input aria-label="Available from" type="time" disabled={!availabilityForm.available} value={availabilityForm.startTime} onChange={(event) => setAvailabilityForm({ ...availabilityForm, startTime: event.target.value })} className="rounded-md border border-zinc-700 bg-zinc-950 px-2 py-2 text-xs text-zinc-200 disabled:opacity-40" />
              <input aria-label="Available until" type="time" disabled={!availabilityForm.available} value={availabilityForm.endTime} onChange={(event) => setAvailabilityForm({ ...availabilityForm, endTime: event.target.value })} className="rounded-md border border-zinc-700 bg-zinc-950 px-2 py-2 text-xs text-zinc-200 disabled:opacity-40" />
              <label className="col-span-2 flex items-center gap-2 text-xs text-zinc-300"><input type="checkbox" checked={availabilityForm.available} onChange={(event) => setAvailabilityForm({ ...availabilityForm, available: event.target.checked })} />Available that day</label>
              <button onClick={saveAvailability} className="col-span-2 rounded-md bg-zinc-100 px-3 py-2 text-xs font-medium text-zinc-950">Save availability</button>
            </div>
            {!!availability.length && <p className="mt-3 text-xs text-zinc-500">{availability.length} date{availability.length === 1 ? '' : 's'} recorded.</p>}
          </section>
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
                      <span className="text-zinc-500">{request.status === 'pending_target' ? 'awaiting colleague' : request.status.replaceAll('_', ' ')}</span>
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
                    {request.type === 'swap' && request.status === 'pending_target' && request.targetUserId === user?.id && <div className="mt-2 flex gap-3"><button onClick={() => respondToSwap(request._id, true)} className="flex items-center gap-1 text-teal-400"><Check className="h-3 w-3" />Accept swap</button><button onClick={() => respondToSwap(request._id, false)} className="text-zinc-400">Decline</button></div>}
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
