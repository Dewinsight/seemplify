import useSWR, { SWRConfiguration } from 'swr';
import api from './api';

// Default SWR config to prevent too frequent revalidation
const defaultConfig: SWRConfiguration = {
  revalidateOnFocus: false,
  revalidateOnReconnect: false,
  dedupingInterval: 10000, // 10 seconds
  errorRetryCount: 2,
};

// API returns { success: true, data: [...] } so we extract .data
const fetcher = async (url: string) => {
  const res = await api.get(url);
  // Handle both direct data and wrapped { data: [...] } responses
  return res.data?.data || res.data;
};

// ============== USER CONTEXT HOOKS ==============

/**
 * Get comprehensive user context including role, teams, permissions
 * This is the primary hook for role-based UI rendering
 */
export function useUserContext() {
  const { data, error, isLoading, mutate } = useSWR('/user/context', fetcher, defaultConfig);

  return {
    // User identity
    user: data?.user,

    // Role info
    role: data?.role?.name || 'employee',
    roleDisplay: data?.role?.displayName || 'Employee',
    isManager: data?.role?.isManager || false,
    isHRAdmin: data?.role?.isHRAdmin || false,
    isTeamLead: data?.role?.isTeamLead || false,

    // Organization
    organization: data?.organization,

    // Teams
    teams: data?.teams || [],
    primaryTeam: data?.primaryTeam,
    currentTeam: data?.currentTeam,

    // Manager-specific data
    managerData: data?.managerData,
    directReportCount: data?.managerData?.directReportCount || 0,
    pendingReviews: data?.managerData?.pendingReviews || 0,

    // Stats
    stats: data?.stats || { myOkrs: 0, myReviews: 0, feedbackReceived: 0 },

    // Feature flags
    features: data?.features || {},

    // SWR state
    isLoading,
    isError: error,
    mutate,
  };
}

/**
 * Get user's teams with full hierarchy info
 */
export function useUserTeams() {
  const { data, error, isLoading } = useSWR('/user/teams', fetcher);
  return {
    teams: data?.teams || [],
    currentOrganization: data?.currentOrganization,
    isLoading,
    isError: error,
  };
}

/**
 * Get current team information
 */
export function useCurrentTeam() {
  const { data, error, isLoading, mutate } = useSWR('/user/current-team', fetcher, defaultConfig);
  return {
    currentTeam: data?.currentTeam,
    availableTeams: data?.availableTeams || [],
    isLoading,
    isError: error,
    mutate,
  };
}

/**
 * Get user's organizations (for organization switcher)
 * Falls back to auth/me if user/organizations fails
 */
export function useOrganizations() {
  const { data, error, isLoading, mutate } = useSWR('/auth/me', fetcher, {
    ...defaultConfig,
    dedupingInterval: 30000, // 30 seconds - orgs rarely change
  });

  // Extract organizations from auth/me response
  // The auth/me endpoint returns user data with idpOrganizations
  const organizations = data?.user?.idpOrganizations ||
    data?.user?.organizations ||
    data?.organizations ||
    [];

  // Find current organization
  const currentOrgId = data?.currentOrganizationId ||
    data?.user?.currentOrganization?.id ||
    (organizations[0]?.id);

  // Mark current organization
  const orgsWithCurrent = organizations.map((org: any) => ({
    id: org.id || org._id || org.organizationId,
    name: org.name || org.organizationName || 'Organization',
    slug: org.slug,
    logo: org.logo,
    role: org.role,
    isCurrent: (org.id || org._id || org.organizationId) === currentOrgId
  }));

  return {
    organizations: orgsWithCurrent,
    currentOrganizationId: currentOrgId,
    isLoading,
    isError: error,
    mutate,
  };
}

/**
 * Get direct reports for managers
 */
