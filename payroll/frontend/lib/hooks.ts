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
  return res.data?.data || res.data;
};

// ============== USER CONTEXT HOOKS ==============

/**
 * Get comprehensive user context including role, teams, permissions
 * This is the primary hook for role-based UI rendering
 * Uses /auth/me which returns user info from IdP
 */
export function useUserContext() {
  const { data, error, isLoading, mutate } = useSWR('/auth/me', fetcher, defaultConfig);

  // Extract user from response
  const user = data?.user;
  
  // Get current organization - prefer full object from response (from IDP)
  const currentOrganization = data?.currentOrganization;
  const currentOrgId = currentOrganization?.id || data?.currentOrganizationId;

  // Find current organization from user's organizations (fallback)
  const currentOrg = currentOrganization || 
                     user?.organizations?.find((o: any) => o.id === currentOrgId || o.isCurrent) ||
                     user?.organizations?.[0];

  // Determine role from organization role
  const orgRole = currentOrg?.role || 'member';
  const isHRAdmin = ['owner', 'admin', 'hr_manager'].includes(orgRole);

  // Check team roles
  const teams = user?.teams || [];
  const isManager = teams.some((t: any) =>
    t.role === 'line_manager' && t.organizationId === currentOrgId
  );
  const isTeamLead = teams.some((t: any) =>
    t.role === 'team_lead' && t.organizationId === currentOrgId
  );

  // Get primary team (first team in current org)
  const primaryTeam = teams.find((t: any) => t.organizationId === currentOrgId);

  // Determine effective role
  let role = 'employee';
  let roleDisplay = 'Employee';
  if (isHRAdmin) {
    role = 'hr_admin';
    roleDisplay = orgRole === 'owner' ? 'Owner' : orgRole === 'admin' ? 'Admin' : 'HR Manager';
  } else if (isManager) {
    role = 'line_manager';
    roleDisplay = 'Line Manager';
  } else if (isTeamLead) {
    role = 'team_lead';
    roleDisplay = 'Team Lead';
  }

  // Format teams with additional info
  const formattedTeams = teams
    .filter((t: any) => t.organizationId === currentOrgId)
    .map((t: any) => ({
      ...t,
      roleDisplay: t.role?.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase())
    }));

  return {
    // User identity
    user: user ? {
      id: user.id || user.sub,
      sub: user.sub || user.id,
      email: user.email,
      name: user.name,
      organizations: user.organizations || [],
      teams: user.teams || [],
    } : null,

    // Role info
    role,
    roleDisplay,
    isManager,
    isHRAdmin,
    isTeamLead,

    // Organization
    organization: currentOrg ? {
      id: currentOrg.id,
      name: currentOrg.name,
      role: currentOrg.role,
    } : null,

    // Teams
    teams: formattedTeams,
    primaryTeam: primaryTeam ? {
      id: primaryTeam.id,
      name: primaryTeam.name,
      role: primaryTeam.role,
      roleDisplay: primaryTeam.role?.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase())
    } : null,

    // Manager-specific data
    managerData: isManager ? {
      directReportCount: 0, // Would need separate API call
      pendingReviews: 0,
    } : null,
    directReportCount: 0,
    pendingReviews: 0,

    // Stats
    stats: { myPayslips: 0, pendingRequests: 0, teamMembers: 0 },

    // Feature flags
    features: {},

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
  const { data, error, isLoading } = useSWR('/auth/me', fetcher, defaultConfig);

  const user = data?.user;
  const currentOrgId = data?.currentOrganizationId;

  const teams = (user?.teams || [])
    .filter((t: any) => t.organizationId === currentOrgId)
    .map((t: any) => ({
      ...t,
      roleDisplay: t.role?.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase())
    }));

  const currentOrg = user?.organizations?.find((o: any) => o.id === currentOrgId) ||
                     user?.organizations?.[0];

  return {
    teams,
    currentOrganization: currentOrg,
    isLoading,
    isError: error,
  };
}

/**
 * Get user's organizations (for organization switcher)
 * Organizations come from IDP via the auth/me endpoint
 */
