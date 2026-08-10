const express = require('express');
const { requireAuth, requireOrganization } = require('../middleware/auth');
const { AttendanceAccessPolicy, EmployeeRoster } = require('../models');
const {
    EDITABLE_PERMISSIONS,
    PERMISSIONS,
    getOrCreateAccessPolicy,
    requireAttendancePermission,
} = require('../services/attendanceAccessService');

const router = express.Router();

router.use(requireAuth, requireOrganization, requireAttendancePermission(PERMISSIONS.ACCESS_MANAGE));

router.get('/', async (req, res, next) => {
    try {
        const policy = await getOrCreateAccessPolicy(req.organizationId, req.user);
        res.json({ policy, editablePermissions: EDITABLE_PERMISSIONS });
    } catch (error) {
        next(error);
    }
});

router.put('/', async (req, res, next) => {
    try {
        const policy = await getOrCreateAccessPolicy(req.organizationId, req.user);
        const incoming = Array.isArray(req.body.roles) ? req.body.roles : [];
        const allowed = new Set(EDITABLE_PERMISSIONS);
        for (const role of policy.roles) {
            if (role.locked) continue;
            const update = incoming.find(item => item.key === role.key);
            if (!update) continue;
            role.permissions = Array.from(new Set((update.permissions || []).filter(permission => allowed.has(permission))));
        }
        policy.updatedBy = req.user.id;
        policy.auditLog.push({
            action: 'role_permissions_updated',
            actorId: req.user.id,
            actorName: req.user.name,
            details: 'Updated Time & Attendance role permissions.',
        });
        await policy.save();
        res.json({ policy, editablePermissions: EDITABLE_PERMISSIONS });
    } catch (error) {
        next(error);
    }
});

router.get('/people', async (req, res, next) => {
    try {
        const query = String(req.query.q || '').trim();
        const filter = { organizationId: req.organizationId, status: 'active' };
        if (query) filter.$or = [
            { name: { $regex: query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
            { email: { $regex: query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
        ];
        const people = await EmployeeRoster.find(filter).select('userId name email role').sort({ name: 1 }).limit(50).lean();
        const policy = await getOrCreateAccessPolicy(req.organizationId, req.user);
        res.json({
            people: people.map(person => ({
                ...person,
                roleKeys: policy.assignments.find(item => String(item.userId) === String(person.userId))?.roleKeys || [],
            })),
        });
    } catch (error) {
        next(error);
    }
});

router.put('/people/:userId', async (req, res, next) => {
    try {
        const person = await EmployeeRoster.findOne({ organizationId: req.organizationId, userId: req.params.userId, status: 'active' }).lean();
        if (!person) return res.status(404).json({ error: 'Employee not found in this organization' });
        const policy = await getOrCreateAccessPolicy(req.organizationId, req.user);
        const assignable = new Set(policy.roles.filter(role => !role.locked).map(role => role.key));
        const roleKeys = Array.from(new Set((req.body.roleKeys || []).filter(roleKey => assignable.has(roleKey))));
        const existing = policy.assignments.find(item => String(item.userId) === String(person.userId));
        const value = {
            userId: person.userId,
            userName: person.name,
            userEmail: person.email,
            roleKeys,
            assignedBy: req.user.id,
            assignedByName: req.user.name,
            assignedAt: new Date(),
        };
        if (existing) Object.assign(existing, value);
        else policy.assignments.push(value);
        policy.updatedBy = req.user.id;
        policy.auditLog.push({
            action: 'person_roles_updated',
            actorId: req.user.id,
            actorName: req.user.name,
            details: `${person.name || person.email || person.userId}: ${roleKeys.join(', ') || 'automatic IDP roles only'}`,
        });
        await policy.save();
        res.json({ assignment: value });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
