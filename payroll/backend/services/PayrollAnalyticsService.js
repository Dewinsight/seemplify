const CURRENT_WORKFORCE_STATUSES = new Set(['active', 'on_notice', 'on_leave']);

function normalizeDepartment(value) {
  const department = String(value || '').trim();
  return department || 'Unassigned';
}

function normalizedProfileStatus(profile = {}) {
  if (profile.isActive === false && !['terminated', 'suspended'].includes(profile.status)) return 'inactive';
  return String(profile.status || (profile.isActive === false ? 'inactive' : 'active')).trim().toLowerCase();
}

function isCurrentWorkforceProfile(profile = {}) {
  return profile.isActive !== false && CURRENT_WORKFORCE_STATUSES.has(normalizedProfileStatus(profile));
}

function currentDepartmentByUser(profiles = []) {
  return new Map(
    profiles
      .filter((profile) => profile?.userId !== undefined && profile?.userId !== null)
      .map((profile) => [String(profile.userId), normalizeDepartment(profile.employeeInfo?.department)])
  );
}

function buildDepartmentRoster(profiles = []) {
  const departments = new Map();
  profiles.filter(isCurrentWorkforceProfile).forEach((profile) => {
    const department = normalizeDepartment(profile.employeeInfo?.department);
    const roster = departments.get(department) || { userIds: new Set(), active: 0, onNotice: 0, onLeave: 0 };
    roster.userIds.add(String(profile.userId));
    const status = normalizedProfileStatus(profile);
    if (status === 'active') roster.active += 1;
    if (status === 'on_notice') roster.onNotice += 1;
    if (status === 'on_leave') roster.onLeave += 1;
    departments.set(department, roster);
  });
  return departments;
}

function buildHeadcountAnalytics(profiles = [], referenceDate = new Date()) {
  const statusBreakdown = {
    active: 0,
    on_notice: 0,
    on_leave: 0,
    terminated: 0,
    suspended: 0,
    inactive: 0,
  };
  profiles.forEach((profile) => {
    const status = normalizedProfileStatus(profile);
    if (Object.prototype.hasOwnProperty.call(statusBreakdown, status)) statusBreakdown[status] += 1;
    else statusBreakdown.inactive += 1;
  });

  const workforceProfiles = profiles.filter(isCurrentWorkforceProfile);
  const employmentTypes = { full_time: 0, part_time: 0, contract: 0, intern: 0, unspecified: 0 };
  const departmentHeadcount = {};
  const tenureRanges = { 'Less than 1 year': 0, '1-2 years': 0, '2-5 years': 0, '5+ years': 0, 'Not recorded': 0 };

  workforceProfiles.forEach((profile) => {
    const employmentType = String(profile.employeeInfo?.employmentType || 'unspecified');
    if (Object.prototype.hasOwnProperty.call(employmentTypes, employmentType)) employmentTypes[employmentType] += 1;
    else employmentTypes.unspecified += 1;

    const department = normalizeDepartment(profile.employeeInfo?.department);
    departmentHeadcount[department] = (departmentHeadcount[department] || 0) + 1;

    const joinedAt = profile.employeeInfo?.dateOfJoining ? new Date(profile.employeeInfo.dateOfJoining) : null;
    if (!joinedAt || Number.isNaN(joinedAt.getTime())) {
      tenureRanges['Not recorded'] += 1;
      return;
    }
    const years = (referenceDate.getTime() - joinedAt.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
    if (years < 1) tenureRanges['Less than 1 year'] += 1;
    else if (years < 2) tenureRanges['1-2 years'] += 1;
    else if (years < 5) tenureRanges['2-5 years'] += 1;
    else tenureRanges['5+ years'] += 1;
  });

  const latestSourceUpdate = profiles.reduce((latest, profile) => {
    const candidates = [profile.updatedAt, profile.employeeInfo?.lastSyncedAt]
      .map((value) => value ? new Date(value) : null)
      .filter((value) => value && !Number.isNaN(value.getTime()));
    return candidates.reduce((current, value) => (!current || value > current ? value : current), latest);
  }, null);

  return {
    total: workforceProfiles.length,
    totalRecords: profiles.length,
    statusBreakdown,
    employmentTypes,
    departmentHeadcount,
    tenureDistribution: Object.entries(tenureRanges).map(([label, count]) => ({ label, count })),
    asOf: referenceDate.toISOString(),
    latestSourceUpdate: latestSourceUpdate?.toISOString() || null,
  };
}

module.exports = {
  buildDepartmentRoster,
  buildHeadcountAnalytics,
  currentDepartmentByUser,
  isCurrentWorkforceProfile,
  normalizeDepartment,
};
