const { AttendanceAccessPolicy } = require('../models');

const PERMISSIONS = Object.freeze({
    EMPLOYEE_VIEW: 'employee.view',
    CORRECTIONS_REQUEST: 'corrections.request',
    MANAGEMENT_VIEW: 'management.view',
    TEAM_VIEW: 'team.view',
    TIMESHEETS_APPROVE: 'timesheets.approve',
    CORRECTIONS_REVIEW: 'corrections.review',
    REPORTS_VIEW: 'reports.view',
    POLICY_VIEW: 'policy.view',
    POLICY_MANAGE: 'policy.manage',
    ACCESS_MANAGE: 'access.manage',
});

const EDITABLE_PERMISSIONS = Object.freeze([
    PERMISSIONS.MANAGEMENT_VIEW,
    PERMISSIONS.TEAM_VIEW,
    PERMISSIONS.TIMESHEETS_APPROVE,
    PERMISSIONS.CORRECTIONS_REVIEW,
    PERMISSIONS.REPORTS_VIEW,
    PERMISSIONS.POLICY_VIEW,
    PERMISSIONS.POLICY_MANAGE,
]);

const DEFAULT_ROLES = Object.freeze([
    {
        key: 'employee',
        name: 'Employee',
        description: 'Personal clock, timesheet and correction-request access.',
        scope: 'self',
        sourceRoles: ['employee'],
        permissions: [PERMISSIONS.EMPLOYEE_VIEW, PERMISSIONS.CORRECTIONS_REQUEST],
        locked: true,
    },
    {
        key: 'line_manager',
        name: 'Line Manager',
        description: 'Reviews direct reports, their timesheets and correction requests.',
        scope: 'reports',
        sourceRoles: ['line_manager', 'team_lead', 'department_head'],
        permissions: [
            PERMISSIONS.MANAGEMENT_VIEW,
            PERMISSIONS.TEAM_VIEW,
            PERMISSIONS.TIMESHEETS_APPROVE,
            PERMISSIONS.CORRECTIONS_REVIEW,
        ],
        locked: false,
    },
    {
        key: 'hr_manager',
        name: 'HR Manager',
        description: 'Organization-wide attendance review, corrections and reporting.',
        scope: 'organization',
        sourceRoles: ['hr_manager'],
        permissions: [
            PERMISSIONS.MANAGEMENT_VIEW,
            PERMISSIONS.TEAM_VIEW,
            PERMISSIONS.TIMESHEETS_APPROVE,
            PERMISSIONS.CORRECTIONS_REVIEW,
            PERMISSIONS.REPORTS_VIEW,
            PERMISSIONS.POLICY_VIEW,
        ],
        locked: false,
    },
    {
        key: 'attendance_admin',
        name: 'Attendance Admin',
        description: 'Full organization access, including attendance roles and permissions.',
        scope: 'organization',
        sourceRoles: ['owner', 'admin'],
        permissions: Object.values(PERMISSIONS),
        locked: true,
    },
]);

const cloneDefaults = () => DEFAULT_ROLES.map(role => ({ ...role, sourceRoles: [...role.sourceRoles], permissions: [...role.permissions] }));

async function getOrCreateAccessPolicy(organizationId, actor = {}) {
    let policy = await AttendanceAccessPolicy.findOne({ organizationId });
    if (policy) return policy;
    try {
        policy = await AttendanceAccessPolicy.create({
            organizationId,
            roles: cloneDefaults(),
            assignments: [],
            auditLog: [{
                action: 'default_roles_seeded',
                actorId: actor.id || 'system',
                actorName: actor.name || 'Attendance setup',
                details: 'Seeded Employee, Line Manager, HR Manager and Attendance Admin roles.',
            }],
            updatedBy: actor.id || 'system',
        });
        return policy;
    } catch (error) {
        if (error?.code === 11000) return AttendanceAccessPolicy.findOne({ organizationId });
        throw error;
    }
}

function identitySourceRoles(user, organizationId) {
    const sourceRoles = new Set(['employee']);
    const currentOrganization = user?.currentOrganization
        || (user?.organizations || []).find(org => String(org.id) === String(organizationId));
    if (currentOrganization?.role) sourceRoles.add(String(currentOrganization.role));
    for (const team of user?.teams || []) {
        if (String(team.organizationId) !== String(organizationId)) continue;
        if (team.role) sourceRoles.add(String(team.role));
    }
    const organizations = user?.organizations || user?.userinfo?.organizations || [];
    const current = organizations.find(org => String(org.id) === String(organizationId));
    if (Array.isArray(current?.departmentHeadPermissions) && current.departmentHeadPermissions.length) sourceRoles.add('department_head');
    return sourceRoles;
}

function effectiveAccessFromPolicy(policy, user, organizationId) {
    const sourceRoles = identitySourceRoles(user, organizationId);
    const assignment = (policy.assignments || []).find(item => String(item.userId) === String(user?.id));
    const assignedRoleKeys = new Set(assignment?.roleKeys || []);
    const activeRoles = (policy.roles || []).filter(role =>
        assignedRoleKeys.has(role.key) || (role.sourceRoles || []).some(sourceRole => sourceRoles.has(sourceRole))
    );
    const permissions = Array.from(new Set(activeRoles.flatMap(role => role.permissions || []))).sort();
    const scopes = {};
    for (const permission of permissions) {
        const permissionScopes = activeRoles.filter(role => (role.permissions || []).includes(permission)).map(role => role.scope);
        scopes[permission] = permissionScopes.includes('organization')
            ? 'organization'
            : permissionScopes.includes('reports') ? 'reports' : 'self';
    }
    return {
        roleKeys: activeRoles.map(role => role.key),
        roleNames: activeRoles.map(role => role.name),
        permissions,
        scopes,
        canAccessManagement: permissions.includes(PERMISSIONS.MANAGEMENT_VIEW),
        canManageAccess: permissions.includes(PERMISSIONS.ACCESS_MANAGE),
    };
}

async function getEffectiveAccess({ organizationId, user }) {
    const policy = await getOrCreateAccessPolicy(organizationId, user);
    return effectiveAccessFromPolicy(policy, user, organizationId);
}

async function hasAttendancePermission(req, permission) {
    if (!req.attendanceAccess) {
        req.attendanceAccess = await getEffectiveAccess({ organizationId: req.organizationId, user: req.user });
    }
    return req.attendanceAccess.permissions.includes(permission);
}

function requireAttendancePermission(permission) {
    return async (req, res, next) => {
        try {
            if (await hasAttendancePermission(req, permission)) return next();
            return res.status(403).json({ error: 'This attendance role does not include the required permission', code: 'ATTENDANCE_PERMISSION_REQUIRED', permission });
        } catch (error) {
            return next(error);
        }
    };
}

module.exports = {
    PERMISSIONS,
    EDITABLE_PERMISSIONS,
    DEFAULT_ROLES,
    getOrCreateAccessPolicy,
    getEffectiveAccess,
    effectiveAccessFromPolicy,
    hasAttendancePermission,
    requireAttendancePermission,
};
