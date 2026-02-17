const LEGACY_ROLE_CAPABILITIES = {
    Requester: ['projects.submit'],
    CenterOfExcellence: ['projects.review.coe', 'dashboard.review'],
    GovernanceApprover: ['projects.review.governance', 'rules.manage', 'projects.override', 'dashboard.review'],
    ExecutiveApprover: [
        'projects.review.executive',
        'projects.review.governance',
        'rules.manage',
        'rules.manage.system',
        'projects.override',
        'dashboard.review'
    ]
};

const toRoleArray = (permission) => {
    const roles = Array.isArray(permission?.roles)
        ? permission.roles
        : (permission?.role ? [permission.role] : []);

    return roles
        .map(r => typeof r === 'string' ? r.trim() : '')
        .filter(Boolean);
};

const getDepartmentId = (permission) => {
    const department = permission?.department;
    if (!department) return null;
    if (typeof department === 'string') return department;
    if (department._id) return String(department._id);
    return String(department);
};

const buildRoleCatalog = (roleDocs = []) => {
    const roleCatalog = {};
    roleDocs.forEach((role) => {
        const key = typeof role.key === 'string' ? role.key.trim() : '';
        if (!key) return;
        roleCatalog[key] = Array.isArray(role.capabilities) ? role.capabilities.filter(Boolean) : [];
    });
    return roleCatalog;
};

const getRoleCapabilities = (roleKey, roleCatalog = {}) => {
    if (roleCatalog[roleKey]) return roleCatalog[roleKey];
    return LEGACY_ROLE_CAPABILITIES[roleKey] || [];
};

const sanitizePermissions = (permissions = [], validRoleKeys = null) => {
    return (permissions || [])
        .map((permission) => {
            const roles = toRoleArray(permission);
            const filteredRoles = validRoleKeys
                ? roles.filter(role => validRoleKeys.has(role))
                : roles;

            return {
                department: permission.department || null,
                roles: Array.from(new Set(filteredRoles))
            };
        })
        .filter(permission => permission.roles.length > 0 || permission.department);
};

const collectUserCapabilities = (user, roleCatalog = {}) => {
    const caps = new Set();
    (user?.permissions || []).forEach((permission) => {
        toRoleArray(permission).forEach((roleKey) => {
            getRoleCapabilities(roleKey, roleCatalog).forEach(cap => caps.add(cap));
        });
    });
    return Array.from(caps);
};

const roleMatches = (user, requiredRoleKeys = [], departmentId = null) => {
    if (!Array.isArray(requiredRoleKeys) || requiredRoleKeys.length === 0) return true;
    if (user?.isAdmin) return true;

    return (user?.permissions || []).some((permission) => {
        const permissionDeptId = getDepartmentId(permission);
        const deptMatches = !departmentId || permissionDeptId === String(departmentId);
        if (!deptMatches) return false;
        return toRoleArray(permission).some(roleKey => requiredRoleKeys.includes(roleKey));
    });
};

const capabilityTokenMatches = (capability, requiredToken) => {
    if (!requiredToken || !capability) return false;
    if (requiredToken.endsWith('*')) {
        const prefix = requiredToken.slice(0, -1);
        return capability.startsWith(prefix);
    }
    return capability === requiredToken;
};

const hasAnyCapability = (user, requiredCapabilities = [], departmentId = null, roleCatalog = null) => {
    if (!Array.isArray(requiredCapabilities) || requiredCapabilities.length === 0) return true;
    if (user?.isAdmin) return true;

    const catalog = roleCatalog || user?.roleCatalog || {};

    return (user?.permissions || []).some((permission) => {
        const permissionDeptId = getDepartmentId(permission);
        const deptMatches = !departmentId || permissionDeptId === String(departmentId);
        if (!deptMatches) return false;

        const permissionCapabilities = toRoleArray(permission)
            .flatMap(roleKey => getRoleCapabilities(roleKey, catalog));

        return permissionCapabilities.some(capability =>
            requiredCapabilities.some(required => capabilityTokenMatches(capability, required))
        );
    });
};

const getDepartmentsForCapabilities = (user, requiredCapabilities = [], roleCatalog = null) => {
    const catalog = roleCatalog || user?.roleCatalog || {};
    const departments = new Set();

    (user?.permissions || []).forEach((permission) => {
        const deptId = getDepartmentId(permission);
        if (!deptId) return;

        const permissionCapabilities = toRoleArray(permission)
            .flatMap(roleKey => getRoleCapabilities(roleKey, catalog));

        const matches = permissionCapabilities.some(capability =>
            requiredCapabilities.some(required => capabilityTokenMatches(capability, required))
        );

        if (matches) departments.add(deptId);
    });

    return Array.from(departments);
};

module.exports = {
    LEGACY_ROLE_CAPABILITIES,
    toRoleArray,
    getDepartmentId,
    buildRoleCatalog,
    getRoleCapabilities,
    sanitizePermissions,
    collectUserCapabilities,
    roleMatches,
    hasAnyCapability,
    getDepartmentsForCapabilities
};
