export interface User {
  id: string;
  email: string;
  name: string;
  organizations: Organization[];
  teams: Team[];
  currentOrganization?: Organization;
}

export interface Organization {
  id: string;
  name: string;
  role: string;
  permissions?: string[];
  appPermissions?: Record<string, string[]>;
  teamPermissions?: string[];
}

export interface Team {
  id: string;
  name: string;
  organizationId: string;
  organizationName: string;
  parentTeamId?: string;
  parentTeamName?: string;
  hierarchyPath: string[];
  role: string;
  isManager: boolean;
  managerId?: string;
  directReports?: string[];
}

export interface LeaveRequest {
  _id: string;
  userId: string;
  userEmail: string;
  userName: string;
  organizationId: string;
  organizationName: string;
  teamId?: string;
  teamIds?: string[];
  teamName?: string;
  teamHierarchyPath?: string[];
  leaveType: LeaveType;
  leaveTypeName?: string;
  startDate: string;
  endDate: string;
  numberOfDays: number;
  reason?: string;
  timezone: string;
  status: LeaveStatus;
  assignedApprover?: {
    userId: string;
    userName: string;
    userEmail?: string;
    teamId?: string;
    assignedAt: string;
    assignmentType: string;
  };
  approvedBy?: {
    userId: string;
    userName: string;
    userEmail?: string;
    approvedAt: string;
    comment?: string;
    approvalType: string;
  };
  rejectedBy?: {
    userId: string;
    userName: string;
    userEmail?: string;
    rejectedAt: string;
    rejectionReason: string;
  };
  cancelledBy?: {
    userId: string;
    userName: string;
    cancelledAt: string;
    cancellationReason?: string;
  };
  auditLog: AuditLogEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface AuditLogEntry {
  action: string;
  performedBy: string;
  performedByName?: string;
  performedAt: string;
  details?: string;
}

export type LeaveType = string;

export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface LeaveBalance {
  _id: string;
  userId: string;
  userEmail: string;
  userName?: string;
  organizationId: string;
  year: number;
  entitlements: LeaveEntitlement[];
  annual?: BalanceType;
  sick?: BalanceType;
  personal?: BalanceType;
  maternity?: BalanceType;
  paternity?: BalanceType;
  unpaid?: BalanceType;
  timezone: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface BalanceType {
  total: number;
  used: number;
  remaining: number;
  pending: number;
}

export interface LeaveEntitlement extends BalanceType {
  leaveTypeKey: string;
  leaveTypeName: string;
  available: number;
  policyDefault: number;
  source: 'policy' | 'override';
  overrideReason?: string;
  lastAdjustedAt?: string | null;
  lastAdjustedBy?: string | null;
  active: boolean;
}

export interface LeaveTypeDefinition {
  key: string;
  name: string;
  description?: string;
  defaultDays: number;
  maxConsecutiveDays: number | null;
  effectiveMaxConsecutiveDays: number | null;
  maxConsecutiveDaysSource: 'leave_type' | 'entitlement' | 'organization';
  paid: boolean;
  active: boolean;
  requiresApproval: boolean | null;
  order: number;
  createdAt?: string | null;
  createdBy?: string | null;
  updatedAt?: string | null;
  updatedBy?: string | null;
}

export interface LeavePolicy {
  _id: string;
  organizationId: string;
  organizationName?: string;
  annualLeaveDays: number;
  sickLeaveDays: number;
  personalLeaveDays: number;
  maternityLeaveDays: number;
  paternityLeaveDays: number;
  unpaidLeaveDays: number;
  leaveTypes: LeaveTypeDefinition[];
  requiresApproval: boolean;
  approvalRoles: string[];
  autoApproveTypes: string[];
  maxConsecutiveDays: number;
  advanceNoticeDays: number;
  minLeaveDays: number;
  carryOverAllowed: boolean;
  maxCarryOverDays: number;
  timezone: string;
  workingDays: number[];
  holidays: Holiday[];
  accrualMethod: string;
  accrualDay: number;
  createdAt: string;
  updatedAt: string;
}

export interface LeaveMember {
  userId: string;
  accountId?: string;
  email: string;
  name: string;
  role: string;
  employeeId?: string | null;
  departmentId?: string | null;
  teamIds: string[];
  teamAssignments?: Array<{ teamId: string; name?: string; departmentId?: string | null; managerId?: string | null }>;
  managerId?: string | null;
  status: string;
  balance: LeaveBalance & { initialized?: boolean };
}

export interface LeaveEntitlementAdjustment {
  _id?: string;
  organizationId: string;
  userId: string;
  userName?: string;
  userEmail?: string;
  year: number;
  leaveTypeKey: string;
  leaveTypeName: string;
  operation?: 'add' | 'deduct' | 'set' | 'reset';
  previousTotal: number;
  newTotal: number;
  delta: number;
  reason: string;
  actorId: string;
  actorName?: string;
  actorEmail?: string;
  createdAt: string;
}

export interface OrganizationAuditLog {
  _id: string;
  action: string;
  resourceType: string;
  resourceId: string;
  performedBy: string;
  performedByName?: string;
  performedByEmail?: string;
  performedAt: string;
  details?: string;
  metadata?: Record<string, unknown>;
}

export interface CalendarDailyCoverage {
  date: string;
  approvedAway: number;
  pendingAway: number;
  approvedAwayPercent: number;
}

export interface CalendarCoverageSummary {
  totalWorkforce: number;
  peopleOnApprovedLeave: number;
  workforcePercentOnLeaveInPeriod: number;
  approvedRequests?: number;
  pendingRequests: number;
  peakAwayCount: number;
  peakAwayPercent: number;
  peakDate: string | null;
}

export interface TeamCalendarCoverage extends CalendarCoverageSummary {
  teamId: string;
  teamName: string;
  dailyCoverage: CalendarDailyCoverage[];
}

export interface Holiday {
  date: string;
  name: string;
  isRecurring: boolean;
}

export interface ApiResponse<T> {
  success?: boolean;
  error?: string;
  code?: string;
  data?: T;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}
