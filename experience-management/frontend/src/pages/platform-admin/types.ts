export type AdminRecordStatus = 'active' | 'suspended' | 'disabled' | 'archived' | 'pending' | 'approved' | 'rejected' | 'cancelled' | string;

export type PlatformAdminCapability =
  | 'readUsers'
  | 'readSpaces'
  | 'readSubscriptions'
  | 'readAnalytics'
  | 'readAudit';

export interface PlatformAdminCapabilities {
  readUsers: boolean;
  readSpaces: boolean;
  readSubscriptions: boolean;
  readAnalytics: boolean;
  readAudit: boolean;
  manageAccounts: boolean;
  manageRoles: boolean;
  manageSpaces: boolean;
  decideSubscriptions: boolean;
}

export interface PlatformAdminMe {
  user: { id: string; name: string; email: string };
  roles: string[];
  isRoot?: boolean;
  root?: boolean;
  capabilities: PlatformAdminCapabilities;
}

export interface PlatformPlan {
  code: string;
  name: string;
  description?: string;
  requestable?: boolean;
  features?: Record<string, boolean>;
  limits?: Record<string, number>;
}

export interface PlatformSubscription {
  id: string;
  spaceId: string;
  planCode: string;
  plan: PlatformPlan | null;
  status: AdminRecordStatus;
  features: Record<string, unknown>;
  limits: Record<string, unknown>;
  sourceRequestId: string | null;
  effectiveAt: string | null;
  expiresAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  space?: { id: string; name: string };
}

export interface PlatformUserSummary {
  id: string;
  name: string;
  email: string;
  accountStatus: AdminRecordStatus;
  emailVerified: boolean;
  onboardingCompleted: boolean;
  platformRoles: string[];
  spaceCount: number;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
  rootPlatformAdmin?: boolean;
}

export interface PlatformUserDetail {
  user: PlatformUserSummary;
  memberships: Array<{
    space: { id: string; name: string; slug: string; status: AdminRecordStatus };
    role: string;
    joinedAt: string;
  }>;
  roleAssignments: Array<{
    id: string;
    role: string;
    active: boolean;
    grantedByUserId: string | null;
    grantedAt: string;
    revokedByUserId: string | null;
    revokedAt: string | null;
    reason: string;
  }>;
}

export interface PlatformSpaceSummary {
  id: string;
  name: string;
  slug: string;
  status: AdminRecordStatus;
  personal: boolean;
  memberCount: number;
  owner: { id: string; name: string } | null;
  subscription: { id: string; planCode: string; status: AdminRecordStatus; version: number } | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlatformSpaceDetail {
  space: PlatformSpaceSummary;
  members: Array<{ id: string; name: string; email: string; role: string; joinedAt: string }>;
  subscription: PlatformSubscription | null;
  counts: {
    surveys: number;
    responses: number;
    campaigns: number;
    agreements: number;
    aiJobs: number;
    openTickets: number;
    knowledgeBases: number;
  };
}

export interface PlatformSubscriptionRequest {
  id: string;
  spaceId: string;
  requestType: string;
  requestedPlanCode: string | null;
  requestedPlan: PlatformPlan | null;
  requestNote: string;
  status: AdminRecordStatus;
  requestedBy: { id: string; name: string; email?: string } | null;
  reviewedBy: { id: string; name: string } | null;
  reviewNote: string;
  decisionAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  space?: { id: string; name: string };
}

export interface PlatformSubscriptionRequestDetail {
  request: PlatformSubscriptionRequest;
  subscription: PlatformSubscription | null;
  decisionConflict?: {
    conflicted: boolean;
    reasons: string[];
    breakGlassRequired: boolean;
    approvalForbidden: boolean;
  };
}

export interface PlatformAuditEvent {
  id: string;
  actor: { id: string; name: string } | null;
  actorRole: string;
  action: string;
  targetType: string;
  targetId: string;
  spaceId: string | null;
  reason: string;
  requestId: string;
  createdAt: string;
  before?: unknown;
  after?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface PlatformOverview {
  generatedAt: string;
  accounts: { total: number; active: number; restricted: number; unverified: number; new30d: number };
  spaces: { total: number; active: number; restricted: number };
  subscriptions: { active: number; suspended: number; cancelled: number; pendingRequests: number };
  product: {
    surveys: number;
    responses: number;
    campaigns: number;
    agreements: number;
    aiJobs: number;
    aiFailures: number;
    openTickets: number;
    knowledgeBases: number;
  };
  aiQueue: Record<string, number>;
}

export interface PlatformAnalyticsSeries {
  from: string;
  to: string;
  series: Array<{
    day: string;
    accounts: number;
    spaces: number;
    responses: number;
    aiJobs: number;
    agreements: number;
    campaigns: number;
  }>;
}