export function useDirectReports() {
  const { data, error, isLoading } = useSWR('/user/my-team-members', fetcher);
  return {
    isManager: data?.isManager || false,
    managedTeams: data?.teams || [],
    directReports: data?.directReports || [],
    totalDirectReports: data?.totalDirectReports || 0,
    isLoading,
    isError: error,
  };
}

/**
 * Search users (for feedback, peer review selection)
 */
export function useUserSearch(query: string) {
  const { data, error, isLoading } = useSWR(
    query && query.length >= 2 ? `/user/search?q=${encodeURIComponent(query)}` : null,
    fetcher
  );
  return {
    users: data || [],
    isLoading,
    isError: error,
  };
}

// ============== DATA HOOKS ==============

/**
 * Get dashboard summary data
 */
export function useDashboardData(teamId?: string) {
  const url = teamId && teamId !== 'all' 
    ? `/dashboard/summary?teamId=${teamId}` 
    : teamId === 'all'
      ? '/dashboard/summary?allTeams=true'
      : '/dashboard/summary';
  
  const { data, error, isLoading } = useSWR(url, fetcher, defaultConfig);
  return {
    dashboard: data,
    isLoading,
    isError: error,
  };
}

/**
 * Get OKRs - returns different data based on user role
 */
export function useOkrs(filters?: { type?: string; status?: string; period?: string }) {
  const queryParams = new URLSearchParams();
  if (filters?.type) queryParams.append('type', filters.type);
  if (filters?.status) queryParams.append('status', filters.status);
  if (filters?.period) queryParams.append('period', filters.period);

  const url = `/okrs${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
  const { data, error, isLoading, mutate } = useSWR(url, fetcher);

  return {
    okrs: Array.isArray(data) ? data : data?.data || [],
    userRole: data?.userRole,
    isLoading,
    isError: error,
    mutate,
  };
}

/**
 * Get direct reports' OKRs (for managers)
 */
export function useDirectReportsOkrs() {
  const { data, error, isLoading } = useSWR('/okrs/direct-reports', fetcher);
  return {
    okrsByUser: data || {},
    directReportCount: data?.directReportCount || 0,
    isLoading,
    isError: error,
  };
}

/**
 * Get performance reviews
 */
export function useReviews(filters?: { cycleId?: string; status?: string }) {
  const queryParams = new URLSearchParams();
  if (filters?.cycleId) queryParams.append('cycleId', filters.cycleId);
  if (filters?.status) queryParams.append('status', filters.status);

  const url = `/reviews${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
  const { data, error, isLoading, mutate } = useSWR(url, fetcher);

  return {
    reviews: Array.isArray(data) ? data : data?.data || [],
    userRole: data?.userRole,
    isLoading,
    isError: error,
    mutate,
  };
}

/**
 * Get pending reviews for managers
 */
export function usePendingReviews() {
  const { data, error, isLoading } = useSWR('/reviews/pending', fetcher);
  return {
    pendingReviews: data || [],
    count: data?.length || 0,
    isLoading,
    isError: error,
  };
}

/**
 * Get direct reports' review status (for managers)
 */
export function useDirectReportsReviews(cycleId?: string) {
  const url = cycleId ? `/reviews/direct-reports?cycleId=${cycleId}` : '/reviews/direct-reports';
  const { data, error, isLoading } = useSWR(url, fetcher);
  return {
    reviewsByUser: data || {},
    directReportCount: data?.directReportCount || 0,
    isLoading,
    isError: error,
  };
}

/**
 * Get review cycles
 */
export function useReviewCycles() {
  const { data, error, isLoading, mutate } = useSWR('/reviews/cycles', fetcher);
  return {
    cycles: data || [],
    isLoading,
    isError: error,
    mutate,
  };
}

/**
 * Get feedback
 */
export function useFeedback(filters?: { type?: string }) {
  const url = filters?.type ? `/feedback?type=${filters.type}` : '/feedback';
  const { data, error, isLoading, mutate } = useSWR(url, fetcher);

  return {
    feedback: Array.isArray(data) ? data : data?.data || [],
    userRole: data?.userRole,
    isLoading,
    isError: error,
    mutate,
  };
}

/**
 * Get feedback received by current user
 */
export function useFeedbackReceived() {
  const { data, error, isLoading } = useSWR('/feedback/received', fetcher);
  return {
    feedback: data || [],
    isLoading,
    isError: error,
  };
}

/**
 * Get feedback for direct reports (managers)
 */
export function useDirectReportsFeedback() {
  const { data, error, isLoading } = useSWR('/feedback/direct-reports', fetcher);
  return {
    feedbackByUser: data || {},
    directReportCount: data?.directReportCount || 0,
    isLoading,
    isError: error,
  };
}

/**
 * Get team analytics
 */
export function useTeamAnalytics(teamId: string) {
  const { data, error, isLoading } = useSWR(
    teamId ? `/analytics/team/${teamId}` : null,
    fetcher
  );
  return {
    analytics: data,
    isLoading,
    isError: error,
  };
}

/**
 * Get dashboard analytics (for managers)
 */
export function useDashboardAnalytics() {
  const { data, error, isLoading } = useSWR('/analytics/dashboard', fetcher);
  return {
    analytics: data,
    isLoading,
    isError: error,
  };
}

// ============== 1:1 MEETINGS HOOKS ==============

/**
 * Get 1:1 meetings
 */
export function useOneOnOnes(filters?: { status?: string; upcoming?: boolean }) {
  const queryParams = new URLSearchParams();
  if (filters?.status) queryParams.append('status', filters.status);
  if (filters?.upcoming !== undefined) queryParams.append('upcoming', String(filters.upcoming));

  const url = `/one-on-ones${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
  const { data, error, isLoading, mutate } = useSWR(url, fetcher);

  return {
    meetings: data || [],
    isLoading,
    isError: error,
    mutate,
  };
}

/**
 * Get upcoming 1:1 meetings
 */
export function useUpcoming1on1s() {
  const { data, error, isLoading } = useSWR('/one-on-ones?upcoming=true', fetcher);
  return {
    meetings: data || [],
    isLoading,
    isError: error,
  };
}

// ============== DEVELOPMENT PLANS HOOKS ==============

/**
 * Get development plans
 */
export function useDevelopmentPlans(filters?: { status?: string }) {
  const url = filters?.status ? `/development-plans?status=${filters.status}` : '/development-plans';
  const { data, error, isLoading, mutate } = useSWR(url, fetcher);

  return {
    plans: data || [],
    isLoading,
    isError: error,
    mutate,
  };
}

/**
 * Get a specific development plan
 */
export function useDevelopmentPlan(planId?: string) {
  const { data, error, isLoading, mutate } = useSWR(
    planId ? `/development-plans/${planId}` : null,
    fetcher
  );

  return {
    plan: data,
    isLoading,
    isError: error,
    mutate,
  };
}

// ============== CALIBRATION HOOKS ==============

/**
 * Get calibration sessions (HR Admin only)
 */
export function useCalibrationSessions(cycleId?: string) {
  const url = cycleId ? `/calibration?reviewCycleId=${cycleId}` : '/calibration';
  const { data, error, isLoading, mutate } = useSWR(url, fetcher);

  return {
    sessions: data || [],
    isLoading,
    isError: error,
    mutate,
  };
}

/**
 * Get a specific calibration session
 */
export function useCalibrationSession(sessionId?: string) {
  const { data, error, isLoading, mutate } = useSWR(
    sessionId ? `/calibration/${sessionId}` : null,
    fetcher
  );

  return {
    session: data,
    isLoading,
    isError: error,
    mutate,
  };
}

// ============== REPORTS HOOKS ==============

/**
 * Get organization summary report (HR Admin)
 */
export function useOrgSummaryReport() {
  const { data, error, isLoading } = useSWR('/reports/org-summary', fetcher);
  return {
    report: data,
    isLoading,
    isError: error,
  };
}

/**
 * Get team performance report
 */
export function useTeamPerformanceReport() {
  const { data, error, isLoading } = useSWR('/reports/team-performance', fetcher);
  return {
    report: data,
    isLoading,
    isError: error,
  };
}

/**
 * Get individual performance report
 */
export function useIndividualReport(userId?: string) {
  const { data, error, isLoading } = useSWR(
    userId ? `/reports/individual/${userId}` : null,
    fetcher
  );
  return {
    report: data,
    isLoading,
    isError: error,
  };
}

/**
 * Get review cycle report
 */
export function useReviewCycleReport(cycleId?: string) {
  const { data, error, isLoading } = useSWR(
    cycleId ? `/reports/review-cycle/${cycleId}` : null,
    fetcher
  );
  return {
    report: data,
    isLoading,
    isError: error,
  };
}

// ============== OKR ALIGNMENT HOOKS ==============

/**
 * Get aligned OKRs (for cascade view)
 */
export function useAlignedOkrs() {
  const { data, error, isLoading } = useSWR('/okrs?includeAligned=true', fetcher);
  return {
    okrs: data || [],
    isLoading,
    isError: error,
  };
}

// ============== APPRAISAL HOOKS ==============

/**
 * Get appraisal cycles
 */
export function useAppraisalCycles(filters?: { status?: string; year?: number }) {
  const queryParams = new URLSearchParams();
  if (filters?.status) queryParams.append('status', filters.status);
  if (filters?.year) queryParams.append('year', String(filters.year));

  const url = `/appraisals/cycles${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
  const { data, error, isLoading, mutate } = useSWR(url, fetcher);

  return {
    cycles: data || [],
    isLoading,
    isError: error,
    mutate,
  };
}

/**
 * Get my appraisals (as employee)
 */
export function useMyAppraisals(filters?: { status?: string; cycleId?: string }) {
  const queryParams = new URLSearchParams();
  if (filters?.status) queryParams.append('status', filters.status);
  if (filters?.cycleId) queryParams.append('cycleId', filters.cycleId);

  const url = `/appraisals/my${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
  const { data, error, isLoading, mutate } = useSWR(url, fetcher);

  return {
    appraisals: Array.isArray(data) ? data : (data?.appraisals || data || []),
    isLoading,
    isError: error,
    mutate,
  };
}

/**
 * Get team appraisals (as manager)
 */
export function useTeamAppraisals(filters?: { status?: string; cycleId?: string }) {
  const queryParams = new URLSearchParams();
  if (filters?.status) queryParams.append('status', filters.status);
  if (filters?.cycleId) queryParams.append('cycleId', filters.cycleId);

  const url = `/appraisals/team${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
  const { data, error, isLoading, mutate } = useSWR(url, fetcher);

  return {
    appraisals: Array.isArray(data) ? data : (data?.appraisals || data || []),
    isLoading,
    isError: error,
    mutate,
  };
}

/**
 * Get a specific appraisal by ID
 * Backend returns: { success: true, data: appraisal, okrs, accessLevel }
 * Fetcher extracts: res.data?.data (the appraisal object)
 */
export function useAppraisal(appraisalId?: string) {
  const { data, error, isLoading, mutate } = useSWR(
    appraisalId ? `/appraisals/${appraisalId}` : null,
    fetcher
  );

  return {
    appraisal: data,
    isLoading,
    isError: error,
    mutate,
  };
}

/**
 * Get appraisal chat thread
 */
export function useAppraisalChat(appraisalId?: string) {
  const { data, error, isLoading, mutate } = useSWR(
    appraisalId ? `/appraisals/${appraisalId}/chat` : null,
    fetcher
  );

  return {
    messages: data?.chatThread || [],
    isLoading,
    isError: error,
    mutate,
  };
}

// Legacy exports for backwards compatibility
export function useCurrentUser() {
  return useUserContext();
}
