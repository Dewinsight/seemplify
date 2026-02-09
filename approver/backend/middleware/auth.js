const jwt = require('jsonwebtoken');
const UserOrganization = require('../models/UserOrganization');

const verifyToken = (req, res, next) => {
    const token = req.headers['authorization'];

    if (!token) {
        return res.status(403).json({ error: 'No token provided' });
    }

    try {
        const bearer = token.split(' ')[1]; // Bearer <token>
        const decoded = jwt.verify(bearer, process.env.JWT_SECRET || 'default_secret');
        req.user = decoded;
        next();
    } catch (error) {
        return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }
};

const verifyRole = (requiredRoles) => {
    return (req, res, next) => {
        // 1. Org-level Admin always passes
        if (req.user.isAdmin) {
            return next();
        }

        // 2. Check legacy role field (if present) for backward compatibility
        if (req.user.role && requiredRoles.includes(req.user.role)) {
            return next();
        }

        // 3. Check Permissions Array - supports multiple roles per department
        if (req.user.permissions && req.user.permissions.some(p => {
            const userRoles = p.roles || (p.role ? [p.role] : []);
            return userRoles.some(r => requiredRoles.includes(r));
        })) {
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

        req.organization = orgId;
        req.membership = membership;
        // Inject org-specific role data into req.user for downstream middleware (verifyRole)
        req.user.isAdmin = membership.isAdmin;
        req.user.permissions = membership.permissions;
        next();
    } catch (error) {
        return res.status(500).json({ error: 'Error validating organization context' });
    }
};

// Optional token - parses token if present but doesn't require it
const optionalToken = (req, res, next) => {
    const token = req.headers['authorization'];
    if (!token) return next();

    try {
        const bearer = token.split(' ')[1];
        const decoded = jwt.verify(bearer, process.env.JWT_SECRET || 'default_secret');
        req.user = decoded;
    } catch (error) {
        // Token invalid - continue without user context
    }
    next();
};

module.exports = { verifyToken, verifyRole, injectOrgContext, optionalToken };
