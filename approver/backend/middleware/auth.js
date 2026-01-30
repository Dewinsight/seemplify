const jwt = require('jsonwebtoken');

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
        // 1. Global Admin always passes
        if (req.user.isAdmin) {
            return next();
        }

        // 2. Check legacy role field (if present) for backward compatibility
        if (req.user.role && requiredRoles.includes(req.user.role)) {
            return next();
        }

        // 3. Check Permissions Array - now supports multiple roles per department
        // User has access if ANY of their roles in ANY department matches required roles
        if (req.user.permissions && req.user.permissions.some(p => {
            // Handle both old format (p.role) and new format (p.roles array)
            const userRoles = p.roles || (p.role ? [p.role] : []);
            return userRoles.some(r => requiredRoles.includes(r));
        })) {
            return next();
        }

        return res.status(403).json({ error: 'Forbidden: Insufficient permissions' });
    };
};

module.exports = { verifyToken, verifyRole };
