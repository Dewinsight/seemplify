export type AdminRecordStatus = 'active' | 'suspended' | 'disabled' | 'archived' | 'pending' | 'approved' | 'rejected' | 'cancelled' | string;

export type PlatformPermissionId =
  | 'users.read'
  | 'users.create'
  | 'users.manage'
  | 'roles.read'
  | 'roles.manage'
  | 'spaces.read'
  | 'spaces.manage'
  | 'subscriptions.read'
  | 'subscriptions.manage'
  | 'analytics.read'
  | 'ai_defaults.read'
  | 'ai_defaults.manage'
  | 'jobs.read'
  | 'activity.read'
  | 'audit.read';

export type PlatformAdminCapability = PlatformPermissionId;

export interface PlatformAdminCapabilities {
  readPlatform?: boolean;
  readUsers?: boolean;
  createUsers?: boolean;
  manageAccounts?: boolean;
  readRoles?: boolean;
  manageRoles?: boolean;
  readSpaces?: boolean;
  manageSpaces?: boolean;
  readSubscriptions?: boolean;
  manageSubscriptions?: boolean;
  decideSubscriptions?: boolean;
  readAnalytics?: boolean;
  readAiDefaults?: boolean;
  manageAiDefaults?: boolean;
  readJobs?: boolean;
  readActivity?: boolean;
  readAudit?: boolean;
}

export interface PlatformAdminMe {
  user: { id: string; name: string; email: string };
  roles: string[];
  permissions?: PlatformPermissionId[];
  adminRoles?: string[];
  adminPermissions?: PlatformPermissionId[];
  isRoot?: boolean;
  root?: boolean;
  capabilities: PlatformAdminCapabilities;
}

const legacyPermissionCapability: Record<PlatformPermissionId, keyof PlatformAdminCapabilities> = {
  'users.read': 'readUsers',
  'users.create': 'createUsers',
  'users.manage': 'manageAccounts',
  'roles.read': 'readRoles',
  'roles.manage': 'manageRoles',
  'spaces.read': 'readSpaces',
  'spaces.manage': 'manageSpaces',
  'subscriptions.read': 'readSubscriptions',
  'subscriptions.manage': 'manageSubscriptions',
  'analytics.read': 'readAnalytics',
  'ai_defaults.read': 'readAiDefaults',
  'ai_defaults.manage': 'manageAiDefaults',
  'jobs.read': 'readJobs',
  'activity.read': 'readActivity',
  'audit.read': 'readAudit'
};

export function platformAdminHasPermission(access: PlatformAdminMe | null | undefined, permission: PlatformPermissionId) {
  if (!access) return false;
  if (access.root || access.isRoot) return true;
  const permissions = access.permissions || access.adminPermissions || [];
  if (permissions.includes(permission)) return true;
  const legacy = legacyPermissionCapability[permission];
  if (access.capabilities?.[legacy]) return true;
  // Older servers exposed role management without a separate read flag.
  if (permission === 'roles.read' && access.capabilities?.manageRoles) return true;
  if (permission === 'subscriptions.manage' && access.capabilities?.decideSubscriptions) return true;
  return false;
}

export interface PlatformPermissionDefinition {
  id: PlatformPermissionId;
  label: string;
  description: string;
}

export interface PlatformAdminRole {
  id: string;
  name: string;
  description: string;
  builtIn: boolean;
  version: number;
  permissions: PlatformPermissionId[];
  createdAt: string;
  updatedAt: string;
}

export interface PlatformRbacCatalog {
  permissions: PlatformPermissionDefinition[];
  roles: PlatformAdminRole[];
}

export interface PlatformAdminRoleAssignment {
  id: string;
  roleId: string;
  roleName: string;
  active: boolean;
  assignedByUserId: string | null;
  assignedAt: string;
  revokedByUserId: string | null;
  revokedAt: string | null;
  reason: string;
  revocationReason?: string | null;
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
  adminRoles: string[];
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
  adminRoleAssignments: PlatformAdminRoleAssignment[];
}

export interface PlatformManagedPlan extends PlatformPlan {
  code: 'starter' | 'team' | 'enterprise';
  name: string;
  description: string;
  requestable: boolean;
  features: {
    surveys: boolean;
    campaigns: boolean;
    agreements: boolean;
    serviceRecovery: boolean;
    socialListening: boolean;
    knowledgeBases: boolean;
    terra: boolean;
  };
  limits: {
    seats: number;
    activeSurveys: number;
    monthlyAiActions: number;
    knowledgeStorageBytes: number;
  };
  displayOrder: number;
  version: number;
  createdAt: string | null;
  updatedAt: string | null;
  activeSubscriptions: number;
  pendingRequests: number;
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

export interface PlatformAdminJob {
  id: string;
  kind: string;
  state: AdminRecordStatus;
  stage: string;
  progress: number;
  attempt: number;
  requester: { id: string; name: string; email?: string } | null;
  requesterRestricted?: boolean;
  space: { id: string; name: string } | null;
  runtime: {
    source: string | null;
    status: 'actual' | 'planned' | 'unknown';
    provider: string | null;
    providerLabel: string | null;
    model: string | null;
    reasoningEffort: string | null;
    actionId: string | null;
  };
  retryAt: string | null;
  error: { code: string; message: string } | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
}

export interface PlatformAdminJobSummary {
  total: number;
  active: number;
  failed: number;
  byState: Record<string, number>;
}

export interface PlatformActivityItem {
  id: string;
  type: string;
  entityType: string;
  entityId: string;
  status: AdminRecordStatus | null;
  kind: string | null;
  actor: { id: string; name: string; email?: string } | null;
  actorRestricted?: boolean;
  space: { id: string; name: string } | null;
  occurredAt: string;
}

export interface PlatformCodexModel {
  id: string;
  displayName: string;
  isDefault: boolean;
  defaultReasoningEffort?: string;
  supportedReasoningEfforts?: Array<{ reasoningEffort: string; description?: string }>;
}

export interface PlatformCodexAction {
  id: string;
  group: string;
  label: string;
  description: string;
  defaultReasoningEffort: string;
}

export interface PlatformCodexActionOverride {
  model: string | null;
  reasoningEffort: string | null;
  reasoningEffortAuto?: true;
}

export interface PlatformAiDefaults {
  codexModel: string | null;
  codexReasoningEffort: string | null;
  codexActionOverrides: Record<string, PlatformCodexActionOverride>;
  runtimePolicy: {
    localEnabled: boolean;
    chatgptEnabled: boolean;
    defaultRuntime: 'local' | 'chatgpt';
  };
  updatedAt: string | null;
}

export interface PlatformAiDefaultsState {
  defaults: PlatformAiDefaults;
  codex: {
    available: boolean;
    account: {
      connected: boolean;
      email: string | null;
      planType: string | null;
      authMode?: string | null;
      pendingLogin?: boolean;
      loginError?: string | null;
    };
    models: PlatformCodexModel[];
    actions: PlatformCodexAction[];
    error: string | null;
  };
}
