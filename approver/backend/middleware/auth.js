const jwt = require('jsonwebtoken');
const UserOrganization = require('../models/UserOrganization');
const Role = require('../models/Role');
const { ensureGovernanceConfigForOrganization } = require('../services/governanceConfigService');
const User = require('../models/User');
const { extractTokenFromRequest, parseCookieHeader } = require('../utils/authSession');
const {
    buildRoleCatalog,
    sanitizePermissions,
    collectUserCapabilities,
    toRoleArray,
    hasAnyCapability
} = require('../utils/access');

const verifyToken = async (req, res, next) => {
    const token = extractTokenFromRequest(req);

    if (!token) {
        return res.status(403).json({ error: 'No token provided' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'default_secret');
        const logoutAt = Number(parseCookieHeader(req.headers.cookie).seemplify_logout_at || 0);
        if (logoutAt && Number(decoded.iat || 0) * 1000 <= logoutAt) {
            return res.status(401).json({ error: 'Session ended centrally' });
        }
        if (decoded.authProvider === 'seemplify-idp') {
            const user = await User.findById(decoded.id).select('idpSubject sessionVersion');
            if (!user || user.idpSubject !== decoded.sub || Number(user.sessionVersion || 0) !== Number(decoded.sv || 0)) {
                return res.status(401).json({ error: 'Session access has changed. Sign in again.' });
            }
        }
        req.user = decoded;
        next();
    } catch (error) {
        return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }
};

const verifyRole = (requiredRoles) => {
    return (req, res, next) => {
        const required = Array.isArray(requiredRoles) ? requiredRoles : [requiredRoles];
        if (required.length === 0) return next();

        // 1. Org-level Admin always passes
        if (req.user.isAdmin) {
            return next();
        }

        // 2. Check legacy role field (if present) for backward compatibility
        if (req.user.role && required.includes(req.user.role)) {
            return next();
        }

        // 3. Direct role key match (dynamic role catalog)
        const userRoleKeys = new Set();
        (req.user.permissions || []).forEach((permission) => {
            toRoleArray(permission).forEach(roleKey => userRoleKeys.add(roleKey));
        });
        if (Array.from(userRoleKeys).some(roleKey => required.includes(roleKey))) {
            return next();
        }

        // 4. Capability match
        if (hasAnyCapability(req.user, required, null, req.user.roleCatalog || {})) {
            return next();
        }

        return res.status(403).json({ error: 'Forbidden: Insufficient permissions' });
    };
};

// Inject organization context from X-Organization-Id header
// Validates user actually belongs to the org via UserOrganization lookup
const injectOrgContext = async (req, res, next) => {
    const orgId = req.headers['x-organization-id'];
    if (!orgId) {
        return res.status(403).json({ error: 'No organization context. Select an organization.' });
    }

    try {
        const membership = await UserOrganization.findOne({
            user: req.user.id,
            organization: orgId
        }).populate('permissions.department');

        if (!membership) {
            return res.status(403).json({ error: 'You do not belong to this organization.' });
        }

        let roleDocs = await Role.find({ organization: orgId, isActive: true }, 'key capabilities');
        if (roleDocs.length === 0) {
            await ensureGovernanceConfigForOrganization(orgId);
            roleDocs = await Role.find({ organization: orgId, isActive: true }, 'key capabilities');
        }
        const roleCatalog = buildRoleCatalog(roleDocs);
        const centralCapabilities = Array.isArray(membership.idpCapabilities)
            ? membership.idpCapabilities.filter(Boolean)
            : null;
        if (centralCapabilities) roleCatalog.__idp = centralCapabilities;
        const validRoleKeys = Object.keys(roleCatalog);

        req.organization = orgId;
        req.membership = membership;
        // Inject org-specific role data into req.user for downstream middleware (verifyRole)
        req.user.isAdmin = centralCapabilities
            ? centralCapabilities.includes('roles.manage')
            : membership.isAdmin;
        req.user.permissions = centralCapabilities
            ? [{ department: null, roles: ['__idp'] }]
            : sanitizePermissions(
                membership.permissions || [],
                validRoleKeys.length > 0 ? new Set(validRoleKeys) : null
            );
        req.user.roleCatalog = roleCatalog;
        req.user.capabilities = collectUserCapabilities(req.user, roleCatalog);
        next();
    } catch (error) {
        return res.status(500).json({ error: 'Error validating organization context' });
    }
};

// Optional token - parses token if present but doesn't require it
const optionalToken = (req, res, next) => {
    const token = extractTokenFromRequest(req);
    if (!token) return next();

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'default_secret');
        req.user = decoded;
    } catch (error) {
        // Token invalid - continue without user context
    }
    next();
};

module.exports = { verifyToken, verifyRole, injectOrgContext, optionalToken };
