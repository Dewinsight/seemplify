const express = require('express');
const router = express.Router();
const { requireAuth, requireOrganization, requireHRAdmin } = require('../middleware/auth');
const { AttendancePolicy } = require('../models');
const { normalizeApprovalSettings } = require('../services/approvalConfigurationService');

function sanitizePolicyUpdate(input = {}) {
    const allowed = [
        'workSchedule', 'overtime', 'gracePeriod', 'restRules', 'timesheetSettings', 'clockSettings',
        'geofencing', 'notifications', 'payroll', 'presence', 'timezone', 'jurisdiction', 'activeRulePack',
    ];
    const output = {};
    for (const key of allowed) {
        if (input[key] !== undefined) output[key] = input[key];
    }

    // Migrate values produced by the old settings screen without persisting duplicate fields.
    if (output.workSchedule?.startTime || output.workSchedule?.endTime) {
        output.workSchedule.defaultShift = {
            ...(output.workSchedule.defaultShift || {}),
            startTime: output.workSchedule.startTime || output.workSchedule.defaultShift?.startTime,
            endTime: output.workSchedule.endTime || output.workSchedule.defaultShift?.endTime,
        };
        delete output.workSchedule.startTime;
        delete output.workSchedule.endTime;
    }
    if (output.overtime?.thresholdMinutes !== undefined && output.overtime.dailyThreshold === undefined) {
        output.overtime.dailyThreshold = Number(output.overtime.thresholdMinutes) / 60;
        delete output.overtime.thresholdMinutes;
    }
    if (output.overtime?.dailyLimitMinutes !== undefined && output.overtime.dailyLimitHours === undefined) {
        output.overtime.dailyLimitHours = Number(output.overtime.dailyLimitMinutes) / 60;
        delete output.overtime.dailyLimitMinutes;
    }
    if (output.timesheetSettings) {
        output.timesheetSettings = normalizeApprovalSettings(output.timesheetSettings);
    }
    return output;
}

// Apply auth middleware
router.use(requireAuth);
router.use(requireOrganization);
router.use(requireHRAdmin);

async function getPolicyHandler(req, res) {
    try {
        const organizationId = req.organizationId;

        // Get existing policy or create default
        const policy = await AttendancePolicy.getOrCreateDefault(
            organizationId,
            req.organizationName,
            req.user.id
        );

        res.json({ policy });
    } catch (error) {
        console.error('Get policy error:', error);
        res.status(500).json({ error: 'Failed to get policy' });
    }
}

// Backward-compatible aliases for fetching policy
router.get('/policy', getPolicyHandler);
router.get('/attendance-policy', getPolicyHandler);

// Update attendance policy  
router.put('/attendance-policy', async (req, res) => {
    try {
        const organizationId = req.organizationId;
        const updates = sanitizePolicyUpdate(req.body);

        updates.updatedBy = req.user.id;
        updates.updatedAt = new Date();

        const policy = await AttendancePolicy.findOneAndUpdate(
            { organizationId },
            { $set: updates },
            { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
        );

        res.json({
            success: true,
            policy,
            message: 'Policy updated successfully'
        });
    } catch (error) {
        console.error('Update policy error:', error);
        res.status(500).json({ error: 'Failed to update policy' });
    }
});

// Add geofence location
router.post('/geofence-locations', async (req, res) => {
    try {
        const organizationId = req.organizationId;
        const { name, address, latitude, longitude, radius } = req.body;

        // Validation
        if (!name || !Number.isFinite(Number(latitude)) || !Number.isFinite(Number(longitude))) {
            return res.status(400).json({ error: 'Name, latitude, and longitude are required' });
        }

        if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
            return res.status(400).json({ error: 'Invalid coordinates' });
        }

        const policy = await AttendancePolicy.findOne({ organizationId });
        if (!policy) {
            return res.status(404).json({ error: 'Policy not found' });
        }

        // Add new location
        policy.geofencing.locations.push({
            name,
            address: address || '',
            latitude,
            longitude,
            radius: radius || 100, // Default 100m
            isActive: true,
        });

        policy.updatedBy = req.user.id;
        await policy.save();

        res.json({
            success: true,
            policy,
            message: 'Geofence location added successfully'
        });
    } catch (error) {
        console.error('Add geofence location error:', error);
        res.status(500).json({ error: 'Failed to add geofence location' });
    }
});

// Update geofence location
router.put('/geofence-locations/:index', async (req, res) => {
    try {
        const organizationId = req.organizationId;
        const locationIndex = parseInt(req.params.index);
        const { name, address, latitude, longitude, radius, isActive } = req.body;

        const policy = await AttendancePolicy.findOne({ organizationId });
        if (!policy) {
            return res.status(404).json({ error: 'Policy not found' });
        }

        if (locationIndex < 0 || locationIndex >= policy.geofencing.locations.length) {
            return res.status(404).json({ error: 'Location not found' });
        }

        // Update location
        const location = policy.geofencing.locations[locationIndex];
        if (name !== undefined) location.name = name;
        if (address !== undefined) location.address = address;
        if (latitude !== undefined) location.latitude = latitude;
        if (longitude !== undefined) location.longitude = longitude;
        if (radius !== undefined) location.radius = radius;
        if (isActive !== undefined) location.isActive = isActive;

        policy.updatedBy = req.user.id;
        await policy.save();

        res.json({
            success: true,
            policy,
            message: 'Geofence location updated successfully'
        });
    } catch (error) {
        console.error('Update geofence location error:', error);
        res.status(500).json({ error: 'Failed to update geofence location' });
    }
});

// Delete geofence location
router.delete('/geofence-locations/:index', async (req, res) => {
    try {
        const organizationId = req.organizationId;
        const locationIndex = parseInt(req.params.index);

        const policy = await AttendancePolicy.findOne({ organizationId });
        if (!policy) {
            return res.status(404).json({ error: 'Policy not found' });
        }

        if (locationIndex < 0 || locationIndex >= policy.geofencing.locations.length) {
            return res.status(404).json({ error: 'Location not found' });
        }

        // Remove location
        policy.geofencing.locations.splice(locationIndex, 1);
        policy.updatedBy = req.user.id;
        await policy.save();

        res.json({
            success: true,
            policy,
            message: 'Geofence location deleted successfully'
        });
    } catch (error) {
        console.error('Delete geofence location error:', error);
        res.status(500).json({ error: 'Failed to delete geofence location' });
    }
});

module.exports = router;
