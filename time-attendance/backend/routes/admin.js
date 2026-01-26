const express = require('express');
const router = express.Router();
const { requireAuth, requireOrganization, requireHRAdmin } = require('../middleware/auth');
const { AttendancePolicy } = require('../models');

// Apply auth middleware
router.use(requireAuth);
router.use(requireOrganization);
router.use(requireHRAdmin);

// Get defined policy
router.get('/policy', async (req, res) => {
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
});

// Update policy
router.put('/policy', async (req, res) => {
    try {
        const organizationId = req.organizationId;
        const updates = req.body;

        // Prevent overwriting read-only fields
        delete updates.organizationId;
        delete updates.organizationName;
        delete updates.createdAt;
        delete updates.updatedAt;
        delete updates._id;

        updates.updatedBy = req.user.id;
        updates.updatedAt = new Date();

        const policy = await AttendancePolicy.findOneAndUpdate(
            { organizationId },
            { $set: updates },
            { new: true, upsert: true }
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

module.exports = router;