export function useOrganizations() {
  const { data, error, isLoading, mutate } = useSWR('/auth/me', fetcher, {
    ...defaultConfig,
    dedupingInterval: 30000, // 30 seconds - orgs rarely change
  });

  // Extract organizations from auth/me response (these come from IDP)
  const organizations = data?.user?.organizations || [];

  // Get current organization - prefer full object from response
  const currentOrganization = data?.currentOrganization;
  const currentOrgId = currentOrganization?.id || data?.currentOrganizationId || organizations[0]?.id;

  // Map organizations with isCurrent flag (backend already adds this, but ensure consistency)
  const orgsWithCurrent = organizations.map((org: any) => ({
    id: org.id || org._id || org.organizationId,
    name: org.name || org.organizationName || 'Organization',
    slug: org.slug,
    logo: org.logo,
    role: org.role,
    isCurrent: org.isCurrent || (org.id || org._id || org.organizationId) === currentOrgId,
  }));

  return {
    organizations: orgsWithCurrent,
    currentOrganization: currentOrganization, // Full organization object from IDP
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
  const { data, error, isLoading } = useSWR('/auth/me', fetcher, defaultConfig);

  const user = data?.user;
  const currentOrgId = data?.currentOrganizationId;

  const teams = user?.teams || [];
  const managedTeams = teams.filter((t: any) =>
    t.organizationId === currentOrgId &&
    (t.role === 'line_manager' || t.role === 'team_lead')
  );

  const isManager = managedTeams.some((t: any) => t.role === 'line_manager');

  return {
    isManager,
    managedTeams,
    directReports: [], // Would need separate API call for actual direct reports
    totalDirectReports: 0,
    isLoading,
    isError: error,
  };
}

// ============== DATA HOOKS ==============

/**
 * Get dashboard summary data
 */
export function useDashboardData() {
  const { data, error, isLoading } = useSWR('/dashboard/summary', fetcher, defaultConfig);
  return {
    dashboard: data,
    isLoading,
    isError: error,
  };
}

/**
 * Get payslips for current user
 */
export function useMyPayslips(filters?: { month?: number; year?: number; status?: string }) {
  const queryParams = new URLSearchParams();
  if (filters?.month) queryParams.append('month', String(filters.month));
  if (filters?.year) queryParams.append('year', String(filters.year));
  if (filters?.status) queryParams.append('status', filters.status);

  const url = `/payroll/my-payslips${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
  const { data, error, isLoading, mutate } = useSWR(url, fetcher, defaultConfig);

  return {
    payslips: Array.isArray(data) ? data : data?.payslips || data || [],
    isLoading,
    isError: error,
    mutate,
  };
}

/**
 * Get compensation requests for my team (manager view)
 */
export function useTeamCompensationRequests(filters?: { status?: string; type?: string }) {
  const queryParams = new URLSearchParams();
  if (filters?.status) queryParams.append('status', filters.status);
  if (filters?.type) queryParams.append('type', filters.type);

  const url = `/compensation/team${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
  const { data, error, isLoading, mutate } = useSWR(url, fetcher, defaultConfig);

  return {
    requests: Array.isArray(data) ? data : data?.requests || data || [],
    isLoading,
    isError: error,
    userRole: data?.userRole,
    mutate,
  };
}

/**
 * Get pending approvals (manager/admin view)
 */
export function usePendingApprovals() {
  const { data, error, isLoading, mutate } = useSWR('/compensation/approvals', fetcher, defaultConfig);

  return {
    approvals: data || [],
    count: data?.length || 0,
    isLoading,
    isError: error,
    mutate,
  };
}

// ============== PAYROLL RUN HOOKS ==============

/**
 * Get all payroll runs (admin view)
 */
export function usePayrollRuns(filters?: { year?: number; status?: string }) {
  const queryParams = new URLSearchParams();
  if (filters?.year) queryParams.append('year', String(filters.year));
  if (filters?.status) queryParams.append('status', filters.status);

  const url = `/payroll/runs${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
  const { data, error, isLoading, mutate } = useSWR(url, fetcher, defaultConfig);

  return {
    runs: data || [],
    isLoading,
    isError: error,
    mutate,
  };
}

/**
 * Get payroll run by ID
 */
export function usePayrollRun(runId?: string) {
  const url = runId ? `/payroll/runs/${runId}` : null;
  const { data, error, isLoading } = useSWR(url, fetcher, defaultConfig);

  return {
    run: data,
    isLoading,
    isError: error,
  };
}

// ============== COMPENSATION REQUEST HOOKS ==============

/**
 * Get compensation request by ID
 */
export function useCompensationRequest(requestId?: string) {
  const url = requestId ? `/compensation/request/${requestId}` : null;
  const { data, error, isLoading, mutate } = useSWR(url, fetcher, defaultConfig);

  return {
    request: data,
    isLoading,
    isError: error,
    mutate,
  };
}

// ============== SALARY GRADE HOOKS ==============

/**
 * Get all salary grades
 */
export function useSalaryGrades() {
  const { data, error, isLoading, mutate } = useSWR('/salary/grades', fetcher, defaultConfig);

  return {
    grades: data || [],
    isLoading,
    isError: error,
    mutate,
  };
}

// ============== PAYROLL PROFILE HOOKS ==============

/**
 * Get payroll profile for current user
 */
export function usePayrollProfile(userId?: string) {
  const url = userId ? `/payroll/profile/${userId}` : '/payroll/profile/my';
  const { data, error, isLoading, mutate } = useSWR(url, fetcher, defaultConfig);

  return {
    profile: data,
    isLoading,
    isError: error,
    mutate,
  };
}

// ============== REPORTS HOOKS ==============

/**
 * Get payroll report by ID
 */
export function usePayrollReport(reportId?: string) {
  const url = reportId ? `/reports/${reportId}` : null;
  const { data, error, isLoading, mutate } = useSWR(url, fetcher, defaultConfig);

  return {
    report: data,
    isLoading,
    isError: error,
    mutate,
  };
}
