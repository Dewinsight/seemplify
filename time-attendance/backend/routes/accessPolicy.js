const express = require('express');
const { requireAuth, requireOrganization } = require('../middleware/auth');
const {
    PERMISSIONS,
    requireAttendancePermission,
} = require('../services/attendanceAccessService');

const router = express.Router();

router.use(requireAuth, requireOrganization, requireAttendancePermission(PERMISSIONS.ACCESS_MANAGE));

router.get('/', async (req, res, next) => {
    try {
        const identityBaseUrl = String(process.env.IDP_PUBLIC_URL || process.env.IDP_ISSUER_URL || process.env.OIDC_ISSUER || 'http://localhost:4000').replace(/\/$/, '');
        res.json({
            managedBy: 'seemplify-idp',
            manageUrl: `${identityBaseUrl}/organizations/${encodeURIComponent(req.organizationId)}/access-control`,
        });
    } catch (error) {
        next(error);
    }
});

const centrallyManaged = (_req, res) => res.status(409).json({
    error: 'Time & Attendance roles are managed in Seemplify Identity.',
    code: 'ACCESS_POLICY_MANAGED_BY_IDP',
});

router.put('/', centrallyManaged);
router.get('/people', centrallyManaged);
router.put('/people/:userId', centrallyManaged);

module.exports = router;
