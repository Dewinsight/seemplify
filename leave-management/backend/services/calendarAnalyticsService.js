function dateKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('Invalid calendar date');
  return date.toISOString().slice(0, 10);
}

function daysInRange(startDate, endDate) {
  const start = new Date(`${dateKey(startDate)}T00:00:00.000Z`);
  const end = new Date(`${dateKey(endDate)}T00:00:00.000Z`);
  if (end < start) throw new Error('Calendar end date must be on or after the start date');
  const days = [];
  for (const cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    days.push(cursor.toISOString().slice(0, 10));
    if (days.length > 370) throw new Error('Calendar range cannot exceed 370 days');
  }
  return days;
}

function overlapsDay(request, day) {
  return dateKey(request.startDate) <= day && dateKey(request.endDate) >= day;
}

function percentage(count, total) {
  return total > 0 ? Number(((count / total) * 100).toFixed(1)) : 0;
}

function uniqueUsers(requests, workforceIds) {
  const ids = new Set(requests.map((request) => String(request.userId)));
  return workforceIds ? Array.from(ids).filter((userId) => workforceIds.has(userId)).length : ids.size;
}

function buildDailyCoverage(days, requests, workforceIds) {
  return days.map((date) => {
    const active = requests.filter((request) => overlapsDay(request, date));
    const approvedUsers = new Set(active.filter((request) => request.status === 'approved').map((request) => String(request.userId)));
    const pendingUsers = new Set(active.filter((request) => request.status === 'pending').map((request) => String(request.userId)));
    const approvedAway = workforceIds
      ? Array.from(approvedUsers).filter((userId) => workforceIds.has(userId)).length
      : approvedUsers.size;
    const pendingAway = workforceIds
      ? Array.from(pendingUsers).filter((userId) => workforceIds.has(userId)).length
      : pendingUsers.size;
    const totalWorkforce = workforceIds?.size || 0;
    return {
      date,
      approvedAway,
      pendingAway,
      approvedAwayPercent: percentage(approvedAway, totalWorkforce),
    };
  });
}

function peakCoverage(dailyCoverage) {
  return dailyCoverage.reduce((peak, day) => (
    day.approvedAway > peak.approvedAway ? day : peak
  ), dailyCoverage[0] || { date: null, approvedAway: 0, approvedAwayPercent: 0 });
}

function memberTeamAssignments(member) {
  const assignments = Array.isArray(member.teamAssignments) ? member.teamAssignments : [];
  if (assignments.length > 0) {
    return assignments
      .filter((assignment) => assignment?.teamId)
      .map((assignment) => ({ teamId: String(assignment.teamId), name: assignment.name || String(assignment.teamId) }));
  }
  return (member.teamIds || []).map((teamId) => ({ teamId: String(teamId), name: String(teamId) }));
}

function buildCalendarAnalytics({ startDate, endDate, roster, requests }) {
  const days = daysInRange(startDate, endDate);
  const workforceIds = new Set(roster.map((member) => String(member.userId)));
  const activeRequests = requests.filter((request) => workforceIds.has(String(request.userId)));
  const approved = activeRequests.filter((request) => request.status === 'approved');
  const pending = activeRequests.filter((request) => request.status === 'pending');
  const dailyCoverage = buildDailyCoverage(days, requests, workforceIds);
  const peak = peakCoverage(dailyCoverage);

  const requestTeamNames = new Map(requests
    .filter((request) => request.teamId && request.teamName)
    .map((request) => [String(request.teamId), request.teamName]));
  const teams = new Map();
  for (const member of roster) {
    for (const assignment of memberTeamAssignments(member)) {
      if (!teams.has(assignment.teamId)) teams.set(assignment.teamId, { name: requestTeamNames.get(assignment.teamId) || assignment.name, userIds: new Set() });
      teams.get(assignment.teamId).userIds.add(String(member.userId));
    }
  }

  const teamCoverage = Array.from(teams.entries()).map(([teamId, team]) => {
    const teamRequests = requests.filter((request) => team.userIds.has(String(request.userId)));
    const teamApproved = teamRequests.filter((request) => request.status === 'approved');
    const teamDaily = buildDailyCoverage(days, teamRequests, team.userIds);
    const teamPeak = peakCoverage(teamDaily);
    return {
      teamId,
      teamName: team.name,
      totalWorkforce: team.userIds.size,
      peopleOnApprovedLeave: uniqueUsers(teamApproved, team.userIds),
      workforcePercentOnLeaveInPeriod: percentage(uniqueUsers(teamApproved, team.userIds), team.userIds.size),
      pendingRequests: teamRequests.filter((request) => request.status === 'pending').length,
      peakAwayCount: teamPeak.approvedAway,
      peakAwayPercent: teamPeak.approvedAwayPercent,
      peakDate: teamPeak.date,
      dailyCoverage: teamDaily,
    };
  }).sort((a, b) => a.teamName.localeCompare(b.teamName));

  return {
    summary: {
      totalWorkforce: workforceIds.size,
      peopleOnApprovedLeave: uniqueUsers(approved, workforceIds),
      workforcePercentOnLeaveInPeriod: percentage(uniqueUsers(approved, workforceIds), workforceIds.size),
      approvedRequests: approved.length,
      pendingRequests: pending.length,
      peakAwayCount: peak.approvedAway,
      peakAwayPercent: peak.approvedAwayPercent,
      peakDate: peak.date,
    },
    dailyCoverage,
    teamCoverage,
  };
}

module.exports = { buildCalendarAnalytics, daysInRange };
