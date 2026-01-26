const { getUserInfo } = require('../config/oidc');

// Middleware to require authentication
const requireAuth = async (req, res, next) => {
    try {
        // Check for session-based authentication
        if (req.session && req.session.user) {
            req.user = req.session.user;
            return next();
        }

        // Check for Bearer token in Authorization header
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const accessToken = authHeader.substring(7);

            try {
                // Verify token with Identity Provider
                const userinfo = await getUserInfo(accessToken);

                req.user = {
                    id: userinfo.sub,
                    email: userinfo.email,
                    name: userinfo.name,
                    organizations: userinfo.organizations || [],
                    teams: userinfo.teams || [],
                    currentOrganization: userinfo.currentOrganization,
                    accessToken,
                    userinfo,
                };

                return next();
            } catch (tokenError) {
                console.error('Token verification failed:', tokenError.message);
                return res.status(401).json({
                    error: 'Invalid or expired access token',
                    code: 'INVALID_TOKEN',
                });
            }
        }

        // No authentication found
        return res.status(401).json({
            error: 'Authentication required',
            code: 'AUTH_REQUIRED',
        });
    } catch (error) {
        console.error('Auth middleware error:', error);
        return res.status(500).json({
            error: 'Authentication error',
            code: 'AUTH_ERROR',
        });
    }
};

// Middleware to optionally get user if authenticated
const optionalAuth = async (req, res, next) => {
    try {
        if (req.session && req.session.user) {
            req.user = req.session.user;
        }

        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const accessToken = authHeader.substring(7);

            try {
                const userinfo = await getUserInfo(accessToken);
                req.user = {
                    id: userinfo.sub,
                    email: userinfo.email,
                    name: userinfo.name,
                    organizations: userinfo.organizations || [],
                    teams: userinfo.teams || [],
                    currentOrganization: userinfo.currentOrganization,
                    accessToken,
                    userinfo,
                };
            } catch (tokenError) {
                console.warn('Optional auth token invalid:', tokenError.message);
            }
        }

        next();
    } catch (error) {
        console.error('Optional auth middleware error:', error);
        next();
    }
};

// Middleware to require organization context
const requireOrganization = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({
            error: 'Authentication required',
            code: 'AUTH_REQUIRED',
        });
    }

    const currentOrg = req.user.currentOrganization ||
        (req.user.organizations && req.user.organizations.length > 0 ? req.user.organizations[0] : null);

    if (!currentOrg) {
        return res.status(403).json({
            error: 'Organization context required',
            code: 'ORG_REQUIRED',
        });
    }

    req.organizationId = currentOrg.id;
    req.organizationName = currentOrg.name;
    req.organizationRole = currentOrg.role;

    next();
};

// Check if user has HR/Admin access
const isHRAdmin = (req) => {
    const role = req.organizationRole;
    return ['owner', 'admin', 'hr_manager'].includes(role);
};

// Check if user is a line manager
const isLineManager = (req) => {
    const teams = req.user.teams || [];
    return teams.some(team =>
        team.organizationId === req.organizationId &&
        ['line_manager', 'team_lead'].includes(team.role)
    );
};

// Middleware to require HR Admin access
const requireHRAdmin = (req, res, next) => {
    if (!isHRAdmin(req)) {
        return res.status(403).json({
            error: 'HR Admin access required',
            code: 'INSUFFICIENT_PERMISSIONS',
        });
    }
    next();
};

// Middleware to require manager access
const requireManager = (req, res, next) => {
    if (!isHRAdmin(req) && !isLineManager(req)) {
        return res.status(403).json({
            error: 'Manager access required',
            code: 'INSUFFICIENT_PERMISSIONS',
        });
    }
    next();
};

module.exports = {
    requireAuth,
    optionalAuth,
    requireOrganization,
    requireHRAdmin,
    requireManager,
    isHRAdmin,
    isLineManager,
};
