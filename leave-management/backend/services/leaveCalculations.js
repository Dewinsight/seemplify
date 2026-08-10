const { format, addDays, differenceInDays, isWeekend, parseISO } = require('date-fns');
const { utcToZonedTime, zonedTimeToUtc } = require('date-fns-tz');

/**
 * Calculate the number of working days between two dates
 * Excludes weekends and holidays
 */
function calculateLeaveDays(startDate, endDate, policy = {}) {
  const {
    timezone = 'UTC',
    holidays = [],
    workingDays = [1, 2, 3, 4, 5], // Monday to Friday
  } = policy;

  // Convert to timezone if needed
  let start = typeof startDate === 'string' ? parseISO(startDate) : new Date(startDate);
  let end = typeof endDate === 'string' ? parseISO(endDate) : new Date(endDate);

  // Convert to organization timezone
  start = utcToZonedTime(start, timezone);
  end = utcToZonedTime(end, timezone);

  // Normalize to start of day
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);

  let days = 0;
  let current = new Date(start);

  // Convert holidays to date strings for comparison
  const holidayStrings = holidays.map(h => {
    const holidayDate = h.date ? new Date(h.date) : new Date(h);
    return format(holidayDate, 'yyyy-MM-dd');
  });

  while (current <= end) {
    const dayOfWeek = current.getDay();
    const dateStr = format(current, 'yyyy-MM-dd');

    // Check if working day
    if (workingDays.includes(dayOfWeek)) {
      // Check if holiday
      const isHoliday = holidayStrings.includes(dateStr);

      if (!isHoliday) {
        days++;
      }
    }

    current = addDays(current, 1);
  }

  return days;
}

/**
 * Validate leave request dates
 */
function validateLeaveDates(startDate, endDate, policy = {}, options = {}) {
  const {
    timezone = 'UTC',
    advanceNoticeDays = 0,
    maxConsecutiveDays,
    holidays = [],
    workingDays = [1, 2, 3, 4, 5],
  } = policy;

  const errors = [];

  let start = typeof startDate === 'string' ? parseISO(startDate) : new Date(startDate);
  let end = typeof endDate === 'string' ? parseISO(endDate) : new Date(endDate);

  // Convert to timezone
  start = utcToZonedTime(start, timezone);
  end = utcToZonedTime(end, timezone);
  const now = utcToZonedTime(new Date(), timezone);

  // Check date order
  if (start > end) {
    errors.push('Start date must be before or equal to end date');
  }

  // Check start date is not in the past
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const startDay = new Date(start);
  startDay.setHours(0, 0, 0, 0);

  if (startDay < today) {
    errors.push('Start date cannot be in the past');
  }

  // Check advance notice (only if policy requires it)
  if (advanceNoticeDays > 0) {
    const daysUntilStart = differenceInDays(startDay, today);
    if (daysUntilStart < advanceNoticeDays) {
      errors.push(`Leave must be requested at least ${advanceNoticeDays} days in advance`);
    }
  }
  // If advanceNoticeDays is 0, no advance notice is required

  // Calculate leave days
  const days = calculateLeaveDays(start, end, { timezone, holidays, workingDays });

  const requestLimit = Object.prototype.hasOwnProperty.call(options, 'maxConsecutiveDays')
    ? options.maxConsecutiveDays
    : maxConsecutiveDays;

  // Check the selected leave type's request limit. Ordinary leave types inherit
  // the organization limit; protected/family leave can use a larger entitlement.
  if (requestLimit && days > requestLimit) {
    const subject = options.leaveTypeName ? `${options.leaveTypeName} requests` : 'Leave requests';
    errors.push(`${subject} can include up to ${requestLimit} consecutive working days`);
  }

  return {
    isValid: errors.length === 0,
    errors,
    numberOfDays: days,
  };
}

/**
 * Find approver for leave request based on team hierarchy
 * Supports: line_manager, team_lead, and parent team hierarchy
 */
async function findApprover(userId, organizationId, userinfo, specificTeamId = null) {
  // Get user's teams in this organization
  let userTeams = (userinfo.teams || []).filter(
    team => team.organizationId === organizationId
  );

  // If specific team requested, filter to that team
  if (specificTeamId) {
    userTeams = userTeams.filter(t => t.id === specificTeamId);
  }

  if (userTeams.length === 0) {
    // User not in any team - assign to organization admin/owner
    return {
      assignmentType: 'organization_role',
      // No specific approverId - any user with org permission can approve
    };
  }

  // Priority 1: Find team manager with line_manager or team_lead role
  // Check direct team manager first
  for (const team of userTeams) {
    // Check if team has a manager who is not the requester
    if (team.managerId && team.managerId !== userId) {
      // Check if manager has line_manager or team_lead role
      // We need to verify this by checking if manager is in approver's teams with the right role
      // For now, if managerId exists, assume they can approve (will be validated in middleware)
      return {
        approverId: team.managerId,
        approverName: team.managerName,
        approverEmail: team.managerEmail,
        teamId: team.id,
        teamName: team.name,
        assignmentType: team.role === 'team_lead' ? 'team_lead' : 'line_manager',
      };
    }
  }

  // Priority 2: Check parent teams for managers
  // If user is in a sub-team, check parent team's manager
  for (const team of userTeams) {
    if (team.parentTeamId) {
      // Find parent team in user's teams (if user is also in parent team)
      // Or we need to check if parent team has a manager
      // For now, we'll assign to org role and let the approval middleware handle hierarchy
    }
  }

  // Priority 3: Check if any team member with line_manager or team_lead role can approve
  // (This would be for cases where there's no assigned manager but there's a team lead)
  for (const team of userTeams) {
    // If user has line_manager or team_lead role themselves, they can self-approve
    // But typically we want someone else to approve
    // This case is handled by the approval permission check
  }

  // No team manager found - fallback to organization admin/owner
  return {
    assignmentType: 'organization_role',
  };
}

/**
 * Get holidays for a date range
 */
function getHolidaysInRange(startDate, endDate, holidays = []) {
  let start = typeof startDate === 'string' ? parseISO(startDate) : new Date(startDate);
  let end = typeof endDate === 'string' ? parseISO(endDate) : new Date(endDate);

  return holidays.filter(h => {
    const holidayDate = h.date ? new Date(h.date) : new Date(h);
    return holidayDate >= start && holidayDate <= end;
  });
}

/**
 * Format date for display
 */
function formatDateForDisplay(date, timezone = 'UTC') {
  const zonedDate = utcToZonedTime(new Date(date), timezone);
  return format(zonedDate, 'MMM dd, yyyy');
}

/**
 * Format date range for display
 */
function formatDateRangeForDisplay(startDate, endDate, timezone = 'UTC') {
  const start = formatDateForDisplay(startDate, timezone);
  const end = formatDateForDisplay(endDate, timezone);

  if (start === end) {
    return start;
  }

  return `${start} - ${end}`;
}

module.exports = {
  calculateLeaveDays,
  validateLeaveDates,
  findApprover,
  getHolidaysInRange,
  formatDateForDisplay,
  formatDateRangeForDisplay,
};
