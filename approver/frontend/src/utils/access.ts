export interface RoleDefinition {
    _id?: string;
    key: string;
    name: string;
    description?: string;
    capabilities: string[];
    isSystem?: boolean;
    isActive?: boolean;
}

export interface OrgPermission {
    department: { _id: string; name?: string } | string;
    roles?: string[];
    role?: string;
}

export interface OrgAccessContext {
    isAdmin?: boolean;
    permissions?: OrgPermission[];
    roles?: RoleDefinition[];
    capabilities?: string[];
}

const LEGACY_ROLE_CAPABILITIES: Record<string, string[]> = {
    Requester: ['projects.submit'],
    CenterOfExcellence: ['projects.review.coe', 'dashboard.review', 'scoring.manage'],
    GovernanceApprover: ['projects.review.governance', 'rules.manage', 'projects.override', 'dashboard.review', 'scoring.manage'],
    ExecutiveApprover: [
        'projects.review.executive',
        'projects.review.governance',
        'rules.manage',
        'rules.manage.system',
        'projects.override',
        'dashboard.review',
        'scoring.manage'
    ]
};

const LEGACY_ROLE_LABELS: Record<string, string> = {
    Requester: 'Requester',
    CenterOfExcellence: 'Center of Excellence',
    GovernanceApprover: 'Governance Approver',
    ExecutiveApprover: 'Executive Approver'
};

const toRoleArray = (permission: OrgPermission): string[] => {
    const roles = Array.isArray(permission.roles)
        ? permission.roles
        : (permission.role ? [permission.role] : []);
    return roles.map(role => role.trim()).filter(Boolean);
};

const getDepartmentId = (permission: OrgPermission): string | null => {
    if (!permission.department) return null;
    if (typeof permission.department === 'string') return permission.department;
    return permission.department._id || null;
};

const tokenMatches = (capability: string, required: string): boolean => {
    if (required.endsWith('*')) {
        const prefix = required.slice(0, -1);
        return capability.startsWith(prefix);
    }
    return capability === required;
};

const buildRoleCapabilityMap = (organization: OrgAccessContext | null | undefined): Record<string, string[]> => {
    const map: Record<string, string[]> = { ...LEGACY_ROLE_CAPABILITIES };
    (organization?.roles || []).forEach((role) => {
        map[role.key] = Array.isArray(role.capabilities) ? role.capabilities : [];
    });
    return map;
};

export const getOrganizationRoles = (organization: OrgAccessContext | null | undefined): RoleDefinition[] => {
    if (!organization?.roles || organization.roles.length === 0) {
        return Object.keys(LEGACY_ROLE_LABELS).map((key) => ({
            key,
            name: LEGACY_ROLE_LABELS[key],
            capabilities: LEGACY_ROLE_CAPABILITIES[key] || [],
            isSystem: true,
            isActive: true
        }));
    }

    return organization.roles
        .filter(role => role.isActive !== false)
        .sort((a, b) => a.name.localeCompare(b.name));
};

export const formatRoleLabel = (organization: OrgAccessContext | null | undefined, roleKey: string): string => {
    const role = (organization?.roles || []).find((r) => r.key === roleKey);
    if (role) return role.name;
    return LEGACY_ROLE_LABELS[roleKey] || roleKey;
};

export const hasAnyCapability = (
    organization: OrgAccessContext | null | undefined,
    requiredCapabilities: string[],
    departmentId?: string | null
): boolean => {
    if (!organization) return false;
    if (organization.isAdmin) return true;
    if (!requiredCapabilities.length) return true;

    const roleCapabilityMap = buildRoleCapabilityMap(organization);
    const permissions = organization.permissions || [];

    return permissions.some((permission) => {
        const permissionDepartmentId = getDepartmentId(permission);
        const deptMatches = !departmentId || permissionDepartmentId === departmentId;
        if (!deptMatches) return false;

        const permissionCapabilities = toRoleArray(permission)
            .flatMap((roleKey) => roleCapabilityMap[roleKey] || []);

        return permissionCapabilities.some((capability) =>
            requiredCapabilities.some((required) => tokenMatches(capability, required))
        );
    });
};

export const hasCapability = (
    organization: OrgAccessContext | null | undefined,
    requiredCapability: string,
    departmentId?: string | null
): boolean => {
    return hasAnyCapability(organization, [requiredCapability], departmentId);
};
