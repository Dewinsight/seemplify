'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { addMonths, endOfMonth, format, parseISO, startOfMonth, subMonths } from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import LeaveCalendarGrid, { requestsForDay } from '@/components/LeaveCalendarGrid';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { leavePoliciesApi, leaveRequestsApi } from '@/lib/api';
import { formatDateRange, getLeaveTypeLabel, getStatusColor, getStatusLabel } from '@/lib/utils';
import {
  CalendarCoverageSummary,
  CalendarDailyCoverage,
  Holiday,
  LeaveRequest,
  TeamCalendarCoverage,
} from '@/types';

const emptySummary: CalendarCoverageSummary = {
  totalWorkforce: 0,
  peopleOnApprovedLeave: 0,
  workforcePercentOnLeaveInPeriod: 0,
  approvedRequests: 0,
  pendingRequests: 0,
  peakAwayCount: 0,
  peakAwayPercent: 0,
  peakDate: null,
};

export default function WorkforceCalendarPanel() {
  const [month, setMonth] = useState(new Date());
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [summary, setSummary] = useState<CalendarCoverageSummary>(emptySummary);
  const [dailyCoverage, setDailyCoverage] = useState<CalendarDailyCoverage[]>([]);
  const [teams, setTeams] = useState<TeamCalendarCoverage[]>([]);
  const [teamId, setTeamId] = useState('');
  const [selectedDay, setSelectedDay] = useState<Date | null>(new Date());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const start = format(startOfMonth(month), 'yyyy-MM-dd');
        const end = format(endOfMonth(month), 'yyyy-MM-dd');
        const [calendarResponse, holidayResponse] = await Promise.all([
          leaveRequestsApi.getOrganizationCalendar(start, end),
          leavePoliciesApi.getHolidays(month.getFullYear()),
        ]);
        setRequests(calendarResponse.requests || []);
        setSummary(calendarResponse.summary || emptySummary);
        setDailyCoverage(calendarResponse.dailyCoverage || []);
        setTeams(calendarResponse.teamCoverage || []);
        setHolidays(holidayResponse.holidays || []);
      } catch (requestError: any) {
        setError(requestError.response?.data?.error || 'Unable to load workforce calendar data.');
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [month]);

  const selectedTeam = teams.find((team) => team.teamId === teamId);
  const activeSummary = selectedTeam || summary;
  const activeCoverage = selectedTeam?.dailyCoverage || dailyCoverage;
  const filteredRequests = useMemo(() => (
    teamId ? requests.filter((request) => request.teamIds?.includes(teamId) || request.teamId === teamId) : requests
  ), [requests, teamId]);
  const selectedRequests = selectedDay ? requestsForDay(filteredRequests, selectedDay) : [];
  const selectedCoverage = selectedDay
    ? activeCoverage.find((entry) => entry.date === format(selectedDay, 'yyyy-MM-dd'))
    : undefined;

  return (
    <section aria-labelledby="workforce-calendar-title" className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><h2 id="workforce-calendar-title" className="text-lg font-semibold">Workforce calendar</h2><p className="mt-1 text-sm text-muted-foreground">Organization and team leave coverage, based on the active workforce roster.</p></div>
        <label className="text-sm"><span className="mr-2 text-muted-foreground">Team</span><select value={teamId} onChange={(event) => setTeamId(event.target.value)} className="h-10 rounded-md border border-input bg-background px-3"><option value="">Entire organization</option>{teams.map((team) => <option key={team.teamId} value={team.teamId}>{team.teamName}</option>)}</select></label>
      </div>

      {error && <Alert variant="danger">{error}</Alert>}

      <dl className="grid border border-border bg-card sm:grid-cols-2 lg:grid-cols-4">
        <div className="border-b border-border px-4 py-3 sm:border-r lg:border-b-0"><dt className="text-xs text-muted-foreground">Active workforce</dt><dd className="mt-1 text-xl font-semibold">{activeSummary.totalWorkforce}</dd></div>
        <div className="border-b border-border px-4 py-3 lg:border-b-0 lg:border-r"><dt className="text-xs text-muted-foreground">People on leave this month</dt><dd className="mt-1 text-xl font-semibold">{activeSummary.peopleOnApprovedLeave} <span className="text-sm font-normal text-muted-foreground">({activeSummary.workforcePercentOnLeaveInPeriod}%)</span></dd></div>
        <div className="border-b border-border px-4 py-3 sm:border-b-0 sm:border-r"><dt className="text-xs text-muted-foreground">Peak daily absence</dt><dd className="mt-1 text-xl font-semibold">{activeSummary.peakAwayCount} <span className="text-sm font-normal text-muted-foreground">({activeSummary.peakAwayPercent}%)</span></dd>{activeSummary.peakDate && <p className="mt-1 text-xs text-muted-foreground">{format(parseISO(activeSummary.peakDate), 'MMM d')}</p>}</div>
        <div className="px-4 py-3"><dt className="text-xs text-muted-foreground">Pending requests</dt><dd className="mt-1 text-xl font-semibold">{activeSummary.pendingRequests}</dd></div>
      </dl>

      <div className="flex items-center justify-between border-y border-border py-3">
        <Button variant="outline" size="sm" onClick={() => setMonth(subMonths(month, 1))}><ChevronLeft className="h-4 w-4" /> Previous</Button>
        <div className="text-center"><h3 className="font-semibold">{format(month, 'MMMM yyyy')}</h3><p className="text-xs text-muted-foreground">{teamId ? selectedTeam?.teamName : 'Entire organization'}</p></div>
        <Button variant="outline" size="sm" onClick={() => setMonth(addMonths(month, 1))}>Next <ChevronRight className="h-4 w-4" /></Button>
      </div>

      {loading ? <div className="py-24 text-center text-sm text-muted-foreground">Loading workforce coverage…</div> : (
        <LeaveCalendarGrid month={month} requests={filteredRequests} holidays={holidays} selectedDay={selectedDay} onSelectDay={setSelectedDay} showEmployeeNames dailyCoverage={activeCoverage} />
      )}

      {selectedDay && (
        <section className="border border-border bg-card" aria-labelledby="workforce-selected-day">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3"><h3 id="workforce-selected-day" className="font-semibold">{format(selectedDay, 'EEEE, MMMM d, yyyy')}</h3><p className="text-sm text-muted-foreground">{selectedCoverage?.approvedAway || 0} approved away · {selectedCoverage?.approvedAwayPercent || 0}% of workforce · {selectedCoverage?.pendingAway || 0} pending</p></div>
          {selectedRequests.length === 0 ? <p className="px-4 py-6 text-sm text-muted-foreground">No leave requests overlap this day.</p> : (
            <div className="divide-y divide-border">{selectedRequests.map((request) => (
              <Link key={request._id} href={`/leave-requests/${request._id}`} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-muted/30">
                <div><p className="text-sm font-medium">{request.userName}</p><p className="mt-1 text-xs text-muted-foreground">{request.teamName || 'No team'} · {getLeaveTypeLabel(request.leaveType, request.leaveTypeName)} · {formatDateRange(request.startDate, request.endDate)}</p></div>
                <span className={`rounded px-2 py-1 text-xs font-medium ${getStatusColor(request.status)}`}>{getStatusLabel(request.status)}</span>
              </Link>
            ))}</div>
          )}
        </section>
      )}

      <section aria-labelledby="team-coverage-title">
        <h3 id="team-coverage-title" className="font-semibold">Team coverage</h3>
        <div className="mt-3 overflow-x-auto border border-border bg-card"><table className="w-full text-left text-sm"><thead className="border-b border-border bg-muted/40 text-xs text-muted-foreground"><tr><th className="px-4 py-3">Team</th><th className="px-4 py-3">Workforce</th><th className="px-4 py-3">People on leave</th><th className="px-4 py-3">Peak daily absence</th><th className="px-4 py-3">Pending</th></tr></thead><tbody className="divide-y divide-border">{teams.map((team) => <tr key={team.teamId}><td className="px-4 py-3 font-medium">{team.teamName}</td><td className="px-4 py-3">{team.totalWorkforce}</td><td className="px-4 py-3">{team.peopleOnApprovedLeave} ({team.workforcePercentOnLeaveInPeriod}%)</td><td className="px-4 py-3">{team.peakAwayCount} ({team.peakAwayPercent}%){team.peakDate ? ` · ${format(parseISO(team.peakDate), 'MMM d')}` : ''}</td><td className="px-4 py-3">{team.pendingRequests}</td></tr>)}{teams.length === 0 && !loading && <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No team assignments are available in the workforce roster.</td></tr>}</tbody></table></div>
      </section>
    </section>
  );
}
