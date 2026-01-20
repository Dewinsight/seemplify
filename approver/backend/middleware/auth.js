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

const verifyRole = (roles) => {
    return (req, res, next) => {
        // 1. Global Admin always passes (unless explicitly excluded, but usually yes)
        if (req.user.isAdmin) {
            return next();
        }

        // 2. Check legacy role (if present)
        if (req.user.role && roles.includes(req.user.role)) {
            return next();
        }

        // 3. Check Permissions Array
        // If the user has ANY permission that matches the required role(s), we let them in.
        // This is a "Global Access" check (e.g. can view dashboard).
        // Specific resource checks (e.g. "Can approve Project X") must be done in the Controller.
        if (req.user.permissions && req.user.permissions.some(p => roles.includes(p.role))) {
            return next();
        }

        return res.status(403).json({ error: 'Forbidden: Insufficient permissions' });
    };
};

module.exports = { verifyToken, verifyRole };
